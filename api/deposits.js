// api/deposits.js - COMPLETE FIXED VERSION
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Authentication check
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
      console.log('💰 POST deposit request');
      console.log('📋 Request body:', req.body);
      console.log('👤 User making request:', { id: user.id, role: user.role });
      
      const { userId, amount, depositDate, purpose } = req.body;
      
      // Basic validation - amount is always required
      if (!amount) {
        return res.status(400).json({ 
          success: false, 
          error: 'Amount is required' 
        });
      }
      
      if (parseFloat(amount) <= 0) {
        return res.status(400).json({ 
          success: false, 
          error: 'Amount must be greater than 0' 
        });
      }
      
      // ===== DETERMINE FLOW: CLIENT REQUEST vs ADMIN DEPOSIT =====
      
      if (user.role === 'admin' && userId && depositDate) {
        // ADMIN FLOW: Adding completed deposit for client after money received
        console.log('🔧 ADMIN FLOW: Adding completed deposit for client');
        
        // Admin deposits require depositDate
        if (!depositDate) {
          return res.status(400).json({ 
            success: false, 
            error: 'depositDate is required for admin deposits' 
          });
        }
        
        return await addCompletedDeposit(userId, amount, depositDate, purpose, user.id, res);
        
      } else {
        // CLIENT FLOW: Submitting deposit request (pending approval)
        console.log('📋 CLIENT FLOW: Creating pending deposit request');
        
        // Client requests don't need depositDate
        return await createDepositRequest(user.id, amount, purpose, res);
      }
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
};

// ===== CLIENT FLOW: Create pending deposit request =====
async function createDepositRequest(userId, amount, purpose, res) {
  try {
    console.log('📋 Creating PENDING deposit request for user:', userId);
    
    // Get user info
    const userCheck = await sql`
      SELECT id, first_name, last_name, email
      FROM users 
      WHERE id = ${userId}
    `;
    
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }
    
    const user = userCheck.rows[0];
    const reference = 'ACP' + Date.now().toString().slice(-6);
    
    // Create PENDING deposit request
    const depositResult = await sql`
      INSERT INTO deposits (
        id, user_id, reference, amount, purpose,
        status, created_at, client_name, client_email
      ) VALUES (
        gen_random_uuid(), ${userId}, ${reference}, ${parseFloat(amount)}, ${purpose || 'additional'},
        'pending', NOW(), 
        ${user.first_name + ' ' + user.last_name},
        ${user.email}
      )
      RETURNING *
    `;
    
    console.log('✅ Pending deposit request created:', reference);
    
    return res.status(200).json({
      success: true,
      message: 'Deposit request submitted successfully! Please upload required documents.',
      deposit: depositResult.rows[0],
      reference: reference,
      nextSteps: [
        'Download and complete the required forms',
        'Upload completed documents',
        'Wait for admin approval',
        'Transfer funds after approval'
      ]
    });
    
  } catch (error) {
    console.error('💥 Failed to create deposit request:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create deposit request',
      details: error.message
    });
  }
}

// ===== ADMIN FLOW: Add completed deposit =====
async function addCompletedDeposit(targetUserId, amount, depositDate, purpose, adminId, res) {
  try {
    console.log('🔧 Admin adding COMPLETED deposit for user:', targetUserId);
    
    // Get user info
    const userCheck = await sql`
      SELECT id, first_name, last_name, email, account_value, total_deposits
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
    
    // ===== ADD DEPOSIT + CALCULATE PERFORMANCE FROM CSV =====
    return await addDepositWithPerformance(targetUserId, amount, depositDate, purpose, adminId, targetUser, res);
    
  } catch (error) {
    console.error('💥 Failed to add completed deposit:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to add deposit',
      details: error.message
    });
  }
}

// ===== ADD DEPOSIT + CALCULATE PERFORMANCE FROM CSV =====
async function addDepositWithPerformance(targetUserId, amount, depositDate, purpose, addedBy, targetUser, res) {
  try {
    console.log('💰 Adding deposit + calculating performance from CSV');
    
    const reference = 'DEP' + Date.now().toString().slice(-8);
    
    // Insert deposit record - USES YOUR UPDATED SCHEMA WITH deposit_date COLUMN
    const depositResult = await sql`
      INSERT INTO deposits (
        id, user_id, reference, amount, purpose,
        status, deposit_date, created_at, client_name, 
        client_email, added_by
      ) VALUES (
        gen_random_uuid(), ${targetUserId}, ${reference}, ${parseFloat(amount)}, ${purpose || 'additional'},
        'completed', ${depositDate}::date, NOW(), 
        ${targetUser.first_name + ' ' + targetUser.last_name},
        ${targetUser.email}, ${addedBy}
      )
      RETURNING *
    `;
        
    // Get all user's deposits to calculate total performance
    const allDepositsResult = await sql`
      SELECT deposit_date, amount FROM deposits 
      WHERE user_id = ${targetUserId} AND status = 'completed'
      ORDER BY deposit_date ASC
    `;
    
    const allDeposits = allDepositsResult.rows;
    console.log(`📊 User has ${allDeposits.length} total deposits`);
    
    // Load CSV data for performance calculation
    const csvData = await loadCSVData();
    
    // Calculate user's current balance based on all deposits + performance
    const performanceResult = calculateUserPerformance(allDeposits, csvData);
    
    console.log('📈 Performance calculation result:', performanceResult);
    
    // Update user's account with calculated performance
    await sql`
      UPDATE users 
      SET 
        account_value = ${performanceResult.currentBalance},
        total_deposits = ${performanceResult.totalDeposits},
        total_return_percent = ${performanceResult.totalReturnPercent},
        updated_at = NOW()
      WHERE id = ${targetUserId}
    `;
    
    console.log(`✅ Deposit added + performance calculated:`);
    console.log(`   - Deposits: $${performanceResult.totalDeposits.toLocaleString()}`);
    console.log(`   - Current Value: $${performanceResult.currentBalance.toLocaleString()}`);
    console.log(`   - Total Return: ${performanceResult.totalReturnPercent.toFixed(2)}%`);
    
    return res.status(200).json({
      success: true,
      message: 'Deposit added and performance calculated from trading data!',
      deposit: depositResult.rows[0],
      performance: {
        totalDeposits: performanceResult.totalDeposits,
        currentBalance: performanceResult.currentBalance,
        totalProfit: performanceResult.currentBalance - performanceResult.totalDeposits,
        totalReturnPercent: performanceResult.totalReturnPercent,
        daysTrading: performanceResult.daysTrading
      }
    });
    
  } catch (error) {
    console.error('💥 Deposit + performance calculation failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to add deposit and calculate performance',
      details: error.message
    });
  }
}

// ===== LOAD CSV DATA =====
async function loadCSVData() {
  try {
    const fs = require('fs');
    const path = require('path');
    
    // Try to read from file system first
    const csvPath = path.join(process.cwd(), 'data', 'daily_returns_simple.csv');
    
    let csvContent;
    if (fs.existsSync(csvPath)) {
      csvContent = fs.readFileSync(csvPath, 'utf8');
      console.log('📊 CSV loaded from local file system');
    } else {
      // Try to fetch from public URL (for Vercel deployment)
      console.log('📊 CSV not found locally, trying public URL...');
      const response = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/data/daily_returns_simple.csv`);
      
      if (response.ok) {
        csvContent = await response.text();
        console.log('📊 CSV loaded from public URL');
      } else {
        throw new Error('CSV file not accessible');
      }
    }
    
    // Parse CSV content
    const lines = csvContent.split('\n');
    const csvData = {};
    
    // Skip header row, parse date and daily return
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const values = line.split(',');
      if (values.length >= 2) {
        const date = values[0].trim();
        const dailyReturn = parseFloat(values[1].trim());
        
        if (!isNaN(dailyReturn)) {
          csvData[date] = dailyReturn / 100; // Convert percentage to decimal
        }
      }
    }
    
    console.log(`📊 Parsed ${Object.keys(csvData).length} trading days from CSV`);
    return csvData;
    
  } catch (error) {
    console.error('💥 Failed to load CSV data:', error);
    console.log('⚠️ Using zero returns - performance calculation will show deposit amounts only');
    return {}; // Return empty object if CSV fails to load
  }
}

// ===== CALCULATE USER PERFORMANCE =====
function calculateUserPerformance(deposits, csvData) {
  console.log('🧮 Calculating user performance from deposits + CSV data');
  
  let totalBalance = 0;
  let totalDeposits = 0;
  let tradingDays = 0;
  
  // Sort deposits by date
  const sortedDeposits = deposits.sort((a, b) => new Date(a.deposit_date) - new Date(b.deposit_date));
  
  // Process each deposit and apply performance from deposit date to today
  for (const deposit of sortedDeposits) {
    const depositAmount = parseFloat(deposit.amount);
    const depositDate = new Date(deposit.deposit_date);
    const today = new Date();
    
    console.log(`💵 Processing deposit: $${depositAmount.toLocaleString()} on ${depositDate.toISOString().split('T')[0]}`);
    
    totalDeposits += depositAmount;
    let currentDepositValue = depositAmount;
    let daysForThisDeposit = 0;
    
    // Apply daily returns from deposit date to today
    for (let date = new Date(depositDate); date <= today; date.setDate(date.getDate() + 1)) {
      const dateStr = date.toISOString().split('T')[0];
      
      // Skip weekends (Saturday = 6, Sunday = 0)
      if (date.getDay() === 0 || date.getDay() === 6) continue;
      
      const dailyReturn = csvData[dateStr] || 0;
      
      if (dailyReturn !== 0) {
        currentDepositValue *= (1 + dailyReturn);
        daysForThisDeposit++;
      }
    }
    
    totalBalance += currentDepositValue;
    tradingDays = Math.max(tradingDays, daysForThisDeposit);
    
    console.log(`   → Grew to: $${currentDepositValue.toLocaleString()} over ${daysForThisDeposit} trading days`);
  }
  
  const totalReturnPercent = totalDeposits > 0 ? ((totalBalance - totalDeposits) / totalDeposits) * 100 : 0;
  
  return {
    totalDeposits,
    currentBalance: totalBalance,
    totalReturnPercent,
    daysTrading: tradingDays
  };
}
