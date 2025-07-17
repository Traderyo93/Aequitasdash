// api/support-messages.js - FIXED VERSION WITH DYNAMIC ADMIN NAMES
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
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
    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    let user;
    
    try {
      user = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
    } catch (error) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }
    
    const { ticketId } = req.query;
    
    if (!ticketId) {
      return res.status(400).json({
        success: false,
        error: 'Ticket ID required'
      });
    }
    
    // Verify ticket exists and user has access
    const ticketCheck = await sql`
      SELECT * FROM support_tickets WHERE id = ${ticketId}
    `;
    
    if (ticketCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Ticket not found'
      });
    }
    
    const ticket = ticketCheck.rows[0];
    
    // Check permissions
    if (user.role !== 'admin' && ticket.user_id !== user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    // FIXED: Get all messages with DYNAMIC admin names based on sender_name field
    const messages = await sql`
      SELECT 
        m.*,
        CASE 
          WHEN m.sender_type = 'admin' AND m.sender_name IS NOT NULL THEN m.sender_name
          WHEN m.sender_type = 'admin' THEN 'Admin User'
          ELSE CONCAT(u.first_name, ' ', u.last_name)
        END as sender_name,
        CASE 
          WHEN m.sender_type = 'admin' THEN 'admin@aequitascap.com'
          ELSE u.email
        END as sender_email
      FROM support_messages m
      LEFT JOIN users u ON m.sender_id = u.id
      WHERE m.ticket_id = ${ticketId}
      ORDER BY m.created_at ASC
    `;
    
    // Mark as read for the requesting user
    if (user.role === 'admin') {
      await sql`
        UPDATE support_tickets 
        SET unread_count_admin = 0
        WHERE id = ${ticketId}
      `;
    } else {
      await sql`
        UPDATE support_tickets 
        SET unread_count_user = 0
        WHERE id = ${ticketId}
      `;
    }
    
    return res.status(200).json({
      success: true,
      ticket: ticket,
      messages: messages.rows
    });
    
  } catch (error) {
    console.error('💥 Support messages API error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
};
