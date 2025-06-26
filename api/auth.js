// api/auth.js - Database Version
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
    // Test database connection
    try {
      await sql`SELECT 1`;
      res.status(200).json({ 
        message: 'API works', 
        database: 'connected',
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
        // Query the users table you created in Neon
        const userResult = await sql`
          SELECT id, email, first_name, last_name, role, account_value, starting_balance 
          FROM users 
          WHERE email = ${email} AND password_hash = ${password}
        `;
        
        if (userResult.rows.length > 0) {
          const user = userResult.rows[0];
          
          res.status(200).json({
            success: true,
            token: `db_token_${user.id}_${Date.now()}`,
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
          return;
        }
        
        // If no user found in database, return error
        res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
        return;
        
      } catch (dbError) {
        console.error('Database error:', dbError);
        
        // Fallback to hardcoded if database fails
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
            message: 'Fallback login (database error)'
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
    
    res.status(400).json({
      success: false,
      error: 'Invalid action'
    });
    return;
  }
  
  res.status(405).json({ error: 'Method not allowed' });
}
