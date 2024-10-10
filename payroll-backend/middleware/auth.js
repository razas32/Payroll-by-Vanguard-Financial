const jwt = require('jsonwebtoken');
const db = require('../db');

// Middleware to authenticate JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) {
    return res.status(401).json({ error: 'Authentication token is required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Middleware to authorize accountants
const authorizeAccountant = (req, res, next) => {
  if (req.user.role !== 'accountant') {
    return res.status(403).json({ error: 'Access denied. Accountant role required.' });
  }
  next();
};

// Middleware to authorize clients or their assigned accountant
const authorizeClientOrAccountant = async (req, res, next) => {
  const companyId = parseInt(req.params.id || req.params.companyId || req.body.company_id);
  
  if (!companyId) {
    return res.status(400).json({ error: 'Company ID is required' });
  }

  try {
    if (req.user.role === 'accountant') {
      const result = await db.query('SELECT accountant_id FROM companies WHERE company_id = $1', [companyId]);
      if (result.rows.length === 0 || result.rows[0].accountant_id !== req.user.userId) {
        return res.status(403).json({ error: 'Access denied. Company does not belong to this accountant.' });
      }
    } else if (req.user.role === 'client') {
      if (req.user.companyId !== companyId) {
        return res.status(403).json({ error: 'Access denied. Clients can only access their own data.' });
      }
    } else {
      return res.status(403).json({ error: 'Access denied. Invalid role.' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: 'An error occurred while checking authorization' });
  }
};

// Middleware to ensure clients have read-only access
const authorizeClientReadOnly = (req, res, next) => {
  if (req.user.role === 'client' && req.method !== 'GET') {
    return res.status(403).json({ error: 'Access denied. Clients have read-only access.' });
  }
  next();
};

// Utility function to generate JWT token
const generateToken = (user) => {
  return jwt.sign(
    { 
      userId: user.id, 
      email: user.email, 
      role: user.role, 
      companyId: user.role === 'client' ? user.companyId : null 
    },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
};

// Utility function to validate password
const validatePassword = (password) => {
  // Implement password validation logic here
  // For example: minimum length, require uppercase, lowercase, number, special character
  const minLength = 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  return (
    password.length >= minLength &&
    hasUppercase &&
    hasLowercase &&
    hasNumber &&
    hasSpecialChar
  );
};

module.exports = {
  authenticateToken,
  authorizeAccountant,
  authorizeClientOrAccountant,
  authorizeClientReadOnly,
  generateToken,
  validatePassword
};