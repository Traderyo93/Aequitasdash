// api/upload.js - Complete Production File Upload with Vercel Blob
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
    console.log('Upload request received');
    
    const { fileName, fileData, depositId, userId } = req.body;
    
    // Validate required fields
    if (!fileName) {
      return res.status(400).json({ 
        success: false, 
        error: 'fileName is required' 
      });
    }
    
    if (!fileData) {
      return res.status(400).json({ 
        success: false, 
        error: 'fileData is required' 
      });
    }
    
    if (!depositId) {
      return res.status(400).json({ 
        success: false, 
        error: 'depositId is required' 
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
    
    console.log(`Uploading to Vercel Blob: ${blobPath}`);
    
    // Upload to Vercel Blob
    const blob = await put(blobPath, buffer, {
      access: 'public',
      contentType: 'application/pdf',
      addRandomSuffix: false
    });
    
    console.log(`Upload successful: ${blob.url}`);
    
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
      message: 'File uploaded successfully',
      file: fileRecord
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    
    // Handle specific Vercel Blob errors
    if (error.message.includes('blob')) {
      return res.status(500).json({
        success: false,
        error: 'Cloud storage error. Please try again.'
      });
    }
    
    // Handle generic errors
    return res.status(500).json({
      success: false,
      error: 'Upload failed: ' + (error.message || 'Unknown error')
    });
  }
}
