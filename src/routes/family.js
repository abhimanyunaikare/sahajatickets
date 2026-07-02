const express = require('express');
const db = require('../db');
const { authenticateSeeker } = require('../middleware/seekerAuth');
const router = express.Router();
const { calculateAge } = require('../utils/helpers');

// GET /api/family — get all family members for logged-in seeker
router.get('/', authenticateSeeker, async (req, res) => {
  try {
    const result = await db.query(
        `SELECT *,
          EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth))::int AS current_age,
          CASE 
            WHEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth)) <= 12 THEN 'child'
            WHEN EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth)) <= 25 THEN 'yuva'
            ELSE 'adult'
          END AS current_category
         FROM family_members 
         WHERE account_id=$1 ORDER BY created_at ASC`,
        [req.seeker.id]
      );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch family members' });
  }
});

// POST /api/family — add a family member
router.post('/', authenticateSeeker, async (req, res) => {
  try {
    const { name, age, date_of_birth, sex, relation, zone_city, email, phone, volunteer_interests } = req.body;
    // Calculate age from DOB if provided, otherwise use age directly
    const finalAge = date_of_birth ? calculateAge(date_of_birth) : parseInt(age);
    
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    if (!age || age < 1 || age > 120) return res.status(400).json({ error: 'Valid age required' });
    if (!sex) return res.status(400).json({ error: 'Sex required' });

    const result = await db.query(
        `INSERT INTO family_members 
          (account_id, name, age, date_of_birth, sex, relation, zone_city, email, phone, volunteer_interests)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.seeker.id, name.trim(), finalAge, date_of_birth || null, sex,
         relation || 'other', zone_city || null, email || null, phone || null,
         volunteer_interests || []]
      );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add family member' });
  }
});

// PATCH /api/family/:id — edit a family member
router.patch('/:id', authenticateSeeker, async (req, res) => {
  try {
    const { name, age, date_of_birth, sex, relation, zone_city, email, phone, volunteer_interests } = req.body;
    const finalAge = date_of_birth ? calculateAge(date_of_birth) : (age ? parseInt(age) : null);
    
    const result = await db.query(
        `UPDATE family_members SET
          name=COALESCE($1,name), age=COALESCE($2,age),
          date_of_birth=COALESCE($3,date_of_birth),
          sex=COALESCE($4,sex), relation=COALESCE($5,relation),
          zone_city=COALESCE($6,zone_city), email=COALESCE($7,email),
          phone=COALESCE($8,phone), volunteer_interests=COALESCE($9,volunteer_interests)
         WHERE id=$10 AND account_id=$11 RETURNING *,
          EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth))::int AS current_age`,
        [name, finalAge, date_of_birth || null, sex, relation,
         zone_city, email, phone, volunteer_interests || null,
         req.params.id, req.seeker.id]
      );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Member not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update family member' });
  }
});

// DELETE /api/family/:id — delete a family member
router.delete('/:id', authenticateSeeker, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM family_members WHERE id=$1 AND account_id=$2',
      [req.params.id, req.seeker.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete family member' });
  }
});

module.exports = router;