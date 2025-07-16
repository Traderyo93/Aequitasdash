// api/generate-statements.js - Automated Statement Generation
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');

// PDF Generation using jsPDF
const jsPDF = require('jspdf');

// CSV Data Cache for performance calculations
let csvCache = null;
let csvCacheTime = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Load CSV data with cumulative returns (same as admin-stats.js)
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

// Calculate client performance using cumulative returns
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

// Generate PDF statement for a client
async function generateClientStatement(client, performance, period) {
  const doc = new jsPDF();
  
  // Helper function to format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP'
    }).format(amount);
  };

  // Helper function to format date
  const formatDate = (date) => {
    return new Intl.DateTimeFormat('en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(date);
  };

  // Set up fonts
  doc.setFont('helvetica');
  
  // Header Section
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('P11 Fund Administration', 20, 20);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('Independent Fund Administrator • Regulated by FCA', 20, 26);
  
  // Aequitas branding (right side)
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Aequitas Capital Partners', 140, 20);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Professional Investment Management', 140, 26);
  
  // Statement title
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('CONFIDENTIAL ACCOUNT STATEMENT', 20, 45);
  
  // Client information section
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Client Information', 20, 65);
  doc.setFont('helvetica', 'normal');
  doc.text(`Name: ${client.first_name} ${client.last_name}`, 20, 75);
  doc.text(`Address: ${client.address || 'On file'}`, 20, 82);
  doc.text(`Account: ${client.account_number || 'ACP-' + client.id.slice(-6)}`, 20, 89);
  
  // Statement period section
  doc.setFont('helvetica', 'bold');
  doc.text('Statement Period', 120, 65);
  doc.setFont('helvetica', 'normal');
  doc.text(`Period: ${period.name}`, 120, 75);
  doc.text(`Issue Date: ${formatDate(new Date())}`, 120, 82);
  doc.text('Administrator: P11 Fund Administration', 120, 89);
  
  // Account summary table
  doc.setFont('helvetica', 'bold');
  doc.text('ACCOUNT SUMMARY', 20, 110);
  
  const tableData = [
    ['Description', 'Amount (£)', 'Percentage'],
    ['Opening Balance', formatCurrency(performance.startBalance), '-'],
    ['Additional Deposits', formatCurrency(performance.newDeposits), '-'],
    ['Investment Gains/(Losses)', formatCurrency(performance.totalGain), `${performance.returnPercent.toFixed(2)}%`],
    ['Withdrawals', formatCurrency(0), '-'],
    ['Closing Balance', formatCurrency(performance.endBalance), `${((performance.endBalance / performance.startBalance - 1) * 100).toFixed(2)}%`]
  ];
  
  let yPosition = 120;
  doc.setFontSize(10);
  
  // Table header
  doc.setFont('helvetica', 'bold');
  doc.text(tableData[0][0], 20, yPosition);
  doc.text(tableData[0][1], 120, yPosition);
  doc.text(tableData[0][2], 170, yPosition);
  yPosition += 10;
  
  // Table rows
  doc.setFont('helvetica', 'normal');
  for (let i = 1; i < tableData.length; i++) {
    if (i === tableData.length - 1) {
      doc.setFont('helvetica', 'bold'); // Bold for closing balance
    }
    doc.text(tableData[i][0], 20, yPosition);
    doc.text(tableData[i][1], 120, yPosition);
    doc.text(tableData[i][2], 170, yPosition);
    yPosition += 8;
  }
  
  // Footer disclaimer
  yPosition += 20;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Important Information', 20, yPosition);
  yPosition += 8;
  
  doc.setFont('helvetica', 'normal');
  const disclaimerText = [
    'Fund Administrator: This statement has been prepared by P11 Fund Administration, an independent',
    'fund administrator regulated by the Financial Conduct Authority (FCA). P11 provides professional',
    'oversight and ensures all statements are independently verified and audited.',
    '',
    'Trade History: A detailed audit log of all transactions is available upon request. To protect',
    'proprietary trading strategies and fund intellectual property, specific entry prices, stop-loss',
    'levels, and position sizing details are not disclosed in standard reporting. This information is',
    'maintained in our secure audit trail for regulatory compliance purposes.',
    '',
    'Confidentiality: This statement contains confidential and proprietary information. It is intended',
    'solely for the named account holder and should not be distributed to third parties without prior',
    'written consent from Aequitas Capital Partners.',
    '',
    'Performance Disclaimer: Past performance is not indicative of future results. Investment values',
    'can go down as well as up. Please refer to the fund\'s offering documents for complete risk disclosures.',
    '',
    `Generated on ${formatDate(new Date())} | P11 Fund Administration | Aequitas Capital Partners`
  ];
  
  disclaimerText.forEach(line => {
    if (yPosition > 270) { // Start new page if needed
      doc.addPage();
      yPosition = 20;
    }
    doc.text(line, 20, yPosition);
    yPosition += 4;
  });
  
  return doc.output('arraybuffer');
}

// Main handler for statement generation
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  try {
    // Verify admin authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'aequitas-secret-key-2025');
    
    if (decoded.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    if (req.method === 'POST') {
      const { action, period } = req.body;
      
      if (action === 'generate-all') {
        // Generate statements for all active clients
        console.log('📊 Generating statements for all clients...');
        
        // Get all active clients
        const clientsResult = await sql`
          SELECT id, first_name, last_name, email, address, created_at
          FROM users 
          WHERE role = 'client' AND status = 'active'
        `;
        
        const clients = clientsResult.rows;
        console.log(`Found ${clients.length} active clients`);
        
        // Load CSV data for performance calculations
        const csvData = await loadCSVData();
        
        // Determine period dates
        const now = new Date();
        const currentYear = now.getFullYear();
        let periodStart, periodEnd, periodName;
        
        if (period === 'H1') {
          // January - June
          periodStart = new Date(currentYear, 0, 1); // Jan 1
          periodEnd = new Date(currentYear, 5, 30); // June 30
          periodName = `January - June ${currentYear}`;
        } else if (period === 'H2') {
          // July - December
          periodStart = new Date(currentYear, 6, 1); // July 1
          periodEnd = new Date(currentYear, 11, 31); // Dec 31
          periodName = `July - December ${currentYear}`;
        } else {
          return res.status(400).json({ success: false, error: 'Invalid period' });
        }
        
        const generatedStatements = [];
        
        // Generate statement for each client
        for (const client of clients) {
          try {
            // Get client's deposits
            const depositsResult = await sql`
              SELECT * FROM deposits 
              WHERE user_id = ${client.id} AND status = 'completed'
              ORDER BY deposit_date ASC
            `;
            
            const deposits = depositsResult.rows;
            
            if (deposits.length === 0) {
              console.log(`⚠️ No deposits found for client ${client.email}`);
              continue;
            }
            
            // Calculate performance for this period
            const performance = calculateClientPerformance(deposits, csvData, periodStart, periodEnd);
            
            // Generate PDF
            const pdfBuffer = await generateClientStatement(client, performance, {
              name: periodName,
              start: periodStart,
              end: periodEnd
            });
            
            // Store statement in database
            const statementId = `${period}-${currentYear}-${client.id}`;
            
            await sql`
              INSERT INTO statements (
                id, client_id, period, period_start, period_end, 
                pdf_data, generated_at, file_size
              ) VALUES (
                ${statementId}, ${client.id}, ${periodName}, ${periodStart}, ${periodEnd},
                ${Buffer.from(pdfBuffer)}, NOW(), ${pdfBuffer.byteLength}
              )
              ON CONFLICT (id) DO UPDATE SET
                pdf_data = EXCLUDED.pdf_data,
                generated_at = EXCLUDED.generated_at,
                file_size = EXCLUDED.file_size
            `;
            
            generatedStatements.push({
              clientId: client.id,
              clientName: `${client.first_name} ${client.last_name}`,
              email: client.email,
              statementId: statementId,
              period: periodName,
              performance: performance
            });
            
            console.log(`✅ Generated statement for ${client.email}`);
            
          } catch (error) {
            console.error(`💥 Failed to generate statement for ${client.email}:`, error);
          }
        }
        
        return res.status(200).json({
          success: true,
          message: `Generated ${generatedStatements.length} statements for ${periodName}`,
          statements: generatedStatements
        });
      }
      
      if (action === 'download') {
        const { statementId } = req.body;
        
        // Get statement from database
        const statementResult = await sql`
          SELECT pdf_data, period FROM statements 
          WHERE id = ${statementId}
        `;
        
        if (statementResult.rows.length === 0) {
          return res.status(404).json({ success: false, error: 'Statement not found' });
        }
        
        const statement = statementResult.rows[0];
        
        // Return PDF data
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Statement-${statementId}.pdf"`);
        
        return res.status(200).send(statement.pdf_data);
      }
    }
    
    if (req.method === 'GET') {
      // Get available statements for current user or all if admin
      const userId = decoded.role === 'admin' ? null : decoded.id;
      
      let statementsResult;
      if (userId) {
        statementsResult = await sql`
          SELECT id, period, period_start, period_end, generated_at, file_size
          FROM statements 
          WHERE client_id = ${userId}
          ORDER BY period_start DESC
        `;
      } else {
        statementsResult = await sql`
          SELECT s.id, s.period, s.period_start, s.period_end, s.generated_at, s.file_size,
                 u.first_name, u.last_name, u.email
          FROM statements s
          JOIN users u ON s.client_id = u.id
          ORDER BY s.period_start DESC
        `;
      }
      
      return res.status(200).json({
        success: true,
        statements: statementsResult.rows
      });
    }
    
    return res.status(405).json({ success: false, error: 'Method not allowed' });
    
  } catch (error) {
    console.error('💥 Statement generation error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate statements',
      details: error.message
    });
  }
};
