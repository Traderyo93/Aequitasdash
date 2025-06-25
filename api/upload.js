// api/upload.js - Upload with explicit store ID
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
    console.log('Available env vars:', Object.keys(process.env).filter(k => k.includes('BLOB')));
    
    const { fileName, fileData, depositId, userId } = req.body;
    
    // Validate required fields
    if (!fileName || !fileData || !depositId) {
      return res.status(400).json({ 
        success: false, 
        error: 'fileName, fileData, and depositId are required' 
      });
    }

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
    
    // Try upload with different token approaches
    let blob;
    
    try {
      // Method 1: Use environment token
      blob = await put(blobPath, buffer, {
        access: 'public',
        contentType: 'application/pdf',
        addRandomSuffix: false
      });
    } catch (error) {
      console.log('Method 1 failed, trying method 2:', error.message);
      
      // Method 2: Try with explicit token from different env var names
      const possibleTokens = [
        process.env.BLOB_READ_WRITE_TOKEN,
        process.env.VERCEL_BLOB_READ_WRITE_TOKEN,
        process.env[`BLOB_READ_WRITE_TOKEN_${process.env.VERCEL_ENV?.toUpperCase()}`]
      ].filter(Boolean);
      
      if (possibleTokens.length > 0) {
        blob = await put(blobPath, buffer, {
          access: 'public',
          contentType: 'application/pdf',
          addRandomSuffix: false,
          token: possibleTokens[0]
        });
      } else {
        throw new Error('No valid blob token found');
      }
    }
    
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
      message: 'File uploaded successfully to Vercel Blob',
      file: fileRecord
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    
    return res.status(500).json({
      success: false,
      error: 'Upload failed: ' + error.message,
      details: 'Check function logs for more information'
    });
  }
}
