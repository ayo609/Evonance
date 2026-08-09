export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { amount, order_id, callback_url, email } = req.body;

    // Try the correct NekPayment API format
    const params = new URLSearchParams({
      merchant_id: '300258219',
      amount: amount.toString(),
      order_id: order_id,
      currency: 'NGN',
      channel_id: '523',
      callback_url: callback_url,
      email: email || '',
      description: 'Deposit to Evonance'
    });

    // Try multiple API endpoints
    let response, data;
    
    // Method 1: Try with payment key as URL parameter
    try {
      response = await fetch(`https://api.nekpayment.com/pay/uniqueurl?key=222c2e39848744c4903f51e6515df0d4&${params.toString()}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      data = await response.json();
      if (data.respcode === '00' || data.status === 'success') {
        return res.status(200).json(data);
      }
    } catch(e) { console.log('Method 1 failed:', e.message); }

    // Method 2: Try POST with key in body
    try {
      response = await fetch('https://api.nekpayment.com/pay/uniqueurl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: '222c2e39848744c4903f51e6515df0d4',
          merchant_id: '300258219',
          amount: amount,
          order_id: order_id,
          currency: 'NGN',
          channel_id: '523',
          callback_url: callback_url,
          email: email || ''
        })
      });
      data = await response.json();
      if (data.respcode === '00' || data.status === 'success') {
        return res.status(200).json(data);
      }
    } catch(e) { console.log('Method 2 failed:', e.message); }

    // Method 3: Return direct checkout URL as fallback
    const directUrl = `https://mch.nekpayment.com/pay?merchant_id=300258219&amount=${amount}&order_id=${order_id}&currency=NGN&channel_id=523&callback_url=${encodeURIComponent(callback_url)}&email=${encodeURIComponent(email || '')}`;
    
    res.status(200).json({
      status: 'fallback',
      payment_url: directUrl,
      message: 'Using direct checkout URL'
    });

  } catch (error) {
    console.error('Server Error:', error);
    // Always return a working URL
    const directUrl = `https://mch.nekpayment.com/pay?merchant_id=300258219&amount=${req.body.amount}&order_id=${req.body.order_id}&currency=NGN&channel_id=523&callback_url=${encodeURIComponent(req.body.callback_url)}&email=${encodeURIComponent(req.body.email || '')}`;
    res.status(200).json({ payment_url: directUrl });
  }
}
