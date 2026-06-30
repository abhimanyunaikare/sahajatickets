const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const db = require('../db');
const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// POST /api/donations/order — create donation Razorpay order
router.post('/order', async (req, res) => {
  try {
    const { event_id, ticket_id, amount, donor_name, email, is_anonymous, dedication_note } = req.body;
    if (!amount || amount < 1) return res.status(400).json({ error: 'Invalid donation amount' });

    const rpOrder = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: 'INR',
      receipt: `don-${Date.now()}`,
      notes: { event_id, type: 'donation' }
    });

    // Get event_id from ticket if not provided directly
    let resolvedEventId = event_id;
    if (!resolvedEventId && ticket_id) {
      const tkRes = await db.query('SELECT event_id FROM tickets WHERE id=$1', [ticket_id]);
      if (tkRes.rows.length > 0) resolvedEventId = tkRes.rows[0].event_id;
    }

    await db.query(
      `INSERT INTO donations (event_id, ticket_id, donor_name, email, amount, is_anonymous, dedication_note, razorpay_order_id, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`,
      [resolvedEventId, ticket_id || null, is_anonymous ? null : donor_name, is_anonymous ? null : email,
       amount, is_anonymous || false, dedication_note || null, rpOrder.id]
    );

    res.json({ order_id: rpOrder.id, amount: rpOrder.amount, key_id: process.env.RAZORPAY_KEY_ID });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create donation order' });
  }
});

// POST /api/donations/verify
router.post('/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(body).digest('hex');
    if (expected !== razorpay_signature) return res.status(400).json({ error: 'Invalid signature' });

    await db.query(
      `UPDATE donations SET payment_status='paid', razorpay_payment_id=$1 WHERE razorpay_order_id=$2`,
      [razorpay_payment_id, razorpay_order_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Donation verification failed' });
  }
});

module.exports = router;
