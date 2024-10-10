const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { sendEmail } = require('../utils/emailSender');
const crypto = require('crypto');

// User Registration
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('userType').isIn(['accountant', 'client'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { email, password, userType } = req.body;

    // Check if user already exists
    const userExists = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Generate verification token
    const verificationToken = crypto.randomBytes(20).toString('hex');

    // Insert user into database
    const result = await db.query(
      'INSERT INTO users (email, password, user_type, verification_token) VALUES ($1, $2, $3, $4) RETURNING user_id',
      [email, hashedPassword, userType, verificationToken]
    );

    const userId = result.rows[0].user_id;

    // Insert into respective table based on user type
    if (userType === 'accountant') {
      await db.query('INSERT INTO accountants (user_id) VALUES ($1)', [userId]);
    } else {
      await db.query('INSERT INTO companies (user_id) VALUES ($1)', [userId]);
    }

    // Send verification email
    const verificationLink = `http://localhost:3000/verify-email?token=${verificationToken}`;
    await sendEmail(
      email,
      'Verify Your Email',
      `Please click on the following link to verify your email: ${verificationLink}`
    );

    res.status(201).json({ message: 'User registered successfully. Please check your email to verify your account.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// User Login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { email, password } = req.body;

    // Check if user exists
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Check if email is verified
    if (!user.is_verified) {
      return res.status(400).json({ error: 'Please verify your email before logging in' });
    }

    // Check password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.user_id, userType: user.user_type },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({ token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Email Verification
router.get('/verify-email', async (req, res) => {
  try {
    const { token } = req.query;

    const result = await db.query(
      'UPDATE users SET is_verified = true, verification_token = null WHERE verification_token = $1 RETURNING *',
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Password Reset Request
router.post('/reset-password-request', [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { email } = req.body;

    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'User not found' });
    }

    const resetToken = crypto.randomBytes(20).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now

    await db.query(
      'UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE email = $3',
      [resetToken, resetTokenExpiry, email]
    );

    const resetLink = `http://yourdomain.com/reset-password?token=${resetToken}`;
    await sendEmail(
      email,
      'Password Reset Request',
      `Please click on the following link to reset your password: ${resetLink}`
    );

    res.json({ message: 'Password reset link sent to your email' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Password Reset
router.post('/reset-password', [
  body('token').notEmpty(),
  body('password').isLength({ min: 8 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { token, password } = req.body;

    const result = await db.query(
      'SELECT * FROM users WHERE reset_token = $1 AND reset_token_expiry > $2',
      [token, new Date()]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await db.query(
      'UPDATE users SET password = $1, reset_token = null, reset_token_expiry = null WHERE reset_token = $2',
      [hashedPassword, token]
    );

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;