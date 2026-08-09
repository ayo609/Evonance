import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { amount, order_id, callback_url, email } = req.body;

    if (!amount || !order_id || !callback_url) {
      return res.status(400).json({ error: 'Missing required fields: amount, order_id, callback_url' });
    }

    // Pull credentials from environment variables — never hardcode these.
    // Set NEK_MCH_ID and NEK_PAYMENT_KEY in your Vercel project settings (Environment Variables).
    const mchId = process.env.NEK_MCH_ID;
    const paymentKey = process.env.NEK_PAYMENT_KEY;
    const channelId = process.env.NEK_CHANNEL_ID || '523';

    if (!mchId || !paymentKey) {
      console.error('Missing NEK_MCH_ID or NEK_PAYMENT_KEY environment variables');
      return res.status(500).json({ error: 'Payment gateway not configured' });
    }

    // Build the parameters string for signing (alphabetical order by key name)
    const signStr = `amount=${amount}&callback_url=${callback_url}&channel_id=${channelId}&currency=NGN&email=${email || ''}&mchId=${mchId}&mchOrderNo=${order_id}&key=${paymentKey}`;

    const sign = crypto.createHash('md5').update(signStr).digest('hex');

    console.log('mchId used:', mchId);
    console.log('Sign string (key redacted in prod):', signStr.replace(paymentKey, '[REDACTED]'));
    console.log('MD5 sign:', sign);

    const paymentUrl = 'https://api.nekpayment.com/pay/web' +
      '?mchId=' + mchId +
      '&amount=' + amount +
      '&mchOrderNo=' + order_id +
      '&currency=NGN' +
      '&channel_id=' + channelId +
      '&callback_url=' + encodeURIComponent(callback_url) +
      '&email=' + encodeURIComponent(email || '') +
      '&signType=MD5' +
      '&sign=' + sign;

    console.log('Payment URL generated for order:', order_id);
    res.status(200).json({ status: 'success', payment_url: paymentUrl });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
}
