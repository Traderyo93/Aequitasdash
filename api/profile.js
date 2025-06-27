// api/profile.js - COMPLETE PROFILE API WITH REAL DOCUMENT URLS
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    const token = authHeader.replace('Bearer ', '');
    let user;
    
    try {
      user = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
    } catch (jwtError) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }
    
    if (req.method === 'GET') {
      // Get user profile with timeline data
      console.log('📋 Getting profile for user:', user.email);
      
      // Get user data
      const userResult = await sql`
        SELECT 
          id, email, first_name, last_name, phone, address, date_of_birth,
          account_value, starting_balance, created_at, last_login, role
        FROM users 
        WHERE id = ${user.id}
      `;
      
      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      const userData = userResult.rows[0];
      console.log('👤 User found:', userData.email);
      
      // Get user's deposits for timeline
      let deposits = [];
      try {
        const depositsResult = await sql`
          SELECT amount, purpose, created_at, status, reference
          FROM deposits 
          WHERE user_id = ${user.id}
          ORDER BY created_at DESC
        `;
        deposits = depositsResult.rows;
        console.log('💰 Found deposits:', deposits.length);
      } catch (depositError) {
        console.log('📊 No deposits table yet');
      }
      
      // Get user's documents for timeline - FIXED TO GET REAL URLS
      let documents = [];
      let documentDebugInfo = { attempts: [], found: 0, errors: [] };
      
      try {
        console.log('📄 Fetching documents for user:', user.id);
        
        const documentsResult = await sql`
          SELECT document_type, file_name, file_url, blob_path, uploaded_at, file_size
          FROM user_documents 
          WHERE user_id = ${user.id}
          ORDER BY uploaded_at DESC
        `;
        
        console.log('📄 Raw documents from DB:', documentsResult.rows);
        
        documents = documentsResult.rows.map(doc => {
          // Map document types to display names
          const displayName = doc.document_type === 'id' ? 'Identity Document' : 
                            doc.document_type === 'address' ? 'Proof of Address' :
                            doc.document_type === 'memorandum' ? 'Signed Memorandum' : 
                            doc.document_type;
          
          // CRITICAL: Use the real file_url from database
          let downloadUrl = doc.file_url;
          
          // If file_url is missing but we have blob_path, construct it
          if (!downloadUrl && doc.blob_path) {
            // This shouldn't happen, but fallback
            downloadUrl = `https://blob.vercel-storage.com/${doc.blob_path}`;
            console.warn('⚠️ Constructed URL from blob_path for:', doc.file_name);
          }
          
          // If still no URL, use placeholder
          if (!downloadUrl) {
            downloadUrl = '#';
            console.error('❌ No URL found for document:', doc.file_name);
          }
          
          console.log('📄 Document processed:', {
            name: displayName,
            file: doc.file_name,
            url: downloadUrl,
            original_url: doc.file_url,
            blob_path: doc.blob_path
          });
          
          return {
            name: displayName,
            file_name: doc.file_name,
            url: downloadUrl,
            uploaded_at: doc.uploaded_at,
            file_size: doc.file_size,
            document_type: doc.document_type
          };
        });
        
        documentDebugInfo.attempts.push({
          method: 'user_documents_table',
          found: documents.length,
          success: true
        });
        
        console.log(`📄 Processed ${documents.length} documents for timeline`);
        
      } catch (docError) {
        console.error('📄 Document query error:', docError);
        documentDebugInfo.errors.push(docError.message);
        documentDebugInfo.attempts.push({
          method: 'user_documents_table',
          found: 0,
          success: false,
          error: docError.message
        });
      }
      
      // Build timeline data
      const timeline = [];
      
      // Account opening with REAL documents
      if (documents.length > 0 || userData.created_at) {
        timeline.push({
          type: 'account_opened',
          title: 'Account Opened',
          description: 'Welcome to Aequitas Capital Partners! Your account has been successfully created and approved.',
          date: userData.created_at,
          documents: documents.length > 0 ? documents : undefined
        });
      }
      
      // Add deposits to timeline
      deposits.forEach(deposit => {
        timeline.push({
          type: 'deposit',
          title: `Deposit - ${deposit.reference}`,
          description: `Deposit of ${parseFloat(deposit.amount).toLocaleString()} for ${deposit.purpose} - Status: ${deposit.status}`,
          date: deposit.created_at,
          amount: parseFloat(deposit.amount)
        });
      });
      
      // Sort timeline by date (newest first)
      timeline.sort((a, b) => new Date(b.date) - new Date(a.date));
      
      // Calculate stats
      const stats = {
        totalDeposits: deposits.reduce((sum, d) => sum + parseFloat(d.amount || 0), 0),
        totalWithdrawals: 0, // Placeholder for withdrawals
        memberSince: new Date(userData.created_at).getFullYear()
      };
      
      console.log('✅ Profile response ready:', {
        userEmail: userData.email,
        documentsFound: documents.length,
        timelineItems: timeline.length,
        depositsTotal: stats.totalDeposits
      });
      
      return res.status(200).json({
        success: true,
        user: {
          id: userData.id,
          email: userData.email,
          firstName: userData.first_name,
          lastName: userData.last_name,
          phone: userData.phone,
          address: userData.address,
          dateOfBirth: userData.date_of_birth,
          accountValue: parseFloat(userData.account_value || 0),
          startingBalance: parseFloat(userData.starting_balance || 0),
          created_at: userData.created_at,
          role: userData.role
        },
        timeline: timeline,
        stats: stats,
        debug: {
          documentsFound: documents.length,
          documentDebug: documentDebugInfo,
          timelineItems: timeline.length
        }
      });
    }
    
    if (req.method === 'PUT') {
      // Update user profile
      const { firstName, lastName, phone, dateOfBirth, address } = req.body;
      
      console.log('📝 Updating profile for user:', user.email);
      console.log('📝 Update data:', { firstName, lastName, phone, dateOfBirth, address });
      
      if (!firstName || !lastName) {
        return res.status(400).json({
          success: false,
          error: 'First name and last name are required'
        });
      }
      
      // Update user in database
      const updateResult = await sql`
        UPDATE users 
        SET 
          first_name = ${firstName},
          last_name = ${lastName},
          phone = ${phone || ''},
          date_of_birth = ${dateOfBirth || null},
          address = ${address || ''},
          updated_at = NOW()
        WHERE id = ${user.id}
        RETURNING id, email, first_name, last_name, phone, address, date_of_birth, account_value, created_at
      `;
      
      if (updateResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      const updatedUser = updateResult.rows[0];
      
      console.log('✅ Profile updated successfully for user:', user.email);
      
      return res.status(200).json({
        success: true,
        message: 'Profile updated successfully',
        user: {
          id: updatedUser.id,
          email: updatedUser.email,
          firstName: updatedUser.first_name,
          lastName: updatedUser.last_name,
          phone: updatedUser.phone,
          address: updatedUser.address,
          dateOfBirth: updatedUser.date_of_birth,
          accountValue: parseFloat(updatedUser.account_value || 0),
          created_at: updatedUser.created_at
        }
      });
    }
    
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
    
  } catch (error) {
    console.error('💥 Profile API error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
      details: error.message,
      debug: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
