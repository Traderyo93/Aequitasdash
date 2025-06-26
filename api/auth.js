// api/auth.js - Simplified Working Version
import { sql } from '@vercel/postgres';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

// Simple JWT creation (without external library for now)
function createSimpleJWT(payload) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadBase64 = btoa(JSON.stringify(payload));
  const signature = btoa(`${header}.${payloadBase64}.${JWT_SECRET}`);
  return `${header}.${payloadBase64}.${signature}`;
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
  
  // Test endpoint for GET requests
  if (req.method === 'GET') {
    return res.status(200).json({
      success: false,
      error: 'Method not allowed. Use POST.',
      status: 'API is working!'
    });
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }
  
  try {
    const { action, email, password } = req.body;
    
    console.log(`Auth API called with action: ${action}`);
    
    if (action === 'login') {
      // Validate input
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email and password are required'
        });
      }
      
      console.log(`Login attempt for: ${email}`);
      
      // Test database connection
      try {
        const testQuery = await sql`SELECT NOW() as current_time`;
        console.log('Database connection successful:', testQuery.rows[0]);
      } catch (dbError) {
        console.error('Database connection failed:', dbError);
        return res.status(500).json({
          success: false,
          error: 'Database connection failed',
          details: dbError.message
        });
      }
      
      // Get user from database
      const userQuery = await sql`
        SELECT id, email, first_name, last_name, role, account_value, starting_balance
        FROM users 
        WHERE email = ${email.toLowerCase()} AND status = 'active'
      `;
      
      console.log(`Database query returned ${userQuery.rows.length} users`);
      
      if (userQuery.rows.length === 0) {
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password'
        });
      }
      
      const user = userQuery.rows[0];
      
      // Simple password verification for demo
      const validPassword = (password === 'admin123' && email === 'admin@aequitascap.com') ||
                           (password === 'client123' && email === 'client@aequitascap.com') ||
                           (password === 'demo123' && email === 'demo@aequitascap.com');
      
      if (!validPassword) {
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password'
        });
      }
      
      // Create simple JWT token
      const tokenPayload = {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
      };
      
      const authToken = createSimpleJWT(tokenPayload);
      
      // Update last login
      await sql`
        UPDATE users 
        SET last_login = NOW() 
        WHERE id = ${user.id}
      `;
      
      console.log('Login successful for:', email);
      
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
          startingBalance: parseFloat(user.starting_balance)
        },
        message: 'Login successful'
      });
    }
    
    // Handle other actions
    return res.status(400).json({
      success: false,
      error: 'Invalid action'
    });
    
  } catch (error) {
    console.error('Auth API Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
}
