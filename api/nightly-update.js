const { sql } = require('@vercel/postgres');
const { spawn } = require('child_process');
const path = require('path');

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json');
    
    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }
    
    try {
        console.log('🌙 Starting nightly update process...');
        
        const today = new Date().toISOString().split('T')[0];
        const dayOfWeek = new Date().getDay();
        
        // Skip weekends (Saturday = 6, Sunday = 0)
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            console.log('📅 Skipping weekend - no market activity');
            return res.status(200).json({
                success: true,
                message: 'Weekend - no update needed',
                date: today,
                skipped: true
            });
        }
        
        // Calculate today's return using Python script
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
                inception_date, total_deposits, live_trading_enabled
            FROM users 
            WHERE live_trading_enabled = true 
            AND inception_date IS NOT NULL
            AND inception_date <= ${today}
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
                        last_backtest_update = ${today},
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
                    newBalance: newBalance
                });
                
                console.log(`✅ Updated ${user.first_name} ${user.last_name}: ${todayReturn.toFixed(4)}% return`);
                
            } catch (userError) {
                console.error(`💥 Failed to update user ${user.id}:`, userError);
                results.push({
                    userId: user.id,
                    success: false,
                    error: userError.message
                });
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        
        return res.status(200).json({
            success: true,
            message: 'Nightly update completed',
            date: today,
            algorithmReturn: todayReturn,
            totalUsers: users.length,
            successCount: successCount,
            results: results
        });
        
    } catch (error) {
        console.error('💥 Nightly update failed:', error);
        return res.status(500).json({
            success: false,
            error: 'Nightly update failed',
            details: error.message
        });
    }
};

// Calculate daily return from Python script
async function calculateDailyReturnFromPython(date) {
    return new Promise((resolve) => {
        try {
            const scriptPath = path.join(process.cwd(), 'python', 'Consolidated_Backtest_June_2025.py');
            
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
                            console.log(`✅ Python script returned ${dailyReturn.toFixed(4)}% for ${date}`);
                            resolve(dailyReturn);
                        } else {
                            console.error('💥 Python script error:', result.error);
                            resolve(0);
                        }
                    } catch (parseError) {
                        console.error('💥 Failed to parse Python output:', parseError);
                        resolve(0);
                    }
                } else {
                    console.error('💥 Python script failed:', stderr);
                    resolve(0);
                }
            });
            
        } catch (error) {
            console.error('💥 Failed to execute Python script:', error);
            resolve(0);
        }
    });
}
