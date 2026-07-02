const jwt = require('jsonwebtoken');

// Verify seeker JWT token (separate from admin/seva auth)
const authenticateSeeker = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Please log in to continue' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'seeker') {
      return res.status(401).json({ error: 'Invalid session' });
    }
    req.seeker = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
};

module.exports = { authenticateSeeker };