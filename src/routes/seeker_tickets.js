const express = require('express');
const db = require('../db');
const { authenticateSeeker } = require('../middleware/seekerAuth');
const router = express.Router();

// GET /api/seeker-tickets — all tickets bought by this seeker
router.get('/', authenticateSeeker, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT 
        t.id, t.seeker_name, t.age, t.age_category, t.sex,
        t.final_amount, t.payment_status, t.qr_uuid,
        t.checked_in, t.checked_in_at,
        t.category_overridden, t.volunteer_interests,
        t.created_at,
        e.title AS event_title, e.start_date, e.end_date,
        e.venue, e.city, e.status AS event_status
       FROM tickets t
       JOIN events e ON e.id = t.event_id
       WHERE t.account_id = $1
       ORDER BY t.created_at DESC`,
      [req.seeker.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

module.exports = router;