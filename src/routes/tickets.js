const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticate, checkinAccess } = require('../middleware/auth');
const { calculatePrice, applyDiscount, generateQRCode, sendTicketEmail, sendWhatsAppTicket } = require('../utils/helpers');
const router = express.Router();

// POST /api/tickets/calculate — preview price before purchase
router.post('/calculate', async (req, res) => {
  try {
    const { event_id, seekers, discount_code } = req.body;
    // seekers: [{ name, age, sex }]

    const tierRes = await db.query('SELECT * FROM ticket_tiers WHERE event_id=$1', [event_id]);
    if (tierRes.rows.length === 0) return res.status(404).json({ error: 'Event pricing not found' });
    const tier = tierRes.rows[0];

    let totalBase = 0;
    const breakdown = seekers.map(s => {
      const price = calculatePrice(s.age, s.sex, tier);
      totalBase += price;
      return { ...s, price };
    });

    let discountInfo = null;
    let finalTotal = totalBase;
    let discountAmount = 0;

    if (discount_code) {
      const dcRes = await db.query(
        `SELECT * FROM discount_codes WHERE event_id=$1 AND code=$2 AND is_active=true
         AND (valid_until IS NULL OR valid_until > NOW())
         AND used_count < max_uses`,
        [event_id, discount_code.toUpperCase()]
      );
      if (dcRes.rows.length > 0) {
        const dc = dcRes.rows[0];
        const applied = applyDiscount(totalBase, dc);
        discountAmount = applied.discountAmount;
        finalTotal = applied.finalAmount;
        discountInfo = { valid: true, type: dc.type, value: dc.value, discountAmount };
      } else {
        discountInfo = { valid: false, message: 'Invalid or expired code' };
      }
    }

    res.json({ breakdown, totalBase, discountAmount, finalTotal, discountInfo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Price calculation failed' });
  }
});

// POST /api/tickets/order — create Razorpay order
router.post('/order', async (req, res) => {
  try {
    const { event_id, seekers, discount_code, language } = req.body;

    // Validate each seeker has phone (mandatory), email optional
    for (const s of seekers) {
      if (!s.phone || s.phone.trim().length < 10) {
        return res.status(400).json({ error: `Phone number is required for ${s.name || 'a seeker'}` });
      }
    }

    const tierRes = await db.query('SELECT * FROM ticket_tiers WHERE event_id=$1', [event_id]);
    const tier = tierRes.rows[0];
    if (!tier) return res.status(404).json({ error: 'Event not found' });

    const eventCheckRes = await db.query('SELECT * FROM events WHERE id=$1', [event_id]);
    if (eventCheckRes.rows.length === 0) return res.status(404).json({ error: 'Event not found' });

    const evStatus = eventCheckRes.rows[0].status;
    if (evStatus === 'draft') {
      return res.status(400).json({ error: 'This event is not yet open for registration.' });
    }
    if (evStatus === 'closed') {
      return res.status(400).json({ error: 'Event registration is closed. Payments are no longer accepted.' });
    }
    const eventRes = { rows: [eventCheckRes.rows[0]] };

    let totalBase = 0;
    const priced = seekers.map(s => {
      const price = calculatePrice(s.age, s.sex, tier);
      totalBase += price;
      return { ...s, price };
    });

    let discountCodeRow = null;
    if (discount_code) {
      const dcRes = await db.query(
        `SELECT * FROM discount_codes WHERE event_id=$1 AND code=$2 AND is_active=true
         AND (valid_until IS NULL OR valid_until > NOW()) AND used_count < max_uses`,
        [event_id, discount_code.toUpperCase()]
      );
      discountCodeRow = dcRes.rows[0] || null;
    }

    const discountResult = applyDiscount(totalBase, discountCodeRow);
    const discountAmount = discountResult.discountAmount;
    const finalTotal = discountResult.finalAmount;
    const bookingGroupId = uuidv4();

    console.log('Pricing debug:', { totalBase, discountAmount, finalTotal, is_free: tier.is_free });

    if (parseFloat(finalTotal) === 0 || tier.is_free) {
      // Free event — skip Razorpay
      const tickets = await createTickets(priced, event_id, tier.id, discountCodeRow, discountAmount, finalTotal, bookingGroupId, language, null, req.body.account_id);

      // Deliver in background, respond immediately
      deliverTickets(tickets, eventRes.rows[0]).catch(err => console.error('Background delivery failed:', err));

      return res.json({ success: true, free: true, tickets: tickets.map(t => ({
        id: t.id,
        seeker_name: t.seeker_name,
        qr_uuid: t.qr_uuid,
        age: t.age,
        age_category: t.age_category,
        sex: t.sex,
        zone_city: t.zone_city,      
        phone: t.phone
      }))});
    }

    // Create Razorpay order
    const donationAmount = parseFloat(req.body.donation_amount) || 0;
    const grandTotal = parseFloat(finalTotal) + donationAmount;
    const amountInPaise = Math.round(grandTotal * 100);    console.log('Razorpay amount in paise:', amountInPaise);

    if (!amountInPaise || amountInPaise < 100) {
      return res.status(400).json({ error: `Invalid amount: ₹${finalTotal}. Minimum is ₹1.` });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });
    console.log('Razorpay key:', process.env.RAZORPAY_KEY_ID);
    const rpOrder = await razorpay.orders.create({      amount: amountInPaise,
      currency: 'INR',
      receipt: `sy-${bookingGroupId.slice(0, 8)}`,
      notes: { event_id, booking_group: bookingGroupId }
    });

    // Save pending tickets
    await createTickets(priced, event_id, tier.id, discountCodeRow, discountAmount, finalTotal, bookingGroupId, language, rpOrder.id, req.body.account_id);

    res.json({
      order_id: rpOrder.id,
      amount: rpOrder.amount,
      currency: 'INR',
      key_id: process.env.RAZORPAY_KEY_ID,
      booking_group_id: bookingGroupId
    });
  } catch (err) {
    console.error('ORDER ERROR FULL:', JSON.stringify(err, null, 2));
    res.status(500).json({ error: 'Failed to create order', detail: err.message, razorpay: err.error });
  }
});

// POST /api/tickets/verify — verify Razorpay payment + deliver tickets
router.post('/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, booking_group_id } = req.body;

    // Verify signature
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSig = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(body).digest('hex');
    if (expectedSig !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    // Update tickets to paid
    const ticketsRes = await db.query(
      `UPDATE tickets SET payment_status='paid', razorpay_order_id=$1, razorpay_payment_id=$2
       WHERE booking_group_id=$3 RETURNING *`,
      [razorpay_order_id, razorpay_payment_id, booking_group_id]
    );
    const tickets = ticketsRes.rows;

    // Get event
    const eventRes = await db.query('SELECT * FROM events WHERE id=$1', [tickets[0].event_id]);
    const event = eventRes.rows[0];

    // Increment discount code usage
    if (tickets[0].discount_code_used) {
      await db.query(
        'UPDATE discount_codes SET used_count = used_count + 1 WHERE event_id=$1 AND code=$2',
        [event.id, tickets[0].discount_code_used]
      );
    }

    // Generate QR and send tickets
    // await deliverTickets(tickets, event);

    res.json({ success: true, tickets: tickets.map(t => ({
      id: t.id,
      seeker_name: t.seeker_name,
      qr_uuid: t.qr_uuid,
      age: t.age,
      age_category: t.age_category,
      sex: t.sex,
      zone_city: t.zone_city,
      phone: t.phone
    }))});

    // Deliver QR/email/WhatsApp in background — don't block the response
    deliverTickets(tickets, event).catch(err => console.error('Background delivery failed:', err));

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

// POST /api/tickets/checkin — scan QR and mark attendance
router.post('/checkin', authenticate, checkinAccess, async (req, res) => {
  try {
    const { qr_data } = req.body;

    let qrUuid;
    try {
      const parsed = JSON.parse(qr_data);
      qrUuid = parsed.uuid;
    } catch {
      qrUuid = qr_data; // fallback plain UUID
    }

    const ticketRes = await db.query(
      `SELECT t.*, e.title, e.start_date, e.end_date
       FROM tickets t JOIN events e ON e.id = t.event_id
       WHERE t.qr_uuid=$1 AND t.payment_status IN ('paid','free')`,
      [qrUuid]
    );

    if (ticketRes.rows.length === 0) {
      return res.status(404).json({ success: false, status: 'invalid', message: 'Ticket not found or invalid' });
    }

    const ticket = ticketRes.rows[0];

    if (ticket.checked_in) {
      return res.json({
        success: false,
        status: 'already_used',
        message: 'Already checked in',
        seeker_name: ticket.seeker_name,
        checked_in_at: ticket.checked_in_at
      });
    }

    // Mark as checked in
    await db.query(
      'UPDATE tickets SET checked_in=true, checked_in_at=NOW(), checked_in_by=$1 WHERE id=$2',
      [req.user.id, ticket.id]
    );

    res.json({
      success: true,
      status: 'admitted',
      seeker_name: ticket.seeker_name,
      age_category: ticket.age_category,
      sex: ticket.sex,
      zone_city: ticket.zone_city,
      event_title: ticket.title
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Check-in failed' });
  }
});

// GET /api/tickets/lookup?email=xxx — attendee self-lookup
// GET /api/tickets/lookup?email=xxx OR ?phone=xxx — attendee self-lookup
router.get('/lookup', async (req, res) => {
  try {
    const { email, phone } = req.query;
    if (!email && !phone) return res.status(400).json({ error: 'Email or phone required' });

    let query, param;
    if (email) {
      query = `SELECT t.id, t.seeker_name, t.age_category, t.sex, t.qr_uuid, t.payment_status,
                t.final_amount, t.checked_in, e.title, e.start_date, e.venue
               FROM tickets t JOIN events e ON e.id = t.event_id
               WHERE t.email=$1 AND t.payment_status IN ('paid','free')
               ORDER BY t.created_at DESC`;
      param = email.toLowerCase();
    } else {
      query = `SELECT t.id, t.seeker_name, t.age_category, t.sex, t.qr_uuid, t.payment_status,
                t.final_amount, t.checked_in, e.title, e.start_date, e.venue
               FROM tickets t JOIN events e ON e.id = t.event_id
               WHERE t.phone=$1 AND t.payment_status IN ('paid','free')
               ORDER BY t.created_at DESC`;
      param = phone;
    }

    const result = await db.query(query, [param]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed' });
  }
});

// ── Internal helpers ──────────────────────────────────────────────
async function createTickets(pricedSeekers, eventId, tierId, discountCodeRow, discountAmount, finalTotal, groupId, language, rpOrderId = null, accountId = null) {
  
  const perTicketDiscount = pricedSeekers.length > 0 ? discountAmount / pricedSeekers.length : 0;
  const tickets = [];
  const { getAgeCategory } = require('../utils/helpers');

  const tierRes = await db.query('SELECT * FROM ticket_tiers WHERE id=$1', [tierId]);
  const tier = tierRes.rows[0];

  for (const s of pricedSeekers) {
    console.log('Seeker sex:', s.sex, 'name:', s.name);

    const finalAmt = Math.max(0, s.price - perTicketDiscount);
    const ageCategory = getAgeCategory(s.age, tier);
    const res = await db.query(
      `INSERT INTO tickets 
        (event_id, tier_id, seeker_name, age, sex, age_category, zone_city, email, phone,
          language, is_first_time, base_amount, discount_amount, final_amount,
          discount_code_used, payment_status, razorpay_order_id, booking_group_id,
          account_id, volunteer_interests, category_overridden)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        RETURNING *`,
       [eventId, tierId, s.name, s.age, s.sex, ageCategory, s.zone_city || null,
        s.email ? s.email.toLowerCase() : null, s.phone, language || 'en', s.is_first_time || false,
        s.price, perTicketDiscount, finalAmt,
        discountCodeRow ? discountCodeRow.code : null,
        (finalAmt === 0 ? 'free' : 'pending'),
        rpOrderId, groupId,
        accountId || null,
        s.volunteer_interests ? s.volunteer_interests : null,
        s.category_overridden || false]
    );
    tickets.push(res.rows[0]);
  }
  return tickets;
}

async function deliverTickets(tickets, event) {
  const { generateQRCode, sendTicketEmail, sendWhatsAppTicket } = require('../utils/helpers');
  for (const ticket of tickets) {
    try {
      const t0 = Date.now();
      const qrBase64 = await generateQRCode(ticket.qr_uuid);
      console.log(`QR generation took ${Date.now() - t0}ms`);

      if (ticket.email) {
        const t1 = Date.now();
        await sendTicketEmail(ticket, event, qrBase64);
        console.log(`Email sending took ${Date.now() - t1}ms`);
      }

      const t2 = Date.now();
      await sendWhatsAppTicket(ticket, event, qrBase64);
      console.log(`WhatsApp sending took ${Date.now() - t2}ms`);
    } catch (err) {
      console.error('Delivery error for ticket', ticket.id, err.message);
    }
  }
}

module.exports = router;
