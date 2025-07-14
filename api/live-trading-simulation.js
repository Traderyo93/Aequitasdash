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
    
    try {
        // Verify authentication
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        
        const token = authHeader.replace('Bearer ', '');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
        
        if (req.method === 'GET') {
            const { action } = req.query;
            const userId = decoded.id;
            
            if (action === 'get_user_performance') {
                return await getUserPerformance(userId);
            }
        }
        
        if (req.method === 'POST') {
            const { action } = req.body;
            const userId = decoded.id;
            
            if (action === 'create_sample_data') {
                return await createSampleData(userId);
            }
        }
        
        return res.status(405).json({ success: false, error: 'Method not allowed' });

    } catch (error) {
        console.error('Live Trading API error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
    
    async function getUserPerformance(userId) {
        try {
            console.log('Getting performance for user:', userId);
            
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
            
            console.log(`Found ${performanceResult.rows.length} performance records for user ${userId}`);
            
            return res.status(200).json({
                success: true,
                user: user,
                performance: performanceResult.rows,
                deposits: depositsResult.rows
            });
            
        } catch (error) {
            console.error('Failed to get user performance:', error);
            return res.status(500).json({ success: false, error: 'Failed to get performance data' });
        }
    }
    
    async function createSampleData(userId) {
        try {
            console.log('Creating sample data for user:', userId);
            
            // Clear existing data
            await sql`DELETE FROM daily_performance WHERE user_id = ${userId}`;
            await sql`DELETE FROM user_deposits WHERE user_id = ${userId}`;
            
            // Add sample deposits
            await sql`
                INSERT INTO user_deposits (user_id, deposit_amount, deposit_date, balance_before_deposit, balance_after_deposit)
                VALUES 
                (${userId}, 100000, '2024-01-01', 0, 100000),
                (${userId}, 50000, '2024-04-15', 125000, 175000)
            `;
            
            // Generate sample performance data
            const startDate = new Date('2024-01-01');
            const endDate = new Date();
            let balance = 100000;
            
            for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
                // Skip weekends
                if (date.getDay() === 0 || date.getDay() === 6) continue;
                
                const dateStr = date.toISOString().split('T')[0];
                
                // Add deposit on April 15th
                if (dateStr === '2024-04-15') {
                    balance += 50000;
                }
                
                // Generate realistic daily return
                const dailyReturn = (Math.random() - 0.45) * 2; // -0.9% to +1.1%
                const openingBalance = balance;
                const dailyPnL = balance * (dailyReturn / 100);
                balance += dailyPnL;
                
                // Ensure balance doesn't go too low
                balance = Math.max(balance, 50000);
                
                await sql`
                    INSERT INTO daily_performance (
                        user_id, trade_date, daily_return_percent, 
                        opening_balance, closing_balance, daily_pnl
                    ) VALUES (
                        ${userId}, ${dateStr}, ${dailyReturn},
                        ${openingBalance}, ${balance}, ${dailyPnL}
                    )
                `;
            }
            
            // Update user record
            const totalDeposits = 150000;
            const totalReturn = ((balance - totalDeposits) / totalDeposits) * 100;
            
            await sql`
                UPDATE users 
                SET 
                    current_balance = ${balance},
                    total_deposits = ${totalDeposits},
                    total_return_percent = ${totalReturn},
                    live_trading_enabled = true,
                    inception_date = '2024-01-01',
                    starting_balance = 100000
                WHERE id = ${userId}
            `;
            
            console.log(`Sample data created for user ${userId}. Final balance: ${balance}`);
            
            return res.status(200).json({ 
                success: true, 
                message: 'Sample data created',
                finalBalance: balance,
                totalReturn: totalReturn.toFixed(2)
            });
            
        } catch (error) {
            console.error('Failed to create sample data:', error);
            return res.status(500).json({ success: false, error: 'Failed to create sample data' });
        }
    }
};
