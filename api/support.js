// api/support.js - UPDATED WITH IMAGE SUPPORT
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
    
    // Create and update support tables with proper migration INCLUDING IMAGE SUPPORT
    console.log('🔧 Checking and updating database schema...');
    
    // Create support_tickets table
    await sql`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        subject VARCHAR(255) NOT NULL,
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'open',
        image_url VARCHAR(500),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        unread_count_user INTEGER DEFAULT 0,
        unread_count_admin INTEGER DEFAULT 1
      )
    `;
    
    // Create support_messages table
    await sql`
      CREATE TABLE IF NOT EXISTS support_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ticket_id UUID NOT NULL,
        sender_id UUID NOT NULL,
        sender_type VARCHAR(10) NOT NULL,
        message TEXT NOT NULL,
        image_url VARCHAR(500),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    
    // Add sender_name column if it doesn't exist (migration)
    try {
      await sql`
        ALTER TABLE support_messages 
        ADD COLUMN IF NOT EXISTS sender_name VARCHAR(255) DEFAULT 'Unknown User'
      `;
      console.log('✅ Added sender_name column to support_messages');
    } catch (alterError) {
      console.log('ℹ️ sender_name column already exists or cannot be added:', alterError.message);
    }
    
    // Add image_url column to support_messages if it doesn't exist
    try {
      await sql`
        ALTER TABLE support_messages 
        ADD COLUMN IF NOT EXISTS image_url VARCHAR(500)
      `;
      console.log('✅ Added image_url column to support_messages');
    } catch (alterError) {
      console.log('ℹ️ image_url column already exists in support_messages:', alterError.message);
    }
    
    // Add image_url column to support_tickets if it doesn't exist
    try {
      await sql`
        ALTER TABLE support_tickets 
        ADD COLUMN IF NOT EXISTS image_url VARCHAR(500)
      `;
      console.log('✅ Added image_url column to support_tickets');
    } catch (alterError) {
      console.log('ℹ️ image_url column already exists in support_tickets:', alterError.message);
    }
    
    // Add constraint if it doesn't exist
    try {
      await sql`
        ALTER TABLE support_messages 
        ADD CONSTRAINT check_sender_type 
        CHECK (sender_type IN ('user', 'admin'))
      `;
    } catch (constraintError) {
      // Constraint might already exist, ignore
      console.log('ℹ️ Constraint already exists or cannot be added:', constraintError.message);
    }
    
    // Add foreign key if it doesn't exist
    try {
      await sql`
        ALTER TABLE support_messages 
        ADD CONSTRAINT fk_ticket_id 
        FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
      `;
    } catch (fkError) {
      // Foreign key might already exist, ignore
      console.log('ℹ️ Foreign key already exists or cannot be added:', fkError.message);
    }
    
    console.log('✅ Database schema updated successfully with image support');
    
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
            ) as latest_sender,
            (
              SELECT image_url 
              FROM support_messages 
              WHERE ticket_id = t.id AND image_url IS NOT NULL
              ORDER BY created_at DESC 
              LIMIT 1
            ) as latest_image
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
        // USER: Get their tickets only WITH IMAGE SUPPORT
        const tickets = await sql`
          SELECT 
            t.*,
            (
              SELECT COUNT(*)
              FROM support_messages 
              WHERE ticket_id = t.id AND image_url IS NOT NULL
            ) as image_count
          FROM support_tickets t
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
      const { action, ticketId, subject, priority, message, imageUrl, senderName } = req.body;
      
      if (action === 'create_ticket') {
        // Create new support ticket WITH IMAGE SUPPORT
        if (!subject || !message) {
          return res.status(400).json({
            success: false,
            error: 'Subject and message are required'
          });
        }
        
        console.log('🎫 Creating new support ticket for user:', user.id);
        console.log('📝 Ticket details:', { subject, priority, message, imageUrl: !!imageUrl });
        
        // Create ticket WITH IMAGE SUPPORT
        const ticketResult = await sql`
          INSERT INTO support_tickets (user_id, subject, priority, status, image_url)
          VALUES (${user.id}, ${subject}, ${priority || 'medium'}, 'open', ${imageUrl || null})
          RETURNING *
        `;
        
        const newTicket = ticketResult.rows[0];
        console.log('✅ Ticket created with ID:', newTicket.id, 'Has image:', !!newTicket.image_url);
        
        // Create first message with user's name AND IMAGE SUPPORT
        const userSenderName = user.firstName && user.lastName 
          ? `${user.firstName} ${user.lastName}`.trim()
          : user.email || 'User';
        
        console.log('💬 Adding initial message from:', userSenderName, 'With image:', !!imageUrl);
        
        await sql`
          INSERT INTO support_messages (ticket_id, sender_id, sender_type, sender_name, message, image_url)
          VALUES (${newTicket.id}, ${user.id}, 'user', ${userSenderName}, ${message}, ${imageUrl || null})
        `;
        
        console.log('✅ Initial message added to ticket with image support');
        
        return res.status(200).json({
          success: true,
          ticket: newTicket,
          message: 'Support ticket created successfully'
        });
        
      } else if (action === 'send_message') {
        // Send message to existing ticket WITH IMAGE SUPPORT
        if (!ticketId || !message) {
          return res.status(400).json({
            success: false,
            error: 'Ticket ID and message are required'
          });
        }
        
        console.log('💬 Sending message to ticket:', ticketId, 'With image:', !!imageUrl);
        
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
          ? (senderName || `${user.firstName || 'Admin'} ${user.lastName || ''}`.trim())
          : `${user.firstName || 'User'} ${user.lastName || ''}`.trim();
        
        console.log(`💬 Adding message as ${senderType}: ${finalSenderName}`);
        
        // Insert message with sender name AND IMAGE SUPPORT
        await sql`
          INSERT INTO support_messages (ticket_id, sender_id, sender_type, sender_name, message, image_url)
          VALUES (${ticketId}, ${user.id}, ${senderType}, ${finalSenderName}, ${message}, ${imageUrl || null})
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
        
        console.log(`✅ Message sent to ticket ${ticketId} by ${finalSenderName} with image: ${!!imageUrl}`);
        
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
    console.error('💥 Error stack:', error.stack);
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};
