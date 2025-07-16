// api/admin-recalculate-all.js - COMPLETE FIXED VERSION
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

// ===== LOAD CSV DATA FUNCTION (FIXED) =====
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
        
        // Parse CSV content - GET CUMULATIVE RETURNS (column 3)
        const lines = csvContent.split('\n');
        const csvData = {};
        
        // Skip header row, parse date and CUMULATIVE return (column 3)
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;
            
            const values = line.split(',');
            if (values.length >= 3) {
                const date = values[0].trim();
                const cumulativeReturn = parseFloat(values[2].trim()); // Column 3: Cumulative return
                
                if (!isNaN(cumulativeReturn)) {
                    csvData[date] = cumulativeReturn; // Store as percentage, not decimal
                }
            }
        }
        
        console.log(`📊 Parsed ${Object.keys(csvData).length} trading days from CSV (cumulative returns)`);
        
        // Show sample data for verification
        const sampleDates = ['2025-01-01', '2025-02-14', '2025-07-15'];
        sampleDates.forEach(date => {
            if (csvData[date]) {
                console.log(`📅 ${date}: ${csvData[date].toFixed(2)}% cumulative`);
            }
        });
        
        return csvData;
        
    } catch (error) {
        console.error('💥 Failed to load CSV data:', error);
        console.log('⚠️ Using zero returns - performance calculation will show deposit amounts only');
        return {}; // Return empty object if CSV fails to load
    }
}

// ===== CALCULATE USER PERFORMANCE FUNCTION (FIXED) =====
function calculateUserPerformance(deposits, csvData) {
    console.log('🧮 Calculating user performance from deposits + CSV data (FIXED VERSION)');
    
    let totalBalance = 0;
    let totalDeposits = 0;
    
    // Filter out deposits with null dates and only use completed ones
    const validDeposits = deposits.filter(deposit => {
        const hasValidDate = deposit.deposit_date && deposit.deposit_date !== null;
        if (!hasValidDate) {
            console.log(`⚠️ Skipping deposit with null date: $${deposit.amount}`);
        }
        return hasValidDate;
    });
    
    console.log(`📊 Processing ${validDeposits.length} valid deposits (filtered from ${deposits.length} total)`);
    
    // Sort deposits by date
    const sortedDeposits = validDeposits.sort((a, b) => new Date(a.deposit_date) - new Date(b.deposit_date));
    
    // Get the latest date in CSV for "end" calculation
    const csvDates = Object.keys(csvData).sort();
    const latestCsvDate = csvDates[csvDates.length - 1];
    const latestCumulativeReturn = csvData[latestCsvDate];
    
    console.log(`📅 Using latest CSV date: ${latestCsvDate} (${latestCumulativeReturn?.toFixed(2)}% cumulative)`);
    
    // Process each deposit
    for (const deposit of sortedDeposits) {
        const depositAmount = parseFloat(deposit.amount);
        const depositDate = new Date(deposit.deposit_date);
        const depositDateStr = depositDate.toISOString().split('T')[0];
        
        console.log(`💵 Processing deposit: $${depositAmount.toLocaleString()} on ${depositDateStr}`);
        
        totalDeposits += depositAmount;
        
        // Get cumulative return at deposit date
        const depositCumulativeReturn = csvData[depositDateStr];
        
        if (!depositCumulativeReturn) {
            console.log(`⚠️ No CSV data for deposit date ${depositDateStr}, using deposit amount as-is`);
            totalBalance += depositAmount;
            continue;
        }
        
        // Calculate performance using cumulative returns
        const performanceMultiplier = latestCumulativeReturn / depositCumulativeReturn;
        const currentDepositValue = depositAmount * performanceMultiplier;
        
        console.log(`   📊 Deposit date cumulative: ${depositCumulativeReturn.toFixed(2)}%`);
        console.log(`   📊 Latest cumulative: ${latestCumulativeReturn.toFixed(2)}%`);
        console.log(`   📊 Multiplier: ${performanceMultiplier.toFixed(4)}x`);
        console.log(`   💰 Current value: $${currentDepositValue.toLocaleString()}`);
        
        totalBalance += currentDepositValue;
    }
    
    const totalReturnPercent = totalDeposits > 0 ? ((totalBalance - totalDeposits) / totalDeposits) * 100 : 0;
    
    console.log(`✅ FINAL CALCULATION:`);
    console.log(`   💰 Total deposits: $${totalDeposits.toLocaleString()}`);
    console.log(`   💰 Total balance: $${totalBalance.toLocaleString()}`);
    console.log(`   📈 Total return: ${totalReturnPercent.toFixed(2)}%`);
    
    return {
        totalDeposits,
        currentBalance: totalBalance,
        totalReturnPercent,
        daysTrading: 0 // Not used in this calculation
    };
}
