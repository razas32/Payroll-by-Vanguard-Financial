const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');

// Mock dependencies
jest.mock('../utils/emailSender', () => ({
  sendEmail: jest.fn().mockResolvedValue(true)
}));

jest.mock('../utils/auditLogger', () => ({
  logAudit: jest.fn(),
}));

const { sendEmail: mockSendEmail } = require('../utils/emailSender');

// Import route files
const authRoutes = require('../routes/auth');
const companyRoutes = require('../routes/companies');
const employeeRoutes = require('../routes/employees');
const payrollRoutes = require('../routes/payroll');

// Create test app
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/payroll', payrollRoutes);

describe('API Routes', () => {
  let accountantToken, clientToken, companyId, employeeId, payrollId, accountantId, clientUserId;
  let testFilesDir;

  beforeAll(async () => {
    // Set up test files directory
    testFilesDir = path.join(__dirname, 'test-files');
    try {
      await fs.mkdir(testFilesDir, { recursive: true });
      
      // Create test PDF files
      const testFederalPdf = path.join(testFilesDir, 'test-federal-td1.pdf');
      const testProvincialPdf = path.join(testFilesDir, 'test-provincial-td1.pdf');
      testTextFile = path.join(testFilesDir, 'test.txt');
      
      const pdfContent = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer<</Root 1 0 R>>');
      await Promise.all([
        fs.writeFile(testFederalPdf, pdfContent),
        fs.writeFile(testProvincialPdf, pdfContent),
        fs.writeFile(testTextFile, 'This is not a PDF')
      ]);
    } catch (err) {
      console.error('Error setting up test files:', err);
    }

    // Create uploads directory
    const uploadsDir = path.join(__dirname, '../uploads/employee-documents');
    try {
      await fs.mkdir(uploadsDir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') console.error('Error creating uploads directory:', err);
    }

    const hashedPassword = await bcrypt.hash('Password123!', 10);
    
    // Create accountant user
    const accountantResult = await db.query(
      'INSERT INTO users (email, password, user_type, is_verified) VALUES ($1, $2, $3, $4) RETURNING user_id',
      ['accountant@test.com', hashedPassword, 'accountant', true]
    );
    const accountantUserId = accountantResult.rows[0].user_id;
    
    // Create accountant record
    const accountantDetailResult = await db.query(
      'INSERT INTO accountants (user_id, first_name, last_name) VALUES ($1, $2, $3) RETURNING accountant_id',
      [accountantUserId, 'Test', 'Accountant']
    );
    accountantId = accountantDetailResult.rows[0].accountant_id;
  
    // Create client user and store the ID
    const clientResult = await db.query(
      'INSERT INTO users (email, password, user_type, is_verified) VALUES ($1, $2, $3, $4) RETURNING user_id',
      ['client@test.com', hashedPassword, 'client', true]
    );
    clientUserId = clientResult.rows[0].user_id; // Store the client user ID
  
    // Create company
    const companyResult = await db.query(
      'INSERT INTO companies (user_id, company_name, contact_person, phone, address, accountant_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING company_id',
      [clientUserId, 'Test Company', 'John Doe', '1234567890', '123 Test St', accountantId]
    );
    companyId = companyResult.rows[0].company_id;
  
    // Create an employee with direct deposit info
    const employeeResult = await db.query(
      `INSERT INTO employees (
        company_id, last_name, first_name, date_of_birth, full_address, email,
        phone_number, sin, start_date, position, pay_type, pay_rate,
        pay_schedule, institution_number, transit_number, account_number,
        consent_electronic_documents
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING employee_id`,
      [
        companyId, 'Doe', 'Jane', '1990-01-01', '456 Emp St',
        'jane@testcompany.com', '9876543210', '987654321', '2023-01-01',
        'Tester', 'SALARY', 50000, 'BIWEEKLY', '001', '12345',
        '1234567890', true
      ]
    );
    employeeId = employeeResult.rows[0].employee_id;
  
    // Create payroll entry
    const payrollResult = await db.query(
      `INSERT INTO payroll_entries (
        employee_id, pay_period_start, pay_period_end, hours_worked,
        gross_pay, deductions, net_pay, payment_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING payroll_id`,
      [employeeId, '2023-01-01', '2023-01-15', 80, 2000, 400, 1600, '2023-01-20']
    );
    payrollId = payrollResult.rows[0].payroll_id;
  
    // Generate tokens
    accountantToken = jwt.sign(
      { userId: accountantUserId, userType: 'accountant', accountantId },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    clientToken = jwt.sign(
      { userId: clientUserId, userType: 'client', companyId },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
  });

  describe('Auth Routes', () => {
    it('should register a new user', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'newuser@test.com',
          password: 'NewPassword123!',
          userType: 'client',
          companyName: 'New Test Company'
        });
      expect(res.statusCode).toEqual(201);
      expect(res.body).toHaveProperty('message');
    });

    it('should login a user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'accountant@test.com',
          password: 'Password123!'
        });
      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('token');
    });

    it('should not login with incorrect credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'accountant@test.com',
          password: 'WrongPassword123!'
        });
      expect(res.statusCode).toEqual(400);
    });

    it('should not register a user with invalid email', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'invalidemail',
          password: 'Password123!',
          userType: 'client',
          companyName: 'Invalid Email Company'
        });
      expect(res.statusCode).toEqual(400);
      expect(res.body).toHaveProperty('errors');
    });

    it('should send a password reset email', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password-request')
        .send({ email: 'client@test.com' });
      expect(res.statusCode).toEqual(200);
      expect(mockSendEmail).toHaveBeenCalled();
    });

    it('should not send a password reset email for non-existent user', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password-request')
        .send({ email: 'nonexistent@test.com' });
      expect(res.statusCode).toEqual(400);
    });
  });

  describe('Company Routes', () => {
    describe('Accountant', () => {
      it('should be able to get all companies', async () => {
        const res = await request(app)
          .get('/api/companies')
          .set('Authorization', `Bearer ${accountantToken}`);
        expect(res.statusCode).toEqual(200);
        expect(Array.isArray(res.body.companies)).toBeTruthy();
      });

      it('should be able to get a single company', async () => {
        const res = await request(app)
          .get(`/api/companies/${companyId}`)
          .set('Authorization', `Bearer ${accountantToken}`);
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('company_id');
      });

      it('should be able to create a new company', async () => {
        const res = await request(app)
          .post('/api/companies')
          .set('Authorization', `Bearer ${accountantToken}`)
          .send({
            company_name: 'New Company',
            contact_person: 'Jane Doe',
            email: 'jane@newcompany.com',
            phone: '9876543210',
            address: '456 New St, New City, NS 67890'
          });
        expect(res.statusCode).toEqual(201);
        expect(res.body).toHaveProperty('company_id');
      });

      it('should be able to update a company', async () => {
        const res = await request(app)
          .put(`/api/companies/${companyId}`)
          .set('Authorization', `Bearer ${accountantToken}`)
          .send({
            company_name: 'Updated Company Name'
          });
        expect(res.statusCode).toEqual(200);
        expect(res.body.company_name).toEqual('Updated Company Name');
      });
    });

    describe('Client', () => {
      it('should not be able to get all companies', async () => {
        const res = await request(app)
          .get('/api/companies')
          .set('Authorization', `Bearer ${clientToken}`);
        expect(res.statusCode).toEqual(403);
      });

      it('should be able to get their own company', async () => {
        const res = await request(app)
          .get(`/api/companies/${companyId}`)
          .set('Authorization', `Bearer ${clientToken}`);
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('company_id', companyId);
      });

      it('should not be able to create a new company', async () => {
        const res = await request(app)
          .post('/api/companies')
          .set('Authorization', `Bearer ${clientToken}`)
          .send({
            company_name: 'Unauthorized Company',
            contact_person: 'Jane Doe',
            email: 'jane@unauthorizedcompany.com',
            phone: '9876543210',
            address: '456 Unauth St, Unauth City, UN 67890'
          });
        expect(res.statusCode).toEqual(403);
      });
    });
  });

  describe('Employee Routes', () => {
    const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer<</Root 1 0 R>>');

    // This helper creates a valid employee request
    const createEmployeeRequest = (token) => {
      const uniqueEmail = `john.doe.${Date.now()}@test.com`;
      return request(app)  // Use supertest's request directly
        .post('/api/employees')
        .set('Authorization', `Bearer ${token}`)
        .field('first_name', 'John')
        .field('last_name', 'Doe')
        .field('date_of_birth', '1990-01-01')
        .field('full_address', '123 Test St')
        .field('email', uniqueEmail)
        .field('phone_number', '+11234567890')
        .field('sin', '123456789')
        .field('start_date', '2024-01-01')
        .field('position', 'Developer')
        .field('pay_type', 'SALARY')
        .field('pay_rate', '75000')
        .field('pay_schedule', 'BIWEEKLY')
        .field('institution_number', '002')
        .field('transit_number', '12345')
        .field('account_number', '1234567')
        .field('consent_electronic_documents', 'true')
        .attach('td1_federal', Buffer.from('%PDF-1.4\nFederal'), {
          filename: 'federal.pdf',
          contentType: 'application/pdf'
        })
        .attach('td1_provincial', Buffer.from('%PDF-1.4\nProvincial'), {
          filename: 'provincial.pdf',
          contentType: 'application/pdf'
        });
    };
  
    describe('Accountant', () => {
      describe('Get Employees', () => {
        it('should get all employees for a company with pagination', async () => {
          const res = await request(app)
            .get(`/api/employees/company/${companyId}`)
            .query({ page: 1, limit: 10 })
            .set('Authorization', `Bearer ${accountantToken}`);
  
          expect(res.statusCode).toBe(200);
          expect(res.body).toHaveProperty('employees');
          expect(res.body).toHaveProperty('currentPage', 1);
          expect(res.body).toHaveProperty('totalPages');
          expect(res.body).toHaveProperty('totalEmployees');
          expect(Array.isArray(res.body.employees)).toBeTruthy();
        });
  
        it('should search employees by name or email', async () => {
          const res = await request(app)
            .get(`/api/employees/company/${companyId}`)
            .query({ search: 'Doe' })
            .set('Authorization', `Bearer ${accountantToken}`);
  
          expect(res.statusCode).toBe(200);
          expect(res.body.employees.some(emp => 
            emp.first_name.includes('Doe') || 
            emp.last_name.includes('Doe') || 
            emp.email.includes('doe')
          )).toBeTruthy();
        });
  
        it('should get a single employee by ID', async () => {
          const res = await request(app)
            .get(`/api/employees/${employeeId}`)
            .set('Authorization', `Bearer ${accountantToken}`);
  
          expect(res.statusCode).toBe(200);
          expect(res.body).toHaveProperty('employee_id', employeeId);
        });
  
        it('should get employees from all managed companies', async () => {
          // First verify access to original company's employees
          const res1 = await request(app)
            .get(`/api/employees/company/${companyId}`)
            .set('Authorization', `Bearer ${accountantToken}`);
        
          expect(res1.statusCode).toBe(200);
          expect(Array.isArray(res1.body.employees)).toBeTruthy();
          
          // Create a new user for the second company
          const newUserResult = await db.query(
            'INSERT INTO users (email, password, user_type, is_verified) VALUES ($1, $2, $3, $4) RETURNING user_id',
            [`client2_${Date.now()}@test.com`, await bcrypt.hash('Password123!', 10), 'client', true]
          );
        
          // Create another company that this accountant manages
          const newCompanyResult = await db.query(
            'INSERT INTO companies (user_id, company_name, accountant_id) VALUES ($1, $2, $3) RETURNING company_id',
            [newUserResult.rows[0].user_id, 'Second Test Company', accountantId]
          );
          
          // Verify access to new company's employees
          const res2 = await request(app)
            .get(`/api/employees/company/${newCompanyResult.rows[0].company_id}`)
            .set('Authorization', `Bearer ${accountantToken}`);
        
          expect(res2.statusCode).toBe(200);
          expect(Array.isArray(res2.body.employees)).toBeTruthy();
        });
      });
  
      describe('Employee Creation', () => {
        it('should be able to create a new employee with documents', async () => {
          const res = await request(app)
            .post('/api/employees')
            .set('Authorization', `Bearer ${accountantToken}`)
            .field('company_id', companyId)
            .field('first_name', 'Test')
            .field('last_name', 'Employee')
            .field('date_of_birth', '1990-01-01')
            .field('full_address', '789 Employee St, Emp City, EC 13579')
            .field('email', 'employee@test.com')
            .field('phone_number', '+15555555555')
            .field('sin', '123456789')
            .field('start_date', '2023-01-01')
            .field('position', 'Tester')
            .field('pay_type', 'SALARY')
            .field('pay_rate', '50000')
            .field('pay_schedule', 'BIWEEKLY')
            .field('institution_number', '002')
            .field('transit_number', '12345')
            .field('account_number', '1234567')
            .field('consent_electronic_documents', 'true')
            .attach('td1_federal', pdfBuffer, {
              filename: 'federal.pdf',
              contentType: 'application/pdf'
            })
            .attach('td1_provincial', pdfBuffer, {
              filename: 'provincial.pdf',
              contentType: 'application/pdf'
            });
    
          expect(res.statusCode).toBe(201);
          expect(res.body).toHaveProperty('employee_id');
          expect(res.body).toHaveProperty('documents');
          expect(res.body.documents).toHaveLength(2);
          expect(res.body.documents.some(doc => doc.document_type === 'TD1_FEDERAL')).toBeTruthy();
          expect(res.body.documents.some(doc => doc.document_type === 'TD1_PROVINCIAL')).toBeTruthy();
        });
  
      describe('Employee Updates', () => {
        it('should update employee information', async () => {
          const res = await request(app)
            .put(`/api/employees/${employeeId}`)
            .set('Authorization', `Bearer ${accountantToken}`)
            .send({
              position: 'Senior Developer',
              pay_rate: '85000',
              email: 'updated.email@test.com'
            });
        
          expect(res.statusCode).toBe(200);
          expect(res.body.position).toBe('Senior Developer');
          expect(res.body.pay_rate).toBe('85000.00');
          
          // Verify the update with a separate GET request
          const verifyRes = await request(app)
            .get(`/api/employees/${employeeId}`)
            .set('Authorization', `Bearer ${accountantToken}`);
          expect(verifyRes.body.email).toBe('updated.email@test.com');
        });
      });
    });
  });
  
    describe('Client', () => {
      describe('Get Employees', () => {
        it('should get all employees for their company', async () => {
          const res = await request(app)
            .get(`/api/employees/company/${companyId}`)
            .set('Authorization', `Bearer ${clientToken}`);
  
          expect(res.statusCode).toBe(200);
          expect(Array.isArray(res.body.employees)).toBeTruthy();
        });
  
        it('should get a single employee from their company', async () => {
          const res = await request(app)
            .get(`/api/employees/${employeeId}`)
            .set('Authorization', `Bearer ${clientToken}`);
  
          expect(res.statusCode).toBe(200);
          expect(res.body).toHaveProperty('employee_id', employeeId);
        });
      });
  
      describe('Employee Creation', () => {
        it('should be able to create a new employee with documents', async () => {
          const res = await request(app)
            .post('/api/employees')
            .set('Authorization', `Bearer ${clientToken}`)
            .field('first_name', 'New')
            .field('last_name', 'Employee')
            .field('date_of_birth', '1990-01-01')
            .field('full_address', '789 New St, New City, NC 13579')
            .field('email', 'new@test.com')
            .field('phone_number', '+15555555555')
            .field('sin', '123456789')
            .field('start_date', '2023-01-01')
            .field('position', 'New Position')
            .field('pay_type', 'SALARY')
            .field('pay_rate', '55000')
            .field('pay_schedule', 'BIWEEKLY')
            .field('institution_number', '003')
            .field('transit_number', '54321')
            .field('account_number', '7654321')
            .field('consent_electronic_documents', 'true')
            .attach('td1_federal', pdfBuffer, {
              filename: 'federal.pdf',
              contentType: 'application/pdf'
            })
            .attach('td1_provincial', pdfBuffer, {
              filename: 'provincial.pdf',
              contentType: 'application/pdf'
            });
    
          expect(res.statusCode).toBe(201);
          expect(res.body).toHaveProperty('employee_id');
          expect(res.body).toHaveProperty('documents');
          expect(res.body.documents).toHaveLength(2);
        });
      });
  
      describe('Employee Updates', () => {
        it('should update their employee', async () => {
          const res = await request(app)
            .put(`/api/employees/${employeeId}`)
            .set('Authorization', `Bearer ${clientToken}`)
            .send({
              position: 'Updated Position',
              pay_rate: '70000'
            });
  
          expect(res.statusCode).toBe(200);
          expect(res.body.position).toBe('Updated Position');
          expect(res.body.pay_rate).toBe('70000.00');
        });
      });
    });
  
    describe('Validation and Error Handling', () => {
      describe('Employee Creation Validation', () => {
        it('should validate required fields', async () => {
          const res = await request(app)
            .post('/api/employees')
            .set('Authorization', `Bearer ${accountantToken}`)
            .field('company_id', companyId)
            .attach('td1_federal', pdfBuffer, {
              filename: 'federal.pdf',
              contentType: 'application/pdf'
            })
            .attach('td1_provincial', pdfBuffer, {
              filename: 'provincial.pdf',
              contentType: 'application/pdf'
            });
      
          expect(res.statusCode).toBe(400);
          expect(res.body).toHaveProperty('errors');
          expect(res.body.errors).toContainEqual(
            expect.objectContaining({
              path: 'first_name',
              msg: 'Invalid value'
            })
          );
        });
  
        it('should validate email format', async () => {
          const res = await request(app)
          .post('/api/employees')
          .set('Authorization', `Bearer ${clientToken}`)
          .field('first_name', 'New')
          .field('last_name', 'Employee')
          .field('date_of_birth', '1990-01-01')
          .field('full_address', '789 New St, New City, NC 13579')
          .field('email', 'invalid-email')
          .field('phone_number', '+15555555555')
          .field('sin', '123456789')
          .field('start_date', '2023-01-01')
          .field('position', 'New Position')
          .field('pay_type', 'SALARY')
          .field('pay_rate', '55000')
          .field('pay_schedule', 'BIWEEKLY')
          .field('institution_number', '003')
          .field('transit_number', '54321')
          .field('account_number', '7654321')
          .field('consent_electronic_documents', 'true')
          .attach('td1_federal', pdfBuffer, {
            filename: 'federal.pdf',
            contentType: 'application/pdf'
          })
          .attach('td1_provincial', pdfBuffer, {
            filename: 'provincial.pdf',
            contentType: 'application/pdf'
          });
          expect(res.statusCode).toBe(400);
          expect(res.body.errors).toContainEqual(
            expect.objectContaining({
              path: 'email',
              msg: 'Invalid value'
            })
          );
        });
  
        it('should validate banking information format', async () => {
          const res = await request(app)
            .post('/api/employees')
            .set('Authorization', `Bearer ${accountantToken}`)
            .field('first_name', 'Test')
            .field('last_name', 'Employee')
            .field('date_of_birth', '1990-01-01')
            .field('full_address', '123 Test St')
            .field('email', `test.${Date.now()}@test.com`)
            .field('phone_number', '+11234567890')
            .field('sin', '123456789')
            .field('start_date', '2024-01-01')
            .field('position', 'Developer')
            .field('pay_type', 'SALARY')
            .field('pay_rate', '75000')
            .field('pay_schedule', 'BIWEEKLY')
            .field('institution_number', '1')    // Invalid
            .field('transit_number', '123')      // Invalid
            .field('account_number', '123')      // Invalid
            .field('consent_electronic_documents', 'true')
            .attach('td1_federal', Buffer.from('%PDF-1.4\nFederal'), {
              filename: 'federal.pdf',
              contentType: 'application/pdf'
            })
            .attach('td1_provincial', Buffer.from('%PDF-1.4\nProvincial'), {
              filename: 'provincial.pdf',
              contentType: 'application/pdf'
            });
        
          expect(res.statusCode).toBe(400);
          // Match the exact error format your route returns
          expect(res.body.errors).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                type: 'field',
                path: 'institution_number',
                value: '1'
              }),
              expect.objectContaining({
                type: 'field',
                path: 'transit_number',
                value: '123'
              }),
              expect.objectContaining({
                type: 'field',
                path: 'account_number',
                value: '123'
              })
            ])
          );
        });
      });
  
      describe('Employee Update Validation', () => {
        it('should validate update fields', async () => {
          const res = await request(app)
            .put(`/api/employees/${employeeId}`)
            .set('Authorization', `Bearer ${accountantToken}`)
            .send({
              email: 'invalid-email',
              pay_rate: -1000,
              pay_type: 'INVALID_TYPE'
            });
  
          expect(res.statusCode).toBe(400);
          expect(res.body.errors).toBeDefined();
        });
      });
  
      describe('Offboarding', () => {
        it('should validate offboarding reason', async () => {
          const res = await request(app)
            .post(`/api/employees/${employeeId}/offboard`)
            .set('Authorization', `Bearer ${accountantToken}`)
            .send({
              reason_for_leaving: 'INVALID_REASON',
              last_day_worked: '2024-03-31',
              payout_accrued_vacation: true
            });
  
          expect(res.statusCode).toBe(400);
          expect(res.body.errors).toContainEqual(
            expect.objectContaining({
              path: 'reason_for_leaving',
            msg: 'Invalid value'
          })
        );
      });

      it('should validate last day worked date', async () => {
        const res = await request(app)
          .post(`/api/employees/${employeeId}/offboard`)
          .set('Authorization', `Bearer ${accountantToken}`)
          .send({
            reason_for_leaving: 'QUIT',
            last_day_worked: 'not-a-date',
            payout_accrued_vacation: true
          });

        expect(res.statusCode).toBe(400);
        expect(res.body.errors).toContainEqual(
          expect.objectContaining({
            path: 'last_day_worked',
            msg: 'Invalid value'
          })
        );
      });

      it('should create a complete offboarding record', async () => {
        const lastDayWorked = '2024-03-31';
        const callbackDate = '2024-06-30';
        
        const res = await request(app)
          .post(`/api/employees/${employeeId}/offboard`)
          .set('Authorization', `Bearer ${accountantToken}`)
          .send({
            reason_for_leaving: 'QUIT',
            last_day_worked: lastDayWorked,
            payout_accrued_vacation: true,
            callback_date: callbackDate
          });

        expect(res.statusCode).toBe(200);

        // Verify the offboarding record in database
        const offboardingRecord = await db.query(
          'SELECT * FROM employee_offboarding WHERE employee_id = $1',
          [employeeId]
        );

        expect(offboardingRecord.rows).toHaveLength(1);
        expect(offboardingRecord.rows[0]).toMatchObject({
          employee_id: employeeId,
          reason_for_leaving: 'QUIT',
          payout_accrued_vacation: true
        });
        
        // Check dates are properly stored
        expect(offboardingRecord.rows[0].last_day_worked.toISOString().split('T')[0])
          .toBe(lastDayWorked);
        expect(offboardingRecord.rows[0].callback_date.toISOString().split('T')[0])
          .toBe(callbackDate);

        // Verify employee is marked as inactive
        const employeeRecord = await db.query(
          'SELECT is_active FROM employees WHERE employee_id = $1',
          [employeeId]
        );
        expect(employeeRecord.rows[0].is_active).toBe(false);
      });
    });
  });
});

  describe('Payroll Routes', () => {
    describe('Accountant', () => {
      it('should be able to create a new payroll entry', async () => {
        const res = await request(app)
          .post('/api/payroll')
          .set('Authorization', `Bearer ${accountantToken}`)
          .send({
            employee_id: employeeId,
            pay_period_start: '2023-01-16',
            pay_period_end: '2023-01-31',
            hours_worked: 80,
            overtime_hours: 5,
            gross_pay: 2500,
            deductions: 500,
            net_pay: 2000,
            payment_date: '2023-02-05'
          });
        expect(res.statusCode).toEqual(201);
        expect(res.body).toHaveProperty('payroll_id');
      });

      it('should be able to get all payroll entries for a company', async () => {
        const res = await request(app)
          .get(`/api/payroll/company/${companyId}`)
          .set('Authorization', `Bearer ${accountantToken}`);
        expect(res.statusCode).toEqual(200);
        expect(Array.isArray(res.body.payrollEntries)).toBeTruthy();
      });

      it('should be able to get a single payroll entry', async () => {
        const res = await request(app)
          .get(`/api/payroll/${payrollId}`)
          .set('Authorization', `Bearer ${accountantToken}`);
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('payroll_id');
      });

      it('should be able to update a payroll entry', async () => {
        const res = await request(app)
          .put(`/api/payroll/${payrollId}`)
          .set('Authorization', `Bearer ${accountantToken}`)
          .send({
            gross_pay: 2600,
            net_pay: 2100
          });
        expect(res.statusCode).toEqual(200);
        expect(res.body.gross_pay).toEqual('2600.00');
        expect(res.body.net_pay).toEqual('2100.00');
      });

      it('should be able to calculate total payroll for a company', async () => {
        const res = await request(app)
          .get(`/api/payroll/total/${companyId}`)
          .set('Authorization', `Bearer ${accountantToken}`)
          .query({ startDate: '2023-01-01', endDate: '2023-01-31' });
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('total_gross');
        expect(res.body).toHaveProperty('total_net');
      });
    });

    describe('Client', () => {
      it('should be able to create a payroll entry', async () => {
        const res = await request(app)
          .post('/api/payroll')
          .set('Authorization', `Bearer ${clientToken}`)
          .send({
            employee_id: employeeId,
            pay_period_start: '2023-02-01',
            pay_period_end: '2023-02-15',
            hours_worked: 80,
            overtime_hours: 0,
            gross_pay: 2000,
            deductions: 400,
            net_pay: 1600,
            payment_date: '2023-02-20'
          });
        expect(res.statusCode).toEqual(201);
        expect(res.body).toHaveProperty('payroll_id');
      });

      it('should be able to view payroll entries for their company', async () => {
        const res = await request(app)
          .get(`/api/payroll/company/${companyId}`)
          .set('Authorization', `Bearer ${clientToken}`);
        expect(res.statusCode).toEqual(200);
        expect(Array.isArray(res.body.payrollEntries)).toBeTruthy();
      });

      it('should be able to update a recent payroll entry', async () => {
        const res = await request(app)
          .put(`/api/payroll/${payrollId}`)
          .set('Authorization', `Bearer ${clientToken}`)
          .send({
            gross_pay: 2100,
            net_pay: 1700
          });
        expect(res.statusCode).toEqual(200);
        expect(res.body.gross_pay).toEqual('2100.00');
        expect(res.body.net_pay).toEqual('1700.00');
      });

      it('should not be able to update an old payroll entry', async () => {
        // Create an old payroll entry (more than 30 days ago)
        const oldPayrollResult = await db.query(
          `INSERT INTO payroll_entries (
            employee_id, pay_period_start, pay_period_end, hours_worked, gross_pay, deductions, net_pay, payment_date, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING payroll_id`,
          [employeeId, '2022-01-01', '2022-01-15', 80, 2000, 400, 1600, '2022-01-20', '2022-01-20']
        );
        const oldPayrollId = oldPayrollResult.rows[0].payroll_id;

        const res = await request(app)
          .put(`/api/payroll/${oldPayrollId}`)
          .set('Authorization', `Bearer ${clientToken}`)
          .send({
            gross_pay: 2200,
            net_pay: 1800
          });
        expect(res.statusCode).toEqual(403);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent routes', async () => {
      const res = await request(app).get('/api/non-existent-route');
      expect(res.statusCode).toEqual(404);
    });

    it('should handle server errors', async () => {
      // Mock a database error
      jest.spyOn(db, 'query').mockRejectedValueOnce(new Error('Database error'));

      const res = await request(app)
        .get('/api/companies')
        .set('Authorization', `Bearer ${accountantToken}`);
      expect(res.statusCode).toEqual(500);
      expect(res.body).toHaveProperty('error');

      // Restore the original implementation
      jest.spyOn(db, 'query').mockRestore();
    });
  });

  describe('Data Validation', () => {
    it('should reject invalid data when creating an employee', async () => {
      const res = await request(app)
        .post('/api/employees')
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({
          company_id: companyId,
          first_name: '',  // Empty first name
          last_name: 'ValidLastName',
          date_of_birth: 'invalid-date',  // Invalid date
          full_address: '123 Valid St',
          email: 'invalidemail',  // Invalid email
          phone_number: '123',  // Invalid phone number
          sin: '12345',  // Invalid SIN (should be 9 digits)
          start_date: '2023-01-01',
          position: 'Tester',
          pay_type: 'INVALID',  // Invalid pay type
          pay_rate: -1000,  // Invalid pay rate
          pay_schedule: 'WEEKLY',
          consent_electronic_documents: 'yes'  // Should be boolean
        });
      expect(res.statusCode).toEqual(400);
      expect(res.body).toHaveProperty('errors');
      expect(res.body.errors.length).toBeGreaterThan(0);
    });
  });

});