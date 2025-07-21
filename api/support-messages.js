// api/support-messages.js - UPDATED WITH IMAGE SUPPORT
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
    
    console.log('📋 Loading messages for ticket:', ticketId, 'User:', user.id);
    
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
    if (user.role !== 'admin' && user.role !== 'superadmin' && ticket.user_id !== user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    // UPDATED: Get all messages with IMAGE SUPPORT and dynamic admin names
    const messages = await sql`
      SELECT 
        m.id,
        m.ticket_id,
        m.sender_id,
        m.sender_type,
        m.message,
        m.image_url,
        m.created_at,
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
    
    console.log(`✅ Loaded ${messages.rows.length} messages for ticket ${ticketId}`);
    
    // Log image URLs for debugging
    const messagesWithImages = messages.rows.filter(m => m.image_url);
    if (messagesWithImages.length > 0) {
      console.log('🖼️ Messages with images:', messagesWithImages.map(m => ({
        id: m.id,
        image_url: m.image_url
      })));
    }
    
    // Mark as read for the requesting user
    if (user.role === 'admin' || user.role === 'superadmin') {
      await sql`
        UPDATE support_tickets 
        SET unread_count_admin = 0
        WHERE id = ${ticketId}
      `;
      console.log('✅ Marked ticket as read for admin');
    } else {
      await sql`
        UPDATE support_tickets 
        SET unread_count_user = 0
        WHERE id = ${ticketId}
      `;
      console.log('✅ Marked ticket as read for user');
    }
    
    return res.status(200).json({
      success: true,
      ticket: ticket,
      messages: messages.rows
    });
    
  } catch (error) {
    console.error('💥 Support messages API error:', error);
    console.error('💥 Error stack:', error.stack);
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};
