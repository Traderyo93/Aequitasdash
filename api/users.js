// api/users.js - COMPLETE FIXED VERSION
const { sql } = require('@vercel/postgres');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // Verify admin authentication for all operations
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    const token = authHeader.replace('Bearer ', '');
    
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
    } catch (jwtError) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }
    
    // Verify admin role
    if (decoded.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    if (req.method === 'POST') {
      // Create new user - FIXED: Handle active vs pending properly
      const { firstName, lastName, email, phone, address, status = 'pending', initialDeposit = 0 } = req.body;
      
      console.log('👤 Creating user:', { firstName, lastName, email, status });
      
      if (!firstName || !lastName || !email) {
        return res.status(400).json({
          success: false,
          error: 'First name, last name, and email are required'
        });
      }
      
      // Check if user exists
      const existingUser = await sql`SELECT id FROM users WHERE email = ${email}`;
      if (existingUser.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'User with this email already exists'
        });
      }
      
      // Generate default password: FirstnameLastname123!
      const defaultPassword = `${firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()}${lastName.charAt(0).toUpperCase() + lastName.slice(1).toLowerCase()}123!`;
      
      let hashedPassword;
      try {
        hashedPassword = await bcrypt.hash(defaultPassword, 12);
      } catch (hashError) {
        console.error('Password hashing failed:', hashError);
        return res.status(500).json({
          success: false,
          error: 'Failed to create secure password'
        });
      }
      
      // 🔥 FIXED: Different creation paths for active vs pending users
      if (status === 'active') {
        // ACTIVE CLIENT: Admin has all docs, user only needs password + 2FA
        console.log('✅ Creating ACTIVE client (pre-verified by admin)');
        
        const insertResult = await sql`
          INSERT INTO users (
            email, password_hash, role, status, first_name, last_name, phone, address,
            account_value, starting_balance, setup_status, setup_step,
            password_must_change, two_factor_enabled, two_factor_setup_required,
            personal_info_completed, documents_uploaded, legal_agreements_signed
          )
          VALUES (
            ${email}, ${hashedPassword}, 'client', 'active', ${firstName}, ${lastName}, 
            ${phone || ''}, ${address || ''}, ${parseFloat(initialDeposit)}, ${parseFloat(initialDeposit)}, 
            'approved', 5, false, false, true, true, 3, true
          )
          RETURNING id, email, first_name, last_name
        `;
        
        const newUser = insertResult.rows[0];
        
        console.log('✅ ACTIVE CLIENT CREATED - only needs password + 2FA:', {
          id: newUser.id,
          email: newUser.email,
          role: 'client',
          status: 'active',
          setup_status: 'approved'
        });
        
        return res.status(201).json({
          success: true,
          message: 'Active client created - only password change and 2FA setup required',
          user: newUser,
          tempPassword: defaultPassword,
          setupRequirements: {
            passwordChangeRequired: false, // 🔥 FIXED: No password change needed
            twoFactorSetupRequired: true,
            accountSetupRequired: false, // 🔥 FIXED: No account setup needed
            documentUploadRequired: false // 🔥 FIXED: No documents needed
          },
          setupInstructions: `
ACTIVE CLIENT CREATED: ${email}
Temporary password: ${defaultPassword}

SIMPLIFIED SETUP FLOW (Admin pre-verified):
1. Login with email: ${email}
2. Login with temp password: ${defaultPassword}
3. 2FA setup required (2fa-setup.html)  
4. Direct to dashboard (no password change or document upload needed)

User bypasses password change and document upload - admin has already verified them.
          `
        });
        
      } else {
        // PENDING USER: Full setup required including documents
        console.log('📋 Creating PENDING user (needs full setup)');
        
        const insertResult = await sql`
          INSERT INTO users (
            email, password_hash, role, status, first_name, last_name, phone, address,
            account_value, starting_balance, setup_status, setup_step, 
            password_must_change, two_factor_enabled, two_factor_setup_required,
            personal_info_completed, documents_uploaded, legal_agreements_signed
          )
          VALUES (
            ${email}, ${hashedPassword}, 'pending', 'setup_pending', ${firstName}, ${lastName}, 
            ${phone || ''}, ${address || ''}, ${parseFloat(initialDeposit)}, ${parseFloat(initialDeposit)}, 
            'setup_pending', 1, true, false, true, false, 0, false
          )
          RETURNING id, email, first_name, last_name
        `;
        
        const newUser = insertResult.rows[0];
        
        console.log('✅ PENDING USER CREATED - needs full setup:', {
          id: newUser.id,
          email: newUser.email,
          role: 'pending',
          status: 'setup_pending'
        });
        
        return res.status(201).json({
          success: true,
          message: 'Pending user created - full setup flow required',
          user: newUser,
          tempPassword: defaultPassword,
          setupRequirements: {
            passwordChangeRequired: true,
            twoFactorSetupRequired: true,
            accountSetupRequired: true, // Full setup needed
            documentUploadRequired: true // Documents needed
          },
          setupInstructions: `
PENDING USER CREATED: ${email}
Temporary password: ${defaultPassword}

FULL SETUP FLOW:
1. Login → Password change required (setup.html)
2. After password change → 2FA setup required (2fa-setup.html)  
3. After 2FA → Complete account setup (setup.html)
4. Upload required documents
5. Admin approval required

User must complete ALL steps in this flow.
          `
        });
      }
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
      
      const updateResult = await sql`
        UPDATE users 
        SET 
          first_name = ${firstName},
          last_name = ${lastName}, 
          phone = ${phone || ''},
          address = ${address || ''},
          account_value = ${parseFloat(accountValue || 0)},
          status = ${status || 'active'},
          updated_at = NOW()
        WHERE id = ${userId}
        RETURNING id, email, first_name, last_name, phone, address, account_value, status
      `;
      
      if (updateResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      return res.status(200).json({
        success: true,
        message: 'User updated successfully',
        user: updateResult.rows[0]
      });
    }
    
    if (req.method === 'DELETE') {
      // Delete user
      const { userId } = req.body;
      
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required'
        });
      }
      
      // Mark as deleted rather than actually deleting
      await sql`
        UPDATE users 
        SET role = 'deleted', updated_at = NOW()
        WHERE id = ${userId}
      `;
      
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
      error: 'Internal server error',
      details: error.message
    });
  }
};
