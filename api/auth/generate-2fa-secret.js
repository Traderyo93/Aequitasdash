const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Simple TOTP implementation without external libraries
function generateSecret() {
    return crypto.randomBytes(32).toString('base32');
}

function generateTOTPURL(secret, label, issuer) {
    const params = new URLSearchParams({
        secret: secret,
        issuer: issuer,
        algorithm: 'SHA1',
        digits: '6',
        period: '30'
    });
    
    return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
}

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
        
        // Get user info
        const userResult = await sql`
            SELECT email, first_name, last_name, two_factor_enabled
            FROM users 
            WHERE id = ${userId}
        `;
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        
        const user = userResult.rows[0];
        
        // Generate secret
        const secret = generateSecret();
        const label = `${user.first_name} ${user.last_name} (${user.email})`;
        const qrCodeUrl = generateTOTPURL(secret, label, 'Aequitas Capital Partners');
        
        // Store temporary secret (not yet activated)
        await sql`
            UPDATE users 
            SET 
                two_factor_temp_secret = ${secret},
                updated_at = NOW()
            WHERE id = ${userId}
        `;
        
        return res.status(200).json({
            success: true,
            secret: secret,
            qrCodeUrl: qrCodeUrl,
            accountName: label
        });
        
    } catch (error) {
        console.error('💥 Generate 2FA secret error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};
