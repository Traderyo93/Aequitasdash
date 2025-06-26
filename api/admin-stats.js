// api/admin-stats.js - COMPLETE FULL VERSION WITH ALL FEATURES
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
    
    // 1. TOTAL CLIENTS - All users except admins
    const totalClientsResult = await sql`
      SELECT COUNT(*) as count
      FROM users 
      WHERE role != 'admin' AND role != 'deleted'
    `;
    const totalClients = parseInt(totalClientsResult.rows[0].count) || 0;
    
    // 2. TOTAL CLIENT BALANCES - Sum of all client account values
    const totalBalancesResult = await sql`
      SELECT COALESCE(SUM(account_value), 0) as total
      FROM users 
      WHERE role != 'admin' AND role != 'deleted'
    `;
    const totalClientBalances = parseFloat(totalBalancesResult.rows[0].total || 0);
    
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
    } catch (depositError) {
      console.log('No deposits table yet, using 0');
      activeDepositsThisMonth = 0;
    }
    
    // 4. PENDING REQUESTS
    let pendingRequests = 0;
    try {
      const pendingRequestsResult = await sql`
        SELECT COUNT(*) as count
        FROM deposits 
        WHERE status = 'pending'
      `;
      pendingRequests = parseInt(pendingRequestsResult.rows[0].count) || 0;
    } catch (depositError) {
      console.log('No deposits table yet, using 0');
      pendingRequests = 0;
    }
    
    // 5. ALL CLIENTS WITH DETAILS - Handle missing columns gracefully
    let allClientsResult;
    try {
      // Try with all columns first
      allClientsResult = await sql`
        SELECT 
          id,
          email,
          first_name,
          last_name,
          phone,
          address,
          account_value,
          starting_balance,
          created_at,
          last_login,
          role
        FROM users 
        WHERE role != 'admin' AND role != 'deleted'
        ORDER BY created_at DESC
      `;
    } catch (columnError) {
      console.log('Some columns missing, trying with basic columns only');
      // Fallback to basic columns
      allClientsResult = await sql`
        SELECT 
          id,
          email,
          first_name,
          last_name,
          created_at,
          role
        FROM users 
        WHERE role != 'admin' AND role != 'deleted'
        ORDER BY created_at DESC
      `;
    }
    
    // 6. ALL DEPOSITS (if table exists)
    let allDepositsResult = { rows: [] };
    try {
      allDepositsResult = await sql`
        SELECT 
          d.id,
          d.user_id,
          d.reference,
          d.amount,
          d.purpose,
          d.status,
          d.created_at,
          d.approved_at,
          d.approved_by,
          u.first_name,
          u.last_name,
          u.email
        FROM deposits d
        LEFT JOIN users u ON d.user_id = u.id
        ORDER BY d.created_at DESC
      `;
    } catch (depositError) {
      console.log('No deposits table yet, using empty array');
    }
    
    // 7. CALCULATE GROWTH
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
    
    // 8. NEW CLIENTS THIS MONTH
    const newClientsResult = await sql`
      SELECT COUNT(*) as count
      FROM users 
      WHERE role != 'admin' AND role != 'deleted'
      AND EXTRACT(MONTH FROM created_at) = ${currentMonth}
      AND EXTRACT(YEAR FROM created_at) = ${currentYear}
    `;
    const newClients = parseInt(newClientsResult.rows[0].count) || 0;
    
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

    // Format clients for frontend - handle missing columns and date formatting
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
        firstName: client.first_name,
        lastName: client.last_name,
        email: client.email,
        phone: client.phone || 'Not provided',
        address: client.address || 'Not provided',
        status: client.role === 'admin' ? 'admin' : 'active',
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
    
    console.log('📊 Admin stats calculated:', stats);
    console.log('👥 Clients found:', formattedClients.length);
    console.log('💰 Deposits found:', formattedDeposits.length);
    
    return res.status(200).json({
      success: true,
      stats,
      clients: formattedClients,
      deposits: formattedDeposits
    });
    
  } catch (error) {
    console.error('💥 Admin stats error:', error);
    
    // Return detailed error for debugging
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch admin statistics',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
