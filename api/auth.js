const { sql } = require('@vercel/postgres');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'GET') {
    try {
      await sql`SELECT 1`;
      res.status(200).json({ message: 'Database works' });
    } catch (error) {
      res.status(200).json({ message: 'Database error: ' + error.message });
    }
    return;
  }
  
  res.status(200).json({ message: 'API works' });
};
