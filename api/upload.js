// api/upload.js - Debug Token Access
import { put } from '@vercel/blob';

export default async function handler(req, res) {
  // Enable CORS for all origins
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  
  // Handle preflight requests
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
    console.log('Environment debug:');
    console.log('- All env keys with BLOB:', Object.keys(process.env).filter(k => k.includes('BLOB')));
    console.log('- BLOB_READ_WRITE_TOKEN exists:', !!process.env.BLOB_READ_WRITE_TOKEN);
    console.log('- BLOB_READ_WRITE_TOKEN length:', process.env.BLOB_READ_WRITE_TOKEN?.length || 0);
    console.log('- BLOB_READ_WRITE_TOKEN starts with:', process.env.BLOB_READ_WRITE_TOKEN?.substring(0, 20));
    console.log('- NODE_ENV:', process.env.NODE_ENV);
    console.log('- VERCEL_ENV:', process.env.VERCEL_ENV);
    
    const { fileName, fileData, depositId, userId } = req.body;
    
    // Validate required fields
    if (!fileName || !fileData || !depositId) {
      return res.status(400).json({ 
        success: false, 
        error: 'fileName, fileData, and depositId are required' 
      });
    }

    console.log(`Processing upload: ${fileName} for deposit ${depositId}`);

    // Validate file type (PDF only)
    if (!fileName.toLowerCase().endsWith('.pdf')) {
      return res.status(400).json({
        success: false,
        error: 'Only PDF files are allowed'
      });
    }

    // Extract and validate base64 data
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

    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Validate file size (10MB limit)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (buffer.length > maxSize) {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum size is 10MB.'
      });
    }

    console.log(`File size: ${buffer.length} bytes`);
    
    // Create organized path structure
    const timestamp = Date.now();
    const cleanFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const blobPath = `deposits/${depositId}/${timestamp}_${cleanFileName}`;
    
    console.log(`Attempting Vercel Blob upload: ${blobPath}`);
    
    // Try different token approaches
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    
    if (!token) {
      console.log('❌ No token found in environment');
      throw new Error('BLOB_READ_WRITE_TOKEN not found in environment variables');
    }
    
    console.log('✅ Token found, attempting upload...');
    
    // Upload to Vercel Blob with explicit token
    const blob = await put(blobPath, buffer, {
      access: 'public',
      contentType: 'application/pdf',
      addRandomSuffix: false,
      token: token // Explicitly pass the token
    });
    
    console.log(`✅ Upload successful: ${blob.url}`);
    
    // Create file record
    const fileRecord = {
      id: 'file_' + timestamp,
      name: fileName,
      originalName: fileName,
      url: blob.url,
      downloadUrl: blob.url,
      uploadDate: new Date().toISOString(),
      depositId: depositId,
      userId: userId || 'unknown',
      status: 'uploaded',
      size: buffer.length,
      type: 'application/pdf',
      blobPath: blobPath
    };
    
    return res.status(200).json({
      success: true,
      message: 'File uploaded successfully to Vercel Blob',
      file: fileRecord
    });
    
  } catch (error) {
    console.error('💥 Upload error:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    return res.status(500).json({
      success: false,
      error: 'Upload failed: ' + error.message
    });
  }
}
