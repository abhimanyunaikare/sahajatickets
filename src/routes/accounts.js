const express = require('express');
const db = require('../db');
const { authenticate, accountsAccess } = require('../middleware/auth');
const router = express.Router();

// GET /api/accounts/summary — overall summary across all events
router.get('/summary', authenticate, accountsAccess, async (req, res) => {
  try {
    const { year } = req.query;
    const yearFilter = year ? `AND EXTRACT(YEAR FROM e.start_date) = ${parseInt(year)}` : '';

    const summary = await db.query(`
      SELECT
        COUNT(DISTINCT e.id) AS total_events,
        COUNT(t.id) FILTER (WHERE t.payment_status IN ('paid','free')) AS total_tickets,
        COALESCE(SUM(t.final_amount) FILTER (WHERE t.payment_status = 'paid'), 0) AS total_ticket_revenue,
        COALESCE(SUM(d.amount) FILTER (WHERE d.payment_status = 'paid'), 0) AS total_donations,
        COUNT(t.id) FILTER (WHERE t.payment_status = 'free') AS free_tickets,
        COALESCE(SUM(t.discount_amount) FILTER (WHERE t.payment_status IN ('paid','free')), 0) AS total_discounts_given
      FROM events e
      LEFT JOIN tickets t ON t.event_id = e.id
      LEFT JOIN donations d ON d.event_id = e.id
      WHERE 1=1 ${yearFilter}
    `);

    // Year-wise breakdown
    const yearwise = await db.query(`
      SELECT
        EXTRACT(YEAR FROM e.start_date)::int AS year,
        COUNT(DISTINCT e.id) AS events,
        COUNT(t.id) FILTER (WHERE t.payment_status IN ('paid','free')) AS tickets,
        COALESCE(SUM(t.final_amount) FILTER (WHERE t.payment_status = 'paid'), 0) AS ticket_revenue,
        COALESCE(SUM(d.amount) FILTER (WHERE d.payment_status = 'paid'), 0) AS donations
      FROM events e
      LEFT JOIN tickets t ON t.event_id = e.id
      LEFT JOIN donations d ON d.event_id = e.id
      GROUP BY EXTRACT(YEAR FROM e.start_date)
      ORDER BY year DESC
    `);

    // Available years
    const years = await db.query(`
      SELECT DISTINCT EXTRACT(YEAR FROM start_date)::int AS year
      FROM events ORDER BY year DESC
    `);

    res.json({
      summary: summary.rows[0],
      yearwise: yearwise.rows,
      available_years: years.rows.map(r => r.year)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

// GET /api/accounts/events — event-wise financial breakdown
router.get('/events', authenticate, accountsAccess, async (req, res) => {
  try {
    const { year } = req.query;
    const yearFilter = year ? `AND EXTRACT(YEAR FROM e.start_date) = ${parseInt(year)}` : '';

    const result = await db.query(`
      SELECT
        e.id, e.title, e.start_date, e.end_date, e.city, e.status,
        COUNT(t.id) FILTER (WHERE t.payment_status IN ('paid','free')) AS total_tickets,
        COUNT(t.id) FILTER (WHERE t.payment_status = 'paid') AS paid_tickets,
        COUNT(t.id) FILTER (WHERE t.payment_status = 'free') AS free_tickets,
        COUNT(t.id) FILTER (WHERE t.age_category = 'child') AS child_count,
        COUNT(t.id) FILTER (WHERE t.age_category = 'yuva') AS yuva_count,
        COUNT(t.id) FILTER (WHERE t.age_category = 'adult') AS adult_count,
        COUNT(t.id) FILTER (WHERE t.sex = 'male') AS male_count,
        COUNT(t.id) FILTER (WHERE t.sex = 'female') AS female_count,
        COALESCE(SUM(t.final_amount) FILTER (WHERE t.payment_status = 'paid'), 0) AS ticket_revenue,
        COALESCE(SUM(t.discount_amount) FILTER (WHERE t.payment_status IN ('paid','free')), 0) AS discounts_given,
        COALESCE(SUM(t.base_amount) FILTER (WHERE t.payment_status IN ('paid','free')), 0) AS gross_amount,
        COALESCE((SELECT SUM(d.amount) FROM donations d WHERE d.event_id = e.id AND d.payment_status = 'paid'), 0) AS donations,
        COUNT(t.id) FILTER (WHERE t.checked_in = true) AS checked_in_count
      FROM events e
      LEFT JOIN tickets t ON t.event_id = e.id
      WHERE 1=1 ${yearFilter}
      GROUP BY e.id
      ORDER BY e.start_date DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch event accounts' });
  }
});

// GET /api/accounts/transactions/:event_id — ticket-wise with Razorpay IDs
router.get('/transactions/:event_id', authenticate, accountsAccess, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        t.id, t.seeker_name, t.age, t.age_category, t.sex,
        t.zone_city, t.email, t.phone,
        t.base_amount, t.discount_amount, t.final_amount,
        t.discount_code_used, t.payment_status,
        t.razorpay_payment_id, t.razorpay_order_id,
        t.checked_in, t.checked_in_at,
        t.created_at
      FROM tickets t
      WHERE t.event_id = $1
      ORDER BY t.created_at DESC
    `, [req.params.event_id]);

    const donations = await db.query(`
      SELECT
        d.id, d.donor_name, d.email, d.amount,
        d.is_anonymous, d.dedication_note,
        d.razorpay_payment_id, d.razorpay_order_id,
        d.payment_status, d.created_at
      FROM donations d
      WHERE d.event_id = $1 AND d.payment_status = 'paid'
      ORDER BY d.created_at DESC
    `, [req.params.event_id]);

    const discountSummary = await db.query(`
      SELECT
        discount_code_used AS code,
        COUNT(*) AS times_used,
        SUM(discount_amount) AS total_discount_given
      FROM tickets
      WHERE event_id = $1 AND discount_code_used IS NOT NULL
      GROUP BY discount_code_used
    `, [req.params.event_id]);

    res.json({
      tickets: result.rows,
      donations: donations.rows,
      discount_summary: discountSummary.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// GET /api/accounts/bookings/:event_id — grouped by booking_group_id (single payment, multiple tickets)
router.get('/bookings/:event_id', authenticate, accountsAccess, async (req, res) => {
    try {
      const result = await db.query(`
        SELECT
          booking_group_id,
          razorpay_payment_id,
          razorpay_order_id,
          payment_status,
          MIN(created_at) AS booked_at,
          COUNT(*) AS ticket_count,
          SUM(final_amount) AS total_amount,
          STRING_AGG(seeker_name, ', ') AS seeker_names,
          MAX(email) AS contact_email,
          MAX(phone) AS contact_phone
        FROM tickets
        WHERE event_id = $1 AND payment_status IN ('paid','free')
        GROUP BY booking_group_id, razorpay_payment_id, razorpay_order_id, payment_status
        ORDER BY booked_at DESC
      `, [req.params.event_id]);
  
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to fetch bookings' });
    }
  });
  
module.exports = router;