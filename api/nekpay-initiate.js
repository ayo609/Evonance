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

    // Kept here directly since this file only ever runs on the server (Vercel), never
    // sent to the browser. Fine as long as your code repo stays private (not public on GitHub).
    const mchId = '300258219';
    const paymentKey = '222c2e39848744c4903f51e6515df0d4';
    const channelId = '523';

    // Server-to-server notification URL — sent as a request param instead of a dashboard
    // setting, since there's no visible notify-URL field in the merchant dashboard.
    // NOTE: this is unverified — NekPayment may ignore an unrecognized "notify_url" param
    // entirely, or may require a different field name. Test this and check server logs
    // to confirm the webhook actually gets called after a real/sandbox payment.
    const notifyUrl = 'https://evonance.vercel.app/api/nekpay-webhook';

    // Build the parameters string for signing (alphabetical order by key name)
    const signStr = `amount=${amount}&callback_url=${callback_url}&channel_id=${channelId}&currency=NGN&email=${email || ''}&mchId=${mchId}&mchOrderNo=${order_id}&notify_url=${notifyUrl}&key=${paymentKey}`;

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
      '&notify_url=' + encodeURIComponent(notifyUrl) +
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
