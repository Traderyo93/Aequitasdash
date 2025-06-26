// api/user-setup.js - CREATE THIS NEW FILE
import { sql } from '@vercel/postgres';
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
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
      // Get user setup status
      const result = await sql`
        SELECT setup_status, setup_step, personal_info, uploaded_documents
        FROM users WHERE id = ${user.id}
      `;
      
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      
      const userStatus = result.rows[0];
      
      return res.status(200).json({
        success: true,
        setupStatus: userStatus.setup_status,
        setupStep: userStatus.setup_step,
        personalInfo: userStatus.personal_info ? JSON.parse(userStatus.personal_info) : null,
        uploadedDocuments: userStatus.uploaded_documents ? JSON.parse(userStatus.uploaded_documents) : null
      });
    }
    
    if (req.method === 'POST') {
      // Save setup progress
      const { setupStep, personalInfo, uploadedDocuments, setupStatus = 'in_progress' } = req.body;
      
      await sql`
        UPDATE users 
        SET 
          setup_status = ${setupStatus},
          setup_step = ${setupStep || 1},
          personal_info = ${personalInfo ? JSON.stringify(personalInfo) : null},
          uploaded_documents = ${uploadedDocuments ? JSON.stringify(uploadedDocuments) : null},
          updated_at = NOW()
        WHERE id = ${user.id}
      `;
      
      return res.status(200).json({ success: true, message: 'Setup progress saved' });
    }
    
    if (req.method === 'PUT') {
      // Admin approval/rejection
      if (user.role !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin access required' });
      }
      
      const { userId, action, notes } = req.body;
      
      if (!userId || !['approve', 'reject'].includes(action)) {
        return res.status(400).json({ success: false, error: 'Invalid request' });
      }
      
      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      
      await sql`
        UPDATE users 
        SET setup_status = ${newStatus}, updated_at = NOW()
        WHERE id = ${userId}
      `;
      
      return res.status(200).json({
        success: true,
        message: `User ${action}d successfully`
      });
    }
    
  } catch (error) {
    console.error('Setup API error:', error);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
}
