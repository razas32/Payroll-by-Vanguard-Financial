const request = require('supertest');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');

// Mock the email sending function
jest.mock('../utils/emailSender', () => ({
  sendEmail: jest.fn().mockResolvedValue(true)
}));

const { sendEmail: mockSendEmail } = require('../utils/emailSender');

// Import route files
const authRoutes = require('../routes/auth');
const companyRoutes = require('../routes/companies');
const employeeRoutes = require('../routes/employees');
const payrollRoutes = require('../routes/payroll');

// Mock the audit logger
jest.mock('../utils/auditLogger', () => ({
  logAudit: jest.fn(),
}));

// Create a test app
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/payroll', payrollRoutes);

describe('API Routes', () => {
  let accountantToken, clientToken, companyId, employeeId, payrollId, accountantId;

  beforeAll(async () => {
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
  
    // Create client user
    const clientResult = await db.query(
      'INSERT INTO users (email, password, user_type, is_verified) VALUES ($1, $2, $3, $4) RETURNING user_id',
      ['client@test.com', hashedPassword, 'client', true]
    );
    const clientUserId = clientResult.rows[0].user_id;
  
    // Create company and associate with accountant
    const companyResult = await db.query(
      'INSERT INTO companies (user_id, company_name, contact_person, phone, address, accountant_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING company_id',
      [clientUserId, 'Test Company', 'John Doe', '1234567890', '123 Test St, Test City, TS 12345', accountantId]
    );
    companyId = companyResult.rows[0].company_id;
  
    // Create an employee
    const employeeResult = await db.query(
      `INSERT INTO employees (
        company_id, last_name, first_name, date_of_birth, full_address, email, phone_number, sin,
        start_date, position, pay_type, pay_rate, pay_schedule, consent_electronic_documents
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING employee_id`,
      [
        companyId, 'Doe', 'Jane', '1990-01-01', '456 Emp St, Emp City, EC 67890', 'jane@testcompany.com',
        '9876543210', '987654321', '2023-01-01', 'Tester', 'SALARY', 50000, 'BIWEEKLY', true
      ]
    );
    employeeId = employeeResult.rows[0].employee_id;
  
    // Create a payroll entry
    const payrollResult = await db.query(
      `INSERT INTO payroll_entries (
        employee_id, pay_period_start, pay_period_end, hours_worked, gross_pay, deductions, net_pay, payment_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING payroll_id`,
      [employeeId, '2023-01-01', '2023-01-15', 80, 2000, 400, 1600, '2023-01-20']
    );
    payrollId = payrollResult.rows[0].payroll_id;
  
    // Generate tokens
    accountantToken = jwt.sign(
      { userId: accountantUserId, userType: 'accountant', accountantId: accountantId },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    clientToken = jwt.sign(
      { userId: clientUserId, userType: 'client', companyId: companyId },
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
  
    describe('Accountant', () => {
      it('should be able to create a new employee', async () => {
        const res = await request(app)
          .post('/api/employees')
          .set('Authorization', `Bearer ${accountantToken}`)
          .send({
            company_id: companyId,
            first_name: 'Test',
            last_name: 'Employee',
            date_of_birth: '1990-01-01',
            full_address: '789 Employee St, Emp City, EC 13579',
            email: 'employee@test.com',
            phone_number: '5555555555',
            sin: '123456789',
            start_date: '2023-01-01',
            position: 'Tester',
            pay_type: 'SALARY',
            pay_rate: 50000,
            pay_schedule: 'BIWEEKLY',
            consent_electronic_documents: true
          });
        expect(res.statusCode).toEqual(201);
        expect(res.body).toHaveProperty('employee_id');
      });

      it('should be able to get all employees for a company', async () => {
        const res = await request(app)
          .get(`/api/employees/company/${companyId}`)
          .set('Authorization', `Bearer ${accountantToken}`);
        expect(res.statusCode).toEqual(200);
        expect(Array.isArray(res.body.employees)).toBeTruthy();
      });

      it('should be able to get a single employee', async () => {
        const res = await request(app)
          .get(`/api/employees/${employeeId}`)
          .set('Authorization', `Bearer ${accountantToken}`);
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('employee_id');
        expect(res.body.employee_id).toEqual(employeeId);
      });

      it('should be able to update an employee', async () => {
        const res = await request(app)
          .put(`/api/employees/${employeeId}`)
          .set('Authorization', `Bearer ${accountantToken}`)
          .send({
            position: 'Senior Tester'
          });
        expect(res.statusCode).toEqual(200);
        expect(res.body.position).toEqual('Senior Tester');
      });
    });

    describe('Client', () => {
      it('should be able to get their own employees', async () => {
        const res = await request(app)
          .get(`/api/employees/company/${companyId}`)
          .set('Authorization', `Bearer ${clientToken}`);
        expect(res.statusCode).toEqual(200);
        expect(Array.isArray(res.body.employees)).toBeTruthy();
      });

      it('should be able to create a new employee', async () => {
        const res = await request(app)
          .post('/api/employees')
          .set('Authorization', `Bearer ${clientToken}`)
          .send({
            first_name: 'New',
            last_name: 'Employee',
            date_of_birth: '1990-01-01',
            full_address: '789 New St, New City, NC 13579',
            email: 'new@test.com',
            phone_number: '5555555555',
            sin: '123456789',
            start_date: '2023-01-01',
            position: 'New Position',
            pay_type: 'SALARY',
            pay_rate: 55000,
            pay_schedule: 'BIWEEKLY',
            consent_electronic_documents: true
          });
        expect(res.statusCode).toEqual(201);
        expect(res.body).toHaveProperty('employee_id');
      });

      it('should be able to update their employee', async () => {
        const res = await request(app)
          .put(`/api/employees/${employeeId}`)
          .set('Authorization', `Bearer ${clientToken}`)
          .send({
            position: 'Updated Position'
          });
        expect(res.statusCode).toEqual(200);
        expect(res.body.position).toEqual('Updated Position');
      });
    });

    describe('Offboarding', () => {
      let offboardEmployeeId;

      beforeEach(async () => {
        // Generate a unique email for each test run
        const uniqueEmail = `offboard_${Date.now()}_${Math.floor(Math.random() * 10000)}@test.com`;

        // Create a new employee for offboarding tests
        const newEmployeeResult = await db.query(
          `INSERT INTO employees (
            company_id, first_name, last_name, date_of_birth, full_address, email,
            phone_number, sin, start_date, position, pay_type, pay_rate, pay_schedule,
            consent_electronic_documents
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING employee_id`,
          [companyId, 'Test', 'Offboard', '1990-01-01', '123 Test St', uniqueEmail,
          '1234567890', '123456789', '2023-01-01', 'Tester', 'SALARY', 50000, 'BIWEEKLY', true]
        );
        offboardEmployeeId = newEmployeeResult.rows[0].employee_id;

        // The company is already associated with the accountant in the main setup
      });

      const offboardEmployee = (token, employeeId) => {
        return request(app)
          .post(`/api/employees/${employeeId}/offboard`)
          .set('Authorization', `Bearer ${token}`)
          .send({
            reason_for_leaving: 'QUIT',
            last_day_worked: '2023-06-30',
            payout_accrued_vacation: true,
            callback_date: '2024-01-01'
          });
      };
    
      it('accountant should be able to offboard an employee', async () => {
        const res = await offboardEmployee(accountantToken, offboardEmployeeId);
        expect(res.statusCode).toEqual(200);
        expect(res.body.message).toEqual('Employee offboarded successfully');
      });
    
      it('client should be able to offboard their employee', async () => {
        const res = await offboardEmployee(clientToken, offboardEmployeeId);
        expect(res.statusCode).toEqual(200);
        expect(res.body.message).toEqual('Employee offboarded successfully');
      });
    
      it('should not allow offboarding with invalid data', async () => {
        const res = await request(app)
          .post(`/api/employees/${offboardEmployeeId}/offboard`)
          .set('Authorization', `Bearer ${accountantToken}`)
          .send({
            reason_for_leaving: 'INVALID_REASON',
            last_day_worked: 'not-a-date',
            payout_accrued_vacation: 'not-a-boolean',
          });
        expect(res.statusCode).toEqual(400);
        expect(res.body).toHaveProperty('errors');
      });
    
      it('should not allow offboarding a non-existent employee', async () => {
        const res = await request(app)
          .post(`/api/employees/99999/offboard`)
          .set('Authorization', `Bearer ${accountantToken}`)
          .send({
            reason_for_leaving: 'QUIT',
            last_day_worked: '2023-06-30',
            payout_accrued_vacation: true,
          });
        expect(res.statusCode).toEqual(404);
      });
    
      it('should verify employee is inactive after offboarding', async () => {
        await offboardEmployee(accountantToken, offboardEmployeeId);
        const employeeRes = await request(app)
          .get(`/api/employees/${offboardEmployeeId}`)
          .set('Authorization', `Bearer ${accountantToken}`);
        expect(employeeRes.statusCode).toEqual(200);
        expect(employeeRes.body.is_active).toEqual(false);
      });
    
      it('should verify offboarding record is created', async () => {
        await offboardEmployee(accountantToken, offboardEmployeeId);
        const offboardingRes = await db.query('SELECT * FROM employee_offboarding WHERE employee_id = $1', [offboardEmployeeId]);
        expect(offboardingRes.rows.length).toEqual(1);
        expect(offboardingRes.rows[0].reason_for_leaving).toEqual('QUIT');
        expect(offboardingRes.rows[0].payout_accrued_vacation).toEqual(true);
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