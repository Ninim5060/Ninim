export default async function handler(req, res) {
    // Chỉ nhận request dạng POST
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    // Lấy API Key bí mật từ môi trường của Vercel (bảo mật 100%)
    const API_KEY = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

    try {
        // Chuyển tiếp tin nhắn của bạn sang Google
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        
        const data = await response.json();
        res.status(200).json(data); // Trả câu trả lời về cho web
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}