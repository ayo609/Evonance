export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Kept here directly since this file only runs on the server (Vercel), never sent
    // to the browser. Fine as long as your code repo stays private.
    const FLW_SECRET_KEY = 'FLWSECK-a48127ddd28d0a14842e99613a4a978f-19ff176de08vt-X';

    const response = await fetch('https://api.flutterwave.com/v3/banks/NG', {
      headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` },
    });
    const data = await response.json();

    if (data.status !== 'success') {
      console.error('Flutterwave bank list error:', data);
      return res.status(502).json({ error: 'Could not fetch bank list' });
    }

    // Each item: { id, code, name }
    res.status(200).json({ banks: data.data });
  } catch (error) {
    console.error('Bank list error:', error);
    res.status(500).json({ error: error.message });
  }
}
