const db = require('./db');

beforeAll(async () => {
  console.log('Setting up test database...');
  await db.createTestDatabase();
  await db.setupTestDatabase();
});

afterAll(async () => {
  console.log('Tearing down test database...');
  await db.teardownTestDatabase();
  await db.end();
});