const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Content-Type', 'application/json');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }
    
    try {
        // Verify authentication
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        
        const token = authHeader.replace('Bearer ', '');
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
        } catch (jwtError) {
            return res.status(401).json({ success: false, error: 'Invalid token' });
        }
        
        const userId = decoded.id;
        
        // Mark setup as completed
        await sql`
            UPDATE users 
            SET 
                two_factor_setup_completed = TRUE,
                updated_at = NOW()
            WHERE id = ${userId}
        `;
        
        console.log(`✅ 2FA setup completed for user ${userId}`);
        
        return res.status(200).json({
            success: true,
            message: '2FA setup completed successfully'
        });
        
    } catch (error) {
        console.error('💥 Complete 2FA setup error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};
