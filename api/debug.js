// api/debug.js - FIXED VERSION with better error handling
export default async function handler(req, res) {
  // Enable CORS for debugging
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed. Use GET.' 
    });
  }

  try {
    console.log('🔍 Debug API called');
    
    // Check environment variables first
    const envCheck = {
      hasPostgresUrl: !!process.env.POSTGRES_URL,
      postgresUrlStart: process.env.POSTGRES_URL?.substring(0, 30) + '...',
      hasJwtSecret: !!process.env.JWT_SECRET,
      jwtSecretLength: process.env.JWT_SECRET?.length || 0,
      hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
      blobTokenStart: process.env.BLOB_READ_WRITE_TOKEN?.substring(0, 20) + '...',
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV
    };
    
    console.log('Environment check:', envCheck);

    // Try simple database test - ONLY if we have the URL
    let databaseResult = null;
    if (process.env.POSTGRES_URL) {
      try {
        const { sql } = await import('@vercel/postgres');
        const timeResult = await sql`SELECT NOW() as current_time`;
        console.log('✅ Database connected');
        
        // Test if users table exists
        const tableCheck = await sql`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = 'users'
        `;
        
        databaseResult = {
          connected: true,
          currentTime: timeResult.rows[0].current_time,
          usersTableExists: tableCheck.rows.length > 0
        };
        
        if (tableCheck.rows.length > 0) {
          const usersCount = await sql`SELECT COUNT(*) as count FROM users`;
          databaseResult.userCount = usersCount.rows[0].count;
        }
        
      } catch (dbError) {
        console.error('Database error:', dbError);
        databaseResult = {
          connected: false,
          error: dbError.message
        };
      }
    }
    
    return res.status(200).json({
      success: true,
      message: 'Debug info retrieved successfully',
      environment: envCheck,
      database: databaseResult,
      timestamp: new Date().toISOString(),
      deployment: {
        region: process.env.VERCEL_REGION || 'unknown',
        url: process.env.VERCEL_URL || 'localhost'
      }
    });
    
  } catch (error) {
    console.error('💥 Debug API error:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    });
  }
}
