const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');

export default async function handler(req, res) {
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
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Mark 2FA setup as completed
        await sql`
            UPDATE users 
            SET 
                two_factor_setup_required = false,
                two_factor_setup_completed = true
            WHERE id = ${decoded.userId}
        `;

        console.log(`🎉 2FA setup completed for user ${decoded.userId}`);

        res.status(200).json({
            success: true,
            message: '2FA setup completed successfully'
        });

    } catch (error) {
        console.error('💥 2FA completion error:', error);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        
        res.status(500).json({ error: 'Failed to complete 2FA setup' });
    }
}
