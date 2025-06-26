// api/auth.js - Debug version with extensive logging
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
  console.log('🚀 AUTH API CALLED');
  console.log('Method:', req.method);
  console.log('Headers:', req.headers);
  console.log('Body:', req.body);
  
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    console.log('✅ OPTIONS request handled');
    res.status(200).end();
    return;
  }

  // Debug endpoint
  if (req.method === 'GET') {
    try {
      console.log('🔍 Testing database connection...');
      console.log('POSTGRES_URL exists:', !!process.env.POSTGRES_URL);
      console.log('POSTGRES_URL format:', process.env.POSTGRES_URL ? 'Valid' : 'Missing');
      
      if (!process.env.POSTGRES_URL) {
        throw new Error('POSTGRES_URL environment variable not found');
      }
      
      const sql = neon(process.env.POSTGRES_URL);
      console.log('📡 Neon client created');
      
      // Test basic connection
      const testResult = await sql`SELECT 1 as test`;
      console.log('🔗 Basic connection test:', testResult);
      
      // Check users table
      const usersTest = await sql`SELECT COUNT(*) as count FROM users`;
      console.log('👥 Users table test:', usersTest);
      
      // List all users (for debugging)
      const allUsers = await sql`SELECT email, role FROM users`;
      console.log('📋 All users:', allUsers);
      
      return res.status(200).json({
        success: true,
        message: "API and database working!",
        database: "Neon connected successfully!",
        users_count: usersTest[0].count,
        users_list: allUsers,
        connection: "neon_serverless",
        timestamp: new Date().toISOString(),
        environment: {
          postgres_url_exists: !!process.env.POSTGRES_URL,
          jwt_secret_exists: !!process.env.JWT_SECRET,
          node_env: process.env.NODE_ENV
        }
      });
    } catch (error) {
      console.error('💥 Database test failed:', error);
      return res.status(500).json({
        success: false,
        message: "Database connection failed",
        error: error.message,
        stack: error.stack,
        environment: {
          postgres_url_exists: !!process.env.POSTGRES_URL,
          jwt_secret_exists: !!process.env.JWT_SECRET
        }
      });
    }
  }

  if (req.method !== 'POST') {
    console.log('❌ Invalid method:', req.method);
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const { email, password } = req.body;
  console.log('📧 Login attempt for email:', email);
  console.log('🔑 Password provided:', !!password);

  if (!email || !password) {
    console.log('❌ Missing email or password');
    res.status(400).json({ success: false, error: 'Email and password required' });
    return;
  }

  if (!process.env.POSTGRES_URL) {
    console.log('❌ POSTGRES_URL missing');
    res.status(500).json({ 
      success: false, 
      error: 'Database configuration missing',
      details: 'POSTGRES_URL not found' 
    });
    return;
  }

  try {
    console.log('🔗 Initializing Neon connection...');
    const sql = neon(process.env.POSTGRES_URL);
    
    console.log('🔍 Querying for user:', email);
    const result = await sql`
      SELECT user_id, email, password_hash, role, first_name, last_name
      FROM users 
      WHERE email = ${email}
    `;

    console.log('📊 Query result count:', result.length);
    
    if (result.length === 0) {
      console.log('❌ User not found:', email);
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const user = result[0];
    console.log('👤 User found:', {
      email: user.email,
      role: user.role,
      has_password_hash: !!user.password_hash
    });
    
    console.log('🔐 Comparing passwords...');
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    console.log('✅ Password valid:', passwordValid);
    
    if (!passwordValid) {
      console.log('❌ Invalid password for:', email);
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    console.log('🎟️ Creating JWT token...');
    const token = jwt.sign(
      { 
        user_id: user.user_id,
        email: user.email,
        role: user.role 
      },
      process.env.JWT_SECRET || 'aequitas-secret-key-2025',
      { expiresIn: '24h' }
    );

    console.log('🎉 Login successful for:', email);

    res.status(200).json({
      success: true,
      token: token,
      user: {
        user_id: user.user_id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name
      }
    });

  } catch (error) {
    console.error('💥 Login process error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      success: false, 
      error: 'Database connection failed',
      details: error.message,
      stack: error.stack
    });
  }
}
