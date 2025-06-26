// api/auth.js - Full Database Authentication
import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method === 'GET') {
    try {
      await sql`SELECT 1 as test`;
      res.status(200).json({ 
        message: 'API works', 
        database: 'connected successfully!',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(200).json({ 
        message: 'API works', 
        database: 'error: ' + error.message 
      });
    }
    return;
  }
  
  if (req.method === 'POST') {
    const body = req.body || {};
    const email = body.email;
    const password = body.password;
    const action = body.action;
    
    if (action === 'login') {
      if (!email || !password) {
        res.status(400).json({
          success: false,
          error: 'Email and password required'
        });
        return;
      }
      
      try {
        // Query your Neon database for the user
        const userResult = await sql`
          SELECT id, email, first_name, last_name, role, account_value, starting_balance 
          FROM users 
          WHERE email = ${email} AND password_hash = ${password}
        `;
        
        if (userResult.rows.length > 0) {
          const user = userResult.rows[0];
          
          // Create unique session token with user ID
          const sessionToken = `db_${user.id}_${Date.now()}`;
          
          res.status(200).json({
            success: true,
            token: sessionToken,
            user: {
              id: user.id,  // This is the actual UUID from database
              email: user.email,
              firstName: user.first_name,
              lastName: user.last_name,
              role: user.role,
              accountValue: parseFloat(user.account_value),
              startingBalance: parseFloat(user.starting_balance)
            },
            message: 'Database login successful',
            source: 'neon_database'
          });
          return;
        }
        
        // No user found in database
        res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
        return;
        
      } catch (dbError) {
        console.error('Database error:', dbError);
        
        // Fallback to hardcoded credentials if database fails
        if (email === 'admin@aequitascap.com' && password === 'admin123') {
          res.status(200).json({
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
            message: 'Fallback login (database unavailable)',
            source: 'fallback'
          });
          return;
        }
        
        res.status(500).json({
          success: false,
          error: 'Database connection failed',
          details: dbError.message
        });
        return;
      }
    }
    
    // For non-login actions, use old logic
    if (email === 'admin@aequitascap.com' && password === 'admin123') {
      res.status(200).json({
        success: true,
        token: 'legacy_admin123',
        user: {
          id: 'admin1',
          email: 'admin@aequitascap.com',
          firstName: 'Admin',
          lastName: 'User',
          role: 'admin',
          accountValue: 2850000,
          startingBalance: 1000000
        },
        source: 'legacy'
      });
      return;
    }
    
    res.status(401).json({ success: false, error: 'Invalid login' });
    return;
  }
  
  res.status(405).json({ error: 'Method not allowed' });
}
