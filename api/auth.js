// api/auth.js - Dynamic Import Version
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  // Try to import postgres dynamically
  let sql = null;
  try {
    const postgres = await import('@vercel/postgres');
    sql = postgres.sql;
  } catch (error) {
    console.log('Postgres import failed:', error.message);
  }
  
  if (req.method === 'GET') {
    if (sql) {
      try {
        await sql`SELECT 1 as test`;
        res.status(200).json({ 
          message: 'API works', 
          database: 'connected successfully!',
          postgres: 'available',
          timestamp: new Date().toISOString()
        });
        return;
      } catch (dbError) {
        res.status(200).json({ 
          message: 'API works', 
          database: 'connection error: ' + dbError.message,
          postgres: 'available but connection failed'
        });
        return;
      }
    } else {
      res.status(200).json({ 
        message: 'API works', 
        database: 'postgres module not available',
        postgres: 'not installed'
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
      
      // Try database authentication if postgres is available
      if (sql) {
        try {
          const userResult = await sql`
            SELECT id, email, first_name, last_name, role, account_value, starting_balance 
            FROM users 
            WHERE email = ${email} AND password_hash = ${password}
          `;
          
          if (userResult.rows.length > 0) {
            const user = userResult.rows[0];
            
            res.status(200).json({
              success: true,
              token: `db_${user.id}_${Date.now()}`,
              user: {
                id: user.id,
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
        } catch (dbError) {
          console.error('Database query error:', dbError);
          // Fall through to hardcoded credentials
        }
      }
      
      // Fallback to hardcoded credentials
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
          message: sql ? 'Fallback login (db query failed)' : 'Fallback login (no postgres)',
          source: 'fallback'
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
          message: sql ? 'Fallback login (db query failed)' : 'Fallback login (no postgres)',
          source: 'fallback'
        });
        return;
      }
      
      res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
      return;
    }
    
    // Legacy non-action login
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
  res.status(405).json({ error: 'Method not allowed' });
}
