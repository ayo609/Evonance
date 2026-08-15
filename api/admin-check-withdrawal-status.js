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

    if (w.status !== 'processing') {
      return res.status(400).json({ error: `This withdrawal is "${w.status}" — nothing to check.` });
    }
    if (!w.flwTransferId) {
      return res.status(400).json({ error: 'No Flutterwave transfer ID on record for this withdrawal.' });
    }

    const statusResponse = await fetch(`https://api.flutterwave.com/v3/transfers/${w.flwTransferId}`, {
      headers: { Authorization: `Bearer ${FLW_SECRET_KEY}` },
    });
    const statusData = await statusResponse.json();
    const flwTransferStatus = statusData?.data?.status; // NEW, PENDING, SUCCESSFUL, FAILED

    if (flwTransferStatus === 'FAILED') {
      await db.collection('users').doc(w.uid).update({
        withdrawalWallet: admin.firestore.FieldValue.increment(w.amount),
      });
      const reason = statusData?.data?.complete_message || 'Transfer failed (insufficient balance or bank rejected it)';
      await withdrawalRef.update({ status: 'failed', failureReason: reason });
      await db.collection('notifications').add({
        uid: w.uid,
        title: '❌ Withdrawal Failed',
        message: `Your withdrawal of ₦${Number(w.amount).toLocaleString()} failed and has been refunded to your wallet.`,
        type: 'withdrawal', read: false, createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ status: 'failed', message: 'Transfer confirmed failed — user refunded.' });
    }

    if (flwTransferStatus === 'SUCCESSFUL') {
      await withdrawalRef.update({ status: 'success' });
      await db.collection('notifications').add({
        uid: w.uid,
        title: '✅ Withdrawal Successful',
        message: `Your withdrawal of ₦${Number(w.netAmount).toLocaleString()} has been sent to your bank account.`,
        type: 'withdrawal', read: false, createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ status: 'success', message: 'Transfer confirmed successful.' });
    }

    // Still NEW or PENDING — genuinely still in flight, not a failure.
    return res.status(200).json({ status: 'processing', message: `Flutterwave still shows "${flwTransferStatus || 'unknown'}" — check again shortly.` });

  } catch (error) {
    console.error('Check withdrawal status error:', error);
    res.status(500).json({ error: error.message });
  }
}
