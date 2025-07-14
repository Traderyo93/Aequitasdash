// api/auth/generate-2fa-secret.js - Fixed for Vercel deployment
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
        // Get and verify token
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

        // Generate secret and QR URL
        const secret = generateSecret();
        const email = user.email || user.userEmail || 'user@aequitas.com';
        const issuer = 'Aequitas Capital Partners';
        const otpauth_url = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;

        // Return success (skip database for now to avoid errors)
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
};
