export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { account_number, account_bank } = req.body;
    if (!account_number || !account_bank) {
      return res.status(400).json({ error: 'Missing account_number or account_bank' });
    }

    const FLW_SECRET_KEY = 'FLWSECK-a48127ddd28d0a14842e99613a4a978f-19ff176de08vt-X';

    const response = await fetch('https://api.flutterwave.com/v3/accounts/resolve', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${FLW_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ account_number, account_bank }),
    });
    const data = await response.json();

    if (data.status !== 'success') {
      return res.status(400).json({ error: data.message || 'Could not resolve account. Check the account number and bank.' });
    }

    res.status(200).json({ account_name: data.data.account_name });
  } catch (error) {
    console.error('Resolve account error:', error);
    res.status(500).json({ error: error.message });
  }
}
