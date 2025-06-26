// api/auth.js - REPLACE YOUR EXISTING FILE
import { sql } from '@vercel/postgres';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
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

  const { email, password, newPassword } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password required' });
  }

  try {
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
    
    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    // Check if password change is required
    if (user.password_must_change) {
      if (!newPassword) {
        return res.status(200).json({
          success: true,
          passwordChangeRequired: true,
          message: 'Password change required'
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
    }

    // Update last login
    await sql`UPDATE users SET last_login = NOW() WHERE id = ${user.id}`;

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'aequitas-secret-key-2025',
      { expiresIn: '24h' }
    );

    return res.status(200).json({
      success: true,
      token: token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        accountValue: user.account_value,
        startingBalance: user.starting_balance,
        setupStatus: user.setup_status,
        setupStep: user.setup_step,
        setupRequired: user.setup_status !== 'approved'
      },
      passwordChanged: user.password_must_change && newPassword
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Authentication failed'
    });
  }
}
