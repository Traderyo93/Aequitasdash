// api/support-image.js - Serve Support Images (Simplified)
const { sql } = require('@vercel/postgres');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Get image ID from query parameter: /api/support-image?id=123
    const imageId = req.query.id;
    
    if (!imageId) {
      return res.status(400).json({ success: false, error: 'Image ID required' });
    }

    console.log('🖼️ Serving image ID:', imageId);

    // Get image from database
    const imageResult = await sql`
      SELECT 
        i.id,
        i.filename,
        i.image_data,
        i.content_type,
        i.file_size,
        i.user_id,
        i.created_at
      FROM support_images i
      WHERE i.id = ${imageId}
    `;

    if (imageResult.rows.length === 0) {
      console.log('❌ Image not found:', imageId);
      return res.status(404).json({ success: false, error: 'Image not found' });
    }

    const image = imageResult.rows[0];
    console.log('✅ Found image:', image.filename, 'Size:', image.file_size);

    // Extract base64 data from the stored data URL
    const matches = image.image_data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches) {
      console.error('❌ Invalid image data format for ID:', imageId);
      return res.status(500).json({ success: false, error: 'Invalid image data format' });
    }

    const contentType = matches[1];
    const imageBuffer = Buffer.from(matches[2], 'base64');

    // Set appropriate headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', imageBuffer.length);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
    res.setHeader('Content-Disposition', `inline; filename="${image.filename}"`);

    console.log('🚀 Serving image:', image.filename, 'Type:', contentType);

    // Send the image
    res.status(200).send(imageBuffer);

  } catch (error) {
    console.error('💥 Error serving image:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to serve image',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};
