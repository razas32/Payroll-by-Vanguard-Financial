// In employees.js route file:
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { body, query, param, validationResult } = require('express-validator');
const db = require('../db');
const { authenticateToken, authorizeClientOrAccountant } = require('../middleware/auth');
const { logAudit } = require('../utils/auditLogger');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '..', 'uploads', 'employee-documents');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const docType = file.fieldname === 'td1_federal' ? 'federal' : 'provincial';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `td1-${docType}-${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  // Check content type
  if (file.mimetype !== 'application/pdf') {
    return cb(new Error('Only PDF files are allowed'));
  }

  // Check file extension
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext !== '.pdf') {
    return cb(new Error('Only PDF files are allowed'));
  }

  cb(null, true);
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 2 // Maximum 2 files
  }
});

// Add error handling middleware
const handleUploadErrors = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 5MB' });
    }
    return res.status(400).json({ error: `File upload error: ${err.message}` });
  } else if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
};

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

//  create employee route with specific TD1 document requirements
router.post('/', 
  authenticateToken, 
  authorizeClientOrAccountant,
  (req, res, next) => {
    upload.fields([
      { name: 'td1_federal', maxCount: 1 },
      { name: 'td1_provincial', maxCount: 1 }
    ])(req, res, (err) => {
      handleUploadErrors(err, req, res, next);
    });
  },
  [
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
    body('institution_number')
      .isString()
      .isLength({ min: 3, max: 3 })
      .matches(/^\d{3}$/),
    body('transit_number')
      .isString()
      .isLength({ min: 5, max: 5 })
      .matches(/^\d{5}$/),
    body('account_number')
      .isString()
      .isLength({ min: 7, max: 12 })
      .matches(/^\d+$/),
    body('consent_electronic_documents').isBoolean()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      // Check if both TD1 forms were uploaded
      if (!req.files?.td1_federal?.[0] || !req.files?.td1_provincial?.[0]) {
        return res.status(400).json({ 
          error: 'Both federal and provincial TD1 forms are required for employee creation'
        });
      }

      const client = await db.getClient();

      try {
        await client.query('BEGIN');

        const companyId = req.user.userType === 'client' ? req.user.companyId : req.body.company_id;

        // Accountant permission check
        if (req.user.userType === 'accountant') {
          const companyCheck = await client.query(
            'SELECT accountant_id FROM companies WHERE company_id = $1',
            [companyId]
          );
          if (companyCheck.rows.length === 0 || companyCheck.rows[0].accountant_id !== req.user.accountantId) {
            await client.query('ROLLBACK');
            return res.status(403).json({
              error: 'Access denied. You do not have permission to create employees for this company.'
            });
          }
        }

        // Insert employee
        const employeeResult = await client.query(
          `INSERT INTO employees (
            company_id, first_name, last_name, date_of_birth, full_address,
            email, phone_number, sin, start_date, position, pay_type,
            pay_rate, pay_schedule, institution_number, transit_number,
            account_number, consent_electronic_documents
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          RETURNING *`,
          [
            companyId, req.body.first_name, req.body.last_name,
            req.body.date_of_birth, req.body.full_address, req.body.email,
            req.body.phone_number, req.body.sin, req.body.start_date,
            req.body.position, req.body.pay_type, req.body.pay_rate,
            req.body.pay_schedule, req.body.institution_number,
            req.body.transit_number, req.body.account_number,
            req.body.consent_electronic_documents
          ]
        );

        const employeeId = employeeResult.rows[0].employee_id;

        // Insert TD1 federal document
        await client.query(
          `INSERT INTO employee_documents (
            employee_id, document_type, file_name, upload_date, document_path
          ) VALUES ($1, $2, $3, CURRENT_DATE, $4)`,
          [
            employeeId,
            'TD1_FEDERAL',
            req.files.td1_federal[0].originalname,
            req.files.td1_federal[0].path
          ]
        );

        // Insert TD1 provincial document
        await client.query(
          `INSERT INTO employee_documents (
            employee_id, document_type, file_name, upload_date, document_path
          ) VALUES ($1, $2, $3, CURRENT_DATE, $4)`,
          [
            employeeId,
            'TD1_PROVINCIAL',
            req.files.td1_provincial[0].originalname,
            req.files.td1_provincial[0].path
          ]
        );

        // Query to get employee with documents
        const result = await client.query(
          `SELECT e.*, 
            json_agg(json_build_object(
              'document_id', d.document_id,
              'document_type', d.document_type,
              'file_name', d.file_name,
              'upload_date', d.upload_date
            )) as documents
          FROM employees e
          LEFT JOIN employee_documents d ON e.employee_id = d.employee_id
          WHERE e.employee_id = $1
          GROUP BY e.employee_id`,
          [employeeId]
        );

        await client.query('COMMIT');
        await logAudit(req.user.userId, req.user.userType, 'create_employee', employeeId);

        res.status(201).json(result.rows[0]);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Error in create employee:', err);
      res.status(500).json({ error: 'An error occurred while creating the employee' });
    }
  }
);



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