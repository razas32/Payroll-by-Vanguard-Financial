// routes/payroll.js
const express = require('express');
const router = express.Router();
const db = require('../db');
const authenticateToken = require('../middleware/auth');

// Get all payroll entries
router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM payroll_entries ORDER BY pay_period_start DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get a single payroll entry
router.get('/:id', authenticateToken, async (req, res) => {
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
router.post('/', authenticateToken, async (req, res) => {
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
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update a payroll entry
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const {
            employee_id, pay_period_start, pay_period_end, hours_worked,
            overtime_hours, gross_pay, deductions, net_pay, payment_date
        } = req.body;
        
        const result = await db.query(
            `UPDATE payroll_entries SET 
                employee_id = $1, pay_period_start = $2, pay_period_end = $3, 
                hours_worked = $4, overtime_hours = $5, gross_pay = $6, 
                deductions = $7, net_pay = $8, payment_date = $9, 
                updated_at = CURRENT_TIMESTAMP
            WHERE payroll_id = $10 RETURNING *`,
            [employee_id, pay_period_start, pay_period_end, hours_worked,
             overtime_hours, gross_pay, deductions, net_pay, payment_date, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Payroll entry not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete a payroll entry
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query('DELETE FROM payroll_entries WHERE payroll_id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Payroll entry not found' });
        }
        res.json({ message: 'Payroll entry deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get payroll entries for a specific date range
router.get('/range/:start/:end', authenticateToken, async (req, res) => {
    try {
        const { start, end } = req.params;
        const result = await db.query(
            'SELECT * FROM payroll_entries WHERE pay_period_start >= $1 AND pay_period_end <= $2 ORDER BY pay_period_start',
            [start, end]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Calculate total payroll for a specific date range
router.get('/total/:start/:end', authenticateToken, async (req, res) => {
    try {
        const { start, end } = req.params;
        const result = await db.query(
            'SELECT SUM(gross_pay) as total_gross, SUM(net_pay) as total_net FROM payroll_entries WHERE pay_period_start >= $1 AND pay_period_end <= $2',
            [start, end]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;