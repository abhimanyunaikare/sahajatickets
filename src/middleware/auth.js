const jwt = require('jsonwebtoken');

// Verify JWT token
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Only organizers can access
const organizerOnly = (req, res, next) => {
  if (req.user.role !== 'organizer') {
    return res.status(403).json({ error: 'Organizer access required' });
  }
  next();
};

// Check-in seva + organizer
const checkinAccess = (req, res, next) => {
  const allowed = ['organizer', 'checkin_seva'];
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({ error: 'Check-in access required' });
  }
  next();
};

// Registration seva + organizer
const registrationAccess = (req, res, next) => {
  const allowed = ['organizer', 'registration_seva', 'checkin_seva'];
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({ error: 'Registration access required' });
  }
  next();
};

// Accounts team + organizer
const accountsAccess = (req, res, next) => {
  const allowed = ['organizer', 'accounts'];
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({ error: 'Accounts access required' });
  }
  next();
};

module.exports = { authenticate, organizerOnly, checkinAccess, registrationAccess, accountsAccess };
