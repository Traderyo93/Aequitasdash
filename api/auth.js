export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  
  if (req.method === 'GET') {
    res.status(200).json({ message: 'API works' });
    return;
  }
  
  if (req.method === 'POST') {
    const body = req.body || {};
    const email = body.email;
    const password = body.password;
    
    if (email === 'admin@aequitascap.com' && password === 'admin123') {
      res.status(200).json({
        success: true,
        token: 'admin123',
        user: {
          id: 'admin1',
          email: 'admin@aequitascap.com',
          firstName: 'Admin',
          lastName: 'User',
          role: 'admin',
          accountValue: 2850000,
          startingBalance: 1000000
        }
      });
      return;
    }
    
    res.status(401).json({ success: false, error: 'Invalid login' });
    return;
  }
  
  res.status(405).json({ error: 'Method not allowed' });
}
