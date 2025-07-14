const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Simple TOTP verification without external libraries
function verifyTOTP(secret, token) {
    const time = Math.floor(Date.now() / 1000 / 30);
    
    // Check current time and ±1 period for clock drift
    for (let i = -1; i <= 1; i++) {
        const timeCounter = time + i;
        const hmac = crypto.createHmac('sha1', Buffer.from(secret, 'base32'));
        hmac.update(Buffer.from(timeCounter.toString(16).padStart(16, '0'), 'hex'));
        const digest = hmac.digest();
        
        const offset = digest[digest.length - 1] & 0x0f;
        const code = ((digest[offset] & 0x7f) << 24) |
                    ((digest[offset + 1] & 0xff) << 16) |
                    ((digest[offset + 2] & 0xff) << 8) |
                    (digest[offset + 3] & 0xff);
        
        const otpCode = (code % 1000000).toString().padStart(6, '0');
        
        if (otpCode === token) {
            return true;
        }
    }
    return false;
}

function generateBackupCodes() {
    const codes = [];
    for (let i = 0; i < 10; i++) {
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        codes.push(`${code.slice(0, 4)}-${code.slice(4, 8)}`);
    }
    return codes;
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
        const { secret, code } = req.body;
        
        if (!secret || !code) {
            return res.status(400).json({ 
                success: false, 
                error: 'Secret and code are required' 
            });
        }
        
        // Verify the TOTP code
        const verified = verifyTOTP(secret, code);
        
        if (!verified) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid verification code' 
            });
        }
        
        // Generate backup codes
        const backupCodes = generateBackupCodes();
        
        // Hash backup codes for storage
        const hashedBackupCodes = backupCodes.map(code => 
            crypto.createHash('sha256').update(code).digest('hex')
        );
        
        // Store the verified secret and backup codes
        await sql`
            UPDATE users 
            SET 
                two_factor_secret = ${secret},
                two_factor_temp_secret = NULL,
                two_factor_enabled = TRUE,
                two_factor_setup_required = FALSE,
                backup_codes = ${JSON.stringify(hashedBackupCodes)},
                updated_at = NOW()
            WHERE id = ${userId}
        `;
        
        console.log(`✅ 2FA enabled for user ${userId}`);
        
        return res.status(200).json({
            success: true,
            message: '2FA setup verified successfully',
            backupCodes: backupCodes // Send unhashed codes to user
        });
        
    } catch (error) {
        console.error('💥 Verify 2FA setup error:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
};
