-- Create custom types
CREATE TYPE pay_type_enum AS ENUM ('HOURLY', 'SALARY');
CREATE TYPE pay_schedule_enum AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');

-- Companies table
CREATE TABLE companies (
    company_id SERIAL PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Employees table
CREATE TABLE employees (
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
);

-- Employee offboarding information
CREATE TABLE employee_offboarding (
    offboarding_id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(employee_id) UNIQUE,
    reason_for_leaving TEXT,
    last_day_worked DATE NOT NULL,
    payout_accrued_vacation BOOLEAN NOT NULL,
    callback_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Payroll entries table
CREATE TABLE payroll_entries (
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
);

-- Vacation accrual table
CREATE TABLE vacation_accrual (
    accrual_id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(employee_id),
    accrual_date DATE NOT NULL,
    hours_accrued NUMERIC(8, 2) NOT NULL,
    hours_used NUMERIC(8, 2) DEFAULT 0,
    balance NUMERIC(8, 2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Support for employee benefits
CREATE TABLE benefits (
    benefit_id SERIAL PRIMARY KEY,
    benefit_name VARCHAR(100) NOT NULL,
    benefit_description TEXT
);

CREATE TABLE employee_benefits (
    employee_benefit_id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(employee_id),
    benefit_id INTEGER REFERENCES benefits(benefit_id),
    enrollment_date DATE NOT NULL,
    contribution_amount NUMERIC(10, 2),
    is_active BOOLEAN DEFAULT TRUE
);

-- Document management for important employee files
CREATE TABLE employee_documents (
    document_id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(employee_id),
    document_type VARCHAR(50) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    upload_date DATE NOT NULL,
    expiry_date DATE,
    document_path TEXT NOT NULL
);

-- Create indexes for faster queries
CREATE INDEX idx_employee_company ON employees(company_id);
CREATE INDEX idx_payroll_employee ON payroll_entries(employee_id);
CREATE INDEX idx_payroll_period ON payroll_entries(pay_period_start, pay_period_end);
CREATE INDEX idx_vacation_employee ON vacation_accrual(employee_id);
CREATE INDEX idx_employee_benefits ON employee_benefits(employee_id);
CREATE INDEX idx_employee_documents ON employee_documents(employee_id);

-- Optional Tables and Fields (still commented out for future use)

-- Better tax handling
/*
CREATE TABLE employee_tax_info (
    tax_info_id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(employee_id) UNIQUE,
    tax_filing_status VARCHAR(50),
    number_of_exemptions INTEGER,
    additional_withholding NUMERIC(10, 2) DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
*/

-- More detailed time tracking for hourly employees
/*
CREATE TABLE time_entries (
    time_entry_id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(employee_id),
    date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    break_duration INTERVAL,
    notes TEXT
);
*/

-- Improved organizational structure with departments
/*
CREATE TABLE departments (
    department_id SERIAL PRIMARY KEY,
    department_name VARCHAR(100) NOT NULL,
    manager_id INTEGER REFERENCES employees(employee_id)
);

-- Uncomment this line in the employees table when activating departments
-- ALTER TABLE employees ADD COLUMN department_id INTEGER REFERENCES departments(department_id);
*/