require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./src/db');

async function createAdmin() {
  try {
    const email = 'admin@gmail.com';
    const password = 'rusgulla123';
    const name = 'Admin';

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      console.log('✅ Admin user already exists. Skipping.');
      process.exit(0);
    }

    const hash = await bcrypt.hash(password, 12);
    await db.query(
      'INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4)',
      [name, email, hash, 'organizer']
    );
    console.log('✅ Default admin created:');
    console.log('   Email: admin@gmail.com');
    console.log('   Password: rusgulla123');
    console.log('   ⚠️  Change this password after first login!');
    process.exit(0);
  } catch (err) {
    console.error('Failed to create admin:', err.message);
    process.exit(1);
  }
}

createAdmin();