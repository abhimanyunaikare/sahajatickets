const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { authenticateSeeker } = require('../middleware/seekerAuth');
const router = express.Router();

// POST /api/seeker-auth/send-otp
// Triggers MSG91 to send OTP to the phone
router.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || phone.replace(/\D/g,'').length !== 10) {
      return res.status(400).json({ error: 'Valid 10-digit phone number required' });
    }
    const cleanPhone = phone.replace(/\D/g, '');
    const authKey = process.env.MSG91_AUTH_KEY;
    const templateId = process.env.MSG91_OTP_TEMPLATE_ID || process.env.MSG91_WIDGET_ID;

    if (!authKey) {
      // Dev mode — generate our own OTP and store in DB
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await db.query('DELETE FROM otp_codes WHERE phone=$1', [cleanPhone]);
      await db.query('INSERT INTO otp_codes (phone, otp_code, expires_at) VALUES ($1,$2,$3)', [cleanPhone, otp, expiresAt]);
      console.log(`📱 DEV OTP for ${cleanPhone}: ${otp}`);
      return res.json({ success: true, dev_otp: otp });
    }

    // Store demo OTP in DB for demo numbers
    // const demoNumbers = (process.env.MSG91_DEMO_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);
    const demoNumbers = (process.env.MSG91_DEMO_NUMBERS || '').split(',').map(n => n.trim()).filter(Boolean);

    if (demoNumbers.includes(cleanPhone)) {
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
      await db.query('DELETE FROM otp_codes WHERE phone=$1', [cleanPhone]);
      await db.query('INSERT INTO otp_codes (phone, otp_code, expires_at) VALUES ($1,$2,$3)', [cleanPhone, '1234', expiresAt]);
    }

    // Send via MSG91
   // For demo numbers, MSG91 ignores our OTP and uses fixed pin (1234)
    // So store 1234 in DB for demo numbers, random OTP for real numbers
    const isDemo = demoNumbers.includes(cleanPhone);
    const otp = isDemo ? '1234' : Math.floor(100000 + Math.random() * 900000).toString();

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await db.query('DELETE FROM otp_codes WHERE phone=$1', [cleanPhone]);
    await db.query('INSERT INTO otp_codes (phone, otp_code, expires_at) VALUES ($1,$2,$3)', [cleanPhone, otp, expiresAt]);

    console.log(`OTP for ${cleanPhone}: ${isDemo ? '1234 (demo)' : '[hidden - sent via SMS]'}`);

    // Send via MSG91 with our generated OTP (demo numbers will use their fixed pin anyway)
    const url = `https://control.msg91.com/api/v5/otp?template_id=${templateId}&mobile=91${cleanPhone}&authkey=${authKey}&otp=${otp}`;

    const response = await fetch(url, { method: 'POST' });
    const data = await response.json();
    console.log('MSG91 send response:', data);

    if (data.type !== 'success') {
      return res.status(500).json({ error: 'Failed to send OTP. Please try again.' });
    }

    res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// POST /api/seeker-auth/verify-otp
// Verifies OTP from our database (works for demo + real numbers via DB)
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ error: 'Phone and OTP required' });
    const cleanPhone = phone.replace(/\D/g, '');

    // Verify from our database
    const result = await db.query(
      `SELECT * FROM otp_codes 
       WHERE phone=$1 AND verified=false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [cleanPhone]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'OTP expired or not found. Please request a new one.' });
    }

    const row = result.rows[0];

    if (row.attempts >= 5) {
      return res.status(400).json({ error: 'Too many attempts. Please request a new OTP.' });
    }

    if (row.otp_code !== otp.toString().trim()) {
      await db.query('UPDATE otp_codes SET attempts=attempts+1 WHERE id=$1', [row.id]);
      return res.status(400).json({ error: 'Incorrect OTP. Please try again.' });
    }

    // OTP correct — mark as verified
    await db.query('UPDATE otp_codes SET verified=true WHERE id=$1', [row.id]);

    // Find or create seeker account
    let accountRes = await db.query('SELECT * FROM seeker_accounts WHERE phone=$1', [cleanPhone]);
    let account;
    const isNew = accountRes.rows.length === 0;

    if (isNew) {
      const createRes = await db.query(
        'INSERT INTO seeker_accounts (phone, last_login_at) VALUES ($1, NOW()) RETURNING *',
        [cleanPhone]
      );
      account = createRes.rows[0];
    } else {
      account = accountRes.rows[0];
      await db.query('UPDATE seeker_accounts SET last_login_at=NOW() WHERE id=$1', [account.id]);
    }

    const token = jwt.sign(
      { id: account.id, phone: account.phone, type: 'seeker' },
      process.env.JWT_SECRET,
      { expiresIn: '90d' }
    );

    res.json({
      token,
      account: { id: account.id, phone: account.phone, name: account.name, email: account.email },
      isNewAccount: isNew || !account.name
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// GET /api/seeker-auth/profile
// GET /api/seeker-auth/profile
router.get('/profile', authenticateSeeker, async (req, res) => {
    try {
      const result = await db.query(
        `SELECT id, phone, name, email, date_of_birth, volunteer_interests,
          EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth))::int AS age,
          CASE 
            WHEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth)) <= 12 THEN 'child'
            WHEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth)) <= 25 THEN 'yuva'
            ELSE 'adult'
          END AS age_category,
          created_at
         FROM seeker_accounts WHERE id=$1`,
        [req.seeker.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Account not found' });
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  });

// PATCH /api/seeker-auth/profile
// PATCH /api/seeker-auth/profile
router.patch('/profile', authenticateSeeker, async (req, res) => {
    try {
      const { name, email, date_of_birth, volunteer_interests } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  
      const result = await db.query(
        `UPDATE seeker_accounts 
         SET name=$1, email=$2, date_of_birth=$3, volunteer_interests=$4
         WHERE id=$5
         RETURNING id, phone, name, email, date_of_birth, volunteer_interests`,
        [name.trim(), email || null, date_of_birth || null,
         volunteer_interests || [], req.seeker.id]
      );
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: 'Failed to update profile' });
    }
  });

// GET /api/seeker-auth/my-stats — seeker dashboard stats
router.get('/my-stats', authenticateSeeker, async (req, res) => {
    try {
      const stats = await db.query(`
        SELECT 
          COUNT(*) AS total_tickets,
          COUNT(*) FILTER (WHERE checked_in=true) AS events_attended,
          COALESCE(SUM(final_amount), 0) AS total_spent
        FROM tickets 
        WHERE account_id=$1 AND payment_status IN ('paid','free')
      `, [req.seeker.id]);
  
      const familyCount = await db.query(
        'SELECT COUNT(*) AS count FROM family_members WHERE account_id=$1',
        [req.seeker.id]
      );
  
      res.json({
        ...stats.rows[0],
        family_members: parseInt(familyCount.rows[0].count)
      });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });


module.exports = router;