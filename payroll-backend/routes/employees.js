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

    let countResult, result;

    if (req.user.userType === 'accountant') {
      countResult = await db.query(
        'SELECT COUNT(*) FROM employees e JOIN companies c ON e.company_id = c.company_id WHERE c.company_id = $1 AND c.accountant_id = $2 AND (e.first_name ILIKE $3 OR e.last_name ILIKE $3 OR e.email ILIKE $3)',
        [companyId, req.user.accountantId, search]
      );
      
      result = await db.query(
        'SELECT e.* FROM employees e JOIN companies c ON e.company_id = c.company_id WHERE c.company_id = $1 AND c.accountant_id = $2 AND (e.first_name ILIKE $3 OR e.last_name ILIKE $3 OR e.email ILIKE $3) ORDER BY e.last_name, e.first_name LIMIT $4 OFFSET $5',
        [companyId, req.user.accountantId, search, limit, offset]
      );
    } else {
      // For client users
      countResult = await db.query(
        'SELECT COUNT(*) FROM employees WHERE company_id = $1 AND (first_name ILIKE $2 OR last_name ILIKE $2 OR email ILIKE $2)',
        [companyId, search]
      );
      
      result = await db.query(
        'SELECT * FROM employees WHERE company_id = $1 AND (first_name ILIKE $2 OR last_name ILIKE $2 OR email ILIKE $2) ORDER BY last_name, first_name LIMIT $3 OFFSET $4',
        [companyId, search, limit, offset]
      );
    }

    const totalEmployees = parseInt(countResult.rows[0].count);

    res.json({
      employees: result.rows,
      currentPage: page,
      totalPages: Math.ceil(totalEmployees / limit),
      totalEmployees
    });
  } catch (err) {
    console.error('Error in get all employees:', err);
    res.status(500).json({ error: 'An error occurred while fetching employees' });
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
    let result;
    if (req.user.userType === 'accountant') {
      result = await db.query('SELECT e.* FROM employees e JOIN companies c ON e.company_id = c.company_id WHERE e.employee_id = $1 AND c.accountant_id = $2', [id, req.user.accountantId]);
    } else {
      result = await db.query('SELECT * FROM employees WHERE employee_id = $1 AND company_id = $2', [id, req.user.companyId]);
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Employee not found or you do not have permission to view this employee' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error in get single employee:', err);
    res.status(500).json({ error: 'An error occurred while fetching the employee' });
  }
});

// Create a new employee
router.post('/', authenticateToken, authorizeClientOrAccountant, [
  body('company_id').optional().isInt(),
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
    const companyId = req.user.userType === 'client' ? req.user.companyId : req.body.company_id;
    const { first_name, last_name, date_of_birth, full_address, email, phone_number, sin, start_date, position, pay_type, pay_rate, pay_schedule, consent_electronic_documents } = req.body;

    // If the user is an accountant, check if they have permission to create an employee for this company
    if (req.user.userType === 'accountant') {
      const companyCheck = await db.query('SELECT accountant_id FROM companies WHERE company_id = $1', [companyId]);
      if (companyCheck.rows.length === 0 || companyCheck.rows[0].accountant_id !== req.user.accountantId) {
        return res.status(403).json({ error: 'Access denied. You do not have permission to create employees for this company.' });
      }
    }

    const result = await db.query(
      `INSERT INTO employees (
        company_id, first_name, last_name, date_of_birth, full_address, email,
        phone_number, sin, start_date, position, pay_type, pay_rate, pay_schedule,
        consent_electronic_documents
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [companyId, first_name, last_name, date_of_birth, full_address, email, phone_number, sin, start_date, position, pay_type, pay_rate, pay_schedule, consent_electronic_documents]
    );

    await logAudit(req.user.userId, req.user.userType, 'create_employee', result.rows[0].employee_id);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error in create employee:', err);
    res.status(500).json({ error: 'An error occurred while creating the employee' });
  }
});

// Update an employee
router.put('/:id', authenticateToken, authorizeClientOrAccountant, [
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

    let query;
    if (req.user.userType === 'accountant') {
      query = `
        UPDATE employees e
        SET ${updateFields.join(', ')}
        FROM companies c
        WHERE e.employee_id = $${paramCount} 
        AND e.company_id = c.company_id
        AND c.accountant_id = $${paramCount + 1}
        RETURNING *
      `;
      values.push(id, req.user.accountantId);
    } else {
      query = `
        UPDATE employees 
        SET ${updateFields.join(', ')}
        WHERE employee_id = $${paramCount} 
        AND company_id = $${paramCount + 1}
        RETURNING *
      `;
      values.push(id, req.user.companyId);
    }

    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Employee not found or you do not have permission to update' });
    }

    await logAudit(req.user.userId, req.user.userType, 'update_employee', id);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error in update employee:', err);
    res.status(500).json({ error: 'An error occurred while updating the employee' });
  }
});

// Offboard an employee (soft delete and add offboarding information)
router.post('/:id/offboard', authenticateToken, authorizeClientOrAccountant, [
  param('id').isInt(),
  body('reason_for_leaving').isIn(['QUIT', 'FIRED', 'LAID_OFF', 'RETIRED', 'OTHER']),
  body('last_day_worked').isDate(),
  body('payout_accrued_vacation').isBoolean(),
  body('callback_date').optional().isDate()
], async (req, res) => {
  console.log('Offboarding route entered');
  console.log('Request params:', req.params);
  console.log('Request body:', req.body);
  console.log('User:', req.user);

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.log('Validation errors:', errors.array());
    return res.status(400).json({ errors: errors.array() });
  }

  const client = await db.getClient();

  try {
    await client.query('BEGIN');
    console.log('Transaction begun');

    const { id } = req.params;
    const { reason_for_leaving, last_day_worked, payout_accrued_vacation, callback_date } = req.body;

    console.log('Checking if employee exists:', id);
    const employeeCheck = await client.query('SELECT * FROM employees WHERE employee_id = $1', [id]);
    if (employeeCheck.rows.length === 0) {
      console.log('Employee not found');
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Employee not found' });
    }

    console.log('Offboarding employee:', id);
    
    // Soft delete the employee
    const updateResult = await client.query(
      'UPDATE employees SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE employee_id = $1 RETURNING *',
      [id]
    );
    console.log('Update result:', updateResult.rows);

    console.log('Inserting offboarding record');
    // Add offboarding information
    const insertResult = await client.query(
      `INSERT INTO employee_offboarding (
        employee_id, reason_for_leaving, last_day_worked, payout_accrued_vacation, callback_date
      ) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, reason_for_leaving, last_day_worked, payout_accrued_vacation, callback_date || null]
    );
    console.log('Insert result:', insertResult.rows);

    await client.query('COMMIT');
    console.log('Transaction committed');

    await logAudit(req.user.userId, req.user.userType, 'offboard_employee', id);
    console.log('Audit logged');

    res.json({ message: 'Employee offboarded successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in offboard employee:', err);
    res.status(500).json({ error: 'An error occurred while offboarding the employee' });
  } finally {
    client.release();
  }
});

module.exports = router;