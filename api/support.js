// api/support.js - COMPLETE SUPPORT SYSTEM WITH DATABASE + ADMIN NAMES
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
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
    let user;
    
    try {
      user = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
    } catch (error) {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }
    
    // Create support tables if they don't exist
    await sql`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        subject VARCHAR(255) NOT NULL,
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'open',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        unread_count_user INTEGER DEFAULT 0,
        unread_count_admin INTEGER DEFAULT 1
      )
    `;
    
    await sql`
      CREATE TABLE IF NOT EXISTS support_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        sender_id UUID NOT NULL,
        sender_type VARCHAR(10) NOT NULL CHECK (sender_type IN ('user', 'admin')),
        sender_name VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    
    if (req.method === 'GET') {
      if (user.role === 'admin' || user.role === 'superadmin') {
        // ADMIN: Get all tickets with unread counts and latest message
        const tickets = await sql`
          SELECT 
            t.*,
            u.first_name,
            u.last_name,
            u.email,
            (
              SELECT message 
              FROM support_messages 
              WHERE ticket_id = t.id 
              ORDER BY created_at DESC 
              LIMIT 1
            ) as latest_message,
            (
              SELECT sender_type 
              FROM support_messages 
              WHERE ticket_id = t.id 
              ORDER BY created_at DESC 
              LIMIT 1
            ) as latest_sender
          FROM support_tickets t
          LEFT JOIN users u ON t.user_id = u.id
          ORDER BY t.last_message_at DESC
        `;
        
        // Get total unread count for admin
        const unreadResult = await sql`
          SELECT COALESCE(SUM(unread_count_admin), 0) as total_unread
          FROM support_tickets
          WHERE unread_count_admin > 0
        `;
        
        return res.status(200).json({
          success: true,
          tickets: tickets.rows,
          totalUnread: parseInt(unreadResult.rows[0].total_unread) || 0
        });
        
      } else {
        // USER: Get their tickets only
        const tickets = await sql`
          SELECT *
          FROM support_tickets
          WHERE user_id = ${user.id}
          ORDER BY last_message_at DESC
        `;
        
        return res.status(200).json({
          success: true,
          tickets: tickets.rows
        });
      }
    }
    
    if (req.method === 'POST') {
      const { action, ticketId, subject, priority, message, senderName } = req.body;
      
      if (action === 'create_ticket') {
        // Create new support ticket
        if (!subject || !message) {
          return res.status(400).json({
            success: false,
            error: 'Subject and message are required'
          });
        }
        
        // Create ticket
        const ticketResult = await sql`
          INSERT INTO support_tickets (user_id, subject, priority, status)
          VALUES (${user.id}, ${subject}, ${priority || 'medium'}, 'open')
          RETURNING *
        `;
        
        const newTicket = ticketResult.rows[0];
        
        // Create first message with user's name
        const userSenderName = `${user.firstName} ${user.lastName}`;
        
        await sql`
          INSERT INTO support_messages (ticket_id, sender_id, sender_type, sender_name, message)
          VALUES (${newTicket.id}, ${user.id}, 'user', ${userSenderName}, ${message})
        `;
        
        console.log('✅ New support ticket created:', newTicket.id);
        
        return res.status(200).json({
          success: true,
          ticket: newTicket,
          message: 'Support ticket created successfully'
        });
        
      } else if (action === 'send_message') {
        // Send message to existing ticket
        if (!ticketId || !message) {
          return res.status(400).json({
            success: false,
            error: 'Ticket ID and message are required'
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
        const isAdmin = user.role === 'admin' || user.role === 'superadmin';
        if (!isAdmin && ticket.user_id !== user.id) {
          return res.status(403).json({
            success: false,
            error: 'Access denied'
          });
        }
        
        // Determine sender type and name
        const senderType = isAdmin ? 'admin' : 'user';
        const finalSenderName = isAdmin 
          ? (senderName || `${user.firstName} ${user.lastName}`)  // Use provided admin name
          : `${user.firstName} ${user.lastName}`;
        
        console.log(`💬 Adding message as ${senderType}: ${finalSenderName}`);
        
        // Insert message with sender name
        await sql`
          INSERT INTO support_messages (ticket_id, sender_id, sender_type, sender_name, message)
          VALUES (${ticketId}, ${user.id}, ${senderType}, ${finalSenderName}, ${message})
        `;
        
        // Update ticket timestamp and unread counts
        if (senderType === 'admin') {
          // Admin sent message - reset admin unread, increment user unread
          await sql`
            UPDATE support_tickets 
            SET 
              last_message_at = NOW(),
              updated_at = NOW(),
              unread_count_admin = 0,
              unread_count_user = unread_count_user + 1,
              status = 'responded'
            WHERE id = ${ticketId}
          `;
        } else {
          // User sent message - increment admin unread, reset user unread
          await sql`
            UPDATE support_tickets 
            SET 
              last_message_at = NOW(),
              updated_at = NOW(),
              unread_count_admin = unread_count_admin + 1,
              unread_count_user = 0,
              status = 'open'
            WHERE id = ${ticketId}
          `;
        }
        
        console.log(`✅ Message sent to ticket ${ticketId} by ${finalSenderName}`);
        
        return res.status(200).json({
          success: true,
          message: 'Message sent successfully'
        });
      }
    }
    
    if (req.method === 'PUT') {
      const { action, ticketId } = req.body;
      
      if (action === 'mark_read') {
        // Mark ticket as read
        if (!ticketId) {
          return res.status(400).json({
            success: false,
            error: 'Ticket ID required'
          });
        }
        
        if (user.role === 'admin' || user.role === 'superadmin') {
          // Admin marking as read
          await sql`
            UPDATE support_tickets 
            SET unread_count_admin = 0
            WHERE id = ${ticketId}
          `;
        } else {
          // User marking as read
          await sql`
            UPDATE support_tickets 
            SET unread_count_user = 0
            WHERE id = ${ticketId} AND user_id = ${user.id}
          `;
        }
        
        return res.status(200).json({
          success: true,
          message: 'Ticket marked as read'
        });
        
      } else if (action === 'close_ticket') {
        // Close ticket (admin only)
        if (user.role !== 'admin' && user.role !== 'superadmin') {
          return res.status(403).json({
            success: false,
            error: 'Admin access required'
          });
        }
        
        await sql`
          UPDATE support_tickets 
          SET 
            status = 'closed',
            updated_at = NOW()
          WHERE id = ${ticketId}
        `;
        
        return res.status(200).json({
          success: true,
          message: 'Ticket closed successfully'
        });
      }
    }
    
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
    
  } catch (error) {
    console.error('💥 Support API error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message
    });
  }
};
