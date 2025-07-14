const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// TOTP verification function (same as above)
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

function verifyTOTP(token, secret) {
    // Check current window and ±1 window for clock drift tolerance
    for (let window = -1; window <= 1; window++) {
        if (generateTOTP(secret, window) === token) {
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

function hashBackupCodes(codes) {
    return codes.map(code => {
        return {
            hash: crypto.createHash('sha256').update(code).digest('hex'),
            used: false
        };
    });
}

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

        const { token: userToken, secret } = req.body;

        if (!userToken || !secret) {
            return res.status(400).json({ error: 'Token and secret are required' });
        }

        // Verify the TOTP token
        if (!verifyTOTP(userToken, secret)) {
            return res.status(400).json({ error: 'Invalid verification code' });
        }

        // Generate backup codes
        const backupCodes = generateBackupCodes();
        const hashedBackupCodes = hashBackupCodes(backupCodes);

        // Move temp secret to permanent and store backup codes
        await sql`
            UPDATE users 
            SET 
                two_factor_secret = ${secret},
                two_factor_temp_secret = NULL,
                two_factor_enabled = true,
                backup_codes = ${JSON.stringify(hashedBackupCodes)}
            WHERE id = ${decoded.userId}
        `;

        console.log(`✅ 2FA setup verified for user ${decoded.userId}`);

        res.status(200).json({
            success: true,
            backupCodes: backupCodes
        });

    } catch (error) {
        console.error('💥 2FA verification error:', error);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        
        res.status(500).json({ error: 'Failed to verify 2FA setup' });
    }
}
