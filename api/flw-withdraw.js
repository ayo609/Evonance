import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();

const FLW_SECRET_KEY = 'FLWSECK-a48127ddd28d0a14842e99613a4a978f-19ff176de08vt-X';
const WITHDRAWAL_FEE_RATE = 0.08;
const MIN_WITHDRAWAL = 3000;

// Nigeria is UTC+1 year-round (no DST), so this is a fixed offset — no timezone library needed.
function isWithinWithdrawalWindow() {
  const now = new Date();
  const lagosMs = now.getTime() + 60 * 60 * 1000; // shift UTC -> Africa/Lagos (UTC+1)
  const lagos = new Date(lagosMs);
  const day = lagos.getUTCDay(); // 0 = Sunday
  const minutesOfDay = lagos.getUTCHours() * 60 + lagos.getUTCMinutes();
  if (day === 0) return false; // no Sunday withdrawals
  return minutesOfDay >= 480 && minutesOfDay < 1020; // 8:00 AM – 5:00 PM
}

function startOfTodayLagos() {
  const now = new Date();
  const lagos = new Date(now.getTime() + 60 * 60 * 1000);
  lagos.setUTCHours(0, 0, 0, 0);
  return new Date(lagos.getTime() - 60 * 60 * 1000); // shift back to UTC for Firestore comparison
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // --- Verify the user's identity server-side, don't trust a client-supplied uid ---
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: 'Missing auth token' });

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired session — please log in again' });
    }
    const uid = decoded.uid;

    const { amount, bank_code, bank_name, account_number, account_name, pin } = req.body;

    if (!amount || !bank_code || !bank_name || !account_number || !account_name || !pin) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (amount < MIN_WITHDRAWAL) {
      return res.status(400).json({ error: `Minimum withdrawal is ₦${MIN_WITHDRAWAL.toLocaleString()}` });
    }
    if (!/^\d{10}$/.test(account_number)) {
      return res.status(400).json({ error: 'Account number must be 10 digits' });
    }

    // --- Re-check every rule server-side — the client-side checks are for UX only ---
    if (!isWithinWithdrawalWindow()) {
      return res.status(400).json({ error: 'Withdrawals are only available Mon–Sat, 8:00 AM–5:00 PM (Lagos time)' });
    }

    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
    const userData = userSnap.data();

    if (!userData.withdrawalPin) {
      return res.status(400).json({ error: 'No withdrawal PIN set' });
    }
    if (String(pin) !== String(userData.withdrawalPin)) {
      return res.status(400).json({ error: 'Incorrect PIN' });
    }

    const invSnap = await db.collection('investments')
      .where('uid', '==', uid)
      .where('status', '==', 'active')
      .limit(1)
      .get();
    if (invSnap.empty) {
      return res.status(400).json({ error: 'You need at least one active investment to withdraw' });
    }

    const todayStart = startOfTodayLagos();
    const todaysWithdrawals = await db.collection('withdrawals')
      .where('uid', '==', uid)
      .where('createdAt', '>=', todayStart)
      .limit(1)
      .get();
    if (!todaysWithdrawals.empty) {
      return res.status(400).json({ error: 'You can only withdraw once per day' });
    }

    const currentBalance = Number(userData.withdrawalWallet) || 0;
    if (amount > currentBalance) {
      return res.status(400).json({ error: 'Insufficient withdrawal wallet balance' });
    }

    const fee = Math.round(amount * WITHDRAWAL_FEE_RATE);
    const netAmount = amount - fee;
    const reference = 'EVOWD' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();

    // --- Deduct balance and create a 'processing' record atomically, BEFORE calling Flutterwave ---
    const withdrawalRef = db.collection('withdrawals').doc();
    await db.runTransaction(async (t) => {
      const freshUserSnap = await t.get(userRef);
      const freshBalance = Number(freshUserSnap.data().withdrawalWallet) || 0;
      if (amount > freshBalance) throw new Error('Insufficient withdrawal wallet balance');

      t.update(userRef, {
        withdrawalWallet: admin.firestore.FieldValue.increment(-amount),
        totalWithdrawals: admin.firestore.FieldValue.increment(amount),
      });
      t.set(withdrawalRef, {
        uid, email: userData.email || '', amount, fee, netAmount,
        bankName: bank_name, bankCode: bank_code, accountNumber: account_number, accountName: account_name,
        status: 'processing', reference,
        createdAt: admin.firestore.FieldValue.serverTimestamp(), processedAt: null,
        type: 'withdrawal',
      });
    });

    // --- Now actually send the money via Flutterwave ---
    try {
      const flwResponse = await fetch('https://api.flutterwave.com/v3/transfers', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${FLW_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          account_bank: bank_code,
          account_number,
          amount: netAmount,
          currency: 'NGN',
          narration: 'Evonance withdrawal',
          reference,
        }),
      });
      const flwData = await flwResponse.json();

      if (flwData.status !== 'success') {
        throw new Error(flwData.message || 'Flutterwave transfer failed');
      }

      await withdrawalRef.update({
        status: 'processing', // Flutterwave transfers complete async — a webhook should flip this to 'success'/'failed'
        flwTransferId: flwData.data?.id || null,
        flwResponse: flwData.data || null,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ status: 'success', message: 'Withdrawal initiated', reference });

    } catch (flwError) {
      console.error('Flutterwave transfer error:', flwError);
      // Refund — the deduction already happened, so undo it since the transfer never went out.
      await userRef.update({
        withdrawalWallet: admin.firestore.FieldValue.increment(amount),
        totalWithdrawals: admin.firestore.FieldValue.increment(-amount),
      });
      await withdrawalRef.update({ status: 'failed', failureReason: flwError.message });
      return res.status(502).json({ error: 'Transfer failed and your balance has been refunded: ' + flwError.message });
    }

  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(500).json({ error: error.message });
  }
}
