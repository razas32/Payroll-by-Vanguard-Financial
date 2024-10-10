const request = require('supertest');
const express = require('express');
const authRoutes = require('../routes/auth');
const db = require('../db');

// Mock the email sending function
jest.mock('../utils/emailSender', () => ({
  sendEmail: jest.fn().mockResolvedValue(true),
}));

// Create a test app
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);

beforeAll(async () => {
  // Set up test database or mock database calls
  // This depends on how you've set up your db.js file
});

afterAll(async () => {
  // Clean up test database
  await db.end();
});

describe('Auth Routes', () => {
  it('should register a new user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'test@example.com',
        password: 'Password123!',
        userType: 'client'
      });
    expect(res.statusCode).toEqual(201);
    expect(res.body).toHaveProperty('message');
  });

  it('should login a user', async () => {
    // First, we need to create a verified user
    await db.query(
      'INSERT INTO users (email, password, user_type, is_verified) VALUES ($1, $2, $3, $4)',
      ['login@example.com', await bcrypt.hash('Password123!', 10), 'client', true]
    );

    const res = await request(app)
      .post('/api/auth/login')
      .send({
        email: 'login@example.com',
        password: 'Password123!'
      });
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('token');
  });

  // Add more tests for other routes
});