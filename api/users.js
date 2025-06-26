// api/users.js - Create and manage real user accounts in database
import { sql } from '@vercel/postgres';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Verify admin authentication
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }
  
  const token = authHeader.replace('Bearer ', '');
  let adminUser;
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
    
    // Verify admin role
    if (decoded.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }
    
    adminUser = decoded;
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Invalid token'
    });
  }
  
  try {
    if (req.method === 'POST') {
      // Create new user in database
      const { 
        firstName, 
        lastName, 
        email, 
        phone,
        address,
        initialDeposit = 0,
        status = 'active'
      } = req.body;
      
      console.log('👤 Admin creating new user:', { firstName, lastName, email });
      
      // Validate required fields
      if (!firstName || !lastName || !email) {
        return res.status(400).json({
          success: false,
          error: 'First name, last name, and email are required'
        });
      }
      
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid email format'
        });
      }
      
      // Check if user already exists
      const existingUser = await sql`
        SELECT id FROM users WHERE email = ${email}
      `;
      
      if (existingUser.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'User with this email already exists'
        });
      }
      
      // Generate secure temporary password
      const tempPassword = generateSecurePassword();
      const hashedPassword = await bcrypt.hash(tempPassword, 12);
      
      // Insert new user
      const result = await sql`
        INSERT INTO users (
          email, 
          password_hash, 
          role, 
          first_name, 
          last_name, 
          phone,
          address,
          account_value,
          starting_balance,
          created_at
        )
        VALUES (
          ${email}, 
          ${hashedPassword}, 
          'client', 
          ${firstName}, 
          ${lastName},
          ${phone || null},
          ${address || null},
          ${parseFloat(initialDeposit)},
          ${parseFloat(initialDeposit)},
          NOW()
        )
        RETURNING id, email, role, first_name, last_name, phone, address, account_value, created_at
      `;
      
      const newUser = result.rows[0];
      
      // Log the action
      console.log(`✅ Admin ${adminUser.email} created new user: ${email}`);
      
      return res.status(201).json({
        success: true,
        message: 'User created successfully',
        user: newUser,
        tempPassword: tempPassword, // Return this for admin to share with client
        setupInstructions: `
          New client account created successfully!
          
          Client Setup Instructions:
          1. Email: ${email}
          2. Temporary Password: ${tempPassword}
          3. They must change this password on first login
          4. Direct them to: ${process.env.VERCEL_URL || 'your-domain'}/login.html
          
          Please share these credentials securely with the client.
        `
      });
    }
    
    if (req.method === 'PUT') {
      // Update existing user
      const { userId, firstName, lastName, phone, address, accountValue, status } = req.body;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required'
        });
      }
      
      const result = await sql`
        UPDATE users 
        SET 
          first_name = COALESCE(${firstName}, first_name),
          last_name = COALESCE(${lastName}, last_name),
          phone = COALESCE(${phone}, phone),
          address = COALESCE(${address}, address),
          account_value = COALESCE(${accountValue ? parseFloat(accountValue) : null}, account_value)
        WHERE id = ${userId} AND role != 'admin'
        RETURNING id, email, first_name, last_name, phone, address, account_value
      `;
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found or cannot be updated'
        });
      }
      
      console.log(`✅ Admin ${adminUser.email} updated user: ${result.rows[0].email}`);
      
      return res.status(200).json({
        success: true,
        message: 'User updated successfully',
        user: result.rows[0]
      });
    }
    
    if (req.method === 'DELETE') {
      // Soft delete user (set role to 'deleted')
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required'
        });
      }
      
      const result = await sql`
        UPDATE users 
        SET role = 'deleted', deleted_at = NOW()
        WHERE id = ${userId} AND role != 'admin'
        RETURNING email
      `;
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found or cannot be deleted'
        });
      }
      
      console.log(`🗑️ Admin ${adminUser.email} deleted user: ${result.rows[0].email}`);
      
      return res.status(200).json({
        success: true,
        message: 'User deleted successfully'
      });
    }
    
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
    
  } catch (error) {
    console.error('💥 Users API error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Failed to process user request',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

// Generate secure random password
function generateSecurePassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}
