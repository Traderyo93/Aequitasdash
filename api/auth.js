// api/auth.js - Fixed to match your actual database schema
import { neon } from '@neondatabase/serverless';
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

  // Debug endpoint
  if (req.method === 'GET') {
    try {
      const sql = neon(process.env.POSTGRES_URL);
      
      const usersTest = await sql`SELECT COUNT(*) as count FROM users`;
      const allUsers = await sql`SELECT id, email, role, account_value FROM users`;
      
      return res.status(200).json({
        success: true,
        message: "API and database working!",
        database: "Neon connected successfully!",
        users_count: usersTest[0].count,
        users_list: allUsers,
        connection: "neon_serverless",
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Database test failed:', error);
      return res.status(500).json({
        success: false,
        error: error.message
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

  if (!process.env.POSTGRES_URL) {
    res.status(500).json({ 
      success: false, 
      error: 'Database configuration missing' 
    });
    return;
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    
    // Query using your actual column names: id (not user_id)
    const result = await sql`
      SELECT id, email, password_hash, role, first_name, last_name, account_value, starting_balance
      FROM users 
      WHERE email = ${email}
    `;

    if (result.length === 0) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const user = result[0];
    
    // Verify password
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    
    if (!passwordValid) {
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    // Update last login
    await sql`
      UPDATE users 
      SET last_login = NOW() 
      WHERE id = ${user.id}
    `;

    // Create JWT token using 'id' not 'user_id'
    const token = jwt.sign(
      { 
        id: user.id,           // Changed from user_id to id
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
        id: user.id,                           // Changed from user_id to id
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        accountValue: user.account_value,      // Added from your schema
        startingBalance: user.starting_balance // Added from your schema
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Database connection failed',
      details: error.message
    });
  }
}
