export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const keys = [
        process.env.GEMINI_API_KEY_1,
        process.env.GEMINI_API_KEY_2
    ].filter(Boolean);

    if (keys.length === 0) {
        return res.status(500).json({ error: { message: "Chưa cấu hình API Key trên Vercel!" } });
    }

    for (let i = 0; i < keys.length; i++) {
        // Bạn có thể đổi tên model ở đây nếu muốn test thử bản khác
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${keys[i]}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            });
            
            const data = await response.json();

            if (data.error && data.error.message.includes('Quota')) {
                continue; // Thử key tiếp theo
            }

            return res.status(200).json(data);

        } catch (error) {
            if (i === keys.length - 1) {
                break;
            }
        }
    }
    
    // Nếu tất cả các key đều quá tải, trả về câu thông báo yêu kiều này thay vì đống code đỏ lòe
    return res.status(200).json({
        candidates: [{
            content: {
                parts: [{
                    text: "Bé Mèo đang bị quá tải vì có quá nhiều người nhắn cùng lúc rùi! Bạn đợi chừng 20-30 giây rồi nhắn lại nha ế >.<"
                }]
            }
        }]
    });
}