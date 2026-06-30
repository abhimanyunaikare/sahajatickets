const express = require('express');
const db = require('../db');
const { authenticate, organizerOnly, registrationAccess } = require('../middleware/auth');
const router = express.Router();

// GET /api/events/my/all — ALL organizers/admins see ALL events (shared org-wide visibility)
router.get('/my/all', authenticate, async (req, res) => {
  try {
    // Only organizer-role users get full event management visibility
    if (req.user.role !== 'organizer') {
      return res.status(403).json({ error: 'Organizer access required' });
    }

    const result = await db.query(
      `SELECT e.*,
        t.adult_male_price, t.adult_female_price,
        t.yuva_male_price, t.yuva_female_price,
        t.child_male_price, t.child_female_price,
        t.is_free,
        u.name AS created_by_name,
        (SELECT COUNT(*) FROM tickets ti WHERE ti.event_id = e.id AND ti.payment_status IN ('paid','free')) AS tickets_sold,
        (SELECT COALESCE(SUM(ti.final_amount),0) FROM tickets ti WHERE ti.event_id = e.id AND ti.payment_status = 'paid') AS total_revenue
       FROM events e
       LEFT JOIN ticket_tiers t ON t.event_id = e.id
       LEFT JOIN users u ON u.id = e.organizer_id
       ORDER BY e.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// GET /api/events — public list of published events
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.*, 
        t.adult_male_price, t.adult_female_price,
        t.yuva_male_price, t.yuva_female_price,
        t.child_male_price, t.child_female_price,
        t.is_free,
        (SELECT COUNT(*) FROM tickets ti WHERE ti.event_id = e.id AND ti.payment_status IN ('paid','free')) AS tickets_sold
       FROM events e
       LEFT JOIN ticket_tiers t ON t.event_id = e.id
       WHERE e.status = 'published'
       ORDER BY e.start_date ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// GET /api/events/:id — single event detail (public)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const eventRes = await db.query(
      `SELECT e.*, t.*, dc.is_active AS discount_enabled
       FROM events e
       LEFT JOIN ticket_tiers t ON t.event_id = e.id
       LEFT JOIN discount_codes dc ON dc.event_id = e.id AND dc.is_active = true
       WHERE e.id = $1 LIMIT 1`, [id]
    );
    if (eventRes.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const ev = eventRes.rows[0];
    // status messaging for frontend
    ev.registration_message =
      ev.status === 'draft' ? 'This event is not yet open for registration.' :
      ev.status === 'closed' ? 'Registrations for this event have closed.' : null;
    res.json(ev);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch event' });
  }
});

// POST /api/events — create event (organizer only)
router.post('/', authenticate, organizerOnly, async (req, res) => {
  try {
    const {
      title, description, banner_url, venue, city, state,
      start_date, end_date, start_time, end_time,
      total_capacity, languages, donation_enabled, sex_based_pricing,
      // Pricing
      child_price, child_male_price, child_female_price, child_max_age,
      yuva_price, yuva_male_price, yuva_female_price, yuva_max_age,
      adult_price, adult_male_price, adult_female_price, is_free
    } = req.body;

    if (!title || !venue || !start_date || !end_date) {
      return res.status(400).json({ error: 'Title, venue, and dates are required' });
    }

    const eventRes = await db.query(
      `INSERT INTO events 
        (organizer_id, title, description, banner_url, venue, city, state, start_date, end_date, start_time, end_time, total_capacity, languages, donation_enabled, sex_based_pricing)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [req.user.id, title, description, banner_url, venue, city, state,
       start_date, end_date, start_time, end_time, total_capacity || 500,
       languages || ['en'],
       donation_enabled !== false,
       sex_based_pricing !== false]
    );
    const event = eventRes.rows[0];

    // Create pricing tier
    // If sex_based_pricing is OFF, use the single price field for both genders
    const cMale = sex_based_pricing === false ? (child_price || 0) : (child_male_price || 0);
    const cFemale = sex_based_pricing === false ? (child_price || 0) : (child_female_price || 0);
    const yMale = sex_based_pricing === false ? (yuva_price || 0) : (yuva_male_price || 0);
    const yFemale = sex_based_pricing === false ? (yuva_price || 0) : (yuva_female_price || 0);
    const aMale = sex_based_pricing === false ? (adult_price || 0) : (adult_male_price || 0);
    const aFemale = sex_based_pricing === false ? (adult_price || 0) : (adult_female_price || 0);

    await db.query(
      `INSERT INTO ticket_tiers 
        (event_id, child_male_price, child_female_price, child_max_age,
         yuva_male_price, yuva_female_price, yuva_max_age,
         adult_male_price, adult_female_price, is_free)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [event.id, cMale, cFemale, child_max_age || 12,
       yMale, yFemale, yuva_max_age || 25,
       aMale, aFemale, is_free || false]
    );

    res.status(201).json(event);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// PATCH /api/events/:id — edit event details
router.patch('/:id', authenticate, organizerOnly, async (req, res) => {
  try {
    const {
      title, description, banner_url, venue, city, state,
      start_date, end_date, start_time, end_time,
      total_capacity, languages, donation_enabled, sex_based_pricing,
      child_price, child_male_price, child_female_price, child_max_age,
      yuva_price, yuva_male_price, yuva_female_price, yuva_max_age,
      adult_price, adult_male_price, adult_female_price, is_free
    } = req.body;

    const eventRes = await db.query(
      `UPDATE events SET
        title=$1, description=$2, banner_url=$3, venue=$4, city=$5, state=$6,
        start_date=$7, end_date=$8, start_time=$9, end_time=$10,
        total_capacity=$11, languages=$12, donation_enabled=$13, sex_based_pricing=$14
        WHERE id=$15 RETURNING *`,
        [title, description, banner_url, venue, city, state,
         start_date, end_date, start_time, end_time, total_capacity,
         languages, donation_enabled !== false, sex_based_pricing !== false,
         req.params.id]
    );
    if (eventRes.rows.length === 0) return res.status(404).json({ error: 'Event not found' });

    const cMale = sex_based_pricing === false ? (child_price || 0) : (child_male_price || 0);
    const cFemale = sex_based_pricing === false ? (child_price || 0) : (child_female_price || 0);
    const yMale = sex_based_pricing === false ? (yuva_price || 0) : (yuva_male_price || 0);
    const yFemale = sex_based_pricing === false ? (yuva_price || 0) : (yuva_female_price || 0);
    const aMale = sex_based_pricing === false ? (adult_price || 0) : (adult_male_price || 0);
    const aFemale = sex_based_pricing === false ? (adult_price || 0) : (adult_female_price || 0);

    await db.query(
      `UPDATE ticket_tiers SET
        child_male_price=$1, child_female_price=$2, child_max_age=$3,
        yuva_male_price=$4, yuva_female_price=$5, yuva_max_age=$6,
        adult_male_price=$7, adult_female_price=$8, is_free=$9
       WHERE event_id=$10`,
      [cMale, cFemale, child_max_age || 12, yMale, yFemale, yuva_max_age || 25,
       aMale, aFemale, is_free || false, req.params.id]
    );

    res.json(eventRes.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// PATCH /api/events/:id/status — publish or close (any organizer can manage any event)
router.patch('/:id/status', authenticate, organizerOnly, async (req, res) => {
  try {
    const { status } = req.body;
    const valid = ['draft', 'published', 'closed'];
    if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });

    const result = await db.query(
      'UPDATE events SET status=$1 WHERE id=$2 RETURNING *',
      [status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// GET /api/events/:id/dashboard — organizer dashboard stats
router.get('/:id/dashboard', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const role = req.user.role;

    const statsRes = await db.query(
      `SELECT 
        COUNT(*) FILTER (WHERE payment_status IN ('paid','free')) AS total_tickets,
        COUNT(*) FILTER (WHERE checked_in = true) AS checked_in_count,
        COUNT(*) FILTER (WHERE age_category = 'child') AS child_count,
        COUNT(*) FILTER (WHERE age_category = 'yuva') AS yuva_count,
        COUNT(*) FILTER (WHERE age_category = 'adult') AS adult_count,
        COUNT(*) FILTER (WHERE sex = 'male') AS male_count,
        COUNT(*) FILTER (WHERE sex = 'female') AS female_count,
        SUM(final_amount) FILTER (WHERE payment_status = 'paid') AS total_revenue
       FROM tickets WHERE event_id = $1`, [id]
    );

    const stats = statsRes.rows[0];

    // Role-based data filtering
    const response = {
      total_tickets: parseInt(stats.total_tickets),
      checked_in_count: parseInt(stats.checked_in_count),
      child_count: parseInt(stats.child_count),
      yuva_count: parseInt(stats.yuva_count),
      adult_count: parseInt(stats.adult_count),
      male_count: parseInt(stats.male_count),
      female_count: parseInt(stats.female_count),
    };

    // Only organizer sees financial data
    if (role === 'organizer') {
      response.total_revenue = parseFloat(stats.total_revenue || 0);
      const donRes = await db.query(
        'SELECT SUM(amount) AS total_donations FROM donations WHERE event_id=$1 AND payment_status=$2',
        [id, 'paid']
      );
      response.total_donations = parseFloat(donRes.rows[0].total_donations || 0);
    }

    // registration_seva sees summary counts only (not revenue)
    // checkin_seva sees only check-in count

    res.json(response);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

// GET /api/events/:id/attendees — attendee list
router.get('/:id/attendees', authenticate, registrationAccess, async (req, res) => {
  try {
    const role = req.user.role;
    let fields = 'seeker_name, age_category, sex, zone_city, checked_in, checked_in_at';
    if (role === 'organizer') fields += ', email, phone, final_amount, discount_code_used';
    if (role === 'registration_seva') fields += ', email, phone';

    const result = await db.query(
      `SELECT ${fields} FROM tickets WHERE event_id = $1 AND payment_status IN ('paid','free') ORDER BY seeker_name`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch attendees' });
  }
});

// POST /api/events/:id/discount — create/toggle discount code
router.post('/:id/discount', authenticate, organizerOnly, async (req, res) => {
  try {
    const { code, type, value, max_uses, valid_until, is_active } = req.body;
    const result = await db.query(
      `INSERT INTO discount_codes (event_id, code, type, value, max_uses, valid_until, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (event_id, code) DO UPDATE SET is_active=$7, value=$4
       RETURNING *`,
      [req.params.id, code.toUpperCase(), type, value || 0, max_uses || 100, valid_until, is_active ?? false]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save discount code' });
  }
});

// POST /api/events/:id/volunteers — add volunteer
router.post('/:id/volunteers', authenticate, organizerOnly, async (req, res) => {
  try {
    const { email, role } = req.body;
    const userRes = await db.query('SELECT id, name FROM users WHERE email=$1', [email]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found. Ask them to register first.' });

    await db.query(
      'INSERT INTO event_volunteers (event_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [req.params.id, userRes.rows[0].id, role]
    );
    res.json({ message: 'Volunteer added', volunteer: userRes.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add volunteer' });
  }
});

module.exports = router;
