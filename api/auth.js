// api/auth.js - FIXED WITH COMMONJS
const { sql } = require('@vercel/postgres');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  // Set CORS headers first
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

    console.log('🔐 Auth attempt for:', email);

    const result = await sql`
      SELECT 
        id, email, password_hash, role, first_name, last_name, 
        account_value, starting_balance, setup_status, setup_step, password_must_change
      FROM users 
      WHERE email = ${email} AND role != 'deleted'
    `;

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    
    // Verify password
    let passwordValid;
    try {
      passwordValid = await bcrypt.compare(password, user.password_hash);
    } catch (bcryptError) {
      console.error('Password comparison failed:', bcryptError);
      return res.status(500).json({ success: false, error: 'Authentication error' });
    }
    
    if (!passwordValid) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

// Check if password change is required
if (user.password_must_change) {
  if (!newPassword) {
    return res.status(200).json({
      success: true,
      passwordChangeRequired: true,
      message: 'Password change required',
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
      if (newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          error: 'New password must be at least 8 characters'
        });
      }
      
      // Update password
      const newPasswordHash = await bcrypt.hash(newPassword, 12);
      await sql`
        UPDATE users 
        SET password_hash = ${newPasswordHash}, password_must_change = false
        WHERE id = ${user.id}
      `;
      
      console.log('✅ Password changed for user:', email);
    }

    // Update last login
    try {
      await sql`UPDATE users SET last_login = NOW() WHERE id = ${user.id}`;
    } catch (updateError) {
      console.error('Failed to update last login:', updateError);
      // Don't fail auth for this
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'aequitas-secret-key-2025',
      { expiresIn: '24h' }
    );

    console.log('✅ Auth successful for:', email, 'Role:', user.role);

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
      passwordChanged: user.password_must_change && newPassword
    });

  } catch (error) {
    console.error('💥 Login error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Authentication failed',
      details: error.message
    });
  }
};
