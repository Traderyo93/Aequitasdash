// api/auth/verify-2fa-login.js - Fixed for Vercel
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// TOTP functions
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
    for (let window = -1; window <= 1; window++) {
        if (generateTOTP(secret, window) === token) {
            return true;
        }
    }
    return false;
}

function verifyBackupCode(inputCode, backupCodes) {
    const inputHash = crypto.createHash('sha256').update(inputCode).digest('hex');
    
    for (let i = 0; i < backupCodes.length; i++) {
        if (backupCodes[i].hash === inputHash && !backupCodes[i].used) {
            return i; // Return index of the matching code
        }
    }
    return -1; // No match found
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
        const { email, token: userToken, isBackupCode } = req.body;

        if (!email || !userToken) {
            return res.status(400).json({ error: 'Email and token are required' });
        }

        // Get user from database
        const userResult = await sql`
            SELECT id, email, password_hash, role, two_factor_secret, backup_codes, two_factor_enabled, first_name, last_name, account_value, starting_balance, setup_status, setup_step
            FROM users 
            WHERE email = ${email}
        `;

        if (userResult.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = userResult.rows[0];

        if (!user.two_factor_enabled) {
            return res.status(400).json({ error: '2FA not enabled for this account' });
        }

        let isValid = false;
        let updatedBackupCodes = null;

        if (isBackupCode) {
            // Verify backup code
            const backupCodes = JSON.parse(user.backup_codes || '[]');
            const codeIndex = verifyBackupCode(userToken, backupCodes);
            
            if (codeIndex >= 0) {
                isValid = true;
                // Mark backup code as used
                backupCodes[codeIndex].used = true;
                updatedBackupCodes = backupCodes;
            }
        } else {
            // Verify TOTP token
            isValid = verifyTOTP(userToken, user.two_factor_secret);
        }

        if (!isValid) {
            return res.status(401).json({ 
                error: isBackupCode ? 'Invalid backup code' : 'Invalid authentication code' 
            });
        }

        // Update backup codes if a backup code was used
        if (updatedBackupCodes) {
            await sql`
                UPDATE users 
                SET backup_codes = ${JSON.stringify(updatedBackupCodes)}
                WHERE id = ${user.id}
            `;
        }

        // Update last login
        await sql`
            UPDATE users 
            SET last_login = NOW() 
            WHERE id = ${user.id}
        `;

        // Generate new JWT token for successful login
        const jwtToken = jwt.sign(
            { 
                userId: user.id, 
                id: user.id,
                email: user.email, 
                role: user.role 
            },
            process.env.JWT_SECRET || 'aequitas-secret-key-2025',
            { expiresIn: '24h' }
        );

        console.log(`✅ 2FA login successful for user ${user.email} (${isBackupCode ? 'backup code' : 'TOTP'})`);

        return res.status(200).json({
            success: true,
            token: jwtToken,
            user: {
                id: user.id,
                email: user.email,
                role: user.role,
                firstName: user.first_name,
                lastName: user.last_name,
                accountValue: parseFloat(user.account_value || 0),
                startingBalance: parseFloat(user.starting_balance || 0),
                setupStatus: user.setup_status,
                setupStep: user.setup_step,
                setupRequired: user.setup_status !== 'approved'
            }
        });

    } catch (error) {
        console.error('💥 2FA login verification error:', error);
        return res.status(500).json({ 
            error: 'Failed to verify 2FA login',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
        });
    }
};
