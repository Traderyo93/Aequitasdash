// api/admin-stats.js - COMPLETE FIXED VERSION WITH PROPER SEPARATION
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');

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
    
    // 2. TOTAL CLIENT BALANCES - Only active clients
    let totalClientBalances = 0;
    try {
      const totalBalancesResult = await sql`
        SELECT COALESCE(SUM(account_value), 0) as total
        FROM users 
        WHERE role = 'client' AND status = 'active'
      `;
      totalClientBalances = parseFloat(totalBalancesResult.rows[0].total || 0);
      console.log('📊 Total client balances:', totalClientBalances);
    } catch (balanceError) {
      console.log('📊 Balance calculation error:', balanceError.message);
      totalClientBalances = 0;
    }
    
    // 3. ACTIVE DEPOSITS THIS MONTH
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
    
    // 4. PENDING REQUESTS - ONLY role = 'pending'
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
    
    // 5. ALL CLIENTS - ONLY show role = 'client' AND status = 'active'
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
    
    // 6. ALL DEPOSITS (only from active clients)
    let allDepositsResult = { rows: [] };
    try {
      allDepositsResult = await sql`
        SELECT 
          d.id, d.user_id, d.reference, d.amount, d.purpose, d.status, 
          d.created_at, d.approved_at, d.approved_by,
          u.first_name, u.last_name, u.email
        FROM deposits d
        LEFT JOIN users u ON d.user_id = u.id
        WHERE u.role = 'client' AND u.status = 'active'
        ORDER BY d.created_at DESC
      `;
      console.log('📊 Found deposits from active clients:', allDepositsResult.rows.length);
    } catch (depositError) {
      console.log('📊 No deposits table yet, using empty array');
    }
    
    // 7. CALCULATE GROWTH METRICS
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
    
    // 8. NEW CLIENTS THIS MONTH (only active clients)
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
    
    // Format deposits for frontend
    const formattedDeposits = allDepositsResult.rows.map(deposit => ({
      id: deposit.id,
      reference: deposit.reference,
      clientName: deposit.first_name && deposit.last_name 
        ? `${deposit.first_name} ${deposit.last_name}` 
        : deposit.email || 'Unknown Client',
      clientEmail: deposit.email,
      amount: parseFloat(deposit.amount || 0),
      purpose: deposit.purpose,
      status: deposit.status,
      date: deposit.created_at,
      approvedAt: deposit.approved_at,
      approvedBy: deposit.approved_by,
      userId: deposit.user_id
    }));

    // Format ONLY ACTIVE CLIENTS for frontend
    const formattedClients = allClientsResult.rows.map(client => {
      // Safe date formatting
      const formatDate = (dateValue) => {
        if (!dateValue) return 'Unknown';
        if (typeof dateValue === 'string') return dateValue.split('T')[0];
        if (dateValue instanceof Date) return dateValue.toISOString().split('T')[0];
        return 'Unknown';
      };

      return {
        id: client.id,
        firstName: client.first_name || 'Unknown',
        lastName: client.last_name || 'User',
        email: client.email,
        phone: client.phone || 'Not provided',
        address: client.address || 'Not provided',
        status: 'active', // All clients in this list are active
        joinDate: formatDate(client.created_at),
        totalDeposits: 0, // Will be calculated from deposits
        accountValue: parseFloat(client.account_value || 0),
        startingBalance: parseFloat(client.starting_balance || 0),
        lastActive: formatDate(client.last_login) !== 'Unknown' ? formatDate(client.last_login) : formatDate(client.created_at)
      };
    });

    // Calculate total deposits per client
    formattedClients.forEach(client => {
      const clientDeposits = formattedDeposits.filter(d => d.userId === client.id);
      client.totalDeposits = clientDeposits.reduce((sum, d) => sum + d.amount, 0);
    });

    const stats = {
      totalClients,
      activeDepositsThisMonth,
      pendingRequests,
      totalClientBalances,
      depositGrowth: parseFloat(depositGrowth.toFixed(1)),
      newClients
    };
    
    console.log('📊 Final admin stats:', stats);
    console.log('👥 Active clients returned:', formattedClients.length);
    console.log('💰 Deposits returned:', formattedDeposits.length);
    console.log('⏳ Total pending requests:', pendingRequests);
    
    // Verify separation
    const clientEmails = formattedClients.map(c => c.email);
    console.log('📊 Client emails in All Clients tab:', clientEmails);
    
    return res.status(200).json({
      success: true,
      stats,
      clients: formattedClients,     // ONLY role='client' AND status='active'
      deposits: formattedDeposits    // ONLY deposits from active clients
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
