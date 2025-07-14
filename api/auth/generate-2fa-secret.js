// api/auth/generate-2fa-secret.js - Fixed version for Vercel
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Pure Node.js TOTP implementation (no speakeasy needed)
function generateTOTPSecret() {
    return crypto.randomBytes(20).toString('base32');
}

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
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        console.log('🔐 Generating 2FA secret...');
        
        // Verify JWT token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('❌ No token provided');
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        let decoded;
        
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
        } catch (jwtError) {
            console.log('❌ Invalid token:', jwtError.message);
            return res.status(401).json({ error: 'Invalid token' });
        }

        console.log('✅ Token verified for user:', decoded.email);

        // Generate new TOTP secret
        const secret = generateTOTPSecret();
        
        // Create otpauth URL for QR code
        const issuer = 'Aequitas Capital Partners';
        const accountName = decoded.email;
        const otpauth_url = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;

        console.log('🔑 Generated secret for user:', decoded.userId || decoded.id);

        // Store temporary secret in database
        const userId = decoded.userId || decoded.id;
        
        try {
            await sql`
                UPDATE users 
                SET two_factor_temp_secret = ${secret}
                WHERE id = ${userId}
            `;
            console.log('💾 Stored temp secret in database');
        } catch (dbError) {
            console.error('💥 Database error:', dbError);
            return res.status(500).json({ error: 'Failed to store secret' });
        }

        console.log(`✅ 2FA secret generated successfully for user ${userId}`);

        res.status(200).json({
            success: true,
            secret: secret,
            otpauth_url: otpauth_url
        });

    } catch (error) {
        console.error('💥 2FA secret generation error:', error);
        console.error('Error stack:', error.stack);
        
        res.status(500).json({ 
            error: 'Failed to generate 2FA secret',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
};
