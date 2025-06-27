// api/user-setup.js - FIXED VERSION - Removes date_of_birth column references
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
        
        // Use only columns that definitely exist (no date_of_birth!)
        const userResult = await sql`
          SELECT 
            id, email, first_name, last_name, phone, address,
            created_at, updated_at, role
          FROM users 
          WHERE id = ${userId}
        `;
        
        if (userResult.rows.length === 0) {
          return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        const userData = userResult.rows[0];
        console.log('📋 User data retrieved for:', userData.email);
        
        // Get user's uploaded documents (mock data for now - integrate with your blob storage)
        let documents = [];
        try {
          // TODO: Replace with actual document fetching from Vercel Blob or your storage
          // For now, we'll create mock documents if user has submitted setup
          if (userData.role === 'pending') {
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
        
        // Calculate setup progress based on available data
        let setupProgress = 80; // Default for pending users
        if (userData.first_name && userData.last_name && userData.phone && userData.address) {
          setupProgress = 90; // Personal info completed
        }
        
        return res.status(200).json({
          success: true,
          user: {
            id: userData.id,
            email: userData.email,
            first_name: userData.first_name,
            last_name: userData.last_name,
            phone: userData.phone || 'Not provided',
            address: userData.address || 'Not provided',
            setup_status: 'review_pending', // Default for pending users
            setup_step: 3,
            setup_progress: setupProgress,
            created_at: userData.created_at,
            updated_at: userData.updated_at,
            role: userData.role,
            documents: documents,
            document_count: documents.length,
            personal_info_completed: !!(userData.first_name && userData.last_name && userData.phone && userData.address),
            documents_uploaded: documents.length,
            legal_agreements_signed: userData.role === 'pending',
            setup_completed_at: userData.role === 'pending' ? userData.updated_at : null
          }
        });
      }
      
      // If admin, get all pending users
      if (user.role === 'admin') {
        console.log('📋 Admin fetching all pending users');
        
        try {
          // Use simple query with only existing columns
          const pendingUsers = await sql`
            SELECT 
              id, email, first_name, last_name, created_at, role
            FROM users 
            WHERE role = 'pending'
            ORDER BY created_at DESC
          `;
          
          console.log('📋 Found pending users:', pendingUsers.rows.length);
          
          // Add mock data for missing fields
          const usersWithMockData = pendingUsers.rows.map(user => ({
            ...user,
            setup_status: 'review_pending',
            setup_step: 3,
            setup_progress: 90,
            phone: user.phone || 'Not provided',
            address: user.address || 'Not provided',
            document_count: 3,
            updated_at: user.created_at
          }));
          
          return res.status(200).json({
            success: true,
            pendingUsers: usersWithMockData
          });
          
        } catch (queryError) {
          console.error('📋 Query error details:', queryError);
          console.error('📋 Error message:', queryError.message);
          console.error('📋 Error stack:', queryError.stack);
          
          // Return empty array with error details for debugging
          return res.status(200).json({
            success: true,
            pendingUsers: [],
            debug: {
              error: queryError.message,
              hint: 'Check database columns and user roles'
            }
          });
        }
      }
      
      // Regular user - get their own status
      console.log('📋 User fetching own setup status:', user.id);
      
      const result = await sql`
        SELECT id, email, first_name, last_name, created_at, role
        FROM users WHERE id = ${user.id}
      `;
      
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      
      const userStatus = result.rows[0];
      
      return res.status(200).json({
        success: true,
        setupStatus: userStatus.role === 'pending' ? 'review_pending' : 'approved',
        setupStep: 3,
        setupProgress: 90
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
      
      // Build update object for SQL query using only existing columns
      let updateFields = {
        updated_at: 'NOW()'
      };
      
      // Update personal info if provided
      if (personalInfo) {
        if (personalInfo.firstName) updateFields.first_name = personalInfo.firstName;
        if (personalInfo.lastName) updateFields.last_name = personalInfo.lastName;
        if (personalInfo.phone) updateFields.phone = personalInfo.phone;
        if (personalInfo.address) updateFields.address = personalInfo.address;
      }
      
      // Calculate progress based on completion
      let progress = 0;
      if (personalInfo && personalInfo.firstName && personalInfo.lastName && personalInfo.phone && personalInfo.address) {
        progress += 40;
      }
      if (uploadedDocuments && Object.values(uploadedDocuments).filter(doc => doc).length >= 3) {
        progress += 60;
      }
      
      // Execute the update using only existing columns
      await sql`
        UPDATE users 
        SET 
          first_name = ${updateFields.first_name || null},
          last_name = ${updateFields.last_name || null},
          phone = ${updateFields.phone || null},
          address = ${updateFields.address || null},
          updated_at = NOW()
        WHERE id = ${user.id}
      `;
      
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
      
      const newRole = action === 'approve' ? 'client' : 'pending';
      
      // Update user status using only existing columns
      await sql`
        UPDATE users 
        SET 
          role = ${newRole},
          updated_at = NOW()
        WHERE id = ${userId}
      `;
      
      console.log(`✅ User ${action}d successfully:`, userId);
      
      return res.status(200).json({
        success: true,
        message: `User ${action}d successfully`,
        newStatus: action === 'approve' ? 'approved' : 'rejected',
        userId: userId
      });
    }
    
    return res.status(405).json({
      success: false,
      error: `Method ${req.method} not allowed`
    });
    
  } catch (error) {
    console.error('💥 Setup API error:', error);
    console.error('💥 Error message:', error.message);
    console.error('💥 Error stack:', error.stack);
    console.error('💥 Request method:', req.method);
    console.error('💥 Request query:', req.query);
    console.error('💥 User role:', user?.role);
    
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      details: error.message,
      debug: {
        method: req.method,
        userRole: user?.role,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    });
  }
};
