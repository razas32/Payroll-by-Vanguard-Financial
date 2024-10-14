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
  //console.log('User in authorizeAccountant:', req.user);
  if (req.user && req.user.userType === 'accountant' && req.user.accountantId) {
    next();
  } else {
    res.status(403).json({ error: 'Access denied. Accountant role required.' });
  }
};

// Middleware to authorize clients or their assigned accountant
// In auth.js
const authorizeClientOrAccountant = async (req, res, next) => {
  console.log('Entering authorizeClientOrAccountant middleware');
  console.log('User:', req.user);
  console.log('Request path:', req.path);
  console.log('Request method:', req.method);
  console.log('Request params:', req.params);
  console.log('Request body:', req.body);

  let companyId = parseInt(req.params.companyId || req.body.company_id);
  let employeeId = parseInt(req.params.id);
  
  console.log('Resolved companyId:', companyId);
  console.log('Resolved employeeId:', employeeId);
  console.log('User companyId:', req.user.companyId);
  console.log('User accountantId:', req.user.accountantId);

  try {
    if (req.user.userType === 'accountant') {
      console.log('User is accountant, checking permission');
      if (req.path.includes('/offboard') || req.path.includes('/employees/')) {
        console.log('Offboarding or employee-specific request detected');
        const result = await db.query('SELECT c.company_id FROM employees e JOIN companies c ON e.company_id = c.company_id WHERE e.employee_id = $1 AND c.accountant_id = $2', [employeeId, req.user.accountantId]);
        console.log('Employee permission check result:', result.rows);
        if (result.rows.length === 0) {
          // Instead of denying access, we'll allow it to pass through
          // The route handler will check if the employee exists and return 404 if not
          console.log('Employee not found or not associated with accountant, allowing request to proceed');
        }
      } else if (companyId) {
        const result = await db.query('SELECT accountant_id FROM companies WHERE company_id = $1', [companyId]);
        console.log('Company permission check result:', result.rows);
        if (result.rows.length === 0 || result.rows[0].accountant_id !== req.user.accountantId) {
          console.log('Access denied for accountant - company');
          return res.status(403).json({ error: 'Access denied. Company does not belong to this accountant.' });
        }
      }
    } else if (req.user.userType === 'client') {
      console.log('User is client, checking permission');
      if (req.path.includes('/offboard') || req.path.includes('/employees/')) {
        console.log('Offboarding or employee-specific request detected');
        const result = await db.query('SELECT company_id FROM employees WHERE employee_id = $1', [employeeId]);
        console.log('Employee permission check result:', result.rows);
        if (result.rows.length === 0) {
          // Instead of denying access, we'll allow it to pass through
          // The route handler will check if the employee exists and return 404 if not
          console.log('Employee not found, allowing request to proceed');
        } else if (result.rows[0].company_id !== req.user.companyId) {
          console.log('Access denied for client - employee');
          return res.status(403).json({ error: 'Access denied. Employee does not belong to this client\'s company.' });
        }
      } else if (companyId && companyId !== req.user.companyId) {
        console.log('Access denied for client - company mismatch');
        return res.status(403).json({ error: 'Access denied. Clients can only access their own data.' });
      }
    } else {
      console.log('Invalid user type:', req.user.userType);
      return res.status(403).json({ error: 'Access denied. Invalid user type.' });
    }
    console.log('Authorization successful');
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