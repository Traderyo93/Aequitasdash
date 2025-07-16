// api/generate-statements.js - Simplified On-Demand Statement Generation
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');
const jsPDF = require('jspdf');

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

// Generate PDF statement exactly like your preview
async function generateClientStatement(client, performance, period) {
  const doc = new jsPDF();
  
  // Helper functions
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

  // Set up fonts
  doc.setFont('helvetica');
  
  // Header Section with P11 and Aequitas branding
  doc.setFillColor(16, 185, 129); // Green color for P11
  doc.rect(20, 15, 25, 25, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('P11', 32.5, 32, { align: 'center' });
  
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(16);
  doc.text('P11 Fund Administration', 55, 25);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Independent Fund Administrator', 55, 32);
  doc.text('Regulated by FCA', 55, 37);
  
  // Aequitas logo area (right side)
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Aequitas Capital Partners', 140, 30);
  
  // Title
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('CONFIDENTIAL ACCOUNT STATEMENT', 105, 55, { align: 'center' });
  
  // Client Information Section
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('CLIENT INFORMATION', 20, 80);
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Name: ${client.first_name} ${client.last_name}`, 20, 90);
  doc.text(`Address: ${client.address || '123 Main Street, London, UK'}`, 20, 97);
  doc.text(`Account: ${client.account_number || 'ACP-2025-001'}`, 20, 104);
  
  // Statement Period Section
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('STATEMENT PERIOD', 120, 80);
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Period: ${period.name}`, 120, 90);
  doc.text(`Issue Date: ${formatDate(new Date())}`, 120, 97);
  doc.text('Administrator: P11 Fund Administration', 120, 104);
  
  // Account Summary Table
  const tableStartY = 125;
  
  // Table headers
  doc.setFillColor(248, 249, 250);
  doc.rect(20, tableStartY, 170, 10, 'F');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Description', 25, tableStartY + 7);
  doc.text('Amount (£)', 120, tableStartY + 7);
  doc.text('Percentage', 160, tableStartY + 7);
  
  // Table data
  const tableData = [
    ['Opening Balance', performance.startBalance, '-'],
    ['Additional Deposits', performance.newDeposits, '-'],
    ['Investment Gains/(Losses)', performance.totalGain, `${performance.returnPercent.toFixed(2)}%`],
    ['Withdrawals', 0, '-'],
    ['Closing Balance', performance.endBalance, `${((performance.endBalance / performance.startBalance - 1) * 100).toFixed(2)}%`]
  ];
  
  let yPos = tableStartY + 15;
  doc.setFont('helvetica', 'normal');
  
  tableData.forEach((row, index) => {
    if (index === tableData.length - 1) {
      // Bold line for closing balance
      doc.line(20, yPos - 3, 190, yPos - 3);
      doc.setFont('helvetica', 'bold');
    }
    
    doc.text(row[0], 25, yPos);
    doc.text(formatCurrency(row[1]), 120, yPos);
    doc.text(row[2], 160, yPos);
    yPos += 10;
  });
  
  // Important Information Section
  yPos += 20;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Important Information', 20, yPos);
  yPos += 10;
  
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  
  const disclaimers = [
    'Fund Administrator: This statement has been prepared by P11 Fund Administration, an independent fund administrator regulated by the Financial Conduct Authority (FCA). P11 provides professional oversight and ensures all statements are independently verified and audited.',
    '',
    'Trade History: A detailed audit log of all transactions is available upon request. To protect proprietary trading strategies and fund intellectual property, specific entry prices, stop-loss levels, and position sizing details are not disclosed in standard reporting. This information is maintained in our secure audit trail for regulatory compliance purposes.',
    '',
    'Confidentiality: This statement contains confidential and proprietary information. It is intended solely for the named account holder and should not be distributed to third parties without prior written consent from Aequitas Capital Partners.',
    '',
    'Performance Disclaimer: Past performance is not indicative of future results. Investment values can go down as well as up. Please refer to the fund\'s offering documents for complete risk disclosures.',
    '',
    `Generated on ${formatDate(new Date())} | P11 Fund Administration | Aequitas Capital Partners`
  ];
  
  disclaimers.forEach(text => {
    if (yPos > 270) { // New page if needed
      doc.addPage();
      yPos = 20;
    }
    if (text === '') {
      yPos += 4;
    } else {
      const lines = doc.splitTextToSize(text, 170);
      lines.forEach(line => {
        doc.text(line, 20, yPos);
        yPos += 4;
      });
    }
  });
  
  return doc.output('arraybuffer');
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
      
      // Return PDF
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Aequitas-Statement-${statementId}.pdf"`);
      
      return res.status(200).send(Buffer.from(pdfBuffer));
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
