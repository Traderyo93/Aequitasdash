// api/auth.js - Debug version with connection testing
import pg from 'pg';
const { Client } = pg;
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Add GET method for testing
  if (req.method === 'GET') {
    try {
      // Test database connection
      const client = new Client({
        connectionString: process.env.POSTGRES_URL,
        ssl: { rejectUnauthorized: false }
      });
      
      await client.connect();
      console.log('Database connected successfully');
      
      // Test query
      const result = await client.query('SELECT COUNT(*) FROM users');
      await client.end();
      
      return res.status(200).json({
        message: "API works",
        database: "connected successfully!",
        users_count: result.rows[0].count,
        connection: "direct_postgres",
        timestamp: new Date().toISOString(),
        postgres_url_exists: !!process.env.POSTGRES_URL
      });
    } catch (error) {
      console.error('Database connection failed:', error);
      return res.status(500).json({
        message: "API works but database failed",
        error: error.message,
        postgres_url_exists: !!process.env.POSTGRES_URL,
        timestamp: new Date().toISOString()
      });
    }
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ success: false, error: 'Email and password required' });
    return;
  }

  // Check if environment variables exist
  if (!process.env.POSTGRES_URL) {
    res.status(500).json({ 
      success: false, 
      error: 'Database configuration missing',
      details: 'POSTGRES_URL not found' 
    });
    return;
  }

  // Database connection
  const client = new Client({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('Attempting database connection...');
    await client.connect();
    console.log('Database connected for login attempt');
    
    // Get user from database
    const result = await client.query(
      'SELECT user_id, email, password_hash, role FROM users WHERE email = $1',
      [email]
    );

    console.log(`Query result: ${result.rows.length} rows found for ${email}`);

    if (result.rows.length === 0) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const user = result.rows[0];
    console.log(`User found: ${user.email}, role: ${user.role}`);
    
    // Verify password with bcrypt
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    console.log(`Password valid: ${passwordValid}`);
    
    if (!passwordValid) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    // Success - create JWT token and return user data
    const token = jwt.sign(
      { 
        user_id: user.user_id,
        email: user.email,
        role: user.role 
      },
      process.env.JWT_SECRET || 'aequitas-secret-key-2025',
      { expiresIn: '24h' }
    );

    console.log('Login successful, returning token');

    res.status(200).json({
      success: true,
      token: token,
      user: {
        user_id: user.user_id,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Database connection failed',
      details: error.message,
      postgres_url_exists: !!process.env.POSTGRES_URL
    });
  } finally {
    try {
      await client.end();
    } catch (e) {
      console.error('Error closing database connection:', e);
    }
  }
}
