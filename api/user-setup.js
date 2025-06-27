// api/user-setup.js - COMPLETE VERSION WITH USER DETAILS SUPPORT
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
  
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  
  const token = authHeader.replace('Bearer ', '');
  let user;
  
  try {
    user = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
  
  try {
    if (req.method === 'GET') {
      const { userId } = req.query;
      
      // If specific userId requested, get that user's details
      if (userId) {
        console.log('📋 Getting specific user setup details for:', userId);
        
        // Verify admin access for viewing other users
        if (user.role !== 'admin') {
          return res.status(403).json({ success: false, error: 'Admin access required' });
        }
        
        const userResult = await sql`
          SELECT 
            id, email, first_name, last_name, phone, date_of_birth, address,
            setup_status, setup_step, setup_progress, created_at, updated_at,
            role, account_value, starting_balance
          FROM users 
          WHERE id = ${userId}
        `;
        
        if (userResult.rows.length === 0) {
          return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        const userData = userResult.rows[0];
        
        // Get user's uploaded documents (mock data for now - integrate with your blob storage)
        let documents = [];
        try {
          // TODO: Replace with actual document fetching from Vercel Blob or your storage
          // For now, we'll create mock documents if user has submitted setup
          if (userData.setup_status === 'review_pending') {
            documents = [
              {
                document_type: 'Identity Document',
                file_url: `#mock-id-document-${userId}`,
                uploaded_at: userData.updated_at || userData.created_at
              },
              {
                document_type: 'Proof of Address',
                file_url: `#mock-address-document-${userId}`,
                uploaded_at: userData.updated_at || userData.created_at
              },
              {
                document_type: 'Signed Memorandum',
                file_url: `#mock-memorandum-${userId}`,
                uploaded_at: userData.updated_at || userData.created_at
              }
            ];
          }
        } catch (docError) {
          console.log('No documents found for user:', docError.message);
        }
        
        // Calculate setup progress
        let setupProgress = 0;
        if (userData.first_name && userData.last_name && userData.phone && userData.address) {
          setupProgress += 40; // Personal info completed
        }
        if (documents.length >= 2) {
          setupProgress += 60; // Documents uploaded
        }
        
        return res.status(200).json({
          success: true,
          user: {
            id: userData.id,
            email: userData.email,
            first_name: userData.first_name,
            last_name: userData.last_name,
            phone: userData.phone,
            date_of_birth: userData.date_of_birth,
            address: userData.address,
            setup_status: userData.setup_status,
            setup_step: userData.setup_step,
            setup_progress: setupProgress,
            created_at: userData.created_at,
            updated_at: userData.updated_at,
            role: userData.role,
            account_value: userData.account_value,
            starting_balance: userData.starting_balance,
            documents: documents,
            document_count: documents.length,
            personal_info_completed: !!(userData.first_name && userData.last_name && userData.phone && userData.address),
            documents_uploaded: documents.length,
            legal_agreements_signed: userData.setup_status === 'review_pending',
            setup_completed_at: userData.setup_status === 'review_pending' ? userData.updated_at : null
          }
        });
      }
      
      // If admin, get all pending users
      if (user.role === 'admin') {
        console.log('📋 Admin fetching all pending users');
        
        const pendingUsers = await sql`
          SELECT 
            id, email, first_name, last_name, setup_status, setup_step, 
            setup_progress, created_at, updated_at, phone, address
          FROM users 
          WHERE setup_status IN ('setup_pending', 'documents_pending', 'review_pending')
          ORDER BY created_at DESC
        `;
        
        // Add document count for each user (mock for now)
        const usersWithDocCount = pendingUsers.rows.map(user => ({
          ...user,
          document_count: user.setup_status === 'review_pending' ? 3 : 0,
          setup_progress: user.setup_progress || 0
        }));
        
        return res.status(200).json({
          success: true,
          pendingUsers: usersWithDocCount
        });
      }
      
      // Regular user - get their own status
      console.log('📋 User fetching own setup status:', user.id);
      
      const result = await sql`
        SELECT setup_status, setup_step, setup_progress
        FROM users WHERE id = ${user.id}
      `;
      
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      
      const userStatus = result.rows[0];
      
      return res.status(200).json({
        success: true,
        setupStatus: userStatus.setup_status,
        setupStep: userStatus.setup_step,
        setupProgress: userStatus.setup_progress
      });
    }
    
    if (req.method === 'POST') {
      // Save setup progress and data
      console.log('📝 Saving setup progress for user:', user.id);
      
      const { 
        personalInfo, 
        uploadedDocuments, 
        setupStatus = 'in_progress', 
        setupStep,
        submittedAt 
      } = req.body;
      
      let updateQuery = `
        UPDATE users 
        SET updated_at = NOW()
      `;
      let updateParams = [];
      
      // Update personal info if provided
      if (personalInfo) {
        if (personalInfo.firstName) {
          updateQuery += `, first_name = $${updateParams.length + 1}`;
          updateParams.push(personalInfo.firstName);
        }
        if (personalInfo.lastName) {
          updateQuery += `, last_name = $${updateParams.length + 1}`;
          updateParams.push(personalInfo.lastName);
        }
        if (personalInfo.phone) {
          updateQuery += `, phone = $${updateParams.length + 1}`;
          updateParams.push(personalInfo.phone);
        }
        if (personalInfo.dateOfBirth) {
          updateQuery += `, date_of_birth = $${updateParams.length + 1}`;
          updateParams.push(personalInfo.dateOfBirth);
        }
        if (personalInfo.address) {
          updateQuery += `, address = $${updateParams.length + 1}`;
          updateParams.push(personalInfo.address);
        }
      }
      
      // Update setup status and step
      if (setupStatus) {
        updateQuery += `, setup_status = $${updateParams.length + 1}`;
        updateParams.push(setupStatus);
      }
      
      if (setupStep) {
        updateQuery += `, setup_step = $${updateParams.length + 1}`;
        updateParams.push(setupStep);
      }
      
      // Calculate and update progress
      let progress = 0;
      if (personalInfo && personalInfo.firstName && personalInfo.lastName && personalInfo.phone && personalInfo.address) {
        progress += 40;
      }
      if (uploadedDocuments && Object.values(uploadedDocuments).filter(doc => doc).length >= 3) {
        progress += 60;
      }
      
      updateQuery += `, setup_progress = $${updateParams.length + 1}`;
      updateParams.push(progress);
      
      updateQuery += ` WHERE id = $${updateParams.length + 1}`;
      updateParams.push(user.id);
      
      // Execute the update
      await sql.query(updateQuery, updateParams);
      
      console.log('✅ Setup progress saved for user:', user.id);
      
      return res.status(200).json({ 
        success: true, 
        message: 'Setup progress saved',
        setupProgress: progress,
        setupStatus: setupStatus
      });
    }
    
    if (req.method === 'PUT') {
      // Admin approval/rejection
      if (user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
      }
      
      const { userId, action, reason } = req.body;
      
      if (!userId || !['approve', 'reject'].includes(action)) {
        return res.status(400).json({ success: false, error: 'Invalid request. userId and action (approve/reject) required.' });
      }
      
      console.log(`🔄 Admin ${action}ing user:`, userId);
      
      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      const newRole = action === 'approve' ? 'client' : 'pending';
      
      // Update user status
      await sql`
        UPDATE users 
        SET 
          setup_status = ${newStatus}, 
          role = ${newRole},
          setup_progress = ${action === 'approve' ? 100 : 0},
          updated_at = NOW()
        WHERE id = ${userId}
      `;
      
      // Log the admin action
      try {
        await sql`
          INSERT INTO admin_actions (admin_id, target_user_id, action, reason, created_at)
          VALUES (${user.id}, ${userId}, ${action}, ${reason || ''}, NOW())
          ON CONFLICT DO NOTHING
        `;
      } catch (logError) {
        console.log('Note: admin_actions table not available for logging');
      }
      
      console.log(`✅ User ${action}d successfully:`, userId);
      
      return res.status(200).json({
        success: true,
        message: `User ${action}d successfully`,
        newStatus: newStatus,
        userId: userId
      });
    }
    
    return res.status(405).json({
      success: false,
      error: `Method ${req.method} not allowed`
    });
    
  } catch (error) {
    console.error('💥 Setup API error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
    });
  }
};
