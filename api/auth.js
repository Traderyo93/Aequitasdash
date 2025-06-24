// Aequitas Capital Partners - Authentication API (Vercel Serverless Function)

// Demo users for testing (in production, this would be a database)
const DEMO_USERS = [
    {
        id: 1,
        email: 'admin@aequitascap.com',
        // Password: admin123 (hashed with bcrypt)
        password: '$2b$10$rOvHbKT7Pfo7QwVcE4QJguWgOJ3LrKzSm.5qM7NJmv6YTVmCKLdMq',
        firstName: 'Admin',
        lastName: 'User',
        role: 'admin',
        accountValue: 2850000,
        availableCash: 125000,
        marginUtilization: 45.2,
        lastLogin: new Date().toISOString()
    },
    {
        id: 2,
        email: 'client@aequitascap.com',
        // Password: client123 (hashed with bcrypt)
        password: '$2b$10$rOvHbKT7Pfo7QwVcE4QJguWgOJ3LrKzSm.5qM7NJmv6YTVmCKLdMq',
        firstName: 'John',
        lastName: 'Smith',
        role: 'client',
        accountValue: 1250000,
        availableCash: 75000,
        marginUtilization: 32.8,
        lastLogin: new Date().toISOString()
    }
];

// Simple password verification (since we can't use bcrypt in Vercel edge runtime)
function verifyPassword(plainPassword, hashedPassword) {
    // For demo purposes, simplified password check
    const demoPasswords = {
        '$2b$10$rOvHbKT7Pfo7QwVcE4QJguWgOJ3LrKzSm.5qM7NJmv6YTVmCKLdMq': ['admin123', 'client123']
    };
    
    return demoPasswords[hashedPassword]?.includes(plainPassword) || false;
}

// Simple JWT implementation (for demo - use a proper library in production)
function createJWT(payload, secret) {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payloadBase64 = btoa(JSON.stringify(payload));
    const signature = btoa(`${header}.${payloadBase64}.${secret}`); // Simplified signature
    
    return `${header}.${payloadBase64}.${signature}`;
}

function verifyJWT(token, secret) {
    try {
        const [header, payload, signature] = token.split('.');
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

// JWT Secret
const JWT_SECRET = 'aequitas_capital_secret_key_2024';

// Rate limiting storage
const loginAttempts = new Map();

function isRateLimited(email) {
    const attempts = loginAttempts.get(email) || { count: 0, lastAttempt: 0 };
    const now = Date.now();
    
    // Reset counter if more than 15 minutes have passed
    if (now - attempts.lastAttempt > 15 * 60 * 1000) {
        attempts.count = 0;
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
    const payload = {
        id: user.id,
        email: user.email,
        role: user.role,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
    };
    
    return createJWT(payload, JWT_SECRET);
}

function authenticateUser(email, password) {
    const user = DEMO_USERS.find(u => u.email.toLowerCase() === email.toLowerCase());
    
    if (!user) {
        return null;
    }
    
    const isValidPassword = verifyPassword(password, user.password);
    
    if (!isValidPassword) {
        return null;
    }
    
    // Update last login
    user.lastLogin = new Date().toISOString();
    
    // Return user without password
    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
}

// Main API handler
export default function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed'
        });
    }
    
    try {
        const { action, email, password, token } = req.body;
        
        switch (action) {
            case 'login':
                // Validate input
                if (!email || !password) {
                    return res.status(400).json({
                        success: false,
                        error: 'Email and password are required'
                    });
                }
                
                // Check rate limiting
                if (isRateLimited(email)) {
                    return res.status(429).json({
                        success: false,
                        error: 'Too many login attempts. Please try again in 15 minutes.'
                    });
                }
                
                // Authenticate user
                const user = authenticateUser(email, password);
                
                if (!user) {
                    recordLoginAttempt(email, false);
                    return res.status(401).json({
                        success: false,
                        error: 'Invalid email or password'
                    });
                }
                
                // Generate JWT token
                const authToken = generateToken(user);
                
                recordLoginAttempt(email, true);
                
                return res.status(200).json({
                    success: true,
                    token: authToken,
                    user: user,
                    message: 'Login successful'
                });
                
            case 'verify':
                // Verify token
                if (!token) {
                    return res.status(400).json({
                        success: false,
                        error: 'Token is required'
                    });
                }
                
                const decoded = verifyJWT(token, JWT_SECRET);
                
                if (!decoded) {
                    return res.status(401).json({
                        success: false,
                        error: 'Invalid or expired token'
                    });
                }
                
                // Get user data
                const userData = DEMO_USERS.find(u => u.id === decoded.id);
                if (!userData) {
                    return res.status(404).json({
                        success: false,
                        error: 'User not found'
                    });
                }
                
                const { password: _, ...userInfo } = userData;
                
                return res.status(200).json({
                    success: true,
                    user: userInfo
                });
                
            case 'reset_request':
                // Password reset request
                if (!email) {
                    return res.status(400).json({
                        success: false,
                        error: 'Email is required'
                    });
                }
                
                // Don't reveal if user exists or not
                return res.status(200).json({
                    success: true,
                    message: 'If an account with that email exists, password reset instructions have been sent.'
                });
                
            case 'logout':
                // Logout (client-side token removal is sufficient for JWT)
                return res.status(200).json({
                    success: true,
                    message: 'Logged out successfully'
                });
                
            default:
                return res.status(400).json({
                    success: false,
                    error: 'Invalid action'
                });
        }
        
    } catch (error) {
        console.error('Auth API Error:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
}

/*
DEMO CREDENTIALS FOR TESTING:

Admin User:
Email: admin@aequitascap.com
Password: admin123

Client User:
Email: client@aequitascap.com
Password: client123
*/
