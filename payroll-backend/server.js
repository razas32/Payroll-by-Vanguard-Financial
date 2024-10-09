// server.js
const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();

// Import routes
const companiesRouter = require('./routes/companies');
const employeesRouter = require('./routes/employees');
const payrollRouter = require('./routes/payroll');

// Middleware
app.use(cors());
app.use(express.json());

// Basic Route
app.get('/', (req, res) => {
    res.send('Welcome to the Payroll Management API');
});

// Use routes
app.use('/api/companies', companiesRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/payroll', payrollRouter);

// Server Listening
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});