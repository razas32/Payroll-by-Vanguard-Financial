// routes/employees.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// Get all employees
router.get('/', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM employees ORDER BY last_name, first_name');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get a single employee
router.get('/:id', async (req, res) => {
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
router.post('/', async (req, res) => {
    try {
        const { 
            company_id, last_name, first_name, date_of_birth, full_address, email, 
            phone_number, sin, start_date, position, pay_type, pay_rate, pay_schedule,
            institution_number, transit_number, account_number, consent_electronic_documents
        } = req.body;
        
        const result = await db.query(
            `INSERT INTO employees (
                company_id, last_name, first_name, date_of_birth, full_address, email,
                phone_number, sin, start_date, position, pay_type, pay_rate, pay_schedule,
                institution_number, transit_number, account_number, consent_electronic_documents
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING *`,
            [company_id, last_name, first_name, date_of_birth, full_address, email,
             phone_number, sin, start_date, position, pay_type, pay_rate, pay_schedule,
             institution_number, transit_number, account_number, consent_electronic_documents]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update an employee
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            company_id, last_name, first_name, date_of_birth, full_address, email, 
            phone_number, sin, start_date, position, pay_type, pay_rate, pay_schedule,
            institution_number, transit_number, account_number, consent_electronic_documents,
            is_active
        } = req.body;
        
        const result = await db.query(
            `UPDATE employees SET 
                company_id = $1, last_name = $2, first_name = $3, date_of_birth = $4, 
                full_address = $5, email = $6, phone_number = $7, sin = $8, start_date = $9, 
                position = $10, pay_type = $11, pay_rate = $12, pay_schedule = $13,
                institution_number = $14, transit_number = $15, account_number = $16, 
                consent_electronic_documents = $17, is_active = $18, updated_at = CURRENT_TIMESTAMP
            WHERE employee_id = $19 RETURNING *`,
            [company_id, last_name, first_name, date_of_birth, full_address, email,
             phone_number, sin, start_date, position, pay_type, pay_rate, pay_schedule,
             institution_number, transit_number, account_number, consent_electronic_documents,
             is_active, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Employee not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete an employee (soft delete by setting is_active to false)
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query(
            'UPDATE employees SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE employee_id = $1 RETURNING *',
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Employee not found' });
        }
        res.json({ message: 'Employee deactivated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all payroll entries for an employee
router.get('/:id/payroll', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query('SELECT * FROM payroll_entries WHERE employee_id = $1 ORDER BY pay_period_start DESC', [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;