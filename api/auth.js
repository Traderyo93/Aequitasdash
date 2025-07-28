// api/auth.js - ENHANCED WITH RATE LIMITING
const { sql } = require('@vercel/postgres');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Simple in-memory rate limiting (for production, use Redis or similar)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5; // Max 5 attempts per IP per window

function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  
  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, []);
  }
  
  const attempts = rateLimitMap.get(ip);
  // Remove old attempts outside the window
  const recentAttempts = attempts.filter(timestamp => timestamp > windowStart);
  rateLimitMap.set(ip, recentAttempts);
  
  return recentAttempts.length < MAX_ATTEMPTS;
}

function recordAttempt(ip) {
  const attempts = rateLimitMap.get(ip) || [];
  attempts.push(Date.now());
  rateLimitMap.set(ip, attempts);
}

module.exports = async function handler(req, res) {
  // Set CORS headers first
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Rate limiting check
  const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
  
  if (!checkRateLimit(clientIP)) {
    console.log('🚫 Rate limit exceeded for IP:', clientIP);
    return res.status(429).json({ 
      success: false, 
      error: 'Too many login attempts. Please try again in 15 minutes.' 
    });
  }

  try {
    const { email, password, newPassword } = req.body;

    if (!email || !password) {
      recordAttempt(clientIP);
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    console.log('🔐 Auth attempt for:', email, 'with newPassword:', !!newPassword);

    // Get user from database with ALL required fields
    const result = await sql`
      SELECT 
        id, email, password_hash, role, status, first_name, last_name, 
        account_value, starting_balance, setup_status, setup_step, 
        password_must_change, created_at, last_login,
        two_factor_enabled, two_factor_setup_required, two_factor_secret, backup_codes
      FROM users 
      WHERE email = ${email} AND role != 'deleted'
    `;

    if (result.rows.length === 0) {
      console.log('❌ User not found:', email);
      recordAttempt(clientIP);
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    console.log('👤 User found:', email, 'Role:', user.role, 'Status:', user.status, 'Password must change:', user.password_must_change, '2FA enabled:', user.two_factor_enabled);
    
    // Verify current password
    let passwordValid;
    try {
      passwordValid = await bcrypt.compare(password, user.password_hash);
    } catch (bcryptError) {
      console.error('💥 Password comparison failed:', bcryptError);
      recordAttempt(clientIP);
      return res.status(500).json({ success: false, error: 'Authentication error' });
    }
    
    if (!passwordValid) {
      console.log('❌ Invalid password for:', email);
      recordAttempt(clientIP);
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    console.log('✅ Password verified for:', email);

    // HANDLE PASSWORD CHANGE REQUEST
    if (newPassword) {
      console.log('🔄 Processing password change for user:', email);
      
      // Validate new password
      if (newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          error: 'New password must be at least 8 characters'
        });
      }

      // Check password complexity
      const hasUpper = /[A-Z]/.test(newPassword);
      const hasLower = /[a-z]/.test(newPassword);
      const hasNumber = /\d/.test(newPassword);
      
      if (!hasUpper || !hasLower || !hasNumber) {
        return res.status(400).json({
          success: false,
          error: 'New password must contain at least one uppercase letter, one lowercase letter, and one number'
        });
      }
      
      // Hash new password
      let newPasswordHash;
      try {
        newPasswordHash = await bcrypt.hash(newPassword, 12);
      } catch (hashError) {
        console.error('💥 Password hashing failed:', hashError);
        return res.status(500).json({
          success: false,
          error: 'Failed to process new password'
        });
      }
      
      // Update password in database
      try {
        const updateResult = await sql`
          UPDATE users 
          SET 
            password_hash = ${newPasswordHash}, 
            password_must_change = false, 
            updated_at = NOW(),
            last_login = NOW()
          WHERE id = ${user.id}
          RETURNING id, email, role, first_name, last_name
        `;
        
        if (updateResult.rows.length === 0) {
          throw new Error('Failed to update user record');
        }
        
        console.log('✅ Password changed successfully for user:', email);
        
        // Generate NEW JWT token for the user with updated password
        const token = jwt.sign(
          { userId: user.id, id: user.id, email: user.email, role: user.role },
          process.env.JWT_SECRET || 'aequitas-secret-key-2025',
          { expiresIn: '24h' }
        );

        console.log('🎫 New JWT token generated after password change:', email);

        return res.status(200).json({
          success: true,
          passwordChanged: true,
          token: token,
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            status: user.status,
            firstName: user.first_name,
            lastName: user.last_name,
            accountValue: parseFloat(user.account_value || 0),
            startingBalance: parseFloat(user.starting_balance || 0),
            setupStatus: user.setup_status,
            setupStep: user.setup_step,
            setupRequired: user.role === 'pending' && user.setup_status !== 'approved',
            password_must_change: false,
            two_factor_setup_required: user.two_factor_setup_required
          },
          message: 'Password changed successfully'
        });
        
      } catch (updateError) {
        console.error('💥 Failed to update password:', updateError);
        return res.status(500).json({
          success: false,
          error: 'Failed to update password'
        });
      }
    }

    // CHECK IF PASSWORD CHANGE IS REQUIRED
    if (user.password_must_change && !newPassword) {
      console.log('⚠️ Password change MANDATORY for user:', email);
      return res.status(200).json({
        success: true,
        passwordChangeRequired: true,
        message: 'Password change required - redirecting to setup',
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          status: user.status,
          firstName: user.first_name,
          lastName: user.last_name,
          setupStatus: user.setup_status,
          setupStep: user.setup_step,
          setupRequired: user.role === 'pending' && user.setup_status !== 'approved',
          password_must_change: user.password_must_change,
          two_factor_setup_required: user.two_factor_setup_required
        }
      });
    }

    // 2FA CHECKS
    if (!user.two_factor_enabled && user.two_factor_setup_required === true) {
      console.log('🔐 2FA setup MANDATORY for user:', email);
      
      const token = jwt.sign(
        { userId: user.id, id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET || 'aequitas-secret-key-2025',
        { expiresIn: '1h' }
      );
      
      return res.status(200).json({
        success: true,
        twoFactorSetupRequired: true,
        token: token,
        user: { 
          id: user.id, 
          email: user.email, 
          role: user.role,
          status: user.status,
          firstName: user.first_name,
          lastName: user.last_name,
          setupStatus: user.setup_status,
          setupStep: user.setup_step,
          setupRequired: user.role === 'pending' && user.setup_status !== 'approved',
          password_must_change: user.password_must_change,
          two_factor_setup_required: user.two_factor_setup_required
        },
        message: '2FA setup required - redirecting to setup'
      });
    }

    // Check if 2FA verification is required (existing users with 2FA enabled)
    if (user.two_factor_enabled) {
      console.log('🔐 2FA verification required for user:', email);
      
      return res.status(200).json({
        success: true,
        twoFactorRequired: true,
        email: user.email,
        message: 'Please enter your 2FA code'
      });
    }

    // NORMAL LOGIN FLOW
    console.log('🔓 Normal login flow for user:', email);
    
    // Update last login timestamp
    try {
      await sql`
        UPDATE users 
        SET last_login = NOW() 
        WHERE id = ${user.id}
      `;
    } catch (updateError) {
      console.error('⚠️ Failed to update last login:', updateError);
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'aequitas-secret-key-2025',
      { expiresIn: '24h' }
    );

    console.log('🎫 JWT token generated for normal login:', email);
    console.log('✅ Normal auth successful for:', email, 'Role:', user.role, 'Status:', user.status);

    // Different setupRequired logic for different user types
    let setupRequired = false;
    
    if (user.role === 'pending') {
      setupRequired = user.setup_status !== 'approved';
    } else if (user.role === 'client' && user.status === 'active') {
      setupRequired = false;
    }

    console.log('🔍 Setup check:', {
      role: user.role,
      status: user.status,
      setup_status: user.setup_status,
      setupRequired: setupRequired,
      password_must_change: user.password_must_change,
      two_factor_setup_required: user.two_factor_setup_required
    });

    return res.status(200).json({
      success: true,
      token: token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        status: user.status,
        firstName: user.first_name,
        lastName: user.last_name,
        accountValue: parseFloat(user.account_value || 0),
        startingBalance: parseFloat(user.starting_balance || 0),
        setupStatus: user.setup_status,
        setupStep: user.setup_step,
        setupRequired: setupRequired,
        password_must_change: user.password_must_change,
        two_factor_setup_required: user.two_factor_setup_required,
        two_factor_enabled: user.two_factor_enabled
      }
    });

  } catch (error) {
    console.error('💥 Authentication error:', error);
    recordAttempt(clientIP);
    
    return res.status(500).json({ 
      success: false, 
      error: 'Authentication failed',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};
