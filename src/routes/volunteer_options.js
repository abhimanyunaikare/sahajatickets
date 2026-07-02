const express = require('express');
const db = require('../db');
const { authenticate, organizerOnly } = require('../middleware/auth');
const router = express.Router();

// GET /api/volunteer-options — public, for seeker registration form
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM volunteer_options WHERE is_active=true ORDER BY display_order ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch options' });
  }
});

// GET /api/volunteer-options/all — organizer sees all including inactive
router.get('/all', authenticate, organizerOnly, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM volunteer_options ORDER BY display_order ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch options' });
  }
});

// POST /api/volunteer-options — add new option (organizer only)
router.post('/', authenticate, organizerOnly, async (req, res) => {
  try {
    const { label, display_order } = req.body;
    if (!label?.trim()) return res.status(400).json({ error: 'Label required' });
    const result = await db.query(
      'INSERT INTO volunteer_options (label, display_order) VALUES ($1,$2) RETURNING *',
      [label.trim(), display_order || 99]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to add option' });
  }
});

// PATCH /api/volunteer-options/:id — edit or toggle active
router.patch('/:id', authenticate, organizerOnly, async (req, res) => {
  try {
    const { label, is_active, display_order } = req.body;
    const result = await db.query(
      `UPDATE volunteer_options SET
        label=COALESCE($1,label),
        is_active=COALESCE($2,is_active),
        display_order=COALESCE($3,display_order)
       WHERE id=$4 RETURNING *`,
      [label, is_active, display_order, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Option not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update option' });
  }
});

// DELETE /api/volunteer-options/:id
router.delete('/:id', authenticate, organizerOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM volunteer_options WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete option' });
  }
});

module.exports = router;