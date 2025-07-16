// api/admin-recalculate-all.js
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }
    
    try {
        // Check for admin API key authentication
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        
        const token = authHeader.replace('Bearer ', '');
        
        // Check if it's the admin API key from environment
        const adminApiKey = process.env.ADMIN_API_KEY || 'your-secure-admin-key-here';
        
        if (token !== adminApiKey) {
            // Try to verify as JWT token for admin user
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
                if (decoded.role !== 'admin') {
                    return res.status(403).json({ success: false, error: 'Admin access required' });
                }
            } catch (jwtError) {
                return res.status(401).json({ success: false, error: 'Invalid authentication' });
            }
        }
        
        console.log('🔄 ADMIN RECALCULATE ALL: Starting daily client balance updates');
        
        // Get all users with completed deposits
        const usersResult = await sql`
            SELECT DISTINCT u.id, u.first_name, u.last_name, u.email
            FROM users u
            INNER JOIN deposits d ON u.id = d.user_id
            WHERE d.status = 'completed'
            ORDER BY u.first_name, u.last_name
        `;
        
        const users = usersResult.rows;
        console.log(`👥 Found ${users.length} users with deposits to update`);
        
        if (users.length === 0) {
            return res.status(200).json({
                success: true,
                message: 'No users with deposits found',
                updatedUsers: 0
            });
        }
        
        // Load CSV data once for all calculations
        const csvData = await loadCSVData();
        console.log(`📊 Loaded ${Object.keys(csvData).length} trading days from CSV`);
        
        const results = [];
        let successCount = 0;
        let errorCount = 0;
        
        // Update each user's balance
        for (const user of users) {
            try {
                console.log(`💰 Updating ${user.first_name} ${user.last_name} (${user.email})`);
                
                // Get all user's completed deposits
                const depositsResult = await sql`
                    SELECT deposit_date, amount FROM deposits 
                    WHERE user_id = ${user.id} AND status = 'completed'
                    ORDER BY deposit_date ASC
                `;
                
                const userDeposits = depositsResult.rows;
                
                if (userDeposits.length === 0) {
                    console.log(`⚠️ No completed deposits found for ${user.email}`);
                    continue;
                }
                
                // Calculate current performance
                const performanceResult = calculateUserPerformance(userDeposits, csvData);
                
                // Update user's account with new calculated values
                await sql`
                    UPDATE users 
                    SET 
                        account_value = ${performanceResult.currentBalance},
                        total_deposits = ${performanceResult.totalDeposits},
                        total_return_percent = ${performanceResult.totalReturnPercent},
                        updated_at = NOW()
                    WHERE id = ${user.id}
                `;
                
                results.push({
                    userId: user.id,
                    name: `${user.first_name} ${user.last_name}`,
                    email: user.email,
                    success: true,
                    totalDeposits: performanceResult.totalDeposits,
                    currentBalance: performanceResult.currentBalance,
                    totalReturn: performanceResult.totalReturnPercent,
                    profit: performanceResult.currentBalance - performanceResult.totalDeposits
                });
                
                successCount++;
                console.log(`✅ Updated ${user.first_name}: $${performanceResult.totalDeposits.toLocaleString()} → $${performanceResult.currentBalance.toLocaleString()} (${performanceResult.totalReturnPercent.toFixed(2)}%)`);
                
            } catch (userError) {
                console.error(`💥 Failed to update ${user.email}:`, userError);
                
                results.push({
                    userId: user.id,
                    name: `${user.first_name} ${user.last_name}`,
                    email: user.email,
                    success: false,
                    error: userError.message
                });
                
                errorCount++;
            }
        }
        
        console.log(`✅ RECALCULATE COMPLETE: ${successCount} successful, ${errorCount} failed`);
        
        return res.status(200).json({
            success: true,
            message: 'Client balance recalculation completed',
            timestamp: new Date().toISOString(),
            totalUsers: users.length,
            successCount: successCount,
            errorCount: errorCount,
            results: results
        });
        
    } catch (error) {
        console.error('💥 Admin recalculate all failed:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            details: error.message
        });
    }
};

// ===== LOAD CSV DATA FUNCTION =====
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

// ===== CALCULATE USER PERFORMANCE FUNCTION =====
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
