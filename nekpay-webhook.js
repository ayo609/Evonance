import crypto from 'crypto';
import admin from 'firebase-admin';

// Initialize Firebase Admin once (uses a service account, not the public client config).
// Set FIREBASE_SERVICE_ACCOUNT as an environment variable in Vercel containing the
// full service account JSON (Firebase Console > Project Settings > Service Accounts > Generate new private key).
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const payload = req.body;
    const paymentKey = process.env.NEK_PAYMENT_KEY;

    if (!paymentKey) {
      console.error('Missing NEK_PAYMENT_KEY');
      return res.status(500).json({ error: 'Not configured' });
    }

    // --- Verify signature ---
    // IMPORTANT: confirm this against NekPayment's actual webhook signing spec before relying
    // on it in production. This assumes: take every field except "sign", sort keys
    // alphabetically, join as key=value with "&", append "&key=<paymentKey>", then MD5.
    const receivedSign = payload.sign;
    const fieldsForSign = Object.keys(payload)
      .filter((k) => k !== 'sign')
      .sort()
      .map((k) => `${k}=${payload[k]}`)
      .join('&');
    const expectedSign = crypto
      .createHash('md5')
      .update(`${fieldsForSign}&key=${paymentKey}`)
      .digest('hex');

    if (!receivedSign || receivedSign.toLowerCase() !== expectedSign.toLowerCase()) {
      console.error('Webhook signature mismatch', { receivedSign, expectedSign });
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const reference = payload.mchOrderNo;
    const isSuccess = payload.tradeResult === '1' || payload.respCode === 'SUCCESS';

    if (!reference) {
      return res.status(400).json({ error: 'Missing mchOrderNo' });
    }

    if (!isSuccess) {
      // Payment failed — mark it, but do not credit anything.
      const depQuery = await db.collection('deposits').where('reference', '==', reference).limit(1).get();
      if (!depQuery.empty) {
        await depQuery.docs[0].ref.update({ status: 'failed' });
      }
      return res.status(200).json({ status: 'received', result: 'failed' });
    }

    // --- Idempotent credit: only credit once, ever, per reference ---
    const depQuery = await db.collection('deposits').where('reference', '==', reference).limit(1).get();
    if (depQuery.empty) {
      console.error('No deposit record found for reference', reference);
      return res.status(404).json({ error: 'Deposit record not found' });
    }

    const depositDoc = depQuery.docs[0];
    const depositData = depositDoc.data();

    if (depositData.walletCredited === true) {
      // Already processed — NekPayment may retry webhooks. Don't double-credit.
      return res.status(200).json({ status: 'already_processed' });
    }

    const creditAmount = payload.tradeAmount ? parseFloat(payload.tradeAmount) : depositData.amount;

    await db.runTransaction(async (t) => {
      const userRef = db.collection('users').doc(depositData.uid);
      t.update(depositDoc.ref, {
        status: 'confirmed',
        confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
        walletCredited: true,
        tradeNo: payload.orderNo || payload.tradeNo || '',
        paymentData: payload,
      });
      t.update(userRef, {
        depositWallet: admin.firestore.FieldValue.increment(creditAmount),
        totalDeposits: admin.firestore.FieldValue.increment(creditAmount),
      });
    });

    await db.collection('notifications').add({
      uid: depositData.uid,
      title: '✅ Deposit Confirmed!',
      message: `Your deposit of ₦${creditAmount.toLocaleString()} has been credited to your wallet.`,
      type: 'deposit',
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ status: 'success' });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
}
