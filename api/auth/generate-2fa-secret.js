// api/auth/generate-2fa-secret.js - Corrected version for Vercel
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Base32 encoding for TOTP secret
function generateBase32Secret() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let secret = '';
    for (let i = 0; i < 32; i++) {
        secret += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return secret;
}

export default async function handler(req, res) {
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
        console.log('🔐 Starting 2FA secret generation...');
        
        // Verify JWT token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('❌ No authorization header found');
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        console.log('🎫 Token received, verifying...');
        
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
            console.log('✅ Token verified for user:', decoded.email || decoded.userId);
        } catch (jwtError) {
            console.log('❌ JWT verification failed:', jwtError.message);
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        // Generate new TOTP secret
        const secret = generateBase32Secret();
        console.log('🔑 Generated secret length:', secret.length);
        
        // Create otpauth URL for QR code
        const issuer = 'Aequitas Capital Partners';
        const accountName = decoded.email || 'user@aequitas.com';
        const otpauth_url = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
        
        console.log('📱 Generated OTP auth URL for:', accountName);

        // Store temporary secret in database
        const userId = decoded.userId || decoded.id;
        console.log('💾 Storing temp secret for user ID:', userId);
        
        try {
            // First check if the user exists and has the required columns
            const userCheck = await sql`
                SELECT id FROM users WHERE id = ${userId}
            `;
            
            if (userCheck.rows.length === 0) {
                console.log('❌ User not found with ID:', userId);
                return res.status(404).json({ error: 'User not found' });
            }
            
            // Update user with temporary secret
            const updateResult = await sql`
                UPDATE users 
                SET two_factor_temp_secret = ${secret}
                WHERE id = ${userId}
                RETURNING id
            `;
            
            if (updateResult.rows.length === 0) {
                throw new Error('Failed to update user record');
            }
            
            console.log('💾 Temp secret stored successfully for user:', userId);
            
        } catch (dbError) {
            console.error('💥 Database error:', dbError);
            console.error('DB Error details:', dbError.message);
            
            // Check if it's a column doesn't exist error
            if (dbError.message.includes('column') && dbError.message.includes('does not exist')) {
                return res.status(500).json({ 
                    error: 'Database not configured for 2FA. Please run the migration first.',
                    details: 'Missing two_factor_temp_secret column'
                });
            }
            
            return res.status(500).json({ 
                error: 'Failed to store secret in database',
                details: process.env.NODE_ENV === 'development' ? dbError.message : 'Database error'
            });
        }

        console.log(`✅ 2FA secret generated successfully for user ${userId}`);

        return res.status(200).json({
            success: true,
            secret: secret,
            otpauth_url: otpauth_url
        });

    } catch (error) {
        console.error('💥 Unexpected error in 2FA secret generation:', error);
        console.error('Error stack:', error.stack);
        
        return res.status(500).json({ 
            error: 'Failed to generate 2FA secret',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
}
