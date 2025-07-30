// api/admin-stats.js - COMPLETELY FIXED VERSION (NO CACHE)
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');

// Load CSV data with cumulative returns (NO CACHE)
async function loadCSVData() {
  try {
    const response = await fetch(`/data/daily_returns_simple.csv?v=${Date.now()}`);
    if (!response.ok) {
      throw new Error('CSV file not accessible');
    }
    
    const csvContent = await response.text();
    const lines = csvContent.split('\n');
    const csvData = {};
    
    // Skip header row, parse date and CUMULATIVE return (column 3)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const values = line.split(',');
      if (values.length >= 3) {
        const date = values[0].trim();
        const cumulativeReturn = parseFloat(values[2].trim()); // Column 3: Cumulative_Return_Percent
        
        if (!isNaN(cumulativeReturn)) {
          csvData[date] = cumulativeReturn; // Store as percentage
        }
      }
    }
    
    console.log(`📊 Loaded ${Object.keys(csvData).length} trading days from CSV (cumulative returns)`);
    
    return csvData;
  } catch (error) {
    console.error('💥 Failed to load CSV data:', error);
    return {};
  }
}

// Calculate account performance using cumulative returns - FIXED CALCULATION
function calculateAccountPerformance(deposits, csvData) {
  console.log('🧮 Calculating performance with FIXED CUMULATIVE returns logic');
  
  const endDate = new Date();
  let totalDeposits = 0;
  let finalBalance = 0;
  
  // Sort deposits chronologically
  const sortedDeposits = deposits.sort((a, b) => {
    const dateA = new Date(a.deposit_date || a.created_at);
    const dateB = new Date(b.deposit_date || b.created_at);
    return dateA - dateB;
  });
  
  // Process each deposit separately
  for (const deposit of sortedDeposits) {
    const depositAmount = parseFloat(deposit.amount);
    const depositDate = new Date(deposit.deposit_date || deposit.created_at);
    const depositDateStr = depositDate.toISOString().split('T')[0];
    
    totalDeposits += depositAmount;
    
    // Get cumulative return at deposit date (baseline)
    const startCumulative = csvData[depositDateStr];
    if (!startCumulative) {
      console.log(`⚠️ No CSV data for deposit date ${depositDateStr}, using deposit amount as-is`);
      finalBalance += depositAmount;
      continue;
    }
    
    // Get cumulative return at end date
    const endDateStr = endDate.toISOString().split('T')[0];
    let endCumulative = csvData[endDateStr];
    
    // If no data for exact end date, find the latest available date
    if (!endCumulative) {
      const availableDates = Object.keys(csvData).sort().reverse();
      const latestDate = availableDates.find(date => date <= endDateStr);
      if (latestDate) {
        endCumulative = csvData[latestDate];
        console.log(`📅 Using latest available date ${latestDate} for end calculation`);
      } else {
        endCumulative = startCumulative; // No growth if no data
      }
    }
    
    // ===== FIXED CALCULATION =====
    // Convert percentages to actual multipliers
    const depositMultiplier = (100 + startCumulative) / 100;  // e.g., 147.84/100 = 1.4784
    const currentMultiplier = (100 + endCumulative) / 100;    // e.g., 265.82/100 = 2.6582
    const performanceMultiplier = currentMultiplier / depositMultiplier; // e.g., 2.6582/1.4784 = 1.798
    const currentDepositValue = depositAmount * performanceMultiplier;
    
    console.log(`💰 Deposit $${depositAmount.toLocaleString()} on ${depositDateStr}:`);
    console.log(`   📊 Cumulative: ${startCumulative.toFixed(2)}% → ${endCumulative.toFixed(2)}%`);
    console.log(`   📊 Deposit multiplier: ${depositMultiplier.toFixed(4)}x`);
    console.log(`   📊 Current multiplier: ${currentMultiplier.toFixed(4)}x`);
    console.log(`   📈 Performance multiplier: ${performanceMultiplier.toFixed(4)}x`);
    console.log(`   💵 Value: $${currentDepositValue.toLocaleString()}`);
    
    finalBalance += currentDepositValue;
  }
  
  return {
    totalDeposits,
    currentBalance: finalBalance
  };
}

module.exports = async function handler(req, res) {
  // Set CORS headers first
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  
  try {
    // Verify admin authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    const token = authHeader.replace('Bearer ', '');
    
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
    } catch (jwtError) {
      console.error('JWT verification failed:', jwtError.message);
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }
    
    // Verify admin role
    if (decoded.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }

    console.log('📊 Admin stats request from:', decoded.email);
    
    // Load CSV data for performance calculations
    const csvData = await loadCSVData();
    
    // 1. TOTAL APPROVED CLIENTS - ONLY role = 'client' AND status = 'active'
    let totalClients = 0;
    try {
      const totalClientsResult = await sql`
        SELECT COUNT(*) as count
        FROM users 
        WHERE role = 'client' AND status = 'active'
      `;
      totalClients = parseInt(totalClientsResult.rows[0].count) || 0;
      console.log('📊 Total active clients:', totalClients);
    } catch (clientCountError) {
      console.log('📊 Client count error:', clientCountError.message);
      totalClients = 0;
    }
    
    // 2. ACTIVE DEPOSITS THIS MONTH
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    
    let activeDepositsThisMonth = 0;
    try {
      const activeDepositsResult = await sql`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM deposits 
        WHERE status IN ('approved', 'completed')
        AND EXTRACT(MONTH FROM created_at) = ${currentMonth}
        AND EXTRACT(YEAR FROM created_at) = ${currentYear}
      `;
      activeDepositsThisMonth = parseFloat(activeDepositsResult.rows[0].total || 0);
      console.log('📊 Deposits this month:', activeDepositsThisMonth);
    } catch (depositError) {
      console.log('📊 No deposits table yet, using 0');
      activeDepositsThisMonth = 0;
    }
    
    // 3. PENDING REQUESTS - ONLY role = 'pending'
    let pendingRequests = 0;
    
    // Count ONLY pending users (not clients with pending setup_status)
    try {
      const pendingUsersResult = await sql`
        SELECT COUNT(*) as count
        FROM users 
        WHERE role = 'pending'
      `;
      pendingRequests += parseInt(pendingUsersResult.rows[0].count) || 0;
      console.log('📊 Pending users:', pendingRequests);
    } catch (pendingUserError) {
      console.log('📊 Could not count pending users:', pendingUserError.message);
    }
    
    // Count pending deposits
    try {
      const pendingDepositsResult = await sql`
        SELECT COUNT(*) as count
        FROM deposits 
        WHERE status = 'pending'
      `;
      const pendingDeposits = parseInt(pendingDepositsResult.rows[0].count) || 0;
      pendingRequests += pendingDeposits;
      console.log('📊 Pending deposits:', pendingDeposits);
    } catch (depositError) {
      console.log('📊 No deposits table yet for pending count');
    }
    
    // 4. ALL CLIENTS - ONLY show role = 'client' AND status = 'active'
    let allClientsResult;
    try {
      allClientsResult = await sql`
        SELECT 
          id, email, first_name, last_name, phone, address, 
          account_value, starting_balance, created_at, last_login, 
          role, status, setup_status
        FROM users 
        WHERE role = 'client' AND status = 'active'
        ORDER BY created_at DESC
      `;
      console.log('📊 Found active clients:', allClientsResult.rows.length);
    } catch (clientQueryError) {
      console.log('📊 Error fetching clients:', clientQueryError.message);
      allClientsResult = { rows: [] };
    }
    
    // 5. ALL DEPOSITS - FIXED: Show ALL deposits regardless of user role/status
    let allDepositsResult = { rows: [] };
    try {
      allDepositsResult = await sql`
        SELECT 
          d.id, d.user_id, d.reference, d.amount, d.purpose, d.status, 
          d.created_at, d.approved_at, d.approved_by, d.deposit_date,
          d.client_name, d.client_email,
          u.first_name, u.last_name, u.email
        FROM deposits d
        LEFT JOIN users u ON d.user_id = u.id
        ORDER BY d.created_at DESC
      `;
      console.log('📊 Found ALL deposits:', allDepositsResult.rows.length);
    } catch (depositError) {
      console.log('📊 No deposits table yet, using empty array');
    }
    
    // 6. CALCULATE GROWTH METRICS
    const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    
    let depositGrowth = 0;
    try {
      const lastMonthDepositsResult = await sql`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM deposits 
        WHERE status IN ('approved', 'completed')
        AND EXTRACT(MONTH FROM created_at) = ${lastMonth}
        AND EXTRACT(YEAR FROM created_at) = ${lastMonthYear}
      `;
      const lastMonthDeposits = parseFloat(lastMonthDepositsResult.rows[0].total || 0);
      
      depositGrowth = lastMonthDeposits > 0 
        ? ((activeDepositsThisMonth - lastMonthDeposits) / lastMonthDeposits * 100)
        : activeDepositsThisMonth > 0 ? 100 : 0;
    } catch (error) {
      depositGrowth = 0;
    }
    
    // 7. NEW CLIENTS THIS MONTH (only active clients)
    let newClients = 0;
    try {
      const newClientsResult = await sql`
        SELECT COUNT(*) as count
        FROM users 
        WHERE role = 'client' AND status = 'active'
        AND EXTRACT(MONTH FROM created_at) = ${currentMonth}
        AND EXTRACT(YEAR FROM created_at) = ${currentYear}
      `;
      newClients = parseInt(newClientsResult.rows[0].count) || 0;
      console.log('📊 New clients this month:', newClients);
    } catch (newClientError) {
      console.log('📊 Could not count new clients:', newClientError.message);
    }
    
    // Format ALL deposits for frontend (including pending ones)
    const formattedDeposits = allDepositsResult.rows.map(deposit => ({
      id: deposit.id,
      reference: deposit.reference,
      clientName: deposit.client_name || 
                 (deposit.first_name && deposit.last_name 
                   ? `${deposit.first_name} ${deposit.last_name}` 
                   : deposit.email || 'Unknown Client'),
      clientEmail: deposit.client_email || deposit.email,
      amount: parseFloat(deposit.amount || 0),
      purpose: deposit.purpose,
      status: deposit.status,
      date: deposit.created_at,
      deposit_date: deposit.deposit_date,
      approvedAt: deposit.approved_at,
      approvedBy: deposit.approved_by,
      userId: deposit.user_id
    }));

    // Format ONLY ACTIVE CLIENTS for frontend with FIXED PERFORMANCE CALCULATION
    const formattedClients = allClientsResult.rows.map(client => {
      // Safe date formatting
      const formatDate = (dateValue) => {
        if (!dateValue) return 'Unknown';
        if (typeof dateValue === 'string') return dateValue.split('T')[0];
        if (dateValue instanceof Date) return dateValue.toISOString().split('T')[0];
        return 'Unknown';
      };

      // Get client's COMPLETED deposits for performance calculation
      const clientDeposits = formattedDeposits
        .filter(d => d.userId === client.id && d.status === 'completed')
        .map(d => ({
          amount: d.amount,
          deposit_date: d.deposit_date || d.date,
          created_at: d.date
        }));

      const totalDeposits = clientDeposits.reduce((sum, d) => sum + d.amount, 0);
      
      // Calculate REAL account value using FIXED cumulative returns
      let accountValue = totalDeposits; // Default fallback
      if (clientDeposits.length > 0 && Object.keys(csvData).length > 0) {
        try {
          const performance = calculateAccountPerformance(clientDeposits, csvData);
          accountValue = performance.currentBalance;
          console.log(`💰 Client ${client.email}: $${totalDeposits} → $${accountValue.toFixed(2)}`);
        } catch (perfError) {
          console.log(`⚠️ Performance calculation failed for ${client.email}:`, perfError.message);
        }
      }

      return {
        id: client.id,
        firstName: client.first_name || 'Unknown',
        lastName: client.last_name || 'User',
        email: client.email,
        phone: client.phone || 'Not provided',
        address: client.address || 'Not provided',
        status: 'active', // All clients in this list are active
        joinDate: formatDate(client.created_at),
        totalDeposits,
        accountValue, // REAL calculated value using FIXED cumulative returns
        startingBalance: totalDeposits, // Starting balance = total deposits
        lastActive: formatDate(client.last_login) !== 'Unknown' ? formatDate(client.last_login) : formatDate(client.created_at)
      };
    });

    // Calculate TOTAL CLIENT BALANCES using real performance
    const totalClientBalances = formattedClients.reduce((sum, client) => sum + client.accountValue, 0);

    const stats = {
      totalClients,
      activeDepositsThisMonth,
      pendingRequests,
      totalClientBalances, // Now uses REAL calculated balances
      depositGrowth: parseFloat(depositGrowth.toFixed(1)),
      newClients
    };
    
    console.log('📊 Final admin stats:', stats);
    console.log('👥 Active clients returned:', formattedClients.length);
    console.log('💰 ALL deposits returned:', formattedDeposits.length);
    console.log('⏳ Total pending requests:', pendingRequests);
    console.log('💵 Total client balances (REAL):', totalClientBalances.toLocaleString());
    
    // Debug: Show pending deposits
    const pendingDeposits = formattedDeposits.filter(d => d.status === 'pending');
    console.log('⏳ Pending deposits being returned:', pendingDeposits.length);
    
    return res.status(200).json({
      success: true,
      stats,
      clients: formattedClients,     // ONLY role='client' AND status='active' with REAL values
      deposits: formattedDeposits    // ALL deposits including pending ones
    });
    
  } catch (error) {
    console.error('💥 Admin stats error:', error);
    console.error('💥 Error details:', error.message);
    console.error('💥 Error stack:', error.stack);
    
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch admin statistics',
      details: error.message,
      debug: {
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        timestamp: new Date().toISOString()
      }
    });
  }
};
