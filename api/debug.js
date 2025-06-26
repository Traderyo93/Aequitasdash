// api/debug.js - Create this file
import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  try {
    console.log('🔍 Testing database connection...');
    
    // Test basic connection
    const timeResult = await sql`SELECT NOW() as current_time`;
    console.log('✅ Database connected');
    
    // Test users table
    const usersResult = await sql`SELECT COUNT(*) as user_count FROM users`;
    console.log('✅ Users table accessible');
    
    // Test admin users
    const adminResult = await sql`SELECT email, role FROM users WHERE role = 'admin' LIMIT 3`;
    console.log('✅ Admin users found:', adminResult.rows.length);
    
    // Environment check
    const envCheck = {
      hasPostgresUrl: !!process.env.POSTGRES_URL,
      postgresUrlStart: process.env.POSTGRES_URL?.substring(0, 20) + '...',
      hasJwtSecret: !!process.env.JWT_SECRET,
      jwtSecretLength: process.env.JWT_SECRET?.length || 0,
      hasBlobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV
    };
    
    return res.status(200).json({
      success: true,
      message: 'All systems working!',
      database: {
        currentTime: timeResult.rows[0].current_time,
        userCount: usersResult.rows[0].user_count,
        adminUsers: adminResult.rows
      },
      environment: envCheck,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('💥 Debug error:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      code: error.code,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      timestamp: new Date().toISOString()
    });
  }
}
