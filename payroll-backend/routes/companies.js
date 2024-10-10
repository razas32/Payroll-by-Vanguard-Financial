const express = require('express');
const router = express.Router();
const { body, query, param, validationResult } = require('express-validator');
const db = require('../db');
const { authenticateToken, authorizeAccountant, authorizeClientOrAccountant } = require('../middleware/auth');
const { logAudit } = require('../utils/auditLogger');

// Get all companies (for accountants only, with pagination and search)
router.get('/', authenticateToken, authorizeAccountant, [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('search').optional().isString()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search ? `%${req.query.search}%` : '%';

    const countResult = await db.query(
      'SELECT COUNT(*) FROM companies WHERE accountant_id = $1 AND (company_name ILIKE $2 OR contact_person ILIKE $2 OR email ILIKE $2)',
      [req.user.accountantId, search]
    );
    const totalCompanies = parseInt(countResult.rows[0].count);

    const result = await db.query(
      'SELECT * FROM companies WHERE accountant_id = $1 AND (company_name ILIKE $2 OR contact_person ILIKE $2 OR email ILIKE $2) ORDER BY company_name LIMIT $3 OFFSET $4',
      [req.user.accountantId, search, limit, offset]
    );

    res.json({
      companies: result.rows,
      currentPage: page,
      totalPages: Math.ceil(totalCompanies / limit),
      totalCompanies
    });
  } catch (err) {
    console.error('Error in get all companies:', err);
    res.status(500).json({ error: 'An error occurred while fetching companies' });
  }
});

// Get a single company
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
      result = await db.query('SELECT * FROM companies WHERE company_id = $1 AND accountant_id = $2', [id, req.user.accountantId]);
    } else {
      result = await db.query('SELECT * FROM companies WHERE company_id = $1', [id]);
    }
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Company not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error in get single company:', err);
    res.status(500).json({ error: 'An error occurred while fetching the company' });
  }
});

// Create a new company (for accountants only)
router.post('/', authenticateToken, authorizeAccountant, [
  body('company_name').notEmpty().trim(),
  body('contact_person').notEmpty().trim(),
  body('email').isEmail().normalizeEmail(),
  body('phone').isMobilePhone(),
  body('address').notEmpty().trim()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { company_name, contact_person, email, phone, address } = req.body;
    const result = await db.query(
      'INSERT INTO companies (company_name, contact_person, email, phone, address, accountant_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [company_name, contact_person, email, phone, address, req.user.accountantId]
    );
    
    await logAudit(req.user.userId, 'accountant', 'create_company', result.rows[0].company_id);
    
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error in create company:', err);
    res.status(500).json({ error: 'An error occurred while creating the company' });
  }
});

// Update a company
router.put('/:id', authenticateToken, authorizeClientOrAccountant, [
  param('id').isInt(),
  body('company_name').optional().notEmpty().trim(),
  body('contact_person').optional().notEmpty().trim(),
  body('email').optional().isEmail().normalizeEmail(),
  body('phone').optional().isMobilePhone(),
  body('address').optional().notEmpty().trim()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const { company_name, contact_person, email, phone, address } = req.body;
    
    let updateFields = [];
    let values = [];
    let paramCount = 1;

    if (company_name) {
      updateFields.push(`company_name = $${paramCount}`);
      values.push(company_name);
      paramCount++;
    }
    if (contact_person) {
      updateFields.push(`contact_person = $${paramCount}`);
      values.push(contact_person);
      paramCount++;
    }
    if (email) {
      updateFields.push(`email = $${paramCount}`);
      values.push(email);
      paramCount++;
    }
    if (phone) {
      updateFields.push(`phone = $${paramCount}`);
      values.push(phone);
      paramCount++;
    }
    if (address) {
      updateFields.push(`address = $${paramCount}`);
      values.push(address);
      paramCount++;
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);

    const query = `
      UPDATE companies 
      SET ${updateFields.join(', ')}
      WHERE company_id = $${paramCount} 
      ${req.user.userType === 'client' ? `AND company_id = $${paramCount + 1}` : `AND accountant_id = $${paramCount + 1}`} 
      RETURNING *
    `;

    values.push(id, req.user.userType === 'client' ? req.user.companyId : req.user.accountantId);

    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Company not found or you do not have permission to update it' });
    }

    await logAudit(req.user.userId, req.user.userType, 'update_company', id);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error in update company:', err);
    res.status(500).json({ error: 'An error occurred while updating the company' });
  }
});

// Delete a company (for accountants only)
router.delete('/:id', authenticateToken, authorizeAccountant, [
  param('id').isInt()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM companies WHERE company_id = $1 AND accountant_id = $2 RETURNING *', [id, req.user.accountantId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Company not found or you do not have permission to delete it' });
    }

    await logAudit(req.user.userId, 'accountant', 'delete_company', id);

    res.json({ message: 'Company deleted successfully' });
  } catch (err) {
    console.error('Error in delete company:', err);
    res.status(500).json({ error: 'An error occurred while deleting the company' });
  }
});

// Accountant associates with an existing company
router.post('/associate/:companyId', authenticateToken, authorizeAccountant, [
  param('companyId').isInt()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { companyId } = req.params;
    const result = await db.query(
      'UPDATE companies SET accountant_id = $1 WHERE company_id = $2 AND accountant_id IS NULL RETURNING *',
      [req.user.accountantId, companyId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Company not found or already associated with an accountant' });
    }

    await logAudit(req.user.userId, 'accountant', 'associate_company', companyId);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error in associate company:', err);
    res.status(500).json({ error: 'An error occurred while associating with the company' });
  }
});

module.exports = router;