const express = require('express');
const router = express.Router();
const { body, query, param, validationResult } = require('express-validator');
const db = require('../db');
const { authenticateToken, authorizeAccountant } = require('../middleware/auth');
const { logAudit } = require('../utils/auditLogger');

// Get all payroll entries for a company (with pagination and date range filter)
router.get('/company/:companyId', authenticateToken, authorizeAccountant, [
  param('companyId').isInt(),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('startDate').optional().isDate(),
  query('endDate').optional().isDate()
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
    const startDate = req.query.startDate || '1900-01-01';
    const endDate = req.query.endDate || '9999-12-31';

    // Check if the accountant has access to this company
    const companyCheck = await db.query('SELECT accountant_id FROM companies WHERE company_id = $1', [companyId]);
    if (companyCheck.rows.length === 0 || companyCheck.rows[0].accountant_id !== req.user.accountantId) {
      return res.status(403).json({ error: 'You do not have permission to access this company\'s payroll' });
    }

    const countResult = await db.query(
      `SELECT COUNT(*) FROM payroll_entries pe
       JOIN employees e ON pe.employee_id = e.employee_id
       WHERE e.company_id = $1 AND pe.pay_period_start >= $2 AND pe.pay_period_end <= $3`,
      [companyId, startDate, endDate]
    );
    const totalEntries = parseInt(countResult.rows[0].count);

    const result = await db.query(
      `SELECT pe.* FROM payroll_entries pe
       JOIN employees e ON pe.employee_id = e.employee_id
       WHERE e.company_id = $1 AND pe.pay_period_start >= $2 AND pe.pay_period_end <= $3
       ORDER BY pe.pay_period_start DESC, pe.employee_id
       LIMIT $4 OFFSET $5`,
      [companyId, startDate, endDate, limit, offset]
    );

    res.json({
      payrollEntries: result.rows,
      currentPage: page,
      totalPages: Math.ceil(totalEntries / limit),
      totalEntries
    });
  } catch (err) {
    console.error('Error in get all payroll entries:', err);
    res.status(500).json({ error: 'An error occurred while fetching payroll entries' });
  }
});

// Get a single payroll entry
router.get('/:id', authenticateToken, authorizeAccountant, [
  param('id').isInt()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT pe.* FROM payroll_entries pe
       JOIN employees e ON pe.employee_id = e.employee_id
       JOIN companies c ON e.company_id = c.company_id
       WHERE pe.payroll_id = $1 AND c.accountant_id = $2`,
      [id, req.user.accountantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Payroll entry not found or you do not have permission to view it' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error in get single payroll entry:', err);
    res.status(500).json({ error: 'An error occurred while fetching the payroll entry' });
  }
});

// Create a new payroll entry
router.post('/', authenticateToken, authorizeAccountant, [
  body('employee_id').isInt(),
  body('pay_period_start').isDate(),
  body('pay_period_end').isDate(),
  body('hours_worked').isFloat({ min: 0 }),
  body('overtime_hours').isFloat({ min: 0 }),
  body('gross_pay').isFloat({ min: 0 }),
  body('deductions').isFloat({ min: 0 }),
  body('net_pay').isFloat({ min: 0 }),
  body('payment_date').isDate()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const {
      employee_id, pay_period_start, pay_period_end, hours_worked,
      overtime_hours, gross_pay, deductions, net_pay, payment_date
    } = req.body;

    // Check if the employee belongs to a company managed by this accountant
    const employeeCheck = await db.query(
      'SELECT c.accountant_id FROM employees e JOIN companies c ON e.company_id = c.company_id WHERE e.employee_id = $1',
      [employee_id]
    );
    if (employeeCheck.rows.length === 0 || employeeCheck.rows[0].accountant_id !== req.user.accountantId) {
      return res.status(403).json({ error: 'You do not have permission to create payroll entries for this employee' });
    }

    const result = await db.query(
      `INSERT INTO payroll_entries (
        employee_id, pay_period_start, pay_period_end, hours_worked,
        overtime_hours, gross_pay, deductions, net_pay, payment_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [employee_id, pay_period_start, pay_period_end, hours_worked,
       overtime_hours, gross_pay, deductions, net_pay, payment_date]
    );

    await logAudit(req.user.userId, 'accountant', 'create_payroll_entry', result.rows[0].payroll_id);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error in create payroll entry:', err);
    res.status(500).json({ error: 'An error occurred while creating the payroll entry' });
  }
});

// Update a payroll entry
router.put('/:id', authenticateToken, authorizeAccountant, [
  param('id').isInt(),
  body('employee_id').optional().isInt(),
  body('pay_period_start').optional().isDate(),
  body('pay_period_end').optional().isDate(),
  body('hours_worked').optional().isFloat({ min: 0 }),
  body('overtime_hours').optional().isFloat({ min: 0 }),
  body('gross_pay').optional().isFloat({ min: 0 }),
  body('deductions').optional().isFloat({ min: 0 }),
  body('net_pay').optional().isFloat({ min: 0 }),
  body('payment_date').optional().isDate()
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
      UPDATE payroll_entries pe
      SET ${updateFields.join(', ')}
      FROM employees e
      JOIN companies c ON e.company_id = c.company_id
      WHERE pe.payroll_id = $${paramCount}
      AND pe.employee_id = e.employee_id
      AND c.accountant_id = $${paramCount + 1}
      RETURNING pe.*
    `;

    values.push(id, req.user.accountantId);

    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Payroll entry not found or you do not have permission to update it' });
    }

    await logAudit(req.user.userId, 'accountant', 'update_payroll_entry', id);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error in update payroll entry:', err);
    res.status(500).json({ error: 'An error occurred while updating the payroll entry' });
  }
});

// Delete a payroll entry
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
      `DELETE FROM payroll_entries pe
       USING employees e, companies c
       WHERE pe.payroll_id = $1
       AND pe.employee_id = e.employee_id
       AND e.company_id = c.company_id
       AND c.accountant_id = $2
       RETURNING pe.*`,
      [id, req.user.accountantId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Payroll entry not found or you do not have permission to delete it' });
    }

    await logAudit(req.user.userId, 'accountant', 'delete_payroll_entry', id);

    res.json({ message: 'Payroll entry deleted successfully' });
  } catch (err) {
    console.error('Error in delete payroll entry:', err);
    res.status(500).json({ error: 'An error occurred while deleting the payroll entry' });
  }
});

// Calculate total payroll for a company within a date range
router.get('/total/:companyId', authenticateToken, authorizeAccountant, [
  param('companyId').isInt(),
  query('startDate').isDate(),
  query('endDate').isDate()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { companyId } = req.params;
    const { startDate, endDate } = req.query;

    // Check if the accountant has access to this company
    const companyCheck = await db.query('SELECT accountant_id FROM companies WHERE company_id = $1', [companyId]);
    if (companyCheck.rows.length === 0 || companyCheck.rows[0].accountant_id !== req.user.accountantId) {
      return res.status(403).json({ error: 'You do not have permission to access this company\'s payroll' });
    }

    const result = await db.query(
      `SELECT 
        SUM(pe.gross_pay) as total_gross,
        SUM(pe.net_pay) as total_net,
        SUM(pe.deductions) as total_deductions,
        COUNT(DISTINCT pe.employee_id) as employee_count
       FROM payroll_entries pe
       JOIN employees e ON pe.employee_id = e.employee_id
       WHERE e.company_id = $1 AND pe.pay_period_start >= $2 AND pe.pay_period_end <= $3`,
      [companyId, startDate, endDate]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error in calculate total payroll:', err);
    res.status(500).json({ error: 'An error occurred while calculating total payroll' });
  }
});

module.exports = router;