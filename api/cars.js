// Vercel Serverless Function: Proxy für die API Ninjas Cars API.
// Liegt im echten Projekt unter:  api/cars.js
// Hält den geheimen Schlüssel serverseitig (NIE im Browser!).
//
// Setze in Vercel unter Settings -> Environment Variables:
//   API_NINJAS_KEY = dein_api_ninjas_schluessel
//
// Aufruf vom Frontend:  /api/cars?endpoint=carmodels&make=Audi

export default async function handler(req, res) {
  const KEY = process.env.API_NINJAS_KEY;
  if (!KEY) {
    return res.status(500).json({ error: 'API_NINJAS_KEY ist nicht gesetzt (Vercel Env-Var).' });
  }

  const { endpoint, make, model, trim, limit, offset, year } = req.query;

  // Nur erlaubte Endpunkte durchlassen
  const allowed = ['carmakes', 'carmodels', 'cartrims', 'cardetails', 'cars'];
  if (!allowed.includes(endpoint)) {
    return res.status(400).json({ error: 'Ungültiger endpoint-Parameter.' });
  }

  // Parameter sauber weiterreichen
  const params = new URLSearchParams();
  if (make) params.set('make', make);
  if (model) params.set('model', model);
  if (trim) params.set('trim', trim);
  if (limit) params.set('limit', limit);
  if (offset) params.set('offset', offset);
  if (year) params.set('year', year);

  const url = `https://api.api-ninjas.com/v1/${endpoint}?${params.toString()}`;

  try {
    const upstream = await fetch(url, { headers: { 'X-Api-Key': KEY } });
    const text = await upstream.text();
    // Status (z.B. 400/403 bei fehlendem Abo) durchreichen, damit das
    // Frontend eine sinnvolle Meldung anzeigen kann.
    res.status(upstream.status);
    res.setHeader('Content-Type', 'application/json');
    // 24h cachen – Fahrzeugdaten ändern sich praktisch nie (spart Quota)
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    return res.send(text);
  } catch (e) {
    return res.status(502).json({ error: 'Fehler bei der Anfrage an API Ninjas.' });
  }
}