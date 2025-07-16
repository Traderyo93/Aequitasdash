// api/cron/statement-scheduler.js - Automated Statement Generation Scheduler
const { sql } = require('@vercel/postgres');

// This would be called by a cron job or scheduled task
// For Vercel, you'd set this up as a scheduled function

module.exports = async function handler(req, res) {
  // Verify this is a scheduled request (add your secret key)
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();
    
    console.log(`📅 Checking if statements should be generated: ${month}/${day}`);
    
    let shouldGenerate = false;
    let period = '';
    
    // Check if it's January 5th (H2 statements due)
    if (month === 1 && day === 5) {
      shouldGenerate = true;
      period = 'H2';
      console.log('🔄 January 5th - Time to generate H2 statements');
    }
    
    // Check if it's July 5th (H1 statements due)
    if (month === 7 && day === 5) {
      shouldGenerate = true;
      period = 'H1';
      console.log('🔄 July 5th - Time to generate H1 statements');
    }
    
    if (!shouldGenerate) {
      console.log('⏭️ No statements due today');
      return res.status(200).json({ message: 'No statements due today' });
    }
    
    // Generate statements for all clients
    const generateResponse = await fetch(`${process.env.VERCEL_URL}/api/generate-statements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.ADMIN_TOKEN}` // Use admin token
      },
      body: JSON.stringify({
        action: 'generate-all',
        period: period
      })
    });
    
    if (generateResponse.ok) {
      const result = await generateResponse.json();
      console.log('✅ Statements generated successfully:', result.message);
      
      // Log the generation for audit purposes
      await sql`
        INSERT INTO system_logs (event_type, message, data, created_at)
        VALUES ('statement_generation', ${result.message}, ${JSON.stringify(result.statements)}, NOW())
      `;
      
      return res.status(200).json({
        success: true,
        message: result.message,
        statementsGenerated: result.statements.length
      });
    } else {
      throw new Error('Failed to generate statements');
    }
    
  } catch (error) {
    console.error('💥 Statement scheduler error:', error);
    
    // Log the error
    try {
      await sql`
        INSERT INTO system_logs (event_type, message, data, created_at)
        VALUES ('statement_generation_error', ${error.message}, ${JSON.stringify({ error: error.stack })}, NOW())
      `;
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }
    
    return res.status(500).json({
      success: false,
      error: 'Statement generation failed',
      details: error.message
    });
  }
};

// Create system logs table for audit trail
/*
CREATE TABLE IF NOT EXISTS system_logs (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_system_logs_event_type ON system_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs(created_at);
*/
