// api/withdrawal.js - COMPLETE FIXED VERSION WITH REAL DATABASE
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { put } = require('@vercel/blob');

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
    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    let user;
    
    try {
      user = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
    } catch (jwtError) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    // Ensure withdrawals table exists
    await sql`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        amount DECIMAL(15, 2) NOT NULL,
        reason VARCHAR(50) NOT NULL,
        details TEXT,
        account_name VARCHAR(255) NOT NULL,
        iban VARCHAR(34) NOT NULL,
        swift_code VARCHAR(11),
        bank_name VARCHAR(255) NOT NULL,
        bank_address TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        reference VARCHAR(50) UNIQUE NOT NULL,
        withdrawal_form_filename VARCHAR(255),
        withdrawal_form_url TEXT,
        admin_notes TEXT,
        approved_by UUID,
        approved_at TIMESTAMP WITH TIME ZONE,
        rejected_by UUID,
        rejected_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;

    if (req.method === 'GET') {
      if (req.url?.includes('/history')) {
        // User: Get their withdrawal history
        console.log('📤 Getting withdrawal history for user:', user.email);
        
        const result = await sql`
          SELECT * FROM withdrawals 
          WHERE user_id = ${user.id} 
          ORDER BY created_at DESC
        `;
        
        return res.status(200).json({
          success: true,
          withdrawals: result.rows
        });
        
      } else if (user.role === 'admin') {
        // Admin: Get all withdrawals with user details
        console.log('📤 Admin getting all withdrawals');
        
        const result = await sql`
          SELECT 
            w.*,
            u.first_name,
            u.last_name,
            u.email,
            approved_admin.first_name as approved_by_name,
            rejected_admin.first_name as rejected_by_name
          FROM withdrawals w
          LEFT JOIN users u ON w.user_id = u.id
          LEFT JOIN users approved_admin ON w.approved_by = approved_admin.id
          LEFT JOIN users rejected_admin ON w.rejected_by = rejected_admin.id
          ORDER BY w.created_at DESC
        `;
        
        const formattedWithdrawals = result.rows.map(w => ({
          id: w.id,
          reference: w.reference,
          client_name: w.first_name && w.last_name ? `${w.first_name} ${w.last_name}` : 'Unknown Client',
          client_email: w.email,
          amount: parseFloat(w.amount),
          reason: w.reason,
          details: w.details,
          account_name: w.account_name,
          iban: w.iban,
          swift_code: w.swift_code,
          bank_name: w.bank_name,
          bank_address: w.bank_address,
          status: w.status,
          withdrawal_form_filename: w.withdrawal_form_filename,
          withdrawal_form_url: w.withdrawal_form_url,
          admin_notes: w.admin_notes,
          approved_by: w.approved_by_name,
          rejected_by: w.rejected_by_name,
          approved_at: w.approved_at,
          rejected_at: w.rejected_at,
          created_at: w.created_at,
          updated_at: w.updated_at,
          user_id: w.user_id
        }));
        
        console.log(`✅ Found ${formattedWithdrawals.length} withdrawal requests`);
        
        return res.status(200).json({
          success: true,
          withdrawals: formattedWithdrawals
        });
        
      } else {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }
    }
    
    if (req.method === 'POST') {
      // Create withdrawal request
      console.log('📤 Creating withdrawal request for user:', user.email);
      
      const { 
        amount, 
        reason, 
        details, 
        accountName, 
        iban, 
        swiftCode, 
        bankName, 
        bankAddress,
        withdrawalFormFile 
      } = req.body;
      
      // Validate required fields
      if (!amount || !reason || !accountName || !iban || !bankName) {
        return res.status(400).json({
          success: false,
          error: 'Required fields missing: amount, reason, accountName, iban, bankName'
        });
      }
      
      // Validate amount
      const withdrawalAmount = parseFloat(amount);
      if (isNaN(withdrawalAmount) || withdrawalAmount <= 0) {
        return res.status(400).json({
          success: false,
          error: 'Invalid withdrawal amount'
        });
      }
      
      // Check if user has sufficient balance
      const userResult = await sql`
        SELECT account_value FROM users WHERE id = ${user.id}
      `;
      
      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      const userBalance = parseFloat(userResult.rows[0].account_value || 0);
      if (withdrawalAmount > userBalance) {
        return res.status(400).json({
          success: false,
          error: 'Insufficient account balance'
        });
      }
      
      // Generate reference number
      const referenceResult = await sql`
        SELECT 'WD-' || TO_CHAR(NOW(), 'YYYY-MM') || '-' || 
               LPAD((COALESCE(MAX(CAST(SUBSTRING(reference FROM 'WD-[0-9]{4}-[0-9]{2}-([0-9]+)') AS INT)), 0) + 1)::TEXT, 3, '0') as reference
        FROM withdrawals 
        WHERE reference LIKE ('WD-' || TO_CHAR(NOW(), 'YYYY-MM') || '-%')
      `;
      
      const reference = referenceResult.rows[0]?.reference || `WD-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-001`;
      
      // Handle file upload if provided
      let withdrawalFormUrl = null;
      let withdrawalFormFilename = null;
      
      if (withdrawalFormFile && withdrawalFormFile.data) {
        try {
          console.log('📎 Processing withdrawal form upload...');
          
          const buffer = Buffer.from(withdrawalFormFile.data, 'base64');
          const filename = withdrawalFormFile.name || 'withdrawal_form.pdf';
          const blobPath = `withdrawals/${user.id}/${Date.now()}_${filename}`;
          
          const blob = await put(blobPath, buffer, {
            access: 'public',
            contentType: 'application/pdf'
          });
          
          withdrawalFormUrl = blob.url;
          withdrawalFormFilename = filename;
          
          console.log('✅ Withdrawal form uploaded successfully');
        } catch (uploadError) {
          console.error('💥 File upload failed:', uploadError);
          // Don't fail the withdrawal request, just log the error
        }
      }
      
      // Insert withdrawal request
      const insertResult = await sql`
        INSERT INTO withdrawals (
          user_id, amount, reason, details, account_name, 
          iban, swift_code, bank_name, bank_address, reference,
          withdrawal_form_filename, withdrawal_form_url
        ) VALUES (
          ${user.id}, ${withdrawalAmount}, ${reason}, ${details || ''}, 
          ${accountName}, ${iban}, ${swiftCode || ''}, 
          ${bankName}, ${bankAddress || ''}, ${reference},
          ${withdrawalFormFilename}, ${withdrawalFormUrl}
        ) RETURNING *
      `;
      
      const newWithdrawal = insertResult.rows[0];
      
      console.log('✅ Withdrawal request created:', reference);
      
      return res.status(200).json({
        success: true,
        message: 'Withdrawal request submitted successfully',
        withdrawal: {
          id: newWithdrawal.id,
          reference: newWithdrawal.reference,
          amount: parseFloat(newWithdrawal.amount),
          status: newWithdrawal.status,
          created_at: newWithdrawal.created_at
        }
      });
    }
    
    if (req.method === 'PUT') {
      // Admin: Update withdrawal status
      if (user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
      }
      
      console.log('📝 Admin updating withdrawal status');
      
      const { withdrawalId, status, adminNotes } = req.body;
      
      if (!withdrawalId || !status) {
        return res.status(400).json({
          success: false,
          error: 'withdrawalId and status are required'
        });
      }
      
      if (!['pending', 'approved', 'completed', 'rejected'].includes(status)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid status'
        });
      }
      
      // Build update query based on status
      let updateFields = {
        status: status,
        admin_notes: adminNotes || null,
        updated_at: new Date()
      };
      
      if (status === 'approved') {
        updateFields.approved_by = user.id;
        updateFields.approved_at = new Date();
      } else if (status === 'rejected') {
        updateFields.rejected_by = user.id;
        updateFields.rejected_at = new Date();
      }
      
      const updateResult = await sql`
        UPDATE withdrawals 
        SET 
          status = ${updateFields.status},
          admin_notes = ${updateFields.admin_notes},
          approved_by = ${updateFields.approved_by || null},
          approved_at = ${updateFields.approved_at || null},
          rejected_by = ${updateFields.rejected_by || null},
          rejected_at = ${updateFields.rejected_at || null},
          updated_at = NOW()
        WHERE id = ${withdrawalId}
        RETURNING *
      `;
      
      if (updateResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Withdrawal not found'
        });
      }
      
      console.log(`✅ Withdrawal ${withdrawalId} updated to ${status}`);
      
      return res.status(200).json({
        success: true,
        message: `Withdrawal ${status} successfully`,
        withdrawal: updateResult.rows[0]
      });
    }
    
    return res.status(405).json({ success: false, error: 'Method not allowed' });
    
  } catch (error) {
    console.error('💥 Withdrawal API error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
    });
  }
};
