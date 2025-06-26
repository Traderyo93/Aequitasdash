// api/auth.js - Minimal Test Version
export default function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Simple test response
  if (req.method === 'GET') {
    return res.status(200).json({
      success: true,
      message: 'API is working!',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV
    });
  }
  
  if (req.method === 'POST') {
    const { action, email, password } = req.body || {};
    
    if (action === 'login') {
      // Hardcoded test for now
      if (email === 'admin@aequitascap.com' && password === 'admin123') {
        return res.status(200).json({
          success: true,
          token: 'test_token_12345',
          user: {
            id: 'test_user_1',
            email: 'admin@aequitascap.com',
            firstName: 'Admin',
            lastName: 'User',
            role: 'admin',
            accountValue: 2850000,
            startingBalance: 1000000
          },
          message: 'Login successful (test mode)'
        });
      } else {
        return res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
      }
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
}
