// api/upload-image.js - Image Upload API for Support System
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Get auth token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Authorization token required' });
    }

    const token = authHeader.substring(7);
    let decoded;
    
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
    } catch (jwtError) {
      console.error('❌ JWT verification failed:', jwtError);
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    const userId = decoded.userId || decoded.id;

    // Verify user exists
    const userResult = await sql`
      SELECT id, email, first_name, last_name 
      FROM users 
      WHERE id = ${userId} AND role != 'deleted'
    `;

    if (userResult.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Handle file upload
    if (!req.body || !req.body.image) {
      return res.status(400).json({ success: false, error: 'No image data provided' });
    }

    // In a real implementation, you would:
    // 1. Parse the multipart form data (using multer or similar)
    // 2. Validate the image (size, type, etc.)
    // 3. Upload to cloud storage (AWS S3, Cloudinary, etc.)
    // 4. Return the URL

    // For this example, we'll simulate a successful upload
    // In production, replace this with actual file upload logic

    const imageData = req.body.image;
    
    // Simulate file validation
    if (!imageData.startsWith('data:image/')) {
      return res.status(400).json({ success: false, error: 'Invalid image format' });
    }

    // Extract image type and data
    const matches = imageData.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ success: false, error: 'Invalid image data' });
    }

    const imageType = matches[1];
    const imageBuffer = Buffer.from(matches[2], 'base64');

    // Check file size (5MB limit)
    if (imageBuffer.length > 5 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: 'Image too large (max 5MB)' });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `support_${userId}_${timestamp}.${imageType}`;

    // In production, upload to your cloud storage service
    // For this example, we'll store the image data in the database
    // (NOT recommended for production - use cloud storage instead)
    
    try {
      // Store image in database (temporary solution)
      const imageResult = await sql`
        INSERT INTO support_images (
          filename, 
          user_id, 
          image_data, 
          content_type,
          file_size,
          created_at
        ) 
        VALUES (
          ${filename},
          ${userId},
          ${imageData},
          ${'image/' + imageType},
          ${imageBuffer.length},
          NOW()
        )
        RETURNING id, filename
      `;

      const imageRecord = imageResult.rows[0];
      
      // Return the URL to access the image
      const imageUrl = `/api/support-image?id=${imageRecord.id}`;

      console.log('✅ Image uploaded successfully:', filename, 'Size:', imageBuffer.length, 'bytes');

      return res.status(200).json({
        success: true,
        imageUrl: imageUrl,
        filename: filename,
        size: imageBuffer.length
      });

    } catch (dbError) {
      console.error('💥 Database error storing image:', dbError);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to store image' 
      });
    }

  } catch (error) {
    console.error('💥 Image upload error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Image upload failed',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};
