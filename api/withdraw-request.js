import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
  });
}
const db = admin.firestore();

const WITHDRAWAL_FEE_RATE = 0.08;
const MIN_WITHDRAWAL = 3000;

// Nigeria is UTC+1 year-round (no DST) — fixed offset, no timezone library needed.
function isWithinWithdrawalWindow() {
  const now = new Date();
  const lagos = new Date(now.getTime() + 60 * 60 * 1000);
  const day = lagos.getUTCDay(); // 0 = Sunday
  const minutesOfDay = lagos.getUTCHours() * 60 + lagos.getUTCMinutes();
  if (day === 0) return false;
  return minutesOfDay >= 480 && minutesOfDay < 1020; // 8:00 AM – 5:00 PM
}

function startOfTodayLagos() {
  const now = new Date();
  const lagos = new Date(now.getTime() + 60 * 60 * 1000);
  lagos.setUTCHours(0, 0, 0, 0);
  return new Date(lagos.getTime() - 60 * 60 * 1000);
}

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
    if (!isWithinWithdrawalWindow()) {
      return res.status(400).json({ error: 'Withdrawals are only available Mon–Sat, 8:00 AM–5:00 PM (Lagos time)' });
    }

    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
    const userData = userSnap.data();

    if (!userData.withdrawalPin) return res.status(400).json({ error: 'No withdrawal PIN set' });
    if (String(pin) !== String(userData.withdrawalPin)) return res.status(400).json({ error: 'Incorrect PIN' });

    // Eligibility: has the user EVER invested — active or already matured/completed —
    // not "do they currently have an active investment." A matured investment still
    // means they're owed money and should be able to withdraw it.
    const invSnap = await db.collection('investments').where('uid', '==', uid).limit(1).get();
    if (invSnap.empty) {
      return res.status(400).json({ error: 'You need to have made at least one investment to withdraw' });
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

    // Reserve the funds now (deduct immediately) so the user can't spend the same balance
    // elsewhere while this request is awaiting admin review. If admin rejects it, the
    // admin-side reject action must refund this amount back.
    const withdrawalRef = db.collection('withdrawals').doc();
    await db.runTransaction(async (t) => {
      const freshUserSnap = await t.get(userRef);
      const freshBalance = Number(freshUserSnap.data().withdrawalWallet) || 0;
      if (amount > freshBalance) throw new Error('Insufficient withdrawal wallet balance');

      t.update(userRef, {
        withdrawalWallet: admin.firestore.FieldValue.increment(-amount),
      });
      t.set(withdrawalRef, {
        uid, email: userData.email || '', amount, fee, netAmount,
        bankName: bank_name, bankCode: bank_code, accountNumber: account_number, accountName: account_name,
        status: 'pending', // admin must review and tap "Process" to actually send the money
        reference,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        processedAt: null,
        type: 'withdrawal',
      });
    });

    return res.status(200).json({ status: 'pending', message: 'Withdrawal request submitted for review', reference });

  } catch (error) {
    console.error('Withdraw request error:', error);
    res.status(500).json({ error: error.message });
  }
}
