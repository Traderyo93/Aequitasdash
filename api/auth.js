// api/auth.js - Debug bcrypt comparison
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'GET') {
    try {
      const sql = neon(process.env.POSTGRES_URL);
      const usersTest = await sql`SELECT COUNT(*) as count FROM users`;
      const allUsers = await sql`SELECT id, email, role, LEFT(password_hash, 30) as hash_preview FROM users`;
      
      return res.status(200).json({
        success: true,
        message: "API working!",
        users_count: usersTest[0].count,
        users_list: allUsers,
        bcrypt_version: bcrypt.version || 'unknown'
      });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ success: false, error: 'Email and password required' });
    return;
  }

  try {
    const sql = neon(process.env.POSTGRES_URL);
    
    const result = await sql`
      SELECT id, email, password_hash, role, first_name, last_name, account_value, starting_balance
      FROM users 
      WHERE email = ${email}
    `;

    if (result.length === 0) {
      console.log('❌ User not found:', email);
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }

    const user = result[0];
    console.log('👤 User found:', user.email);
    console.log('🔐 Password provided:', password);
    console.log('🔑 Hash from DB:', user.password_hash);
    console.log('📝 Hash starts with:', user.password_hash.substring(0, 10));
    
    // Debug bcrypt comparison
    try {
      const passwordValid = await bcrypt.compare(password, user.password_hash);
      console.log('✅ bcrypt.compare result:', passwordValid);
      
      // Additional debug - test known hash
      const testHash = bcrypt.hashSync(password, 10);
      console.log('🧪 Fresh hash for same password:', testHash);
      const testCompare = bcrypt.compareSync(password, testHash);
      console.log('🧪 Fresh hash validates:', testCompare);
      
      if (!passwordValid) {
        console.log('❌ Password validation failed');
        res.status(401).json({ 
          success: false, 
          error: 'Invalid credentials',
          debug: {
            email_found: true,
            password_provided: !!password,
            hash_format: user.password_hash.substring(0, 4),
            bcrypt_working: testCompare
          }
        });
        return;
      }
    } catch (bcryptError) {
      console.error('💥 bcrypt error:', bcryptError);
      res.status(500).json({ 
        success: false, 
        error: 'Password verification failed',
        details: bcryptError.message
      });
      return;
    }

    // Success - update last login
    await sql`UPDATE users SET last_login = NOW() WHERE id = ${user.id}`;

    const token = jwt.sign(
      { 
        id: user.id,
        email: user.email,
        role: user.role 
      },
      process.env.JWT_SECRET || 'aequitas-secret-key-2025',
      { expiresIn: '24h' }
    );

    console.log('🎉 Login successful for:', email);

    res.status(200).json({
      success: true,
      token: token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.first_name,
        lastName: user.last_name,
        accountValue: user.account_value,
        startingBalance: user.starting_balance
      }
    });

  } catch (error) {
    console.error('💥 Login error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Database connection failed',
      details: error.message
    });
  }
}
