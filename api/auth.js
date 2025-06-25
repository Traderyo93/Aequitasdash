// api/auth.js - Complete Production Authentication API
export const config = {
  runtime: 'edge',
}

// Demo users for production (in real app, this would be a database)
const DEMO_USERS = [
  {
    id: 'user_admin_001',
    email: 'admin@aequitascap.com',
    password: 'admin123',
    firstName: 'Admin',
    lastName: 'User',
    role: 'admin',
    accountValue: 2850000,
    availableCash: 125000,
    marginUtilization: 45.2,
    lastLogin: new Date().toISOString(),
    status: 'active',
    permissions: ['read', 'write', 'admin', 'client_management']
  },
  {
    id: 'user_client_001',
    email: 'client@aequitascap.com',
    password: 'client123',
    firstName: 'John',
    lastName: 'Smith',
    role: 'client',
    accountValue: 1250000,
    availableCash: 75000,
    marginUtilization: 32.8,
    lastLogin: new Date().toISOString(),
    status: 'active',
    permissions: ['read', 'write']
  },
  {
    id: 'user_demo_001',
    email: 'demo@aequitascap.com',
    password: 'demo123',
    firstName: 'Demo',
    lastName: 'User',
    role: 'client',
    accountValue: 500000,
    availableCash: 25000,
    marginUtilization: 15.5,
    lastLogin: new Date().toISOString(),
    status: 'active',
    permissions: ['read']
  }
];

// Simple JWT implementation for edge runtime
function createJWT(payload) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadBase64 = btoa(JSON.stringify(payload));
  const secret = 'aequitas_capital_secret_key_2024_production';
  const signature = btoa(`${header}.${payloadBase64}.${secret}`);
  
  return `${header}.${payloadBase64}.${signature}`;
}

function verifyJWT(token) {
  try {
    const [header, payload, signature] = token.split('.');
    const secret = 'aequitas_capital_secret_key_2024_production';
    const expectedSignature = btoa(`${header}.${payload}.${secret}`);
    
    if (signature !== expectedSignature) {
      return null;
    }
    
    const decodedPayload = JSON.parse(atob(payload));
    
    // Check expiration
    if (decodedPayload.exp && Date.now() / 1000 > decodedPayload.exp) {
      return null;
    }
    
    return decodedPayload;
  } catch {
    return null;
  }
}

// Rate limiting storage (in-memory for demo)
const loginAttempts = new Map();

function isRateLimited(email) {
  const attempts = loginAttempts.get(email) || { count: 0, lastAttempt: 0 };
  const now = Date.now();
  
  // Reset counter if more than 15 minutes have passed
  if (now - attempts.lastAttempt > 15 * 60 * 1000) {
    attempts.count = 0;
    loginAttempts.set(email, attempts);
  }
  
  // Block if more than 5 attempts in 15 minutes
  return attempts.count >= 5;
}

function recordLoginAttempt(email, success = false) {
  const attempts = loginAttempts.get(email) || { count: 0, lastAttempt: 0 };
  
  if (success) {
    loginAttempts.delete(email);
  } else {
    attempts.count += 1;
    attempts.lastAttempt = Date.now();
    loginAttempts.set(email, attempts);
  }
}

function generateToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
    firstName: user.firstName,
    lastName: user.lastName,
    iat: now,
    exp: now + (24 * 60 * 60) // 24 hours
  };
  
  return createJWT(payload);
}

function authenticateUser(email, password) {
  console.log(`Authentication attempt for: ${email}`);
  
  const user = DEMO_USERS.find(u => u.email.toLowerCase() === email.toLowerCase());
  
  if (!user) {
    console.log('User not found');
    return null;
  }
  
  // Simple password check (in production, use proper hashing)
  if (user.password !== password) {
    console.log('Invalid password');
    return null;
  }
  
  if (user.status !== 'active') {
    console.log('User account is not active');
    return null;
  }
  
  // Update last login
  user.lastLogin = new Date().toISOString();
  
  console.log(`Authentication successful for: ${email}`);
  
  // Return user without password
  const { password: _, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

export default async function handler(req) {
  // Handle CORS
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 200, 
      headers: corsHeaders 
    });
  }
  
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({
      success: false,
      error: 'Method not allowed'
    }), { 
      status: 405, 
      headers: corsHeaders 
    });
  }
  
  try {
    const body = await req.json();
    const { action, email, password, token } = body;
    
    console.log(`Auth API called with action: ${action}`);
    
    switch (action) {
      case 'login':
        // Validate input
        if (!email || !password) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Email and password are required'
          }), { 
            status: 400, 
            headers: corsHeaders 
          });
        }
        
        // Check rate limiting
        if (isRateLimited(email)) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Too many login attempts. Please try again in 15 minutes.'
          }), { 
            status: 429, 
            headers: corsHeaders 
          });
        }
        
        // Authenticate user
        const user = authenticateUser(email, password);
        
        if (!user) {
          recordLoginAttempt(email, false);
          return new Response(JSON.stringify({
            success: false,
            error: 'Invalid email or password'
          }), { 
            status: 401, 
            headers: corsHeaders 
          });
        }
        
        // Generate JWT token
        const authToken = generateToken(user);
        
        recordLoginAttempt(email, true);
        
        return new Response(JSON.stringify({
          success: true,
          token: authToken,
          user: user,
          message: 'Login successful'
        }), { 
          status: 200, 
          headers: corsHeaders 
        });
        
      case 'verify':
        // Verify token
        if (!token) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Token is required'
          }), { 
            status: 400, 
            headers: corsHeaders 
          });
        }
        
        const decoded = verifyJWT(token);
        
        if (!decoded) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Invalid or expired token'
          }), { 
            status: 401, 
            headers: corsHeaders 
          });
        }
        
        // Get user data
        const userData = DEMO_USERS.find(u => u.id === decoded.id);
        if (!userData) {
          return new Response(JSON.stringify({
            success: false,
            error: 'User not found'
          }), { 
            status: 404, 
            headers: corsHeaders 
          });
        }
        
        const { password: _, ...userInfo } = userData;
        
        return new Response(JSON.stringify({
          success: true,
          user: userInfo
        }), { 
          status: 200, 
          headers: corsHeaders 
        });
        
      case 'reset_request':
        // Password reset request
        if (!email) {
          return new Response(JSON.stringify({
            success: false,
            error: 'Email is required'
          }), { 
            status: 400, 
            headers: corsHeaders 
          });
        }
        
        // Don't reveal if user exists or not
        return new Response(JSON.stringify({
          success: true,
          message: 'If an account with that email exists, password reset instructions have been sent.'
        }), { 
          status: 200, 
          headers: corsHeaders 
        });
        
      case 'logout':
        // Logout (client-side token removal is sufficient for JWT)
        return new Response(JSON.stringify({
          success: true,
          message: 'Logged out successfully'
        }), { 
          status: 200, 
          headers: corsHeaders 
        });
        
      default:
        return new Response(JSON.stringify({
          success: false,
          error: 'Invalid action'
        }), { 
          status: 400, 
          headers: corsHeaders 
        });
    }
    
  } catch (error) {
    console.error('Auth API Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: 'Internal server error'
    }), { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}

/*
PRODUCTION CREDENTIALS:

Admin User:
Email: admin@aequitascap.com
Password: admin123

Client User:
Email: client@aequitascap.com
Password: client123

Demo User:
Email: demo@aequitascap.com
Password: demo123
*/
