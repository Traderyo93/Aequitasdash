// api/deposits.js - FIXED VERSION WITHOUT PURPOSE REQUIREMENT
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
        
        return await addCompletedDeposit(userId, amount, depositDate, purpose || 'additional', user.id, res);
        
      } else {
        // CLIENT FLOW: Submitting deposit request (pending approval)
        console.log('📋 CLIENT FLOW: Creating pending deposit request');
        
        // Client requests don't need depositDate
        return await createDepositRequest(user.id, amount, purpose || 'additional', res);
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
    
    // Create PENDING deposit request - purpose is optional
    const depositResult = await sql`
      INSERT INTO deposits (
        id, user_id, reference, amount, purpose,
        status, created_at, client_name, client_email
      ) VALUES (
        gen_random_uuid(), ${userId}, ${reference}, ${parseFloat(amount)}, ${purpose},
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
    
    // Insert deposit record - purpose is optional with default
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

// ===== LOAD CSV DATA - FIXED FOR VERCEL =====
async function loadCSVData() {
  try {
    console.log('📊 Loading CSV data for performance calculation...');
    
    // Always use the public URL for consistency in Vercel
    const csvUrl = `/data/daily_returns_simple.csv?v=${Date.now()}`;
    
    const response = await fetch(csvUrl);
    if (!response.ok) {
      throw new Error(`CSV fetch failed: ${response.status} ${response.statusText}`);
    }
    
    const csvContent = await response.text();
    const lines = csvContent.split('\n');
    const csvData = {};
    
    // Parse CSV content - use CUMULATIVE returns (column 3)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const values = line.split(',');
      if (values.length >= 3) {
        const date = values[0].trim();
        const dailyReturn = parseFloat(values[1].trim()); // Column 2: Daily return
        const cumulativeReturn = parseFloat(values[2].trim()); // Column 3: Keep for reference
        
        if (!isNaN(dailyReturn)) {
          csvData[date] = dailyReturn; // Store DAILY return for compounding
        }
      }
    }
    
    console.log(`📊 Parsed ${Object.keys(csvData).length} trading days from CSV (daily returns)`);
    
    // Show sample data for verification
    const sampleDates = ['2024-06-03', '2024-12-31', '2025-01-24'];
    sampleDates.forEach(date => {
      if (csvData[date]) {
        console.log(`📅 ${date}: ${csvData[date].toFixed(2)}% daily`);
      }
    });
    
    return csvData;
    
  } catch (error) {
    console.error('💥 Failed to load CSV data:', error);
    console.log('⚠️ Using zero returns - performance calculation will show deposit amounts only');
    return {}; // Return empty object if CSV fails to load
  }
}

// ===== CALCULATE USER PERFORMANCE USING CUMULATIVE RETURNS =====
// ===== CALCULATE USER PERFORMANCE USING DAILY COMPOUNDING =====
function calculateUserPerformance(deposits, csvData) {
  console.log('🧮 Calculating user performance with DAILY COMPOUNDING');
  
  let totalBalance = 0;
  let totalDeposits = 0;
  
  // Filter out deposits with null dates
  const validDeposits = deposits.filter(deposit => {
    const hasValidDate = deposit.deposit_date && deposit.deposit_date !== null;
    if (!hasValidDate) {
      console.log(`⚠️ Skipping deposit with null date: $${deposit.amount}`);
    }
    return hasValidDate;
  });
  
  console.log(`📊 Processing ${validDeposits.length} valid deposits`);
  
  // Sort deposits by date
  const sortedDeposits = validDeposits.sort((a, b) => new Date(a.deposit_date) - new Date(b.deposit_date));
  
  // Get all CSV dates in order
  const allDates = Object.keys(csvData).sort();
  
  // Process each deposit with DAILY COMPOUNDING
  for (const deposit of sortedDeposits) {
    const depositAmount = parseFloat(deposit.amount);
    const depositDate = new Date(deposit.deposit_date);
    const depositDateStr = depositDate.toISOString().split('T')[0];
    
    console.log(`💵 Processing deposit: $${depositAmount.toLocaleString()} on ${depositDateStr}`);
    
    totalDeposits += depositAmount;
    
    // Find deposit date in CSV
    const depositDateIndex = allDates.indexOf(depositDateStr);
    
    if (depositDateIndex === -1) {
      console.log(`⚠️ No CSV data for deposit date ${depositDateStr}, using deposit amount as-is`);
      totalBalance += depositAmount;
      continue;
    }
    
    // START DAILY COMPOUNDING from day AFTER deposit
    let currentBalance = depositAmount;
    let tradingDays = 0;
    
    for (let i = depositDateIndex + 1; i < allDates.length; i++) {
      const tradingDate = allDates[i];
      const dailyReturn = csvData[tradingDate]; // This is now DAILY return from column 2
      
      if (dailyReturn !== undefined && !isNaN(dailyReturn)) {
        const dailyGain = currentBalance * (dailyReturn / 100);
        currentBalance += dailyGain; // Compound the gain
        tradingDays++;
      }
    }
    
    const profit = currentBalance - depositAmount;
    const returnPercent = ((currentBalance / depositAmount) - 1) * 100;
    
    console.log(`   📈 Compounded over ${tradingDays} days`);
    console.log(`   💰 Final value: $${currentBalance.toLocaleString()}`);
    console.log(`   📊 Profit: $${profit.toLocaleString()} (${returnPercent.toFixed(2)}%)`);
    
    totalBalance += currentBalance;
  }
  
  const totalReturnPercent = totalDeposits > 0 ? ((totalBalance - totalDeposits) / totalDeposits) * 100 : 0;
  
  console.log(`✅ FINAL CALCULATION (DAILY COMPOUNDING):`);
  console.log(`   💰 Total deposits: $${totalDeposits.toLocaleString()}`);
  console.log(`   💰 Total balance: $${totalBalance.toLocaleString()}`);
  console.log(`   📈 Total return: ${totalReturnPercent.toFixed(2)}%`);
  
  return {
    totalDeposits,
    currentBalance: totalBalance,
    totalReturnPercent,
    daysTrading: 0
  };
}
