// api/generate-statements.js - Fixed jsPDF import and PDF generation
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');

// Note: jsPDF might not work in Node.js environment
// We'll create a simple PDF structure instead

// CSV Data Cache
let csvCache = null;
let csvCacheTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Load CSV data with cumulative returns
async function loadCSVData() {
  if (csvCache && csvCacheTime && Date.now() - csvCacheTime < CACHE_DURATION) {
    return csvCache;
  }

  try {
    const response = await fetch('https://aequitasdash.vercel.app/data/daily_returns_simple.csv');
    if (!response.ok) throw new Error('CSV file not accessible');
    
    const csvContent = await response.text();
    const lines = csvContent.split('\n');
    const csvData = {};
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const values = line.split(',');
      if (values.length >= 3) {
        const date = values[0].trim();
        const cumulativeReturn = parseFloat(values[2].trim());
        
        if (!isNaN(cumulativeReturn)) {
          csvData[date] = cumulativeReturn;
        }
      }
    }
    
    csvCache = csvData;
    csvCacheTime = Date.now();
    return csvData;
  } catch (error) {
    console.error('Failed to load CSV data:', error);
    return {};
  }
}

// Calculate client performance for a specific period
function calculateClientPerformance(deposits, csvData, periodStart, periodEnd) {
  let totalDeposits = 0;
  let startBalance = 0;
  let endBalance = 0;
  let newDeposits = 0;

  const sortedDeposits = deposits.sort((a, b) => {
    const dateA = new Date(a.deposit_date || a.created_at);
    const dateB = new Date(b.deposit_date || b.created_at);
    return dateA - dateB;
  });

  const periodStartStr = periodStart.toISOString().split('T')[0];
  const periodEndStr = periodEnd.toISOString().split('T')[0];

  for (const deposit of sortedDeposits) {
    const depositAmount = parseFloat(deposit.amount);
    const depositDate = new Date(deposit.deposit_date || deposit.created_at);
    const depositDateStr = depositDate.toISOString().split('T')[0];

    totalDeposits += depositAmount;

    // Calculate start of period balance
    if (depositDate <= periodStart) {
      const startCumulative = csvData[depositDateStr];
      const periodStartCumulative = csvData[periodStartStr];
      
      if (startCumulative && periodStartCumulative) {
        const multiplier = periodStartCumulative / startCumulative;
        startBalance += depositAmount * multiplier;
      } else {
        startBalance += depositAmount;
      }
    }

    // Calculate end of period balance
    const startCumulative = csvData[depositDateStr];
    const periodEndCumulative = csvData[periodEndStr];
    
    if (startCumulative && periodEndCumulative) {
      const multiplier = periodEndCumulative / startCumulative;
      endBalance += depositAmount * multiplier;
    } else {
      endBalance += depositAmount;
    }

    // Track new deposits during period
    if (depositDate > periodStart && depositDate <= periodEnd) {
      newDeposits += depositAmount;
    }
  }

  return {
    totalDeposits,
    startBalance,
    endBalance,
    newDeposits,
    totalGain: endBalance - startBalance - newDeposits,
    returnPercent: startBalance > 0 ? ((endBalance - startBalance - newDeposits) / startBalance) * 100 : 0
  };
}

// Generate PDF statement exactly like your image
async function generateClientStatement(client, performance, period) {
  // For now, let's create a simple HTML-to-PDF approach
  // Since jsPDF might not work in Node.js environment
  
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 2
    }).format(amount);
  };

  const formatDate = (date) => {
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(date);
  };

  // Create HTML content that matches your PDF layout exactly
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; }
        .p11-badge { background: #10b981; color: white; padding: 15px; border-radius: 8px; font-weight: bold; font-size: 18px; }
        .company-info h1 { margin: 0; font-size: 18px; }
        .company-info p { margin: 2px 0; font-size: 12px; color: #6b7280; }
        .title { text-align: center; font-size: 20px; font-weight: bold; margin: 30px 0; }
        .info-section { display: inline-block; width: 45%; vertical-align: top; margin-right: 5%; }
        .info-section h3 { margin: 0 0 10px 0; font-size: 14px; color: #374151; text-transform: uppercase; }
        .info-section p { margin: 2px 0; font-size: 13px; color: #4b5563; }
        .summary-table { width: 100%; border-collapse: collapse; margin: 30px 0; }
        .summary-table th, .summary-table td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
        .summary-table th { background: #f9fafb; font-weight: 600; }
        .amount { font-weight: 600; }
        .positive { color: #059669; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 11px; color: #6b7280; line-height: 1.5; }
        .footer h4 { margin: 0 0 10px 0; font-size: 12px; color: #374151; }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div class="p11-badge">P11</div>
          <div class="company-info">
            <h1>P11 Fund Administration</h1>
            <p>Independent Fund Administrator</p>
            <p>Regulated by FCA</p>
          </div>
        </div>
        <div>
          <p style="text-align: right; font-weight: bold;">Aequitas Capital Partners</p>
        </div>
      </div>

      <div class="title">CONFIDENTIAL ACCOUNT STATEMENT</div>

      <div class="info-section">
        <h3>Client Information</h3>
        <p><strong>Name:</strong> ${client.first_name} ${client.last_name}</p>
        <p><strong>Address:</strong> ${client.address || '123 Main Street, London, UK'}</p>
        <p><strong>Account:</strong> ${client.account_number || 'ACP-2025-890'}</p>
      </div>

      <div class="info-section">
        <h3>Statement Period</h3>
        <p><strong>Period:</strong> ${period.name}</p>
        <p><strong>Issue Date:</strong> ${formatDate(new Date())}</p>
        <p><strong>Administrator:</strong> P11 Fund Administration</p>
      </div>

      <table class="summary-table">
        <thead>
          <tr>
            <th>Description</th>
            <th style="text-align: right;">Amount (£)</th>
            <th style="text-align: right;">Percentage</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Opening Balance</td>
            <td class="amount" style="text-align: right;">${formatCurrency(performance.startBalance)}</td>
            <td style="text-align: right;">-</td>
          </tr>
          <tr>
            <td>Additional Deposits</td>
            <td class="amount" style="text-align: right;">${formatCurrency(performance.newDeposits)}</td>
            <td style="text-align: right;">-</td>
          </tr>
          <tr>
            <td>Investment Gains/(Losses)</td>
            <td class="amount positive" style="text-align: right;">${formatCurrency(performance.totalGain)}</td>
            <td class="positive" style="text-align: right;">${performance.returnPercent.toFixed(2)}%</td>
          </tr>
          <tr>
            <td>Withdrawals</td>
            <td class="amount" style="text-align: right;">${formatCurrency(0)}</td>
            <td style="text-align: right;">-</td>
          </tr>
          <tr style="border-top: 2px solid #374151;">
            <td><strong>Closing Balance</strong></td>
            <td class="amount" style="text-align: right; font-weight: bold;">${formatCurrency(performance.endBalance)}</td>
            <td style="text-align: right; font-weight: bold;">${((performance.endBalance / performance.startBalance - 1) * 100).toFixed(2)}%</td>
          </tr>
        </tbody>
      </table>

      <div class="footer">
        <h4>Important Information</h4>
        <p><strong>Fund Administrator:</strong> This statement has been prepared by P11 Fund Administration, an independent fund administrator regulated by the Financial Conduct Authority (FCA). P11 provides professional oversight and ensures all statements are independently verified and audited.</p>
        
        <p><strong>Trade History:</strong> A detailed audit log of all transactions is available upon request. To protect proprietary trading strategies and fund intellectual property, specific entry prices, stop-loss levels, and position sizing details are not disclosed in standard reporting. This information is maintained in our secure audit trail for regulatory compliance purposes.</p>
        
        <p><strong>Confidentiality:</strong> This statement contains confidential and proprietary information. It is intended solely for the named account holder and should not be distributed to third parties without prior written consent from Aequitas Capital Partners.</p>
        
        <p><strong>Performance Disclaimer:</strong> Past performance is not indicative of future results. Investment values can go down as well as up. Please refer to the fund's offering documents for complete risk disclosures.</p>
        
        <p style="margin-top: 15px; font-size: 10px; color: #9ca3af;">Generated on ${formatDate(new Date())} | P11 Fund Administration | Aequitas Capital Partners</p>
      </div>
    </body>
    </html>
  `;

  // For now, return the HTML content as a simple response
  // In production, you'd convert this to PDF using puppeteer or similar
  return Buffer.from(htmlContent, 'utf-8');
}

// Get available statement periods based on client's actual deposits
function getAvailableStatementPeriods(deposits) {
  const periods = [];
  const now = new Date();
  
  if (!deposits || deposits.length === 0) {
    return periods;
  }
  
  // Get the range of years from first deposit to current year
  const depositDates = deposits.map(d => new Date(d.deposit_date || d.created_at));
  const earliestDeposit = new Date(Math.min(...depositDates));
  const startYear = earliestDeposit.getFullYear();
  const currentYear = now.getFullYear();
  
  for (let year = startYear; year <= currentYear; year++) {
    // H1 Statement (January - June) - available from July 5th
    const h1Available = new Date(year, 6, 5); // July 5th
    const h1PeriodStart = new Date(year, 0, 1);
    const h1PeriodEnd = new Date(year, 5, 30);
    
    // Check if client had any deposits during H1 period
    const hasH1Deposits = deposits.some(deposit => {
      const depositDate = new Date(deposit.deposit_date || deposit.created_at);
      return depositDate >= h1PeriodStart && depositDate <= h1PeriodEnd;
    });
    
    if (now >= h1Available && hasH1Deposits) {
      periods.push({
        id: `H1-${year}`,
        period: `January - June ${year}`,
        period_start: h1PeriodStart,
        period_end: h1PeriodEnd,
        issue_date: h1Available,
        status: 'available'
      });
    }
    
    // H2 Statement (July - December) - available from January 5th next year
    const h2Available = new Date(year + 1, 0, 5); // January 5th next year
    const h2PeriodStart = new Date(year, 6, 1);
    const h2PeriodEnd = new Date(year, 11, 31);
    
    // Check if client had any deposits during H2 period
    const hasH2Deposits = deposits.some(deposit => {
      const depositDate = new Date(deposit.deposit_date || deposit.created_at);
      return depositDate >= h2PeriodStart && depositDate <= h2PeriodEnd;
    });
    
    if (now >= h2Available && hasH2Deposits) {
      periods.push({
        id: `H2-${year}`,
        period: `July - December ${year}`,
        period_start: h2PeriodStart,
        period_end: h2PeriodEnd,
        issue_date: h2Available,
        status: 'available'
      });
    }
  }
  
  return periods.sort((a, b) => b.period_start - a.period_start);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
    
    if (req.method === 'GET') {
      // Get available statements for current user based on their deposits
      const client = await sql`
        SELECT id, first_name, last_name, email, address, account_number, created_at
        FROM users 
        WHERE id = ${decoded.id} AND role = 'client'
      `;
      
      if (client.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Client not found' });
      }
      
      // Get client's completed deposits
      const deposits = await sql`
        SELECT deposit_date, created_at, amount
        FROM deposits 
        WHERE user_id = ${decoded.id} AND status = 'completed'
        ORDER BY deposit_date ASC
      `;
      
      // Get available periods based on actual deposits
      const availablePeriods = getAvailableStatementPeriods(deposits.rows);
      
      return res.status(200).json({
        success: true,
        statements: availablePeriods
      });
    }
    
    if (req.method === 'POST') {
      const { statementId } = req.body;
      
      if (!statementId) {
        return res.status(400).json({ success: false, error: 'Statement ID required' });
      }
      
      // Get client info
      const client = await sql`
        SELECT id, first_name, last_name, email, address, account_number, created_at
        FROM users 
        WHERE id = ${decoded.id} AND role = 'client'
      `;
      
      if (client.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Client not found' });
      }
      
      const clientData = client.rows[0];
      
      // Parse statement ID to get period info
      const [periodType, year] = statementId.split('-');
      const yearInt = parseInt(year);
      
      let periodStart, periodEnd, periodName;
      
      if (periodType === 'H1') {
        periodStart = new Date(yearInt, 0, 1); // January 1
        periodEnd = new Date(yearInt, 5, 30);   // June 30
        periodName = `January - June ${yearInt}`;
      } else if (periodType === 'H2') {
        periodStart = new Date(yearInt, 6, 1);  // July 1
        periodEnd = new Date(yearInt, 11, 31);  // December 31
        periodName = `July - December ${yearInt}`;
      } else {
        return res.status(400).json({ success: false, error: 'Invalid statement ID' });
      }
      
      // Get client's deposits for this period
      const deposits = await sql`
        SELECT * FROM deposits 
        WHERE user_id = ${decoded.id} AND status = 'completed'
        AND deposit_date <= ${periodEnd}
        ORDER BY deposit_date ASC
      `;
      
      // Load CSV data and calculate performance
      const csvData = await loadCSVData();
      const performance = calculateClientPerformance(deposits.rows, csvData, periodStart, periodEnd);
      
      // Generate PDF
      const pdfBuffer = await generateClientStatement(clientData, performance, {
        name: periodName,
        start: periodStart,
        end: periodEnd
      });
      
      // Return HTML content as PDF (for now)
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `attachment; filename="Aequitas-Statement-${statementId}.html"`);
      
      return res.status(200).send(pdfBuffer);
    }
    
    return res.status(405).json({ success: false, error: 'Method not allowed' });
    
  } catch (error) {
    console.error('Statement generation error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate statement',
      details: error.message
    });
  }
};
