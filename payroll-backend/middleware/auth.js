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
  console.log('User in authorizeAccountant:', req.user);
  if (req.user && req.user.userType === 'accountant' && req.user.accountantId) {
    next();
  } else {
    res.status(403).json({ error: 'Access denied. Accountant role required.' });
  }
};

// Middleware to authorize clients or their assigned accountant
const authorizeClientOrAccountant = async (req, res, next) => {
  console.log('User in authorizeClientOrAccountant:', req.user);
  let companyId;

  if (req.baseUrl.includes('/employees') && req.params.id) {
    // For single employee routes
    const employeeId = parseInt(req.params.id);
    const employeeResult = await db.query('SELECT company_id FROM employees WHERE employee_id = $1', [employeeId]);
    if (employeeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    companyId = employeeResult.rows[0].company_id;
  } else {
    // For company routes or get all employees route
    companyId = parseInt(req.params.id || req.params.companyId || req.body.company_id);
  }
  
  console.log('Resolved companyId:', companyId);
  console.log('User accountantId:', req.user.accountantId);

  if (!companyId) {
    return res.status(400).json({ error: 'Company ID could not be determined' });
  }

  try {
    if (req.user.userType === 'accountant') {
      const result = await db.query('SELECT accountant_id FROM companies WHERE company_id = $1', [companyId]);
      console.log('Query result:', result.rows);
      if (result.rows.length === 0 || result.rows[0].accountant_id !== req.user.accountantId) {
        return res.status(403).json({ error: 'Access denied. Company does not belong to this accountant.' });
      }
    } else if (req.user.userType === 'client') {
      if (req.user.companyId !== companyId) {
        return res.status(403).json({ error: 'Access denied. Clients can only access their own data.' });
      }
    } else {
      return res.status(403).json({ error: 'Access denied. Invalid user type.' });
    }
    next();
  } catch (err) {
    console.error('Error in authorizeClientOrAccountant:', err);
    res.status(500).json({ error: 'An error occurred while checking authorization' });
  }
};

// Middleware to ensure clients have read-only access
const authorizeClientReadOnly = (req, res, next) => {
  if (req.user.userType === 'client' && req.method !== 'GET') {
    return res.status(403).json({ error: 'Access denied. Clients have read-only access.' });
  }
  next();
};

// Utility function to generate JWT token
const generateToken = (user) => {
  const payload = { 
    userId: user.id, 
    email: user.email, 
    userType: user.user_type,
    accountantId: user.user_type === 'accountant' ? user.accountant_id : null,
    companyId: user.user_type === 'client' ? user.company_id : null 
  };

  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '1h' });
};

// Utility function to validate password
const validatePassword = (password) => {
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

// Middleware to check if the user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.user) {
    next();
  } else {
    res.status(401).json({ error: 'User is not authenticated' });
  }
};

module.exports = {
  authenticateToken,
  authorizeAccountant,
  authorizeClientOrAccountant,
  authorizeClientReadOnly,
  generateToken,
  validatePassword,
  isAuthenticated
};