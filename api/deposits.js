// api/deposits.js - COMPLETE FIXED VERSION WITH COMMONJS
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
      console.log('💰 POST deposit request - TRADING INTEGRATION VERSION');
      console.log('📋 Request body:', req.body);
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
        SELECT id, first_name, last_name, email, account_value, starting_balance, live_trading_enabled, total_deposits
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
      console.log('👤 Target user found:', targetUser.email);
      
      // ===== INTEGRATION WITH LIVE TRADING SIMULATION =====
      console.log('🔄 Calling live-trading-simulation.js for deposit processing...');
      
      try {
        // Call the live trading simulation to handle the deposit with backtesting
        const tradingResult = await processDepositWithTrading(targetUserId, amount, depositDate);
        
        if (tradingResult.success) {
          console.log('✅ Live trading simulation processed deposit successfully');
          
          // Create deposit record in deposits table for admin tracking
          const reference = 'DEP' + Date.now().toString().slice(-8);
          
          const depositRecord = await sql`
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
          
          return res.status(200).json({
            success: true,
            message: `Deposit processed successfully with trading simulation!`,
            deposit: depositRecord.rows[0],
            tradingResult: tradingResult
          });
          
        } else {
          console.error('❌ Live trading simulation failed:', tradingResult.error);
          
          // Fallback to simple deposit without trading simulation
          console.log('⚠️ Falling back to simple deposit without trading simulation');
          return await addDepositDirectly(targetUserId, amount, depositDate, purpose, user.id, targetUser, res);
        }
        
      } catch (tradingError) {
        console.error('💥 Trading simulation error:', tradingError);
        
        // Fallback to simple deposit
        console.log('⚠️ Trading simulation failed, falling back to direct deposit');
        return await addDepositDirectly(targetUserId, amount, depositDate, purpose, user.id, targetUser, res);
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

// ===== TRADING SIMULATION INTEGRATION FUNCTION =====
async function processDepositWithTrading(userId, depositAmount, depositDate) {
  try {
    console.log('🎯 Processing deposit with trading simulation:', { userId, depositAmount, depositDate });
    
    // Get current user info
    const userResult = await sql`
      SELECT current_balance, total_deposits, live_trading_enabled, inception_date
      FROM users 
      WHERE id = ${userId}
    `;
    
    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }
    
    const userInfo = userResult.rows[0];
    const currentBalance = parseFloat(userInfo.current_balance || 0);
    const currentTotalDeposits = parseFloat(userInfo.total_deposits || 0);
    const isFirstDeposit = currentTotalDeposits === 0;
    
    // Record the deposit in user_deposits table
    await sql`
      INSERT INTO user_deposits (
        user_id, deposit_amount, deposit_date, 
        balance_before_deposit, balance_after_deposit, status
      ) VALUES (
        ${userId}, ${depositAmount}, ${depositDate}, 
        ${currentBalance}, ${currentBalance + parseFloat(depositAmount)}, 'completed'
      )
    `;
    
    const newTotalDeposits = currentTotalDeposits + parseFloat(depositAmount);
    
    if (isFirstDeposit) {
      // First deposit - enable live trading and set inception date
      await sql`
        UPDATE users 
        SET 
          live_trading_enabled = true,
          inception_date = ${depositDate},
          starting_balance = ${depositAmount},
          current_balance = ${depositAmount},
          total_deposits = ${newTotalDeposits},
          account_value = ${depositAmount},
          total_return_percent = 0,
          last_backtest_update = ${depositDate},
          updated_at = NOW()
        WHERE id = ${userId}
      `;
      
      console.log('🎯 First deposit - enabling live trading and backfilling from inception');
      
      // Backfill performance from inception date to today
      await backfillUserPerformance(userId, depositDate);
      
      return {
        success: true,
        message: 'First deposit added - live trading enabled and historical performance calculated',
        userId: userId,
        depositAmount: depositAmount,
        depositDate: depositDate,
        inceptionDate: depositDate,
        liveTrading: true
      };
      
    } else {
      // Additional deposit - update totals and recalculate performance
      await sql`
        UPDATE users 
        SET 
          total_deposits = ${newTotalDeposits},
          updated_at = NOW()
        WHERE id = ${userId}
      `;
      
      console.log('💰 Additional deposit - recalculating performance from inception');
      
      // Recalculate performance from original inception date
      await backfillUserPerformance(userId, userInfo.inception_date);
      
      return {
        success: true,
        message: 'Additional deposit added and performance recalculated',
        userId: userId,
        depositAmount: depositAmount,
        depositDate: depositDate,
        newTotalDeposits: newTotalDeposits
      };
    }
    
  } catch (error) {
    console.error('💥 Trading simulation integration failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ===== BACKFILL USER PERFORMANCE FUNCTION =====
async function backfillUserPerformance(userId, inceptionDate) {
  try {
    console.log(`📊 BACKFILLING user ${userId} from inception: ${inceptionDate}`);
    
    // Load historical returns from CSV
    const historicalReturns = await loadHistoricalReturnsCSV();
    
    // Get user deposits chronologically
    const depositsResult = await sql`
      SELECT deposit_amount, deposit_date
      FROM user_deposits
      WHERE user_id = ${userId}
      ORDER BY deposit_date ASC
    `;
    
    const deposits = depositsResult.rows;
    console.log(`💰 Found ${deposits.length} deposits for user`);
    
    // Clear existing performance data
    await sql`DELETE FROM daily_performance WHERE user_id = ${userId}`;
    
    // Process each day from inception to today
    const startDate = new Date(inceptionDate);
    const today = new Date();
    
    let currentBalance = 0;
    let depositIndex = 0;
    
    for (let date = new Date(startDate); date <= today; date.setDate(date.getDate() + 1)) {
      const dateStr = date.toISOString().split('T')[0];
      
      // Apply any deposits for this date
      while (depositIndex < deposits.length && 
             new Date(deposits[depositIndex].deposit_date).toISOString().split('T')[0] === dateStr) {
        
        const depositAmount = parseFloat(deposits[depositIndex].deposit_amount);
        console.log(`💵 Adding deposit: $${depositAmount} on ${dateStr}`);
        currentBalance += depositAmount;
        depositIndex++;
      }
      
      // Skip if no balance yet
      if (currentBalance === 0) continue;
      
      // Get daily return from CSV
      const dailyReturn = historicalReturns[dateStr] || 0;
      
      // Apply return to current balance
      const openingBalance = currentBalance;
      const dailyPnL = openingBalance * (dailyReturn / 100);
      currentBalance = openingBalance + dailyPnL;
      
      // Store daily performance
      await sql`
        INSERT INTO daily_performance (
          user_id, trade_date, daily_return_percent,
          opening_balance, closing_balance, daily_pnl
        ) VALUES (
          ${userId}, ${dateStr}, ${dailyReturn},
          ${openingBalance}, ${currentBalance}, ${dailyPnL}
        )
      `;
      
      if (Math.abs(dailyReturn) > 0.001) { // Only log significant returns
        console.log(`📈 ${dateStr}: ${dailyReturn.toFixed(4)}% → $${currentBalance.toLocaleString()}`);
      }
    }
    
    // Update user's final balance and total return
    const totalDeposits = deposits.reduce((sum, dep) => sum + parseFloat(dep.deposit_amount), 0);
    const totalReturn = totalDeposits > 0 ? ((currentBalance - totalDeposits) / totalDeposits) * 100 : 0;
    
    await sql`
      UPDATE users 
      SET 
        current_balance = ${currentBalance},
        account_value = ${currentBalance},
        total_return_percent = ${totalReturn},
        last_backtest_update = CURRENT_DATE,
        updated_at = NOW()
      WHERE id = ${userId}
    `;
    
    console.log(`✅ BACKFILL COMPLETE: $${totalDeposits.toLocaleString()} deposits → $${currentBalance.toLocaleString()} (${totalReturn.toFixed(2)}% return)`);
    
  } catch (error) {
    console.error('💥 Backfill failed:', error);
    throw error;
  }
}

// ===== LOAD HISTORICAL RETURNS FROM CSV =====
async function loadHistoricalReturnsCSV() {
  try {
    // Try to read from file system (for local/server environment)
    const fs = require('fs');
    const path = require('path');
    
    const csvPath = path.join(process.cwd(), 'data', 'daily_returns_simple.csv');
    
    if (fs.existsSync(csvPath)) {
      const csvContent = fs.readFileSync(csvPath, 'utf8');
      return parseCSVContent(csvContent);
    } else {
      console.log('📊 CSV file not found locally, trying public URL...');
      
      // Try to fetch from public URL (for Vercel deployment)
      const response = await fetch(`${process.env.VERCEL_URL || 'http://localhost:3000'}/data/daily_returns_simple.csv`);
      
      if (response.ok) {
        const csvContent = await response.text();
        return parseCSVContent(csvContent);
      } else {
        throw new Error('CSV file not accessible via URL');
      }
    }
  } catch (error) {
    console.error('💥 Failed to load historical returns CSV:', error);
    console.log('⚠️ Using empty returns data - trading simulation will not apply historical returns');
    return {}; // Return empty object if CSV fails to load
  }
}

// ===== PARSE CSV CONTENT =====
function parseCSVContent(csvContent) {
  try {
    const lines = csvContent.split('\n');
    const returns = {};
    
    // Skip header row
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const values = line.split(',');
      if (values.length >= 2) {
        const date = values[0].trim();
        const dailyReturn = parseFloat(values[1].trim());
        
        if (!isNaN(dailyReturn)) {
          returns[date] = dailyReturn;
        }
      }
    }
    
    console.log(`📊 Loaded ${Object.keys(returns).length} historical daily returns from CSV`);
    return returns;
    
  } catch (error) {
    console.error('💥 Failed to parse CSV content:', error);
    return {};
  }
}

// ===== SIMPLE DEPOSIT FALLBACK FUNCTION =====
async function addDepositDirectly(targetUserId, amount, depositDate, purpose, addedBy, targetUser, res) {
  try {
    console.log('💰 Adding deposit directly (SIMPLE VERSION)');
    
    const reference = 'DEP' + Date.now().toString().slice(-8);
    
    // Insert deposit record
    const depositResult = await sql`
      INSERT INTO deposits (
        id, user_id, reference, amount, currency, purpose,
        status, deposit_date, created_at, client_name, 
        client_email, added_by
      ) VALUES (
        gen_random_uuid(), ${targetUserId}, ${reference}, ${parseFloat(amount)}, 'USD', ${purpose},
        'completed', ${depositDate}::date, NOW(), 
        ${targetUser.first_name + ' ' + targetUser.last_name},
        ${targetUser.email}, ${addedBy}
      )
      RETURNING *
    `;
    
    // Get user's current account values
    const userResult = await sql`
      SELECT account_value, total_deposits FROM users WHERE id = ${targetUserId}
    `;
    
    const currentUser = userResult.rows[0] || {};
    const currentAccountValue = parseFloat(currentUser.account_value || 0);
    const currentTotalDeposits = parseFloat(currentUser.total_deposits || 0);
    
    // Update user's account (simple addition)
    const newAccountValue = currentAccountValue + parseFloat(amount);
    const newTotalDeposits = currentTotalDeposits + parseFloat(amount);
    
    await sql`
      UPDATE users 
      SET 
        account_value = ${newAccountValue},
        total_deposits = ${newTotalDeposits},
        updated_at = NOW()
      WHERE id = ${targetUserId}
    `;
    
    console.log(`✅ Simple deposit complete: $${amount} added, new balance: $${newAccountValue.toLocaleString()}`);
    
    return res.status(200).json({
      success: true,
      message: 'Deposit added successfully',
      deposit: depositResult.rows[0],
      newAccountValue: newAccountValue,
      newTotalDeposits: newTotalDeposits
    });
    
  } catch (error) {
    console.error('💥 Direct deposit failed:', error);
    throw error;
  }
}
