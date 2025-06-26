// api/admin-stats.js - Get real admin statistics from database
import { sql } from '@vercel/postgres';
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
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
  
  // Verify admin authentication
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }
  
  const token = authHeader.replace('Bearer ', '');
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
    
    // Verify admin role
    if (decoded.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Invalid token'
    });
  }
  
  try {
    console.log('📊 Fetching admin statistics...');
    
    // 1. TOTAL CLIENTS - All users except admins
    const totalClientsResult = await sql`
      SELECT COUNT(*) as count
      FROM users 
      WHERE role != 'admin' AND role != 'deleted'
    `;
    const totalClients = parseInt(totalClientsResult.rows[0].count);
    
    // 2. ACTIVE DEPOSITS THIS MONTH - Approved/completed deposits in current month
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    
    const activeDepositsResult = await sql`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM deposits 
      WHERE status IN ('approved', 'completed')
      AND EXTRACT(MONTH FROM created_at) = ${currentMonth}
      AND EXTRACT(YEAR FROM created_at) = ${currentYear}
    `;
    const activeDeposits = parseFloat(activeDepositsResult.rows[0].total || 0);
    
    // 3. PENDING REQUESTS - Deposits with pending status
    const pendingRequestsResult = await sql`
      SELECT COUNT(*) as count
      FROM deposits 
      WHERE status = 'pending'
    `;
    const pendingRequests = parseInt(pendingRequestsResult.rows[0].count);
    
    // 4. TOTAL CLIENT BALANCES - Sum of all client account values
    const totalBalancesResult = await sql`
      SELECT COALESCE(SUM(account_value), 0) as total
      FROM users 
      WHERE role != 'admin' AND role != 'deleted'
    `;
    const totalClientBalances = parseFloat(totalBalancesResult.rows[0].total || 0);
    
    // 5. ALL CLIENTS WITH DETAILS - For the clients table
    const allClientsResult = await sql`
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
    
    // 6. ALL DEPOSITS - For the deposits table
    const allDepositsResult = await sql`
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
    
    // 7. MONTHLY GROWTH - Compare with last month
    const lastMonth = currentMonth === 1 ? 12 : currentMonth - 1;
    const lastMonthYear = currentMonth === 1 ? currentYear - 1 : currentYear;
    
    const lastMonthDepositsResult = await sql`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM deposits 
      WHERE status IN ('approved', 'completed')
      AND EXTRACT(MONTH FROM created_at) = ${lastMonth}
      AND EXTRACT(YEAR FROM created_at) = ${lastMonthYear}
    `;
    const lastMonthDeposits = parseFloat(lastMonthDepositsResult.rows[0].total || 0);
    
    // Calculate growth percentage
    const depositGrowth = lastMonthDeposits > 0 
      ? ((activeDeposits - lastMonthDeposits) / lastMonthDeposits * 100).toFixed(1)
      : activeDeposits > 0 ? 100 : 0;
    
    // 8. NEW CLIENTS THIS MONTH
    const newClientsResult = await sql`
      SELECT COUNT(*) as count
      FROM users 
      WHERE role != 'admin' AND role != 'deleted'
      AND EXTRACT(MONTH FROM created_at) = ${currentMonth}
      AND EXTRACT(YEAR FROM created_at) = ${currentYear}
    `;
    const newClients = parseInt(newClientsResult.rows[0].count);
    
    console.log('📊 Admin stats calculated:', {
      totalClients,
      activeDeposits,
      pendingRequests,
      totalClientBalances,
      depositGrowth,
      newClients
    });
    
    return res.status(200).json({
      success: true,
      stats: {
        totalClients,
        activeDeposits,
        pendingRequests,
        totalClientBalances,
        depositGrowth: parseFloat(depositGrowth),
        newClients
      },
      clients: allClientsResult.rows,
      deposits: allDepositsResult.rows.map(deposit => ({
        id: deposit.id,
        reference: deposit.reference,
        clientName: deposit.first_name && deposit.last_name 
          ? `${deposit.first_name} ${deposit.last_name}` 
          : deposit.email || 'Unknown Client',
        clientEmail: deposit.email,
        amount: parseFloat(deposit.amount),
        purpose: deposit.purpose,
        status: deposit.status,
        date: deposit.created_at,
        approvedAt: deposit.approved_at,
        approvedBy: deposit.approved_by,
        userId: deposit.user_id
      }))
    });
    
  } catch (error) {
    console.error('💥 Admin stats error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch admin statistics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
