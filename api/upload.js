// api/upload.js - FIXED VERSION - CommonJS syntax
const { put } = require('@vercel/blob');
const { sql } = require('@vercel/postgres');

module.exports = async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Use POST.' 
    });
  }

  try {
    console.log('=== UPLOAD REQUEST RECEIVED ===');
    
    const { fileName, fileData, depositId, userId, documentType, isSetupDocument } = req.body;
    
    // Validate required fields
    if (!fileName || !fileData || !userId) {
      return res.status(400).json({ 
        success: false, 
        error: 'fileName, fileData, and userId are required' 
      });
    }

    console.log(`📄 Processing upload: ${fileName}`);
    console.log(`👤 User: ${userId}`);
    console.log(`📋 Document type: ${documentType}`);
    console.log(`🔧 Setup document: ${isSetupDocument}`);

    // Validate file type (PDF only)
    if (!fileName.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({
        success: false,
        error: 'Only PDF files are allowed'
      });
    }

    // Extract base64 data
    let base64Data;
    if (fileData.includes(',')) {
      base64Data = fileData.split(',')[1];
    } else {
      base64Data = fileData;
    }
    
    if (!base64Data) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file data format'
      });
    }

    // Convert to buffer
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Validate file size (10MB limit)
    const maxSize = 10 * 1024 * 1024;
    if (buffer.length > maxSize) {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum size is 10MB.'
      });
    }

    console.log(`📏 File size: ${buffer.length} bytes`);
    
    // Create blob path
    const timestamp = Date.now();
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    
    let blobPath;
    if (isSetupDocument) {
      blobPath = `setup/${userId}/${documentType}/${timestamp}_${cleanFileName}`;
    } else {
      blobPath = `deposits/${depositId}/${timestamp}_${cleanFileName}`;
    }
    
    console.log(`☁️ Uploading to Vercel Blob: ${blobPath}`);
    
    // Upload to Vercel Blob
    const blob = await put(blobPath, buffer, {
      access: 'public',
      contentType: 'application/pdf',
      addRandomSuffix: false
    });
    
    console.log(`✅ Blob uploaded successfully: ${blob.url}`);
    
    // CRITICAL: Save to database
    let databaseSaved = false;
    let databaseError = null;
    
    try {
      console.log(`💾 Saving to database...`);
      
      // Ensure user_documents table exists
      await sql`
        CREATE TABLE IF NOT EXISTS user_documents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL,
          document_type VARCHAR(50) NOT NULL,
          file_name VARCHAR(255) NOT NULL,
          file_url TEXT NOT NULL,
          blob_path TEXT,
          file_size INTEGER,
          uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `;
      
      // Create unique constraint if not exists
      try {
        await sql`
          ALTER TABLE user_documents 
          ADD CONSTRAINT unique_user_document_type 
          UNIQUE(user_id, document_type)
        `;
      } catch (constraintError) {
        // Constraint may already exist, ignore
        console.log('Unique constraint already exists or failed to add');
      }
      
      if (isSetupDocument && documentType) {
        console.log(`📝 Inserting setup document: ${documentType} for user ${userId}`);
        
        // Insert/update document record
        await sql`
          INSERT INTO user_documents (user_id, document_type, file_name, file_url, blob_path, file_size)
          VALUES (${userId}, ${documentType}, ${fileName}, ${blob.url}, ${blobPath}, ${buffer.length})
          ON CONFLICT (user_id, document_type) 
          DO UPDATE SET 
            file_name = EXCLUDED.file_name,
            file_url = EXCLUDED.file_url,
            blob_path = EXCLUDED.blob_path,
            file_size = EXCLUDED.file_size,
            uploaded_at = NOW()
        `;
        
        console.log(`✅ Document saved to user_documents table`);
        databaseSaved = true;
        
      } else {
        console.log(`📝 Inserting general upload for deposit: ${depositId}`);
        
        // Create uploads table if not exists
        await sql`
          CREATE TABLE IF NOT EXISTS uploads (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL,
            deposit_id VARCHAR(255),
            file_name VARCHAR(255) NOT NULL,
            file_url TEXT NOT NULL,
            blob_path TEXT,
            file_size INTEGER,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
          )
        `;
        
        // Insert deposit document
        await sql`
          INSERT INTO uploads (user_id, deposit_id, file_name, file_url, blob_path, file_size)
          VALUES (${userId}, ${depositId}, ${fileName}, ${blob.url}, ${blobPath}, ${buffer.length})
        `;
        
        console.log(`✅ Document saved to uploads table`);
        databaseSaved = true;
      }
      
    } catch (dbError) {
      console.error('💥 Database save failed:', dbError);
      databaseError = dbError.message;
      databaseSaved = false;
    }
    
    // Create response
    const fileRecord = {
      id: 'file_' + timestamp,
      name: fileName,
      originalName: fileName,
      url: blob.url,
      downloadUrl: blob.url,
      uploadDate: new Date().toISOString(),
      depositId: depositId,
      userId: userId,
      documentType: documentType,
      status: 'uploaded',
      size: buffer.length,
      type: 'application/pdf',
      blobPath: blobPath
    };
    
    const response = {
      success: true,
      message: `File uploaded to Vercel Blob${databaseSaved ? ' and saved to database' : ''}`,
      file: fileRecord,
      blobUploaded: true,
      databaseSaved: databaseSaved
    };
    
    if (databaseError) {
      response.warning = `Database save failed: ${databaseError}`;
    }
    
    console.log(`🎉 Upload complete - Blob: ✅, Database: ${databaseSaved ? '✅' : '❌'}`);
    
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('💥 Upload error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Upload failed: ' + error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};
