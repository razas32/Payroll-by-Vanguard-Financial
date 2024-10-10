const express = require('express');
const router = express.Router();
const { body, query, param, validationResult } = require('express-validator');
const db = require('../db');
const { authenticateToken, authorizeClientOrAccountant, authorizeAccountant } = require('../middleware/auth');
const { logAudit } = require('../utils/auditLogger');

// Get all employees (for a specific company, with pagination and search)
router.get('/company/:companyId', authenticateToken, authorizeClientOrAccountant, [
  param('companyId').isInt(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { companyId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : '%';

    const countResult = await db.query(
      'SELECT COUNT(*) FROM employees WHERE company_id = $1 AND (first_name ILIKE $2 OR last_name ILIKE $2 OR email ILIKE $2)',
      [companyId, search]
    );
    const totalEmployees = parseInt(countResult.rows[0].count);

    const result = await db.query(
      'SELECT * FROM employees WHERE company_id = $1 AND (first_name ILIKE $2 OR last_name ILIKE $2 OR email ILIKE $2) ORDER BY last_name, first_name LIMIT $3 OFFSET $4',
      [companyId, search, limit, offset]
    );

    res.json({
      employees: result.rows,
      currentPage: page,
      totalPages: Math.ceil(totalEmployees / limit),
      totalEmployees
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get a single employee
router.get('/:id', authenticateToken, authorizeClientOrAccountant, [
  param('id').isInt()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM employees WHERE employee_id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a new employee
router.post('/', authenticateToken, authorizeAccountant, [
  body('company_id').isInt(),
  body('first_name').notEmpty().trim(),
  body('last_name').notEmpty().trim(),
  body('date_of_birth').isDate(),
  body('full_address').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('phone_number').isMobilePhone(),
  body('sin').isLength({ min: 9, max: 9 }),
  body('start_date').isDate(),
  body('position').notEmpty().trim(),
  body('pay_type').isIn(['HOURLY', 'SALARY']),
  body('pay_rate').isFloat({ min: 0 }),
  body('pay_schedule').isIn(['WEEKLY', 'BIWEEKLY', 'MONTHLY']),
  body('institution_number').optional().isString(),
  body('transit_number').optional().isString(),
  body('account_number').optional().isString(),
  body('consent_electronic_documents').isBoolean()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const {
      company_id, first_name, last_name, date_of_birth, full_address, email,
      phone_number, sin, start_date, position, pay_type, pay_rate, pay_schedule,
      institution_number, transit_number, account_number, consent_electronic_documents
    } = req.body;

    const result = await db.query(
      `INSERT INTO employees (
        company_id, first_name, last_name, date_of_birth, full_address, email,
        phone_number, sin, start_date, position, pay_type, pay_rate, pay_schedule,
        institution_number, transit_number, account_number, consent_electronic_documents
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
      [company_id, first_name, last_name, date_of_birth, full_address, email,
       phone_number, sin, start_date, position, pay_type, pay_rate, pay_schedule,
       institution_number, transit_number, account_number, consent_electronic_documents]
    );

    await logAudit(req.user.userId, 'accountant', 'create_employee', result.rows[0].employee_id);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update an employee
router.put('/:id', authenticateToken, authorizeAccountant, [
  param('id').isInt(),
  body('first_name').optional().notEmpty().trim(),
  body('last_name').optional().notEmpty().trim(),
  body('date_of_birth').optional().isDate(),
  body('full_address').optional().notEmpty().trim(),
  body('email').optional().isEmail().normalizeEmail(),
  body('phone_number').optional().isMobilePhone(),
  body('sin').optional().isLength({ min: 9, max: 9 }),
  body('start_date').optional().isDate(),
  body('position').optional().notEmpty().trim(),
  body('pay_type').optional().isIn(['HOURLY', 'SALARY']),
  body('pay_rate').optional().isFloat({ min: 0 }),
  body('pay_schedule').optional().isIn(['WEEKLY', 'BIWEEKLY', 'MONTHLY']),
  body('institution_number').optional().isString(),
  body('transit_number').optional().isString(),
  body('account_number').optional().isString(),
  body('consent_electronic_documents').optional().isBoolean(),
  body('is_active').optional().isBoolean()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const updateFields = [];
    const values = [];
    let paramCount = 1;

    Object.keys(req.body).forEach(key => {
      if (req.body[key] !== undefined) {
        updateFields.push(`${key} = $${paramCount}`);
        values.push(req.body[key]);
        paramCount++;
      }
    });

    updateFields.push('updated_at = CURRENT_TIMESTAMP');

    const query = `
      UPDATE employees 
      SET ${updateFields.join(', ')}
      WHERE employee_id = $${paramCount} 
      RETURNING *
    `;

    values.push(id);

    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    await logAudit(req.user.userId, 'accountant', 'update_employee', id);

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete an employee (soft delete by setting is_active to false)
router.delete('/:id', authenticateToken, authorizeAccountant, [
  param('id').isInt()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const result = await db.query(
      'UPDATE employees SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE employee_id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    await logAudit(req.user.userId, 'accountant', 'deactivate_employee', id);

    res.json({ message: 'Employee deactivated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;