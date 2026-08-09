export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { amount, order_id, callback_url, email } = req.body;

    const response = await fetch('https://api.nekpayment.com/pay/uniqueurl', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer 222c2e39848744c4903f51e6515df0d4'
      },
      body: JSON.stringify({
        merchant_id: '300258219',
        amount: amount,
        order_id: order_id,
        currency: 'NGN',
        channel_id: '523',
        callback_url: callback_url,
        customer_email: email || '',
        description: 'Deposit to Evonance'
      })
    });

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
