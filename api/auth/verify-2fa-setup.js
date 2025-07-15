// api/auth/verify-2fa-setup.js - Production ready
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Base32 decode for TOTP verification
function base32Decode(encoded) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    
    for (let i = 0; i < encoded.length; i++) {
        const val = alphabet.indexOf(encoded.charAt(i).toUpperCase());
        if (val === -1) continue;
        bits += val.toString(2).padStart(5, '0');
    }
    
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        bytes.push(parseInt(bits.substr(i, 8), 2));
    }
    
    return Buffer.from(bytes);
}

// Generate TOTP code
function generateTOTP(secret, window = 0) {
    const epoch = Math.round(new Date().getTime() / 1000.0);
    const time = Math.floor(epoch / 30) + window;
    
    const timeBytes = Buffer.allocUnsafe(8);
    timeBytes.fill(0);
    timeBytes.writeUInt32BE(time, 4);
    
    const secretBytes = base32Decode(secret);
    const hmac = crypto.createHmac('sha1', secretBytes);
    hmac.update(timeBytes);
    const hash = hmac.digest();
    
    const offset = hash[hash.length - 1] & 0xf;
    const code = (hash.readUInt32BE(offset) & 0x7fffffff) % 1000000;
    
    return code.toString().padStart(6, '0');
}

// Verify TOTP token with drift tolerance
function verifyTOTP(token, secret) {
    // Check current window and ±1 window for clock drift tolerance
    for (let window = -1; window <= 1; window++) {
        if (generateTOTP(secret, window) === token) {
            return true;
        }
    }
    return false;
}

// Generate backup codes
function generateBackupCodes() {
    const codes = [];
    for (let i = 0; i < 10; i++) {
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        codes.push(`${code.slice(0, 4)}-${code.slice(4, 8)}`);
    }
    return codes;
}

// Hash backup codes for secure storage
function hashBackupCodes(codes) {
    return codes.map(code => {
        return {
            hash: crypto.createHash('sha256').update(code).digest('hex'),
            used: false
        };
    });
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

        const { token: userToken, secret } = req.body;

        if (!userToken || !secret) {
            return res.status(400).json({ error: 'Token and secret are required' });
        }

        // Verify the TOTP token
        if (!verifyTOTP(userToken, secret)) {
            return res.status(400).json({ error: 'Invalid verification code' });
        }

        console.log(`✅ TOTP verified for user ${user.userId || user.id}`);

        // Generate backup codes
        const backupCodes = generateBackupCodes();
        const hashedBackupCodes = hashBackupCodes(backupCodes);

        // Store everything in database
        const userId = user.userId || user.id;
        
        try {
            await sql`
                UPDATE users 
                SET 
                    two_factor_secret = ${secret},
                    two_factor_temp_secret = NULL,
                    two_factor_enabled = true,
                    backup_codes = ${JSON.stringify(hashedBackupCodes)}
                WHERE id = ${userId}
                RETURNING id
            `;
            
            console.log(`✅ 2FA setup completed for user ${userId}`);
            
        } catch (dbError) {
            console.error('💥 Database error:', dbError);
            return res.status(500).json({ 
                error: 'Failed to save 2FA setup',
                details: process.env.NODE_ENV === 'development' ? dbError.message : 'Database error'
            });
        }

        return res.status(200).json({
            success: true,
            backupCodes: backupCodes
        });

    } catch (error) {
        console.error('💥 2FA verification error:', error);
        return res.status(500).json({ 
            error: 'Failed to verify 2FA setup',
            message: error.message 
        });
    }
};
