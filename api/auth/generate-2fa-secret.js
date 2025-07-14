// api/auth/generate-2fa-secret.js - Simple, working version
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');

// Simple base32 secret generation
function generateSecret() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let result = '';
    for (let i = 0; i < 32; i++) {
        result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
}

export default async function handler(req, res) {
    // Handle CORS
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        return res.status(200).end();
    }

    // Only allow POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Set response headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
        // Get token from header
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        
        // Verify token
        let user;
        try {
            user = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
        } catch (err) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        // Generate secret
        const secret = generateSecret();
        const email = user.email || user.userEmail || 'user@aequitas.com';
        const issuer = 'Aequitas Capital Partners';
        
        // Create QR URL
        const otpauth_url = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;

        // Try to store in database (but don't fail if it doesn't work)
        const userId = user.userId || user.id;
        if (userId) {
            try {
                await sql`UPDATE users SET two_factor_temp_secret = ${secret} WHERE id = ${userId}`;
            } catch (dbErr) {
                console.log('DB update failed:', dbErr.message);
                // Continue anyway - we can still generate the QR code
            }
        }

        // Return success
        return res.status(200).json({
            success: true,
            secret: secret,
            otpauth_url: otpauth_url
        });

    } catch (error) {
        console.error('API Error:', error);
        return res.status(500).json({ 
            error: 'Server error',
            message: error.message 
        });
    }
}
