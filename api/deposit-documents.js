// api/deposit-documents.js - Fetch documents for deposits
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Use GET.' 
    });
  }

  try {
    // Verify JWT token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const user = jwt.verify(token, process.env.JWT_SECRET);

    const { depositId, userId } = req.query;

    if (!depositId && !userId) {
      return res.status(400).json({
        success: false,
        error: 'Either depositId or userId is required'
      });
    }

    console.log(`📋 Fetching documents for deposit: ${depositId || 'user: ' + userId}`);

    // Query deposit_documents table
    let documentsResult;
    if (depositId) {
      documentsResult = await sql`
        SELECT * FROM deposit_documents 
        WHERE deposit_id = ${depositId}
        ORDER BY uploaded_at DESC
      `;
    } else {
      documentsResult = await sql`
        SELECT * FROM deposit_documents 
        WHERE user_id = ${userId}
        ORDER BY uploaded_at DESC
      `;
    }

    const documents = documentsResult.rows.map(doc => ({
      id: doc.id,
      fileName: doc.file_name,
      fileUrl: doc.file_url,
      fileSize: doc.file_size,
      uploadedAt: doc.uploaded_at,
      depositId: doc.deposit_id,
      userId: doc.user_id,
      blobPath: doc.blob_path
    }));

    console.log(`✅ Found ${documents.length} deposit documents`);

    return res.status(200).json({
      success: true,
      documents: documents,
      count: documents.length
    });

  } catch (error) {
    console.error('💥 Error fetching deposit documents:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch documents: ' + error.message
    });
  }
};
