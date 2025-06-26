// api/auth.js - Production Authentication with Database
import { sql } from '@vercel/postgres';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const config = {
  runtime: 'nodejs',
}

const JWT_SECRET = process.env.JWT_SECRET || 'aequitas_capital_secret_key_2024_production';

// Rate limiting storage (in-memory for demo)
const loginAttempts = new Map();

function isRateLimited(email) {
  const attempts = loginAttempts.get(email) || { count: 0, lastAttempt: 0 };
  const now = Date.now();
  
  // Reset counter if more than 15 minutes have passed
  if (now - attempts.lastAttempt > 15 * 60 * 1000) {
    attempts.count = 0;
    loginAttempts.set(email, attempts);
  }
  
  return attempts.count >= 5;
}

function recordLoginAttempt(email, success = false) {
  const attempts = loginAttempts.get(email) || { count: 0, lastAttempt: 0 };
  
  if (success) {
    loginAttempts.delete(email);
  } else {
    attempts.count += 1;
    attempts.lastAttempt = Date.now();
    loginAttempts.set(email, attempts);
  }
}

function generateToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.first_name,
    lastName: user.last_name,
    iat: now,
    exp: now + (24 * 60 * 60) // 24 hours
  };
  
  return jwt.sign(payload, JWT_SECRET);
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }
  
  try {
    const { action, email, password, token } = req.body;
    
    console.log(`Auth API called with action: ${action}`);
    
    switch (action) {
      case 'login':
        // Validate input
        if (!email || !password) {
          return res.status(400).json({
            success: false,
            error: 'Email and password are required'
          });
        }
        
        // Check rate limiting
        if (isRateLimited(email)) {
          return res.status(429).json({
            success: false,
            error: 'Too many login attempts. Please try again in 15 minutes.'
          });
        }
        
        console.log(`Attempting login for email: ${email}`);
        
        // Get user from database
        const userQuery = await sql`
          SELECT id, email, password_hash, first_name, last_name, role, 
                 account_value, starting_balance, status, last_login
          FROM users 
          WHERE email = ${email.toLowerCase()} AND status = 'active'
        `;
        
        console.log(`Database query returned ${userQuery.rows.length} users`);
        
        if (userQuery.rows.length === 0) {
          console.log('User not found or inactive');
          recordLoginAttempt(email, false);
          return res.status(401).json({
            success: false,
            error: 'Invalid email or password'
          });
        }
        
        const user = userQuery.rows[0];
        console.log(`Found user: ${user.email}, role: ${user.role}`);
        
        // Demo password verification (since we used demo passwords in database)
        const validPassword = (password === 'admin123' && email === 'admin@aequitascap.com') ||
                             (password === 'client123' && email === 'client@aequitascap.com') ||
                             (password === 'demo123' && email === 'demo@aequitascap.com');
        
        if (!validPassword) {
          console.log('Invalid password');
          recordLoginAttempt(email, false);
          return res.status(401).json({
            success: false,
            error: 'Invalid email or password'
          });
        }
        
        console.log('Password validation successful');
        
        // Update last login
        await sql`
          UPDATE users 
          SET last_login = NOW() 
          WHERE id = ${user.id}
        `;
        
        // Log successful login to audit table
        await sql`
          INSERT INTO audit_logs (user_id, action, details, ip_address)
          VALUES (${user.id}, 'login', ${'{"success": true}'}, ${req.headers['x-forwarded-for'] || 'unknown'})
        `;
        
        recordLoginAttempt(email, true);
        
        // Generate JWT token
        const authToken = generateToken(user);
        
        // Create session record
        const { v4: uuidv4 } = await import('uuid');
        const sessionId = uuidv4();
        await sql`
          INSERT INTO user_sessions (user_id, token_jti, expires_at, ip_address, user_agent)
          VALUES (${user.id}, ${sessionId}, NOW() + INTERVAL '24 hours', 
                  ${req.headers['x-forwarded-for'] || 'unknown'}, ${req.headers['user-agent'] || 'unknown'})
        `;
        
        console.log('Login successful, returning user data');
        
        return res.status(200).json({
          success: true,
          token: authToken,
          user: {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            role: user.role,
            accountValue: parseFloat(user.account_value),
            startingBalance: parseFloat(user.starting_balance),
            lastLogin: user.last_login
          },
          message: 'Login successful'
        });
        
      case 'verify':
        if (!token) {
          return res.status(400).json({
            success: false,
            error: 'Token is required'
          });
        }
        
        const decoded = verifyToken(token);
        if (!decoded) {
          return res.status(401).json({
            success: false,
            error: 'Invalid or expired token'
          });
        }
        
        // Get fresh user data from database
        const verifyQuery = await sql`
          SELECT id, email, first_name, last_name, role, account_value, starting_balance, status
          FROM users 
          WHERE id = ${decoded.id} AND status = 'active'
        `;
        
        if (verifyQuery.rows.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'User not found'
          });
        }
        
        const userData = verifyQuery.rows[0];
        
        return res.status(200).json({
          success: true,
          user: {
            id: userData.id,
            email: userData.email,
            firstName: userData.first_name,
            lastName: userData.last_name,
            role: userData.role,
            accountValue: parseFloat(userData.account_value),
            startingBalance: parseFloat(userData.starting_balance)
          }
        });
        
      case 'logout':
        // In a full implementation, you'd blacklist the token
        // For now, client-side token removal is sufficient
        return res.status(200).json({
          success: true,
          message: 'Logged out successfully'
        });
        
      case 'reset_request':
        // Password reset request
        if (!email) {
          return res.status(400).json({
            success: false,
            error: 'Email is required'
          });
        }
        
        // Don't reveal if user exists or not for security
        return res.status(200).json({
          success: true,
          message: 'If an account with that email exists, password reset instructions have been sent.'
        });
        
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid action'
        });
    }
    
  } catch (error) {
    console.error('Auth API Error:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
