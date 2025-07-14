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
            const { action, userId: targetUserId, startingBalance, inceptionDate, liveTrading, depositAmount, depositDate } = req.body;
            
            if (action === 'create_simulation_account' && isAdmin) {
                return await createSimulationAccount(targetUserId, startingBalance, inceptionDate, liveTrading);
            } else if (action === 'add_deposit' && isAdmin) {
                return await addUserDeposit(targetUserId, depositAmount, depositDate);
            } else if (action === 'run_daily_update' && isAdmin) {
                return await runDailyUpdateForAllUsers();
            } else if (action === 'update_client_profile' && isAdmin) {
                return await updateClientProfile(req.body);
            }
        }
        
        if (req.method === 'GET') {
            const { action, userId: targetUserId } = req.query;
            
            if (action === 'get_user_performance') {
                return await getUserPerformance(targetUserId || userId);
            } else if (action === 'get_user_deposits') {
                return await getUserDeposits(targetUserId || userId);
            } else if (action === 'get_simulation_status' && isAdmin) {
                return await getSimulationStatus();
            }
        }
        
        return res.status(405).json({ success: false, error: 'Method not allowed' });

    } catch (error) {
        console.error('💥 Live Trading API error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
    
    // ===================================================================
    // CREATE SIMULATION ACCOUNT
    // ===================================================================
    async function createSimulationAccount(userId, startingBalance, inceptionDate, liveTrading) {
        try {
            console.log('🎯 Creating simulation account:', { userId, startingBalance, inceptionDate, liveTrading });
            
            // Update user with simulation settings
            await sql`
                UPDATE users 
                SET 
                    starting_balance = ${startingBalance},
                    inception_date = ${inceptionDate},
                    live_trading_enabled = ${liveTrading},
                    current_balance = ${startingBalance},
                    total_deposits = ${startingBalance},
                    account_value = ${startingBalance},
                    total_return_percent = 0,
                    last_backtest_update = ${inceptionDate},
                    updated_at = NOW()
                WHERE id = ${userId}
            `;
            
            // Record initial deposit
            await sql`
                INSERT INTO user_deposits (
                    user_id, deposit_amount, deposit_date, 
                    balance_before_deposit, balance_after_deposit, status
                ) VALUES (
                    ${userId}, ${startingBalance}, ${inceptionDate}, 
                    0, ${startingBalance}, 'completed'
                )
            `;
            
            // If live trading enabled, backfill performance from inception to today
            if (liveTrading) {
                await backfillUserPerformance(userId, inceptionDate);
            }
            
            return res.status(200).json({
                success: true,
                message: 'Simulation account created successfully',
                userId: userId,
                startingBalance: startingBalance,
                inceptionDate: inceptionDate,
                liveTrading: liveTrading
            });
            
        } catch (error) {
            console.error('💥 Failed to create simulation account:', error);
            throw error;
        }
    }
    
    // ===================================================================
    // ADD USER DEPOSIT
    // ===================================================================
    async function addUserDeposit(userId, depositAmount, depositDate) {
        try {
            console.log('💰 Adding user deposit:', { userId, depositAmount, depositDate });
            
            // Get current user balance
            const userResult = await sql`
                SELECT current_balance, total_deposits, live_trading_enabled, inception_date
                FROM users 
                WHERE id = ${userId}
            `;
            
            if (userResult.rows.length === 0) {
                throw new Error('User not found');
            }
            
            const user = userResult.rows[0];
            const currentBalance = parseFloat(user.current_balance);
            const newTotalDeposits = parseFloat(user.total_deposits) + parseFloat(depositAmount);
            
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
            
            // Update user's total deposits
            await sql`
                UPDATE users 
                SET 
                    total_deposits = ${newTotalDeposits},
                    updated_at = NOW()
                WHERE id = ${userId}
            `;
            
            // If live trading enabled, recalculate performance from inception
            if (user.live_trading_enabled) {
                await backfillUserPerformance(userId, user.inception_date);
            }
            
            return res.status(200).json({
                success: true,
                message: 'Deposit added successfully',
                userId: userId,
                depositAmount: depositAmount,
                depositDate: depositDate,
                newTotalDeposits: newTotalDeposits
            });
            
        } catch (error) {
            console.error('💥 Failed to add user deposit:', error);
            throw error;
        }
    }
    
    // ===================================================================
    // BACKFILL USER PERFORMANCE
    // ===================================================================
    async function backfillUserPerformance(userId, inceptionDate) {
        try {
            console.log('📊 BACKFILLING performance for user:', userId, 'from:', inceptionDate);
            
            // Get all user's deposits chronologically
            const depositsResult = await sql`
                SELECT deposit_amount, deposit_date
                FROM user_deposits
                WHERE user_id = ${userId}
                ORDER BY deposit_date ASC
            `;
            
            const deposits = depositsResult.rows;
            console.log('💰 Found deposits:', deposits.map(d => `$${d.deposit_amount} on ${d.deposit_date}`));
            
            // Clear existing performance data
            await sql`
                DELETE FROM daily_performance WHERE user_id = ${userId}
            `;
            
            // Get date range from inception to today
            const startDate = new Date(inceptionDate);
            const endDate = new Date();
            
            let currentBalance = 0;
            let depositIndex = 0;
            
            // Process each day from inception to today
            for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
                const dateStr = date.toISOString().split('T')[0];
                
                // Check if there's a deposit on this date
                while (depositIndex < deposits.length && 
                       new Date(deposits[depositIndex].deposit_date).toISOString().split('T')[0] === dateStr) {
                    
                    const depositAmount = parseFloat(deposits[depositIndex].deposit_amount);
                    console.log(`💵 Processing deposit: $${depositAmount} on ${dateStr}`);
                    currentBalance += depositAmount;
                    depositIndex++;
                }
                
                // Skip if no balance yet
                if (currentBalance === 0) continue;
                
                // Get daily return for this date
                const dailyReturn = await calculateDailyReturnFromPython(dateStr);
                
                // Apply daily return
                const openingBalance = currentBalance;
                const dailyPnL = openingBalance * (dailyReturn / 100);
                currentBalance = openingBalance + dailyPnL;
                
                // Store daily performance record
                await sql`
                    INSERT INTO daily_performance (
                        user_id, trade_date, daily_return_percent,
                        opening_balance, closing_balance, daily_pnl
                    ) VALUES (
                        ${userId}, ${dateStr}, ${dailyReturn},
                        ${openingBalance}, ${currentBalance}, ${dailyPnL}
                    )
                `;
                
                // Log progress for significant changes
                if (dailyReturn !== 0 && openingBalance > 0) {
                    console.log(`📈 ${dateStr}: ${dailyReturn.toFixed(4)}% return, $${openingBalance.toFixed(2)} → $${currentBalance.toFixed(2)}`);
                }
            }
            
            // Update user's current balance and total return
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
            
            console.log('✅ BACKFILL COMPLETED for user:', userId);
            console.log(`📊 Final Results: $${totalDeposits.toLocaleString()} deposits → $${currentBalance.toLocaleString()} balance (${totalReturn.toFixed(2)}% return)`);
            
        } catch (error) {
            console.error('💥 Failed to backfill user performance:', error);
            throw error;
        }
    }
    
    // ===================================================================
    // CALCULATE DAILY RETURN FROM PYTHON
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
            
            // Get today's algorithm return
            const todayReturn = await calculateDailyReturnFromPython(today);
            
            // Store algorithm return for today
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
            console.log(`📊 Found ${users.length} users with live trading enabled`);
            
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
    
    // ===================================================================
    // UPDATE CLIENT PROFILE
    // ===================================================================
    async function updateClientProfile(data) {
        try {
            const { userId, firstName, lastName, email, phone, address, status } = data;
            
            await sql`
                UPDATE users 
                SET 
                    first_name = ${firstName},
                    last_name = ${lastName},
                    email = ${email},
                    phone = ${phone},
                    address = ${address},
                    status = ${status},
                    updated_at = NOW()
                WHERE id = ${userId}
            `;
            
            return res.status(200).json({
                success: true,
                message: 'Client profile updated successfully',
                userId: userId
            });
            
        } catch (error) {
            console.error('💥 Failed to update client profile:', error);
            throw error;
        }
    }
    
    // ===================================================================
    // GET SIMULATION STATUS
    // ===================================================================
    async function getSimulationStatus() {
        try {
            const statsResult = await sql`
                SELECT 
                    COUNT(*) as total_users,
                    COUNT(CASE WHEN live_trading_enabled = true THEN 1 END) as live_trading_users,
                    SUM(CASE WHEN live_trading_enabled = true THEN current_balance ELSE 0 END) as total_aum,
                    SUM(CASE WHEN live_trading_enabled = true THEN total_deposits ELSE 0 END) as total_deposits
                FROM users
            `;
            
            const recentPerformanceResult = await sql`
                SELECT 
                    trade_date, 
                    AVG(daily_return_percent) as avg_return,
                    COUNT(*) as users_count
                FROM daily_performance
                WHERE trade_date >= CURRENT_DATE - INTERVAL '7 days'
                GROUP BY trade_date
                ORDER BY trade_date DESC
            `;
            
            return res.status(200).json({
                success: true,
                stats: statsResult.rows[0],
                recentPerformance: recentPerformanceResult.rows
            });
            
        } catch (error) {
            console.error('💥 Failed to get simulation status:', error);
            throw error;
        }
    }
};
