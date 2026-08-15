import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();

const FLW_SECRET_KEY = 'FLWSECK-a48127ddd28d0a14842e99613a4a978f-19ff176de08vt-X';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // --- Verify the caller is actually an admin — server-side, not just a client-side check ---
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired session — please log in again' });
    }

    const adminSnap = await db.collection('adminUsers').doc(decoded.uid).get();
    if (!adminSnap.exists || adminSnap.data().role !== 'admin') {
      return res.status(403).json({ error: 'Not authorized — admin access required' });
    }

    const { withdrawal_id } = req.body;
    if (!withdrawal_id) return res.status(400).json({ error: 'Missing withdrawal_id' });

    const withdrawalRef = db.collection('withdrawals').doc(withdrawal_id);
    const withdrawalSnap = await withdrawalRef.get();
    if (!withdrawalSnap.exists) return res.status(404).json({ error: 'Withdrawal not found' });
    const w = withdrawalSnap.data();

    if (w.status !== 'pending') {
      return res.status(400).json({ error: `This withdrawal is already "${w.status}" — cannot process again.` });
    }

    // Mark as processing immediately so a second admin tapping Process at the same
    // moment can't trigger a duplicate transfer for the same request.
    await withdrawalRef.update({ status: 'processing', processingStartedAt: admin.firestore.FieldValue.serverTimestamp() });

    try {
      const flwResponse = await fetch('https://api.flutterwave.com/v3/transfers', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${FLW_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          account_bank: w.bankCode,
          account_number: w.accountNumber,
          amount: w.netAmount,
          currency: 'NGN',
          narration: 'Evonance withdrawal',
          reference: w.reference,
        }),
      });
      const flwData = await flwResponse.json();

      if (flwData.status !== 'success') {
        throw new Error(flwData.message || 'Flutterwave transfer failed');
      }

      await withdrawalRef.update({
        status: 'processing', // Flutterwave transfers complete async — a webhook (if added later)
                               // should flip this to 'success' once actually confirmed delivered.
        flwTransferId: flwData.data?.id || null,
        flwResponse: flwData.data || null,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        processedBy: decoded.uid,
      });

      await db.collection('notifications').add({
        uid: w.uid,
        title: '💸 Withdrawal Processing',
        message: `Your withdrawal of ₦${Number(w.netAmount).toLocaleString()} is being sent to your bank account.`,
        type: 'withdrawal',
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ status: 'success', message: 'Transfer initiated successfully' });

    } catch (flwError) {
      console.error('Flutterwave transfer error:', flwError);
      // Refund the user — the transfer never actually went out.
      await db.collection('users').doc(w.uid).update({
        withdrawalWallet: admin.firestore.FieldValue.increment(w.amount),
      });
      await withdrawalRef.update({
        status: 'failed',
        failureReason: flwError.message,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        processedBy: decoded.uid,
      });
      await db.collection('notifications').add({
        uid: w.uid,
        title: '❌ Withdrawal Failed',
        message: `Your withdrawal of ₦${Number(w.amount).toLocaleString()} failed and has been refunded to your wallet.`,
        type: 'withdrawal',
        read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(502).json({ error: 'Transfer failed and the user has been refunded: ' + flwError.message });
    }

  } catch (error) {
    console.error('Admin process withdrawal error:', error);
    res.status(500).json({ error: error.message });
  }
}
