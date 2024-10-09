// routes/companies.js
const express = require('express');
const router = express.Router();
const db = require('../db');

// Get all companies
router.get('/', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM companies ORDER BY company_name');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get a single company
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query('SELECT * FROM companies WHERE company_id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Company not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create a new company
router.post('/', async (req, res) => {
    try {
        const { company_name, contact_person, email, phone, address } = req.body;
        const result = await db.query(
            'INSERT INTO companies (company_name, contact_person, email, phone, address) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [company_name, contact_person, email, phone, address]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update a company
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { company_name, contact_person, email, phone, address } = req.body;
        const result = await db.query(
            'UPDATE companies SET company_name = $1, contact_person = $2, email = $3, phone = $4, address = $5, updated_at = CURRENT_TIMESTAMP WHERE company_id = $6 RETURNING *',
            [company_name, contact_person, email, phone, address, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Company not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete a company
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query('DELETE FROM companies WHERE company_id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Company not found' });
        }
        res.json({ message: 'Company deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all employees for a company
router.get('/:id/employees', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await db.query('SELECT * FROM employees WHERE company_id = $1', [id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;