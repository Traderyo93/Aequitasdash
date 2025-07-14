// api/deposits.js - COMPLETE FIXED VERSION
import { sql } from '@vercel/postgres';
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // FIXED: Proper JWT authentication
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  
  const token = authHeader.replace('Bearer ', '');
  let user;
  
  try {
    user = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
  
  try {
    if (req.method === 'GET') {
      console.log('📊 GET deposits request from user:', user.role);
      
      let depositsQuery;
      
      if (user.role === 'admin') {
        // Admin gets ALL deposits
        depositsQuery = await sql`
          SELECT 
            d.*,
            u.first_name,
            u.last_name,
            u.email
          FROM deposits d
          LEFT JOIN users u ON d.user_id = u.id
          ORDER BY d.created_at DESC
        `;
      } else {
        // Regular users get only their deposits
        depositsQuery = await sql`
          SELECT * FROM deposits 
          WHERE user_id = ${user.id}
          ORDER BY created_at DESC
        `;
      }
      
      return res.status(200).json({
        success: true,
        deposits: depositsQuery.rows
      });
    }
    
    if (req.method === 'POST') {
      // FIXED: Handle admin adding deposits for clients
      console.log('💰 POST deposit request:', req.body);
      console.log('👤 User making request:', { id: user.id, role: user.role });
      
      const { userId, amount, depositDate, purpose } = req.body;
      
      // Validation
      if (!amount || !depositDate || !purpose) {
        return res.status(400).json({ 
          success: false, 
          error: 'Missing required fields: amount, depositDate, purpose' 
        });
      }
      
      if (parseFloat(amount) <= 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'Amount must be greater than 0' 
        });
      }
      
      // Determine target user
      let targetUserId;
      if (user.role === 'admin' && userId) {
        // Admin adding deposit for specific client
        targetUserId = userId;
        console.log('🔑 Admin adding deposit for client:', targetUserId);
      } else {
        // Regular user adding deposit for themselves
        targetUserId = user.id;
        console.log('👤 User adding deposit for themselves:', targetUserId);
      }
      
      // Check if target user exists
      const userCheck = await sql`
        SELECT id, first_name, last_name, email, account_value, starting_balance
        FROM users 
        WHERE id = ${targetUserId}
      `;
      
      if (userCheck.rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'Target user not found' 
        });
      }
      
      const targetUser = userCheck.rows[0];
      
      // Generate reference number
      const reference = 'DEP' + Date.now().toString().slice(-8);
      
      // Insert deposit record
      const depositResult = await sql`
        INSERT INTO deposits (
          id,
          user_id,
          reference,
          amount,
          currency,
          purpose,
          status,
          deposit_date,
          created_at,
          client_name,
          client_email,
          added_by
        ) VALUES (
          gen_random_uuid(),
          ${targetUserId},
          ${reference},
          ${parseFloat(amount)},
          'USD',
          ${purpose},
          'completed',
          ${depositDate}::date,
          NOW(),
          ${targetUser.first_name + ' ' + targetUser.last_name},
          ${targetUser.email},
          ${user.id}
        )
        RETURNING *
      `;
      
      // Update user's account balance
      const newAccountValue = (parseFloat(targetUser.account_value) || 0) + parseFloat(amount);
      const newStartingBalance = (parseFloat(targetUser.starting_balance) || 0) + parseFloat(amount);
      
      await sql`
        UPDATE users 
        SET 
          account_value = ${newAccountValue},
          starting_balance = ${newStartingBalance},
          updated_at = NOW()
        WHERE id = ${targetUserId}
      `;
      
      console.log('✅ Deposit added successfully:', {
        reference: reference,
        amount: parseFloat(amount),
        targetUser: targetUser.email,
        newBalance: newAccountValue
      });
      
      return res.status(200).json({
        success: true,
        message: 'Deposit added successfully',
        deposit: depositResult.rows[0],
        newAccountValue: newAccountValue
      });
    }
    
    if (req.method === 'PUT') {
      // Admin-only: Update deposit status
      if (user.role !== 'admin') {
        return res.status(403).json({
          success: false,
          error: 'Admin access required'
        });
      }
      
      const { depositId, status, notes } = req.body;
      
      if (!depositId || !status) {
        return res.status(400).json({
          success: false,
          error: 'depositId and status required'
        });
      }
      
      const result = await sql`
        UPDATE deposits 
        SET 
          status = ${status}, 
          approved_at = CURRENT_TIMESTAMP,
          approved_by = ${user.id},
          admin_notes = ${notes || ''}
        WHERE id = ${depositId}
        RETURNING *
      `;
      
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Deposit not found'
        });
      }
      
      return res.status(200).json({
        success: true,
        deposit: result.rows[0],
        message: 'Deposit status updated'
      });
    }
    
    return res.status(405).json({
      success: false,
      error: `Method ${req.method} not allowed`
    });
    
  } catch (error) {
    console.error('💥 Deposits API error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
}
