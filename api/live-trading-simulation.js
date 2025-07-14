const { sql } = require('@vercel/postgres');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const path = require('path');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    try {
        // Verify authentication
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        
        const token = authHeader.replace('Bearer ', '');
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
        } catch (jwtError) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }
        
        const isAdmin = decoded.role === 'admin';
        const userId = decoded.id;

        if (req.method === 'POST') {
            const { action, userId: targetUserId, depositAmount, depositDate } = req.body;
            
            if (action === 'add_deposit' && isAdmin) {
                return await addUserDeposit(targetUserId, depositAmount, depositDate);
            } else if (action === 'run_daily_update' && isAdmin) {
                return await runDailyUpdateForAllUsers();
            }
        }
        
        if (req.method === 'GET') {
            const { action, userId: targetUserId } = req.query;
            
            if (action === 'get_user_performance') {
                return await getUserPerformance(targetUserId || userId);
            } else if (action === 'get_user_deposits') {
                return await getUserDeposits(targetUserId || userId);
            }
        }
        
        return res.status(405).json({ success: false, error: 'Method not allowed' });

    } catch (error) {
        console.error('💥 Live Trading API error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
    
    // ===================================================================
    // ADD USER DEPOSIT (First deposit enables live trading)
    // ===================================================================
    async function addUserDeposit(userId, depositAmount, depositDate) {
        try {
            console.log('💰 Adding user deposit:', { userId, depositAmount, depositDate });
            
            // Get current user info
            const userResult = await sql`
                SELECT current_balance, total_deposits, live_trading_enabled, inception_date
                FROM users 
                WHERE id = ${userId}
            `;
            
            if (userResult.rows.length === 0) {
                throw new Error('User not found');
            }
            
            const user = userResult.rows[0];
            const currentBalance = parseFloat(user.current_balance || 0);
            const currentTotalDeposits = parseFloat(user.total_deposits || 0);
            const isFirstDeposit = currentTotalDeposits === 0;
            
            // Record the deposit
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
                
                return res.status(200).json({
                    success: true,
                    message: 'First deposit added - live trading enabled and historical performance calculated',
                    userId: userId,
                    depositAmount: depositAmount,
                    depositDate: depositDate,
                    inceptionDate: depositDate,
                    liveTrading: true
                });
                
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
                await backfillUserPerformance(userId, user.inception_date);
                
                return res.status(200).json({
                    success: true,
                    message: 'Additional deposit added and performance recalculated',
                    userId: userId,
                    depositAmount: depositAmount,
                    depositDate: depositDate,
                    newTotalDeposits: newTotalDeposits
                });
            }
            
        } catch (error) {
            console.error('💥 Failed to add user deposit:', error);
            throw error;
        }
    }
    
    // ===================================================================
    // BACKFILL USER PERFORMANCE (Using Historical CSV + Live Python)
    // ===================================================================
    async function backfillUserPerformance(userId, inceptionDate) {
        try {
            console.log(`📊 BACKFILLING user ${userId} from inception: ${inceptionDate}`);
            
            // Load historical returns from CSV (INSTANT!)
            const historicalReturns = await loadHistoricalReturnsCSV();
            
            // Get user deposits chronologically
            const depositsResult = await sql`
                SELECT deposit_amount, deposit_date
                FROM user_deposits
                WHERE user_id = ${userId}
                ORDER BY deposit_date ASC
            `;
            
            const deposits = depositsResult.rows;
            console.log(`💰 Found deposits:`, deposits.map(d => `$${d.deposit_amount} on ${d.deposit_date}`));
            
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
                
                // Get daily return (from CSV for historical, Python for today)
                let dailyReturn;
                if (dateStr === today.toISOString().split('T')[0]) {
                    // Today - run Python script
                    dailyReturn = await calculateDailyReturnFromPython(dateStr);
                    
                    // Append today's return to CSV for future use
                    await appendTodaysReturnToCSV(dateStr, dailyReturn);
                } else {
                    // Historical - use CSV data (INSTANT!)
                    dailyReturn = historicalReturns[dateStr] || 0;
                }
                
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
                
                if (dailyReturn !== 0) {
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
    
    // ===================================================================
    // LOAD HISTORICAL RETURNS FROM CSV
    // ===================================================================
    async function loadHistoricalReturnsCSV() {
        const fs = require('fs');
        const path = require('path');
        
        try {
            const csvPath = path.join(process.cwd(), 'data', 'daily_returns_simple.csv');
            const csvContent = fs.readFileSync(csvPath, 'utf8');
            
            // Parse CSV manually (simple parsing)
            const lines = csvContent.split('\n');
            
            const returns = {};
            
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
            console.error('💥 Failed to load historical returns CSV:', error);
            return {}; // Return empty object if CSV fails to load
        }
    }
    
    // ===================================================================
    // APPEND TODAY'S RETURN TO CSV
    // ===================================================================
    async function appendTodaysReturnToCSV(date, dailyReturn) {
        const fs = require('fs');
        const path = require('path');
        
        try {
            const csvPath = path.join(process.cwd(), 'data', 'daily_returns_simple.csv');
            
            // Read existing CSV to get last cumulative return
            const csvContent = fs.readFileSync(csvPath, 'utf8');
            const lines = csvContent.split('\n');
            
            let lastCumulativeReturn = 0;
            
            // Find the last valid cumulative return
            for (let i = lines.length - 1; i >= 1; i--) {
                const line = lines[i].trim();
                if (line) {
                    const values = line.split(',');
                    if (values.length >= 3) {
                        lastCumulativeReturn = parseFloat(values[2]);
                        break;
                    }
                }
            }
            
            // Calculate new cumulative return: ADD daily to previous cumulative
            const newCumulativeReturn = lastCumulativeReturn + dailyReturn;
            
            const newRow = `\n${date},${dailyReturn.toFixed(6)},${newCumulativeReturn.toFixed(6)}`;
            
            fs.appendFileSync(csvPath, newRow);
            console.log(`📊 CSV updated: ${date} = ${dailyReturn.toFixed(4)}% daily, ${newCumulativeReturn.toFixed(4)}% cumulative`);
            
        } catch (error) {
            console.error('💥 Failed to append to CSV:', error);
            throw error;
        }
    }
    // ===================================================================
    // CALCULATE DAILY RETURN FROM PYTHON SCRIPT
    // ===================================================================
    async function calculateDailyReturnFromPython(date) {
        return new Promise((resolve, reject) => {
            try {
                console.log('🐍 Calculating daily return for date:', date);
                
                // Path to your Python script
                const scriptPath = path.join(process.cwd(), 'python', 'Consolidated_Backtest_June_2025.py');
                
                // Execute your Python script
                const pythonProcess = spawn('python3', [
                    scriptPath,
                    '--from-date', date,
                    '--to-date', date,
                    '--starting-balance', '100000',
                    '--output-format', 'json'
                ]);
                
                let stdout = '';
                let stderr = '';
                
                pythonProcess.stdout.on('data', (data) => {
                    stdout += data.toString();
                });
                
                pythonProcess.stderr.on('data', (data) => {
                    stderr += data.toString();
                });
                
                pythonProcess.on('close', (code) => {
                    if (code === 0) {
                        try {
                            const result = JSON.parse(stdout);
                            
                            if (result.success) {
                                const dailyReturn = parseFloat(result.daily_return_percent || 0);
                                console.log(`✅ Daily return for ${date}: ${dailyReturn.toFixed(4)}%`);
                                resolve(dailyReturn);
                            } else {
                                console.error('💥 Python script returned error:', result.error);
                                resolve(0);
                            }
                            
                        } catch (parseError) {
                            console.error('💥 Failed to parse Python output:', parseError);
                            console.error('Raw output:', stdout);
                            resolve(0);
                        }
                    } else {
                        console.error('💥 Python script failed with code:', code);
                        console.error('Error output:', stderr);
                        resolve(0);
                    }
                });
                
            } catch (error) {
                console.error('💥 Failed to execute Python script:', error);
                resolve(0);
            }
        });
    }
    
    // ===================================================================
    // DAILY UPDATE FOR ALL USERS
    // ===================================================================
    async function runDailyUpdateForAllUsers() {
        try {
            console.log('🔄 Running daily update for all live trading users...');
            
            const today = new Date().toISOString().split('T')[0];
            const dayOfWeek = new Date().getDay();
            
            // Skip weekends
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                return res.status(200).json({
                    success: true,
                    message: 'Weekend - no update needed',
                    skipped: true
                });
            }
            
            // Get today's algorithm return from Python script
            const todayReturn = await calculateDailyReturnFromPython(today);
            
            // Append to historical CSV for future use
            await appendTodaysReturnToCSV(today, todayReturn);
            
            // Store algorithm return in database
            await sql`
                INSERT INTO algorithm_daily_returns (
                    trade_date, daily_return_percent
                ) VALUES (
                    ${today}, ${todayReturn}
                )
                ON CONFLICT (trade_date) 
                DO UPDATE SET daily_return_percent = EXCLUDED.daily_return_percent
            `;
            
            // Get all users with live trading enabled
            const usersResult = await sql`
                SELECT 
                    id, first_name, last_name, current_balance, 
                    inception_date, total_deposits
                FROM users 
                WHERE live_trading_enabled = true 
                AND inception_date IS NOT NULL
                AND inception_date <= CURRENT_DATE
                ORDER BY id
            `;
            
            const users = usersResult.rows;
            console.log(`👥 Found ${users.length} users with live trading enabled`);
            
            const results = [];
            
            for (const user of users) {
                try {
                    const userId = user.id;
                    const currentBalance = parseFloat(user.current_balance);
                    
                    // Apply today's return
                    const dailyPnL = currentBalance * (todayReturn / 100);
                    const newBalance = currentBalance + dailyPnL;
                    
                    // Update user balance
                    await sql`
                        UPDATE users 
                        SET 
                            current_balance = ${newBalance},
                            account_value = ${newBalance},
                            last_backtest_update = CURRENT_DATE,
                            updated_at = NOW()
                        WHERE id = ${userId}
                    `;
                    
                    // Record daily performance
                    await sql`
                        INSERT INTO daily_performance (
                            user_id, trade_date, daily_return_percent,
                            opening_balance, closing_balance, daily_pnl
                        ) VALUES (
                            ${userId}, ${today}, ${todayReturn},
                            ${currentBalance}, ${newBalance}, ${dailyPnL}
                        )
                        ON CONFLICT (user_id, trade_date) 
                        DO UPDATE SET 
                            daily_return_percent = EXCLUDED.daily_return_percent,
                            opening_balance = EXCLUDED.opening_balance,
                            closing_balance = EXCLUDED.closing_balance,
                            daily_pnl = EXCLUDED.daily_pnl
                    `;
                    
                    // Calculate total return percentage
                    const totalDeposits = parseFloat(user.total_deposits);
                    const totalReturn = totalDeposits > 0 ? ((newBalance - totalDeposits) / totalDeposits) * 100 : 0;
                    
                    await sql`
                        UPDATE users 
                        SET total_return_percent = ${totalReturn}
                        WHERE id = ${userId}
                    `;
                    
                    results.push({
                        userId: userId,
                        name: `${user.first_name} ${user.last_name}`,
                        success: true,
                        dailyReturn: todayReturn,
                        dailyPnL: dailyPnL,
                        newBalance: newBalance,
                        totalReturn: totalReturn
                    });
                    
                    console.log(`✅ Updated ${user.first_name} ${user.last_name}: ${todayReturn.toFixed(4)}% return, $${dailyPnL.toFixed(2)} P&L`);
                    
                } catch (userError) {
                    console.error(`💥 Failed to update user ${user.id}:`, userError);
                    results.push({
                        userId: user.id,
                        name: `${user.first_name} ${user.last_name}`,
                        success: false,
                        error: userError.message
                    });
                }
            }
            
            const successCount = results.filter(r => r.success).length;
            const failCount = results.filter(r => !r.success).length;
            
            console.log(`✅ Daily update completed: ${successCount} successful, ${failCount} failed`);
            
            return res.status(200).json({
                success: true,
                message: 'Daily update completed',
                date: today,
                algorithmReturn: todayReturn,
                totalUsers: users.length,
                successCount: successCount,
                failCount: failCount,
                results: results
            });
            
        } catch (error) {
            console.error('💥 Daily update failed:', error);
            throw error;
        }
    }
    
    // ===================================================================
    // GET USER PERFORMANCE
    // ===================================================================
    async function getUserPerformance(userId) {
        try {
            console.log('📈 Getting user performance for:', userId);
            
            // Get user's basic info
            const userResult = await sql`
                SELECT 
                    current_balance, total_deposits, total_return_percent,
                    starting_balance, inception_date, live_trading_enabled
                FROM users 
                WHERE id = ${userId}
            `;
            
            if (userResult.rows.length === 0) {
                return res.status(404).json({ success: false, error: 'User not found' });
            }
            
            const user = userResult.rows[0];
            
            // Get daily performance data
            const performanceResult = await sql`
                SELECT 
                    trade_date, daily_return_percent, opening_balance,
                    closing_balance, daily_pnl
                FROM daily_performance
                WHERE user_id = ${userId}
                ORDER BY trade_date ASC
            `;
            
            // Get deposit history
            const depositsResult = await sql`
                SELECT deposit_amount, deposit_date, status
                FROM user_deposits
                WHERE user_id = ${userId}
                ORDER BY deposit_date ASC
            `;
            
            console.log(`✅ Found ${performanceResult.rows.length} performance records for user ${userId}`);
            
            return res.status(200).json({
                success: true,
                user: user,
                performance: performanceResult.rows,
                deposits: depositsResult.rows
            });
            
        } catch (error) {
            console.error('💥 Failed to get user performance:', error);
            throw error;
        }
    }
    
    // ===================================================================
    // GET USER DEPOSITS
    // ===================================================================
    async function getUserDeposits(userId) {
        try {
            const depositsResult = await sql`
                SELECT 
                    deposit_amount, deposit_date, balance_before_deposit,
                    balance_after_deposit, status, created_at
                FROM user_deposits
                WHERE user_id = ${userId}
                ORDER BY deposit_date DESC
            `;
            
            return res.status(200).json({
                success: true,
                userId: userId,
                deposits: depositsResult.rows
            });
            
        } catch (error) {
            console.error('💥 Failed to get user deposits:', error);
            throw error;
        }
    }
};
