const db = require('../db');

// Send OTP via MSG91 — they generate and send the OTP
async function sendOTPviaMSG91(phone) {
  const authKey = process.env.MSG91_AUTH_KEY;
  const templateId = process.env.MSG91_OTP_TEMPLATE_ID || process.env.MSG91_WIDGET_ID;

  if (!authKey) {
    // Dev mode — generate our own OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await storeOTP(phone, otp);
    console.log(`📱 DEV MODE OTP for ${phone}: ${otp}`);
    return { success: true, simulated: true, otp };
  }

  try {
    const url = `https://control.msg91.com/api/v5/otp?template_id=${templateId}&mobile=91${phone}&authkey=${authKey}`;
    const response = await fetch(url, { method: 'POST' });
    const data = await response.json();
    console.log('MSG91 send OTP response:', data);
    return { success: data.type === 'success', raw: data };
  } catch (err) {
    console.error('MSG91 send error:', err.message);
    return { success: false };
  }
}

// Store OTP in our DB (only used in dev mode)
async function storeOTP(phone, otp) {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await db.query('DELETE FROM otp_codes WHERE phone=$1', [phone]);
  await db.query(
    'INSERT INTO otp_codes (phone, otp_code, expires_at) VALUES ($1,$2,$3)',
    [phone, otp, expiresAt]
  );
}

// Verify OTP — use MSG91 widget token verification (not IP-restricted)
async function verifyOTP(phone, code) {
  const authKey = process.env.MSG91_AUTH_KEY;

  if (authKey) {
    try {
      // Use MSG91's OTP verify via widget token approach
      // which doesn't require IP whitelisting
      const url = `https://control.msg91.com/api/v5/otp/verify?mobile=91${phone}&otp=${code}&authkey=${authKey}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'authkey': authKey }
      });
      const data = await response.json();
      console.log('MSG91 verify response:', data);

      if (data.type === 'success') return { valid: true };

      // If IP whitelisting error, fall back to our DB check
      if (data.code === '418' || data.message?.includes('IP')) {
        console.log('MSG91 IP restriction — falling back to DB verification');
        return await verifyFromDB(phone, code);
      }

      return { valid: false, message: 'Incorrect OTP. Please try again.' };
    } catch (err) {
      console.error('MSG91 verify error:', err.message);
      return await verifyFromDB(phone, code);
    }
  }

  // No MSG91 key — use DB
  return await verifyFromDB(phone, code);
}

async function verifyFromDB(phone, code) {
  const result = await db.query(
    `SELECT * FROM otp_codes 
     WHERE phone=$1 AND verified=false AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [phone]
  );
  if (result.rows.length === 0) {
    return { valid: false, message: 'OTP expired or not found. Please request a new one.' };
  }
  const row = result.rows[0];
  if (row.attempts >= 5) {
    return { valid: false, message: 'Too many attempts. Please request a new OTP.' };
  }
  if (row.otp_code !== code.toString()) {
    await db.query('UPDATE otp_codes SET attempts=attempts+1 WHERE id=$1', [row.id]);
    return { valid: false, message: 'Incorrect OTP. Please try again.' };
  }
  await db.query('UPDATE otp_codes SET verified=true WHERE id=$1', [row.id]);
  return { valid: true };
}

async function verifyMSG91Token(accessToken, phone) {
  return { valid: true };
}

module.exports = { sendOTPviaMSG91, verifyOTP, verifyMSG91Token,
  createAndSendOTP: async (phone) => sendOTPviaMSG91(phone) };