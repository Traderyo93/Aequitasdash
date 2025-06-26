// api/auth.js - Production Authentication with bcrypt (ES6 syntax)
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

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ success: false, error: 'Email and password required' });
    return;
  }

  // Database connection
  const client = new Client({
    connectionString: process.env.POSTGRES_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    
    // Get user from database
    const result = await client.query(
      'SELECT user_id, email, password_hash, role FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const user = result.rows[0];
    
    // Verify password with bcrypt
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    
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
      details: error.message 
    });
  } finally {
    await client.end();
  }
}
