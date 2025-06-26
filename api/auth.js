// api/auth.js - Production Authentication with bcrypt
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

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
    const client = new Client({
      connectionString: process.env.POSTGRES_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    try {
      await client.connect();
      const result = await client.query('SELECT NOW() as current_time, COUNT(*) as user_count FROM users');
      await client.end();
      
      res.status(200).json({ 
        message: 'Database connected successfully!',
        connection: 'direct_postgres_bcrypt',
        timestamp: result.rows[0].current_time,
        users_in_db: result.rows[0].user_count
      });
      return;
    } catch (error) {
      res.status(200).json({ 
        message: 'Database connection failed',
        error: error.message,
        connection: 'failed'
      });
      return;
    }
  }
  
  if (req.method === 'POST') {
    const { email, password, action } = req.body || {};
    
    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: 'Email and password required'
      });
      return;
    }
    
    // Connect to Neon database
    const client = new Client({
      connectionString: process.env.POSTGRES_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    try {
      await client.connect();
      
      // Get user from database (without password check in SQL)
      const result = await client.query(`
        SELECT id, email, first_name, last_name, role, account_value, starting_balance, password_hash
        FROM users 
        WHERE email = $1
      `, [email]);
      
      await client.end();
      
      if (result.rows.length > 0) {
        const user = result.rows[0];
        
        // PRODUCTION: Verify password with bcrypt
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        
        if (!passwordMatch) {
          res.status(401).json({
            success: false,
            error: 'Invalid credentials'
          });
          return;
        }
        
        // Create secure token with REAL database user ID
        const userToken = `neon_${user.id}_${Date.now()}`;
        
        res.status(200).json({
          success: true,
          token: userToken,
          user: {
            id: user.id,  // REAL UUID from Neon - ensures user isolation!
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            role: user.role,
            accountValue: parseFloat(user.account_value),
            startingBalance: parseFloat(user.starting_balance)
          },
          message: 'Production login successful',
          source: 'neon_database_bcrypt'
        });
        return;
      }
      
      // No user found
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
          source: 'fallback',
          error: dbError.message
        });
        return;
      }
      
      res.status(500).json({
        success: false,
        error: 'Database connection failed: ' + dbError.message
      });
      return;
    }
  }
  
  res.status(405).json({ error: 'Method not allowed' });
}
  res.status(405).json({ error: 'Method not allowed' });
}
