const express = require('express');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const router = express.Router();

// GET /api/volunteer-directory
// Organizer-only view of all seekers + family members with volunteer interests
router.get('/', authenticate, async (req, res) => {
  try {
    const { interest, category, zone } = req.query;

    let query = `
      SELECT * FROM volunteer_directory
      WHERE 1=1
    `;
    const params = [];
    let paramIdx = 1;

    if (interest) {
      query += ` AND $${paramIdx} = ANY(volunteer_interests)`;
      params.push(interest);
      paramIdx++;
    }
    if (category) {
      query += ` AND age_category = $${paramIdx}`;
      params.push(category);
      paramIdx++;
    }
    if (zone) {
      query += ` AND zone_city ILIKE $${paramIdx}`;
      params.push(`%${zone}%`);
      paramIdx++;
    }

    query += ` ORDER BY seeker_name`;
    const result = await db.query(query, params);

    // Get interest counts for filter summary
    const countRes = await db.query(`
      SELECT unnest(volunteer_interests) AS interest, COUNT(*) AS count
      FROM volunteer_directory
      GROUP BY interest
      ORDER BY count DESC
    `);

    res.json({
      volunteers: result.rows,
      total: result.rows.length,
      interest_counts: countRes.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch volunteer directory' });
  }
});

module.exports = router;