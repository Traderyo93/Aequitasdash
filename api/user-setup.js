// api/user-setup.js - COMPLETE FIXED VERSION
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
        
        // Get user data with all fields including new boolean columns
        const userResult = await sql`
          SELECT 
            id, email, first_name, last_name, phone, address, date_of_birth,
            created_at, updated_at, role, status, setup_status, setup_step, setup_progress,
            account_value, starting_balance,
            personal_info_completed, documents_uploaded, legal_agreements_signed,
            password_must_change
          FROM users 
          WHERE id = ${userId}
        `;
        
        if (userResult.rows.length === 0) {
          return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        const userData = userResult.rows[0];
        console.log('📋 User data retrieved for:', userData.email);
        
        // Get REAL documents from user_documents table
        let documents = [];
        let debugInfo = { searchAttempts: [] };
        
        try {
          console.log('📄 Checking user_documents table...');
          
          const documentsResult = await sql`
            SELECT document_type, file_name, file_url, blob_path, uploaded_at, file_size
            FROM user_documents 
            WHERE user_id = ${userId}
            ORDER BY uploaded_at DESC
          `;
          
          documents = documentsResult.rows.map(doc => ({
            document_type: doc.document_type === 'id' ? 'Identity Document' : 
                         doc.document_type === 'address' ? 'Proof of Address' :
                         doc.document_type === 'memorandum' ? 'Signed Memorandum' : 
                         doc.document_type,
            file_name: doc.file_name,
            file_url: doc.file_url,
            blob_path: doc.blob_path,
            uploaded_at: doc.uploaded_at,
            file_size: doc.file_size
          }));
          
          debugInfo.searchAttempts.push({
            method: 'user_documents_table',
            found: documents.length,
            success: true
          });
          
          console.log(`📄 Found ${documents.length} documents in user_documents table`);
          
        } catch (error) {
          console.log('📄 user_documents table error:', error.message);
          debugInfo.searchAttempts.push({
            method: 'user_documents_table',
            found: 0,
            success: false,
            error: error.message
          });
        }
        
        // FIXED: Use actual database value for NEW pending users, not calculated
        let setupProgress = userData.setup_progress || 0;
        
        // Only calculate progress if the user has actually started setup
        const hasPersonalInfo = userData.first_name && userData.last_name && userData.phone && userData.address;
        const hasDocuments = documents.length >= 3;
        const hasAgreements = documents.some(d => d.document_type === 'Signed Memorandum');
        
        // NEW USERS should show 0% until they actually complete steps
        if (userData.role === 'pending' && userData.setup_status === 'setup_pending' && !hasPersonalInfo && !hasDocuments) {
            setupProgress = 0;  // Force 0% for brand new users
        } else {
            // Only for users who have started, calculate progress
            setupProgress = 0;
            if (hasPersonalInfo) setupProgress += 33;
            if (hasDocuments) setupProgress += 34; 
            if (hasAgreements) setupProgress += 33;
            setupProgress = Math.min(setupProgress, 100);
        }
        
        return res.status(200).json({
          success: true,
          user: {
            id: userData.id,
            email: userData.email,
            first_name: userData.first_name,
            last_name: userData.last_name,
            phone: userData.phone || 'Not provided',
            date_of_birth: userData.date_of_birth || null,
            address: userData.address || 'Not provided',
            setup_status: userData.setup_status || 'setup_pending',
            setup_step: userData.setup_step || 1,
            setup_progress: setupProgress,
            created_at: userData.created_at,
            updated_at: userData.updated_at,
            role: userData.role,
            status: userData.status,
            account_value: userData.account_value || 0,
            starting_balance: userData.starting_balance || 0,
            documents: documents,
            document_count: documents.length,
            personal_info_completed: hasPersonalInfo,
            documents_uploaded: documents.length,
            legal_agreements_signed: hasAgreements,
            password_must_change: userData.password_must_change || false,
            setup_completed_at: userData.role === 'pending' ? userData.updated_at : null
          },
          debug: debugInfo
        });
      }
      
      // FIXED: If admin, get ONLY actual pending users (not admins!)
      if (user.role === 'admin') {
        console.log('📋 Admin fetching all pending users');
        
        // CRITICAL FIX: Only get users with role = 'pending'
        // Remove the OR condition that was catching admin users
        const pendingUsers = await sql`
          SELECT 
            id, email, first_name, last_name, phone, date_of_birth, address,
            created_at, updated_at, role, status, setup_status, setup_progress,
            personal_info_completed, documents_uploaded, legal_agreements_signed,
            password_must_change, setup_step
          FROM users 
          WHERE role = 'pending'
          ORDER BY created_at DESC
        `;
        
        console.log('📋 Found pending users:', pendingUsers.rows.length);
        
        // FIXED: Proper progress calculation without hardcoded 90%
        const usersWithDocCounts = await Promise.all(
          pendingUsers.rows.map(async (user) => {
            let docCount = 0;
            
            try {
              const docCountResult = await sql`
                SELECT COUNT(*) as count
                FROM user_documents 
                WHERE user_id = ${user.id}
              `;
              docCount = parseInt(docCountResult.rows[0].count) || 0;
            } catch (e) {
              docCount = 0; // Don't assume documents exist
            }
            
            // PROPER setup progress calculation
            let setupProgress = 0;
            
            // Only count steps as complete if they're actually complete
            const hasPersonalInfo = user.first_name && user.last_name && user.phone && user.address;
            const hasDocuments = docCount >= 3;
            const hasAgreements = user.legal_agreements_signed;
            
            if (hasPersonalInfo) setupProgress += 33;
            if (hasDocuments) setupProgress += 34;
            if (hasAgreements) setupProgress += 33;
            
            // Users just created should be 0%
            if (!hasPersonalInfo && !hasDocuments && !hasAgreements) {
              setupProgress = 0;
            }
            
            return {
              ...user,
              setup_status: user.setup_status || 'setup_pending',
              setup_progress: setupProgress, // FIXED: No more hardcoded 90%
              document_count: docCount,
              phone: user.phone || 'Not provided',
              address: user.address || 'Not provided',
              
              // Include the boolean fields for proper frontend handling
              personal_info_completed: hasPersonalInfo,
              documents_uploaded: docCount,
              legal_agreements_signed: hasAgreements,
              password_must_change: user.password_must_change || false
            };
          })
        );
        
        return res.status(200).json({
          success: true,
          pendingUsers: usersWithDocCounts
        });
      }
      
      // Regular user - get their own status
      const result = await sql`
        SELECT 
          id, email, first_name, last_name, date_of_birth, created_at, role, 
          setup_status, setup_progress, personal_info_completed, documents_uploaded,
          legal_agreements_signed, password_must_change
        FROM users 
        WHERE id = ${user.id}
      `;
      
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      
      const userStatus = result.rows[0];
      
      // Calculate actual progress for user
      let setupProgress = 0;
      if (userStatus.personal_info_completed) setupProgress += 33;
      if (userStatus.documents_uploaded >= 3) setupProgress += 34;
      if (userStatus.legal_agreements_signed) setupProgress += 33;
      
      return res.status(200).json({
        success: true,
        setupStatus: userStatus.setup_status || 'setup_pending',
        setupStep: 1,
        setupProgress: setupProgress,
        passwordChangeRequired: userStatus.password_must_change || false
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
      
      // Update user record
      let updateFields = {};
      
      if (personalInfo) {
        if (personalInfo.firstName) updateFields.first_name = personalInfo.firstName;
        if (personalInfo.lastName) updateFields.last_name = personalInfo.lastName;
        if (personalInfo.phone) updateFields.phone = personalInfo.phone;
        if (personalInfo.dateOfBirth) updateFields.date_of_birth = personalInfo.dateOfBirth;
        if (personalInfo.address) updateFields.address = personalInfo.address;
      }
      
      if (setupStatus) updateFields.setup_status = setupStatus;
      if (setupStep) updateFields.setup_step = setupStep;
      
      // Calculate progress properly
      let progress = 0;
      const hasPersonalInfo = personalInfo?.firstName && personalInfo?.lastName && personalInfo?.phone && personalInfo?.address;
      const hasDocuments = uploadedDocuments && Object.values(uploadedDocuments).filter(doc => doc).length >= 3;
      
      if (hasPersonalInfo) {
        progress += 33;
        updateFields.personal_info_completed = true;
      }
      if (hasDocuments) {
        progress += 34;
        updateFields.documents_uploaded = Object.values(uploadedDocuments).filter(doc => doc).length;
      }
      if (setupStatus === 'review_pending') {
        progress += 33;
        updateFields.legal_agreements_signed = true;
      }
      
      updateFields.setup_progress = progress;
      
      // Update user record
      const updateQuery = `
        UPDATE users 
        SET 
          first_name = COALESCE($1, first_name),
          last_name = COALESCE($2, last_name),
          phone = COALESCE($3, phone),
          date_of_birth = COALESCE($4, date_of_birth),
          address = COALESCE($5, address),
          setup_status = COALESCE($6, setup_status),
          setup_step = COALESCE($7, setup_step),
          setup_progress = $8,
          personal_info_completed = COALESCE($9, personal_info_completed),
          documents_uploaded = COALESCE($10, documents_uploaded),
          legal_agreements_signed = COALESCE($11, legal_agreements_signed),
          updated_at = NOW()
        WHERE id = $12
      `;
      
      await sql.query(updateQuery, [
        updateFields.first_name,
        updateFields.last_name,
        updateFields.phone,
        updateFields.date_of_birth,
        updateFields.address,
        updateFields.setup_status,
        updateFields.setup_step,
        updateFields.setup_progress,
        updateFields.personal_info_completed,
        updateFields.documents_uploaded,
        updateFields.legal_agreements_signed,
        user.id
      ]);
      
      console.log('✅ Setup progress saved for user:', user.id);
      
      return res.status(200).json({ 
        success: true, 
        message: 'Setup progress saved',
        setupProgress: progress,
        setupStatus: setupStatus
      });
    }
    
    if (req.method === 'PUT') {
      // Admin approval/rejection or reset
      if (user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
      }
      
      const { userId, action, reason } = req.body;
      
      if (!userId || !['approve', 'reject', 'reset_setup'].includes(action)) {
        return res.status(400).json({ success: false, error: 'Invalid request. userId and action (approve/reject/reset_setup) required.' });
      }
      
      console.log(`🔄 Admin ${action}ing user:`, userId);
      
      if (action === 'reset_setup') {
        // Reset user back to setup mode
        await sql`
          UPDATE users 
          SET 
            role = 'pending',
            setup_status = 'setup_pending',
            setup_progress = 0,
            setup_step = 1,
            personal_info_completed = false,
            documents_uploaded = 0,
            legal_agreements_signed = false,
            password_must_change = true,
            updated_at = NOW()
          WHERE id = ${userId}
        `;
        
        // Clear existing documents to force re-upload
        try {
          await sql`DELETE FROM user_documents WHERE user_id = ${userId}`;
          console.log('🗑️ Cleared existing documents for re-upload');
        } catch (e) {
          console.log('📄 No documents to clear');
        }
        
        console.log('✅ User reset to setup mode:', userId);
        
        return res.status(200).json({
          success: true,
          message: 'User reset to setup mode - they can now complete setup again',
          newStatus: 'setup_pending',
          userId: userId
        });
      }
      
      const newRole = action === 'approve' ? 'client' : 'pending';
      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      
      // Update user status
      await sql`
        UPDATE users 
        SET 
          role = ${newRole},
          setup_status = ${newStatus},
          setup_progress = ${action === 'approve' ? 100 : 0},
          updated_at = NOW()
        WHERE id = ${userId}
      `;
      
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
      details: error.message
    });
  }
};
