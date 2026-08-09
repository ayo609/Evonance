export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { amount, order_id, callback_url, email } = req.body;

    // Use the CORRECT web payment endpoint
    const paymentUrl = 'https://api.nekpayment.com/pay/web' +
      '?mchId=977977001' +
      '&amount=' + amount +
      '&mchOrderNo=' + order_id +
      '&currency=NGN' +
      '&channel_id=523' +
      '&callback_url=' + encodeURIComponent(callback_url) +
      '&email=' + encodeURIComponent(email || '') +
      '&signType=MD5';

    console.log('Payment URL:', paymentUrl);
    res.status(200).json({ status: 'success', payment_url: paymentUrl });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
