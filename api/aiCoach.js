export default async function handler(req, res) {
  // --- CORS: erlaubt der App (anderer Origin) den Zugriff ---
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight-Anfrage des Browsers sofort beantworten
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Nur POST erlaubt.' });
  }

  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY ist nicht gesetzt (Vercel Env-Var).' });
  }

  // Body einlesen (Vercel parst JSON meist automatisch; Fallback für Sicherheit)
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const prompt = body?.prompt;
  const systemInstruction = body?.systemInstruction;

  if (!prompt) {
    return res.status(400).json({ error: 'prompt fehlt.' });
  }

  // Falls dieses Modell mal nicht mehr existiert, hier den aktuellen
  // Namen aus Google AI Studio eintragen.
  const MODEL = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
  };
  if (systemInstruction) {
    payload.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await upstream.json();

    if (!upstream.ok) {
      const msg = data?.error?.message || `Gemini-Fehler ${upstream.status}`;
      return res.status(upstream.status).json({ error: msg });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(502).json({ error: 'Fehler bei der Anfrage an Gemini.' });
  }
}