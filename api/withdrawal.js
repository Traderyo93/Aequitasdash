// api/withdrawal.js - FIXED VERSION FOR VERCEL
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');
const multer = require('multer');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.doc', '.docx'];
    const ext = require('path').extname(file.originalname).toLowerCase();
    cb(null, allowedTypes.includes(ext));
  }
});

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // Simple auth check - extract from token
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    let user;
    
    try {
      user = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
    } catch {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    // Create tables if they don't exist
    await sql`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        amount DECIMAL(15, 2) NOT NULL,
        reason VARCHAR(50) NOT NULL,
        details TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        account_name VARCHAR(255),
        iban VARCHAR(34),
        swift_code VARCHAR(11),
        bank_name VARCHAR(255),
        bank_address TEXT,
        form_filename VARCHAR(255),
        admin_notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    if (req.method === 'GET') {
      if (req.url?.includes('/history')) {
        // Get user's withdrawal history
        const result = await sql`
          SELECT * FROM withdrawals 
          WHERE user_id = ${user.id} 
          ORDER BY created_at DESC
        `;
        
        return res.status(200).json({
          success: true,
          withdrawals: result.rows
        });
      }
      
      // Admin: Get all withdrawals
      if (user.role === 'admin') {
        const result = await sql`
          SELECT w.*, u.first_name, u.last_name, u.email
          FROM withdrawals w
          LEFT JOIN users u ON w.user_id::uuid = u.id
          ORDER BY w.created_at DESC
        `;
        
        return res.status(200).json({
          success: true,
          withdrawals: result.rows
        });
      }
      
      return res.status(403).json({ success: false, error: 'Access denied' });
    }
    
    if (req.method === 'POST') {
      // Create withdrawal request
      const { amount, reason, details, accountName, iban, swiftCode, bankName, bankAddress } = req.body;
      
      if (!amount || !reason || !accountName || !iban) {
        return res.status(400).json({
          success: false,
          error: 'Required fields missing'
        });
      }
      
      // Insert withdrawal
      const result = await sql`
        INSERT INTO withdrawals (
          user_id, amount, reason, details, account_name, 
          iban, swift_code, bank_name, bank_address
        ) VALUES (
          ${user.id}, ${amount}, ${reason}, ${details || ''}, 
          ${accountName}, ${iban}, ${swiftCode || ''}, 
          ${bankName}, ${bankAddress || ''}
        ) RETURNING *
      `;
      
      return res.status(200).json({
        success: true,
        message: 'Withdrawal request submitted',
        withdrawal: result.rows[0]
      });
    }
    
    if (req.method === 'PUT') {
      // Admin: Update withdrawal status
      if (user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
      }
      
      const { withdrawalId, status, adminNotes } = req.body;
      
      await sql`
        UPDATE withdrawals 
        SET status = ${status}, admin_notes = ${adminNotes || ''}, updated_at = NOW()
        WHERE id = ${withdrawalId}
      `;
      
      return res.status(200).json({
        success: true,
        message: `Withdrawal ${status}`
      });
    }
    
    return res.status(405).json({ success: false, error: 'Method not allowed' });
    
  } catch (error) {
    console.error('Withdrawal API error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error',
      details: error.message
    });
  }
};
