const express = require('express');
const db = require('../db');
const { authenticate, organizerOnly } = require('../middleware/auth');
const router = express.Router();

// GET /api/zone-options — public, for seeker forms
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM zone_options WHERE is_active=true ORDER BY display_order ASC, label ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch zones' });
  }
});

// GET /api/zone-options/all — organizer sees all including inactive
router.get('/all', authenticate, organizerOnly, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM zone_options ORDER BY display_order ASC, label ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch zones' });
  }
});

// POST /api/zone-options
router.post('/', authenticate, organizerOnly, async (req, res) => {
  try {
    const { label, display_order } = req.body;
    if (!label?.trim()) return res.status(400).json({ error: 'Label required' });
    const result = await db.query(
      'INSERT INTO zone_options (label, display_order) VALUES ($1,$2) RETURNING *',
      [label.trim(), display_order || 99]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Zone already exists' });
    res.status(500).json({ error: 'Failed to add zone' });
  }
});

// PATCH /api/zone-options/:id
router.patch('/:id', authenticate, organizerOnly, async (req, res) => {
  try {
    const { label, is_active, display_order } = req.body;
    const result = await db.query(
      `UPDATE zone_options SET
        label=COALESCE($1,label),
        is_active=COALESCE($2,is_active),
        display_order=COALESCE($3,display_order)
       WHERE id=$4 RETURNING *`,
      [label, is_active, display_order, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Zone not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update zone' });
  }
});

// DELETE /api/zone-options/:id
router.delete('/:id', authenticate, organizerOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM zone_options WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete zone' });
  }
});

module.exports = router;