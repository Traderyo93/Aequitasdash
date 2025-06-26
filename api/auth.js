// api/auth.js - Direct Postgres Connection
const { Client } = require('pg');

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  // Create database client using your Neon connection string
  const client = new Client({
    connectionString: process.env.POSTGRES_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
  
  if (req.method === 'GET') {
    try {
      await client.connect();
      const result = await client.query('SELECT 1 as test');
      await client.end();
      
      res.status(200).json({ 
        message: 'API works', 
        database: 'connected successfully!',
        connection: 'direct_postgres',
        timestamp: new Date().toISOString()
      });
      return;
    } catch (error) {
      res.status(200).json({ 
        message: 'API works', 
        database: 'error: ' + error.message,
        connection: 'failed'
      });
      return;
    }
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
        await client.connect();
        
        // Query your Neon database
        const query = `
          SELECT id, email, first_name, last_name, role, account_value, starting_balance 
          FROM users 
          WHERE email = $1 AND password_hash = $2
        `;
        
        const result = await client.query(query, [email, password]);
        await client.end();
        
        if (result.rows.length > 0) {
          const user = result.rows[0];
          
          res.status(200).json({
            success: true,
            token: `neon_${user.id}_${Date.now()}`,
            user: {
              id: user.id,  // Real UUID from Neon database
              email: user.email,
              firstName: user.first_name,
              lastName: user.last_name,
              role: user.role,
              accountValue: parseFloat(user.account_value),
              startingBalance: parseFloat(user.starting_balance)
            },
            message: 'Neon database login successful',
            source: 'neon_direct'
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
            message: 'Fallback login (database error)',
            source: 'fallback',
            error: dbError.message
          });
          return;
        }
        
        if (email === 'client@aequitascap.com' && password === 'client123') {
          res.status(200).json({
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
            message: 'Fallback login (database error)',
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
    
    // Non-action legacy support
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
