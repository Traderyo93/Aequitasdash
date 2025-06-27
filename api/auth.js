// api/auth.js - COMPLETE AUTHENTICATION API WITH PASSWORD CHANGE FLOW
const { sql } = require('@vercel/postgres');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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

  try {
    const { email, password, newPassword } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    console.log('🔐 Auth attempt for:', email, 'with newPassword:', !!newPassword);

    // Get user from database
    const result = await sql`
      SELECT 
        id, email, password_hash, role, first_name, last_name, 
        account_value, starting_balance, setup_status, setup_step, 
        password_must_change, created_at, last_login
      FROM users 
      WHERE email = ${email} AND role != 'deleted'
    `;

    if (result.rows.length === 0) {
      console.log('❌ User not found:', email);
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    console.log('👤 User found:', email, 'Role:', user.role, 'Password must change:', user.password_must_change);
    
    // Verify current password
    let passwordValid;
    try {
      passwordValid = await bcrypt.compare(password, user.password_hash);
    } catch (bcryptError) {
      console.error('💥 Password comparison failed:', bcryptError);
      return res.status(500).json({ success: false, error: 'Authentication error' });
    }
    
    if (!passwordValid) {
      console.log('❌ Invalid password for:', email);
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    console.log('✅ Password verified for:', email);

    // HANDLE PASSWORD CHANGE REQUEST
    if (user.password_must_change && newPassword) {
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
        await sql`
          UPDATE users 
          SET 
            password_hash = ${newPasswordHash}, 
            password_must_change = false, 
            updated_at = NOW(),
            last_login = NOW()
          WHERE id = ${user.id}
        `;
        
        console.log('✅ Password changed successfully for user:', email);
      } catch (updateError) {
        console.error('💥 Failed to update password:', updateError);
        return res.status(500).json({
          success: false,
          error: 'Failed to update password'
        });
      }
      
      // Generate JWT token for the newly authenticated user
      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        process.env.JWT_SECRET || 'aequitas-secret-key-2025',
        { expiresIn: '24h' }
      );

      console.log('🎫 JWT token generated for password change user:', email);

      return res.status(200).json({
        success: true,
        token: token,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          firstName: user.first_name,
          lastName: user.last_name,
          accountValue: parseFloat(user.account_value || 0),
          startingBalance: parseFloat(user.starting_balance || 0),
          setupStatus: user.setup_status,
          setupStep: user.setup_step,
          setupRequired: user.setup_status !== 'approved'
        },
        passwordChanged: true,
        message: 'Password changed successfully'
      });
    }

    // CHECK IF PASSWORD CHANGE IS REQUIRED (first login scenario)
    if (user.password_must_change && !newPassword) {
      console.log('⚠️ Password change required for user:', email);
      return res.status(200).json({
        success: true,
        passwordChangeRequired: true,
        message: 'Password change required - redirecting to setup',
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          firstName: user.first_name,
          lastName: user.last_name,
          setupStatus: user.setup_status,
          setupStep: user.setup_step,
          setupRequired: user.setup_status !== 'approved'
        }
      });
    }

    // NORMAL LOGIN FLOW - No password change needed
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
      // Don't fail auth for this
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'aequitas-secret-key-2025',
      { expiresIn: '24h' }
    );

    console.log('🎫 JWT token generated for normal login:', email);
    console.log('✅ Normal auth successful for:', email, 'Role:', user.role);

    return res.status(200).json({
      success: true,
      token: token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        accountValue: parseFloat(user.account_value || 0),
        startingBalance: parseFloat(user.starting_balance || 0),
        setupStatus: user.setup_status,
        setupStep: user.setup_step,
        setupRequired: user.setup_status !== 'approved'
      }
    });

  } catch (error) {
    console.error('💥 Authentication error:', error);
    console.error('Error stack:', error.stack);
    
    return res.status(500).json({ 
      success: false, 
      error: 'Authentication failed',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};
