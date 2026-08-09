export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { amount, order_id, callback_url, email } = req.body;

  // Build the direct NekPayment checkout URL (this always works)
  const paymentUrl = 'https://mch.nekpayment.com/pay' +
    '?merchant_id=300258219' +
    '&amount=' + amount +
    '&order_id=' + order_id +
    '&currency=NGN' +
    '&channel_id=523' +
    '&callback_url=' + encodeURIComponent(callback_url) +
    '&email=' + encodeURIComponent(email || '') +
    '&description=Deposit+to+Evonance';

  res.status(200).json({ status: 'success', payment_url: paymentUrl });
}
