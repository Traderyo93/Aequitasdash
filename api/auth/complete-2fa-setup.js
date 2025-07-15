// api/auth/complete-2fa-setup.js - Production ready
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
    // Handle CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Verify JWT token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        let user;
        
        try {
            user = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
        } catch (err) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        // Mark 2FA setup as completed
        const userId = user.userId || user.id;
        
        try {
            const result = await sql`
                UPDATE users 
                SET two_factor_setup_required = false
                WHERE id = ${userId}
                RETURNING id, email
            `;
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }
            
            console.log(`🎉 2FA setup completed for user ${userId}`);
            
        } catch (dbError) {
            console.error('💥 Database error:', dbError);
            return res.status(500).json({ 
                error: 'Failed to complete 2FA setup',
                details: process.env.NODE_ENV === 'development' ? dbError.message : 'Database error'
            });
        }

        return res.status(200).json({
            success: true,
            message: '2FA setup completed successfully'
        });

    } catch (error) {
        console.error('💥 2FA completion error:', error);
        return res.status(500).json({ 
            error: 'Failed to complete 2FA setup',
            message: error.message 
        });
    }
};
