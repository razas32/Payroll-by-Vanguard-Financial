const { Pool } = require('pg');
require('dotenv').config();

const createDatabase = async () => {
  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    database: 'postgres'
  });

  try {
    await pool.query(`CREATE DATABASE payroll_db`);
    console.log('Database created successfully');
  } catch (err) {
    if (err.code === '42P04') {
      console.log('Database already exists, continuing with setup');
    } else {
      throw err;
    }
  } finally {
    await pool.end();
  }
};

const setupDatabase = async () => {
  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
    database: 'payroll_db'
  });

  try {
    await createDatabase();

    // Create custom types
    await pool.query(`
      DO $$ BEGIN
        CREATE TYPE pay_type_enum AS ENUM ('HOURLY', 'SALARY');
        CREATE TYPE pay_schedule_enum AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        user_type VARCHAR(20) NOT NULL CHECK (user_type IN ('accountant', 'client')),
        is_verified BOOLEAN DEFAULT FALSE,
        verification_token VARCHAR(255),
        reset_token VARCHAR(255),
        reset_token_expiry TIMESTAMP,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create accountants table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS accountants (
        accountant_id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(user_id),
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create companies table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
        company_id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE REFERENCES users(user_id),
        company_name VARCHAR(255) NOT NULL,
        contact_person VARCHAR(255),
        phone VARCHAR(20),
        address TEXT,
        accountant_id INTEGER REFERENCES accountants(accountant_id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create employees table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employees (
        employee_id SERIAL PRIMARY KEY,
        company_id INTEGER REFERENCES companies(company_id),
        last_name VARCHAR(100) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        date_of_birth DATE NOT NULL,
        full_address TEXT NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        sin VARCHAR(9) NOT NULL,
        start_date DATE NOT NULL,
        position VARCHAR(100) NOT NULL,
        pay_type pay_type_enum NOT NULL,
        pay_rate NUMERIC(10, 2) NOT NULL,
        pay_schedule pay_schedule_enum NOT NULL,
        institution_number VARCHAR(3),
        transit_number VARCHAR(5),
        account_number VARCHAR(12),
        consent_electronic_documents BOOLEAN NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create employee_offboarding table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employee_offboarding (
        offboarding_id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(employee_id) UNIQUE,
        reason_for_leaving TEXT,
        last_day_worked DATE NOT NULL,
        payout_accrued_vacation BOOLEAN NOT NULL,
        callback_date DATE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create payroll_entries table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payroll_entries (
        payroll_id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(employee_id),
        pay_period_start DATE NOT NULL,
        pay_period_end DATE NOT NULL,
        hours_worked NUMERIC(8, 2),
        overtime_hours NUMERIC(8, 2) DEFAULT 0,
        gross_pay NUMERIC(10, 2) NOT NULL,
        deductions NUMERIC(10, 2) DEFAULT 0,
        net_pay NUMERIC(10, 2) NOT NULL,
        payment_date DATE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create vacation_accrual table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vacation_accrual (
        accrual_id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(employee_id),
        accrual_date DATE NOT NULL,
        hours_accrued NUMERIC(8, 2) NOT NULL,
        hours_used NUMERIC(8, 2) DEFAULT 0,
        balance NUMERIC(8, 2) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create benefits table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS benefits (
        benefit_id SERIAL PRIMARY KEY,
        benefit_name VARCHAR(100) NOT NULL,
        benefit_description TEXT
      )
    `);

    // Create employee_benefits table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employee_benefits (
        employee_benefit_id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(employee_id),
        benefit_id INTEGER REFERENCES benefits(benefit_id),
        enrollment_date DATE NOT NULL,
        contribution_amount NUMERIC(10, 2),
        is_active BOOLEAN DEFAULT TRUE
      )
    `);

    // Create employee_documents table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employee_documents (
        document_id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(employee_id),
        document_type VARCHAR(50) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        upload_date DATE NOT NULL,
        expiry_date DATE,
        document_path TEXT NOT NULL
      )
    `);

    // Create indexes
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_employee_company ON employees(company_id);
        CREATE INDEX IF NOT EXISTS idx_payroll_employee ON payroll_entries(employee_id);
        CREATE INDEX IF NOT EXISTS idx_payroll_period ON payroll_entries(pay_period_start, pay_period_end);
        CREATE INDEX IF NOT EXISTS idx_vacation_employee ON vacation_accrual(employee_id);
        CREATE INDEX IF NOT EXISTS idx_employee_benefits ON employee_benefits(employee_id);
        CREATE INDEX IF NOT EXISTS idx_employee_documents ON employee_documents(employee_id);
        CREATE INDEX IF NOT EXISTS idx_company_accountant ON companies(accountant_id);
      `);
  
      console.log('Database setup completed successfully');
    } catch (error) {
      console.error('Error setting up database:', error);
    } finally {
      await pool.end();
    }
  };
  
  setupDatabase();