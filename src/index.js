require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));

app.use(cors({
  origin: 'https://sahajatickets-frontend-inky.vercel.app',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/events',    require('./routes/events'));
app.use('/api/tickets',   require('./routes/tickets'));
app.use('/api/donations', require('./routes/donations'));
app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/users', require('./routes/users'));

// Health check
app.get('/api/health', (_, res) => res.json({ status: 'ok', time: new Date() }));

// Razorpay webhook (backup payment confirmation)
app.post('/api/webhook/razorpay', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-razorpay-signature'];
  const body = req.body.toString();
  const expected = require('crypto')
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(body).digest('hex');
  if (sig !== expected) return res.status(400).send('Invalid');
  const event = JSON.parse(body);
  console.log('Razorpay webhook:', event.event);
  // TODO: handle payment.captured for missed verifications
  res.json({ received: true });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`✅  SY Events backend running on port ${PORT}`));
