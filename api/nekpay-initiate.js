import crypto from 'crypto';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { amount, order_id, callback_url, email } = req.body;
    
    const mchId = '977977001';
    const paymentKey = '222c2e39848744c4903f51e6515df0d4';
    
    // Build the parameters string for signing
    // Format: param1=value1&param2=value2&key=paymentKey
    const signStr = `amount=${amount}&callback_url=${callback_url}&channel_id=523&currency=NGN&email=${email||''}&mchId=${mchId}&mchOrderNo=${order_id}&key=${paymentKey}`;
    
    // Generate MD5 signature
    const sign = crypto.createHash('md5').update(signStr).digest('hex');
    
    console.log('Sign string:', signStr);
    console.log('MD5 sign:', sign);

    // Build payment URL with signature
    const paymentUrl = 'https://api.nekpayment.com/pay/web' +
      '?mchId=' + mchId +
      '&amount=' + amount +
      '&mchOrderNo=' + order_id +
      '&currency=NGN' +
      '&channel_id=523' +
      '&callback_url=' + encodeURIComponent(callback_url) +
      '&email=' + encodeURIComponent(email || '') +
      '&signType=MD5' +
      '&sign=' + sign;

    console.log('Payment URL:', paymentUrl);
    res.status(200).json({ status: 'success', payment_url: paymentUrl });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
}
