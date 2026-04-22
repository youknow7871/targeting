export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    
    try {
        const { prompt } = req.body;
        const apiKey = process.env.GEMINI_API_KEY;
        
        if (!apiKey) {
            return res.status(500).json({ error: 'Server configuration error: GEMINI_API_KEY is missing in Vercel Environment Variables.' });
        }

        const fetchConfig = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.7
                }
            })
        };

        const candidateModels = [
            'gemini-3.1-pro-preview', // prioritize superior Pro model
            'gemini-flash-latest', 
            'gemini-1.5-flash-latest', 
            'gemini-pro-latest',
            'gemini-pro'
        ];
        
        let response = null;
        let finalModel = null;
        let lastErrText = "";

        for (const model of candidateModels) {
            try {
                response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, fetchConfig);
                
                if (response.ok) {
                    finalModel = model;
                    break;
                } else {
                    lastErrText = await response.text();
                }
            } catch (e) {
                lastErrText = e.message;
            }
        }

        if (!finalModel || !response || !response.ok) {
            let errMsg = lastErrText;
            try {
                const errJson = JSON.parse(lastErrText);
                errMsg = errJson.error ? errJson.error.message : lastErrText;
            } catch(e) {}
            return res.status(500).json({ error: errMsg || "Failed to call Gemini API." });
        }

        const data = await response.json();
        return res.status(200).json(data);

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
