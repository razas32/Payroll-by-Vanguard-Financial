const request = require('supertest');
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');

// Import your route files
const authRoutes = require('../routes/auth');
const companyRoutes = require('../routes/companies');
const employeeRoutes = require('../routes/employees');
const payrollRoutes = require('../routes/payroll');

// Mock the email sending function
jest.mock('../utils/emailSender', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
}));

// Create a test app
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/payroll', payrollRoutes);

jest.mock('../utils/auditLogger', () => ({
    logAudit: jest.fn(),
  }));

describe('API Routes', () => {
  let accountantToken, clientToken, companyId, employeeId, payrollId;

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
    const accountantId = accountantDetailResult.rows[0].accountant_id;
  
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
    await db.query(
      `INSERT INTO payroll_entries (
        employee_id, pay_period_start, pay_period_end, hours_worked, gross_pay, deductions, net_pay, payment_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [employeeId, '2023-01-01', '2023-01-15', 80, 2000, 400, 1600, '2023-01-20']
    );
  
    // Generate tokens
    accountantToken = jwt.sign(
        { 
          userId: accountantUserId, 
          userType: 'accountant',
          accountantId: accountantId  // Add this line
        },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );
    clientToken = jwt.sign(
      { userId: clientUserId, userType: 'client' },
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

    

    // Add more auth tests as needed
  });

  describe('Company Routes', () => {
    it('should get all companies for an accountant', async () => {
      const res = await request(app)
        .get('/api/companies')
        .set('Authorization', `Bearer ${accountantToken}`);
      expect(res.statusCode).toEqual(200);
      expect(Array.isArray(res.body.companies)).toBeTruthy();
    });

    it('should get a single company', async () => {
      const res = await request(app)
        .get(`/api/companies/${companyId}`)
        .set('Authorization', `Bearer ${accountantToken}`);
      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('company_id');
    });

    it('should create a new company', async () => {
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

    it('should update a company', async () => {
      const res = await request(app)
        .put(`/api/companies/${companyId}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({
          company_name: 'Updated Company Name'
        });
      expect(res.statusCode).toEqual(200);
      expect(res.body.company_name).toEqual('Updated Company Name');
    });
   

    // Add more company tests as needed
  });

  describe('Employee Routes', () => {
    it('should create a new employee', async () => {
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
      employeeId = res.body.employee_id;
    });

    it('should get all employees for a company', async () => {
        const res = await request(app)
          .get(`/api/employees/company/${companyId}`)
          .set('Authorization', `Bearer ${accountantToken}`);
        console.log('Get all employees response:', res.body);
        expect(res.statusCode).toEqual(200);
        expect(Array.isArray(res.body.employees)).toBeTruthy();
      });

    it('should get a single employee', async () => {
      const res = await request(app)
        .get(`/api/employees/${employeeId}`)
        .set('Authorization', `Bearer ${accountantToken}`);
      console.log('Test response:', res.body);  
      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('employee_id');
      expect(res.body.employee_id).toEqual(employeeId);
    });

    it('should update an employee', async () => {
      const res = await request(app)
        .put(`/api/employees/${employeeId}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({
          position: 'Senior Tester'
        });
      expect(res.statusCode).toEqual(200);
      expect(res.body.position).toEqual('Senior Tester');
    });

    // Add more employee tests as needed
  });

  describe('Payroll Routes', () => {
    it('should create a new payroll entry', async () => {
      const res = await request(app)
        .post('/api/payroll')
        .set('Authorization', `Bearer ${accountantToken}`)
        .send({
          employee_id: employeeId,
          pay_period_start: '2023-01-01',
          pay_period_end: '2023-01-15',
          hours_worked: 80,
          overtime_hours: 5,
          gross_pay: 2500,
          deductions: 500,
          net_pay: 2000,
          payment_date: '2023-01-20'
        });
      expect(res.statusCode).toEqual(201);
      expect(res.body).toHaveProperty('payroll_id');
      payrollId = res.body.payroll_id;
    });

    it('should get all payroll entries for a company', async () => {
      const res = await request(app)
        .get(`/api/payroll/company/${companyId}`)
        .set('Authorization', `Bearer ${accountantToken}`);
      expect(res.statusCode).toEqual(200);
      expect(Array.isArray(res.body.payrollEntries)).toBeTruthy();
    });

    it('should get a single payroll entry', async () => {
      const res = await request(app)
        .get(`/api/payroll/${payrollId}`)
        .set('Authorization', `Bearer ${accountantToken}`);
      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('payroll_id');
    });

    it('should update a payroll entry', async () => {
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

    it('should calculate total payroll for a company', async () => {
      const res = await request(app)
        .get(`/api/payroll/total/${companyId}`)
        .set('Authorization', `Bearer ${accountantToken}`)
        .query({ startDate: '2023-01-01', endDate: '2023-01-31' });
      expect(res.statusCode).toEqual(200);
      expect(res.body).toHaveProperty('total_gross');
      expect(res.body).toHaveProperty('total_net');
    });

    // Add more payroll tests as needed
  });

});