const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Pure Node.js TOTP implementation (no speakeasy needed)
function generateTOTPSecret() {
    return crypto.randomBytes(20).toString('base32');
}

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

        // Generate new TOTP secret
        const secret = generateTOTPSecret();
        
        // Create otpauth URL for QR code
        const issuer = 'Aequitas Capital Partners';
        const accountName = decoded.email;
        const otpauth_url = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;

        // Store temporary secret in database
        await sql`
            UPDATE users 
            SET two_factor_temp_secret = ${secret}
            WHERE id = ${decoded.userId}
        `;

        console.log(`🔐 Generated 2FA secret for user ${decoded.userId}`);

        res.status(200).json({
            success: true,
            secret: secret,
            otpauth_url: otpauth_url
        });

    } catch (error) {
        console.error('💥 2FA secret generation error:', error);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        
        res.status(500).json({ error: 'Failed to generate 2FA secret' });
    }
}
