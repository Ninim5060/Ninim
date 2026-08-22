export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({
            error: {
                message: 'Method Not Allowed'
            }
        });
    }

    // =========================================================
    // RATE LIMIT
    // Tối đa 5 request / phút / IP
    //
    // Lưu ý:
    // Đây là rate limit cơ bản trên từng instance Vercel.
    // Nếu sau này web đông người, nên dùng Redis/KV để
    // rate limit được đồng bộ giữa nhiều instance.
    // =========================================================

    const RATE_LIMIT_MAX = 5;
    const RATE_LIMIT_WINDOW_MS = 60 * 1000;

    if (!globalThis.__aiCuteRateLimit) {
        globalThis.__aiCuteRateLimit = new Map();
    }

    function getClientIp(req) {
        const forwarded = req.headers['x-forwarded-for'];

        if (typeof forwarded === 'string' && forwarded.length > 0) {
            return forwarded.split(',')[0].trim();
        }

        return (
            req.headers['x-real-ip'] ||
            req.socket?.remoteAddress ||
            'unknown'
        );
    }

    function checkRateLimit(ip) {
        const now = Date.now();
        const old = globalThis.__aiCuteRateLimit.get(ip);

        // Chưa có IP hoặc đã hết 1 phút
        if (
            !old ||
            now - old.windowStart >= RATE_LIMIT_WINDOW_MS
        ) {
            globalThis.__aiCuteRateLimit.set(ip, {
                windowStart: now,
                count: 1
            });

            return {
                allowed: true,
                remaining: RATE_LIMIT_MAX - 1,
                retryAfter: 0
            };
        }

        // Đã vượt giới hạn
        if (old.count >= RATE_LIMIT_MAX) {
            const retryAfter = Math.ceil(
                (
                    RATE_LIMIT_WINDOW_MS -
                    (now - old.windowStart)
                ) / 1000
            );

            return {
                allowed: false,
                remaining: 0,
                retryAfter
            };
        }

        // Tăng số request
        old.count += 1;

        return {
            allowed: true,
            remaining: RATE_LIMIT_MAX - old.count,
            retryAfter: 0
        };
    }

    const clientIp = getClientIp(req);
    const rateLimit = checkRateLimit(clientIp);

    res.setHeader(
        'X-RateLimit-Limit',
        String(RATE_LIMIT_MAX)
    );

    res.setHeader(
        'X-RateLimit-Remaining',
        String(rateLimit.remaining)
    );

    // Nếu user gửi quá nhanh
    if (!rateLimit.allowed) {
        res.setHeader(
            'Retry-After',
            String(rateLimit.retryAfter)
        );

        return res.status(429).json({
            error: {
                message:
                    `Bạn gửi hơi nhanh rồi nè 😿 ` +
                    `Bé Mèo chỉ nhận tối đa ${RATE_LIMIT_MAX} lượt/phút. ` +
                    `Bạn thử lại sau ${rateLimit.retryAfter} giây nha >.<`
            }
        });
    }


    // =========================================================
    // API KEYS
    // Lấy từ Environment Variables trên Vercel
    // KHÔNG viết API key trực tiếp vào code.
    // =========================================================

    const keys = [
        process.env.GEMINI_API_KEY_1,
        process.env.GEMINI_API_KEY_2
    ].filter(Boolean);

    if (keys.length === 0) {
        return res.status(500).json({
            error: {
                message: 'Chưa cấu hình API Key trên Vercel!'
            }
        });
    }


    // =========================================================
    // RETRY / BACKOFF
    // =========================================================

    const MAX_RETRIES_PER_KEY = 2;

    const BASE_DELAY_MS = 1200;

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getRetryDelay(response, attempt) {

        // Nếu Gemini trả Retry-After
        const retryAfter =
            response.headers.get('retry-after');

        if (retryAfter) {
            const seconds = Number(retryAfter);

            if (Number.isFinite(seconds)) {
                return Math.min(
                    Math.max(seconds * 1000, 500),
                    15000
                );
            }
        }

        // Exponential backoff
        //
        // attempt 0 → 1.2 giây
        // attempt 1 → 2.4 giây
        // attempt 2 → 4.8 giây

        return Math.min(
            BASE_DELAY_MS * (2 ** attempt),
            8000
        );
    }

    function isRetryableStatus(status) {

        // 429 = rate limit / quota
        // 5xx = lỗi server tạm thời

        return [
            429,
            500,
            502,
            503,
            504
        ].includes(status);
    }

    function isDailyQuotaError(data) {

        const message =
            String(
                data?.error?.message || ''
            ).toLowerCase();

        return (
            message.includes('per day') ||
            message.includes('daily') ||
            message.includes('rpd') ||
            message.includes('requests per day')
        );
    }


    // =========================================================
    // GỌI GEMINI
    // =========================================================

    let lastError = null;

    // Key 1 → retry
    // Key 2 → retry
    //
    // Lưu ý:
    // Nếu 2 key cùng nằm trong một project,
    // quota project-level vẫn có thể dùng chung.

    for (
        let keyIndex = 0;
        keyIndex < keys.length;
        keyIndex++
    ) {

        const key = keys[keyIndex];

        for (
            let attempt = 0;
            attempt <= MAX_RETRIES_PER_KEY;
            attempt++
        ) {

            const url =
                `https://generativelanguage.googleapis.com/v1beta/models/` +
                `gemini-3.1-pro:generateContent?key=${encodeURIComponent(key)}`;

            try {

                const response = await fetch(
                    url,
                    {
                        method: 'POST',

                        headers: {
                            'Content-Type': 'application/json'
                        },

                        body: JSON.stringify(req.body)
                    }
                );

                const data =
                    await response.json().catch(() => ({}));


                // =================================================
                // THÀNH CÔNG
                // =================================================

                if (response.ok) {
                    return res.status(200).json(data);
                }


                // =================================================
                // LƯU LỖI
                // =================================================

                lastError =
                    data?.error || {
                        message:
                            `Gemini trả về HTTP ${response.status}`
                    };


                // =================================================
                // QUOTA THEO NGÀY
                // Retry liên tục không giúp ích
                // =================================================

                if (
                    response.status === 429 &&
                    isDailyQuotaError(data)
                ) {

                    console.warn(
                        `[Gemini] Key ${keyIndex + 1}: daily quota exhausted`
                    );

                    break;
                }


                // =================================================
                // LỖI KHÔNG NÊN RETRY
                //
                // Ví dụ:
                // 400
                // 401
                // 403
                // =================================================

                if (
                    !isRetryableStatus(
                        response.status
                    )
                ) {

                    return res.status(
                        response.status
                    ).json({
                        error: {
                            message:
                                lastError.message ||
                                `Gemini API lỗi HTTP ${response.status}`,

                            status:
                                lastError.status,

                            code:
                                lastError.code
                        }
                    });
                }


                console.warn(
                    `[Gemini] Key ${keyIndex + 1}, ` +
                    `attempt ${attempt + 1}: ` +
                    `HTTP ${response.status}`
                );


                // =================================================
                // RETRY
                // =================================================

                if (
                    attempt < MAX_RETRIES_PER_KEY
                ) {

                    const delay =
                        getRetryDelay(
                            response,
                            attempt
                        );

                    await sleep(delay);

                } else {

                    // Hết retry key hiện tại
                    // → chuyển sang key tiếp theo

                    break;
                }

            } catch (error) {

                lastError = {
                    message:
                        error?.message ||
                        'Lỗi kết nối tới Gemini API'
                };

                console.error(
                    `[Gemini] Key ${keyIndex + 1}, ` +
                    `attempt ${attempt + 1}:`,
                    error
                );


                // Retry lỗi mạng
                if (
                    attempt < MAX_RETRIES_PER_KEY
                ) {

                    await sleep(
                        BASE_DELAY_MS *
                        (2 ** attempt)
                    );

                } else {

                    break;
                }
            }
        }
    }


    // =========================================================
    // TẤT CẢ KEY ĐỀU THẤT BẠI
    // =========================================================

    const message =
        lastError?.message ||
        'Bé Mèo đang tạm quá tải. Bạn thử lại sau một chút nha >.<';


    // Trả 429 thật thay vì giả HTTP 200
    return res.status(429).json({
        error: {
            message:
                'Bé Mèo đang tạm quá tải hoặc đã chạm ' +
                'giới hạn sử dụng. Bạn đợi một chút rồi ' +
                'thử lại nha >.<',

            detail: message
        }
    });
}