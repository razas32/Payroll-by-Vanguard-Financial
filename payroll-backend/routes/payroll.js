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
    res.status(500).json({ error: err.message });
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
    const result = await db.query('SELECT * FROM payroll_entries WHERE payroll_id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Payroll entry not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
      UPDATE payroll_entries 
      SET ${updateFields.join(', ')}
      WHERE payroll_id = $${paramCount} 
      RETURNING *
    `;

    values.push(id);

    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Payroll entry not found' });
    }

    await logAudit(req.user.userId, 'accountant', 'update_payroll_entry', id);

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const result = await db.query('DELETE FROM payroll_entries WHERE payroll_id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Payroll entry not found' });
    }

    await logAudit(req.user.userId, 'accountant', 'delete_payroll_entry', id);

    res.json({ message: 'Payroll entry deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;