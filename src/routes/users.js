const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { authenticate, organizerOnly } = require('../middleware/auth');
const router = express.Router();

// GET /api/users — list all users (organizer only)
router.get('/', authenticate, organizerOnly, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.name, u.email, u.phone, u.role, u.created_at,
        (SELECT COUNT(*) FROM event_volunteers ev WHERE ev.user_id = u.id) AS events_assigned
       FROM users u ORDER BY u.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// PATCH /api/users/:id — update role
router.patch('/:id', authenticate, organizerOnly, async (req, res) => {
  try {
    const { role, name, phone } = req.body;
    const validRoles = ['organizer', 'checkin_seva', 'registration_seva', 'accounts'];
    if (role && !validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const result = await db.query(
      `UPDATE users SET
        role = COALESCE($1, role),
        name = COALESCE($2, name),
        phone = COALESCE($3, phone)
       WHERE id=$4 RETURNING id, name, email, phone, role`,
      [role, name, phone, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE /api/users/:id — remove user
router.delete('/:id', authenticate, organizerOnly, async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    await db.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// POST /api/users — organizer creates a new volunteer/accounts account directly
router.post('/', authenticate, organizerOnly, async (req, res) => {
  try {
    const { name, email, phone, password, role } = req.body;
    const validRoles = ['organizer', 'checkin_seva', 'registration_seva', 'accounts'];
    const userRole = validRoles.includes(role) ? role : 'checkin_seva';

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 12);
    const result = await db.query(
      'INSERT INTO users (name, email, phone, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, role, phone',
      [name, email, phone || null, hash, userRole]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create user' });
  }
});

module.exports = router;