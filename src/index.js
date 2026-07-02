require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.FRONTEND_URL,        // your Vercel URL
  process.env.FRONTEND_URL_LOCAL,  // optional local override
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Allow any vercel.app subdomain for preview deployments
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.options('/{*path}', cors());

app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/events',    require('./routes/events'));
app.use('/api/tickets',   require('./routes/tickets'));
app.use('/api/donations', require('./routes/donations'));
app.use('/api/accounts', require('./routes/accounts'));
app.use('/api/users', require('./routes/users'));
app.use('/api/seeker-auth', require('./routes/seeker_auth'));
app.use('/api/family',           require('./routes/family'));
app.use('/api/volunteer-options', require('./routes/volunteer_options'));
app.use('/api/seeker-tickets',   require('./routes/seeker_tickets'));
app.use('/api/volunteer-directory', require('./routes/volunteer_directory'));
app.use('/api/zone-options', require('./routes/zone_options'));

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
