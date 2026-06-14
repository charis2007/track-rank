export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
if (req.method === 'OPTIONS') {
  res.status(204).end();
  return;
}
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Nur POST erlaubt' });
  }

  const { prompt, systemInstruction } = req.body || {};
  const apiKey = process.env.GEMINI_API_KEY; // kommt aus den Vercel-Einstellungen

  if (!apiKey) {
    return res.status(500).json({ error: 'Kein API-Key konfiguriert' });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
      }),
    });
    const data = await r.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Keine Antwort erhalten.';
    res.status(200).json({ text });
  } catch (e) {
    res.status(500).json({ error: 'KI-Aufruf fehlgeschlagen' });
  }
}