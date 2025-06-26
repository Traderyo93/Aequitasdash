// api/auth.js - Fixed Neon Database Version
import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // Health check
    if (req.method === 'GET') {
      let dbStatus = 'disconnected';
      try {
        await sql`SELECT 1`;
        dbStatus = 'connected';
      } catch (dbError) {
        dbStatus = 'error: ' + dbError.message;
      }
      
      return res.status(200).json({
        success: true,
        message: 'Auth API working',
        database: dbStatus,
        timestamp: new Date().toISOString()
      });
    }
    
    if (req.method === 'POST') {
      const { action, email, password } = req.body || {};
      
      if (action === 'login') {
        if (!email || !password) {
          return res.status(400).json({
            success: false,
            error: 'Email and password required'
          });
        }
        
        try {
          // Tables already exist in Neon, just query them
          
          // Check if user exists in database
          const userResult = await sql`
            SELECT * FROM users WHERE email = ${email}
          `;
          
          if (userResult.rows.length > 0) {
            const user = userResult.rows[0];
            
            // Simple password check (in production use bcrypt)
            if (user.password_hash === password) {
              return res.status(200).json({
                success: true,
                token: 'db_token_' + Date.now(),
                user: {
                  id: user.id,
                  email: user.email,
                  firstName: user.first_name,
                  lastName: user.last_name,
                  role: user.role,
                  accountValue: parseFloat(user.account_value),
                  startingBalance: parseFloat(user.starting_balance)
                },
                message: 'Database login successful'
              });
            }
          }
          
          // Users already exist in Neon database
          
          // Try login again after inserting users
          const retryResult = await sql`
            SELECT * FROM users WHERE email = ${email}
          `;
          
          if (retryResult.rows.length > 0) {
            const user = retryResult.rows[0];
            if (user.password_hash === password) {
              return res.status(200).json({
                success: true,
                token: 'db_token_' + Date.now(),
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
          }
          
        } catch (dbError) {
          console.log('Database error:', dbError);
          
          // Fallback to hardcoded credentials if database fails
          if (email === 'admin@aequitascap.com' && password === 'admin123') {
            return res.status(200).json({
              success: true,
              token: 'fallback_admin_' + Date.now(),
              user: {
                id: 'admin_fallback',
                email: 'admin@aequitascap.com',
                firstName: 'Admin',
                lastName: 'User',
                role: 'admin',
                accountValue: 2850000,
                startingBalance: 1000000
              },
              message: 'Fallback admin login'
            });
          }
          
          if (email === 'client@aequitascap.com' && password === 'client123') {
            return res.status(200).json({
              success: true,
              token: 'fallback_client_' + Date.now(),
              user: {
                id: 'client_fallback',
                email: 'client@aequitascap.com',
                firstName: 'John',
                lastName: 'Smith',
                role: 'client',
                accountValue: 1250000,
                startingBalance: 1000000
              },
              message: 'Fallback client login'
            });
          }
        }
        
        return res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
      }
      
      return res.status(400).json({
        success: false,
        error: 'Invalid action'
      });
    }
    
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
    
  } catch (error) {
    console.error('Auth error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Server error',
      details: error.message
    });
  }
}
