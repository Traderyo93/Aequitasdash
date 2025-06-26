// api/deposits.js - User-Specific Deposits API
import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // Extract user from token (simple version)
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    // Extract user ID from token (simple parsing)
    let userId;
    if (token.includes('admin')) {
      userId = 'admin_user';
    } else if (token.includes('client')) {
      userId = 'client_user';
    } else {
      userId = 'demo_user';
    }
    
    // Tables already exist in Neon - no need to create
    
    if (req.method === 'GET') {
      // Get deposits for specific user only
      const deposits = await sql`
        SELECT * FROM deposits 
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `;
      
      return res.status(200).json({
        success: true,
        deposits: deposits.rows,
        user_id: userId
      });
    }
    
    if (req.method === 'POST') {
      const { amount, purpose, reference } = req.body;
      
      if (!amount || !purpose || !reference) {
        return res.status(400).json({
          success: false,
          error: 'Amount, purpose, and reference required'
        });
      }
      
      // Insert deposit for this specific user
      const result = await sql`
        INSERT INTO deposits (user_id, reference, amount, purpose, status)
        VALUES (${userId}, ${reference}, ${amount}, ${purpose}, 'pending')
        RETURNING *
      `;
      
      return res.status(201).json({
        success: true,
        deposit: result.rows[0],
        message: 'Deposit created successfully'
      });
    }
    
    if (req.method === 'PUT') {
      // Admin-only: Update deposit status
      if (!userId.includes('admin')) {
        return res.status(403).json({
          success: false,
          error: 'Admin access required'
        });
      }
      
      const { depositId, status, notes } = req.body;
      
      const result = await sql`
        UPDATE deposits 
        SET status = ${status}, 
            approved_at = CURRENT_TIMESTAMP,
            approved_by = ${userId}
        WHERE id = ${depositId}
        RETURNING *
      `;
      
      return res.status(200).json({
        success: true,
        deposit: result.rows[0],
        message: 'Deposit status updated'
      });
    }
    
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
    
  } catch (error) {
    console.error('Deposits error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Server error',
      details: error.message
    });
  }
}
