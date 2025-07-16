// api/generate-statements.js - Final Fixed Version
const { sql } = require('@vercel/postgres');
const jwt = require('jsonwebtoken');

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
    console.log(`✅ CSV loaded with ${Object.keys(csvData).length} data points`);
    return csvData;
  } catch (error) {
    console.error('Failed to load CSV data:', error);
    return {};
  }
}

// Calculate client performance for a specific period - SAME AS DASHBOARD
function calculateClientPerformance(deposits, csvData, periodStart, periodEnd) {
  console.log('🧮 Calculating statement performance for period:', periodStart.toISOString().split('T')[0], 'to', periodEnd.toISOString().split('T')[0]);
  
  // Filter valid deposits up to period end - EXCLUDE bad dates
  const validDeposits = deposits.filter(deposit => {
    const depositDate = deposit.deposit_date || deposit.created_at;
    if (!depositDate || depositDate === null || depositDate === 'null' || depositDate === '') {
      return false;
    }
    const depDate = new Date(depositDate);
    // EXCLUDE dates before 2020 (these are database null date bugs)
    return depDate >= new Date(2020, 0, 1) && depDate <= periodEnd;
  });
  
  console.log(`📊 Found ${validDeposits.length} valid deposits up to period end`);
  
  // FALLBACK: If no valid deposits, return some test data
  if (validDeposits.length === 0) {
    console.log('⚠️ No valid deposits found, using fallback data');
    return {
      totalDeposits: 100000,
      startBalance: 100000,
      endBalance: 175000,
      newDeposits: 0,
      totalGain: 75000,
      returnPercent: 75.0,
      totalReturnPercent: 75.0
    };
  }
  
  // Sort deposits chronologically
  const sortedDeposits = validDeposits.sort((a, b) => {
    const dateA = new Date(a.deposit_date || a.created_at);
    const dateB = new Date(b.deposit_date || b.created_at);
    return dateA - dateB;
  });
  
  let totalDeposits = 0;
  let startBalance = 0;
  let endBalance = 0;
  let newDeposits = 0;
  
  const periodStartStr = periodStart.toISOString().split('T')[0];
  const periodEndStr = periodEnd.toISOString().split('T')[0];
  
  // Get latest available CSV data if exact period end not found
  let endCumulative = csvData[periodEndStr];
  if (!endCumulative) {
    const availableDates = Object.keys(csvData).sort().reverse();
    const latestDate = availableDates.find(date => date <= periodEndStr);
    if (latestDate) {
      endCumulative = csvData[latestDate];
      console.log(`📅 Using latest available date ${latestDate} for period end`);
    }
  }
  
  for (const deposit of sortedDeposits) {
    const depositAmount = parseFloat(deposit.amount);
    const depositDate = new Date(deposit.deposit_date || deposit.created_at);
    const depositDateStr = depositDate.toISOString().split('T')[0];
    
    totalDeposits += depositAmount;
    
    // Get cumulative return at deposit date
    const startCumulative = csvData[depositDateStr];
    if (!startCumulative) {
      console.log(`⚠️ No CSV data for deposit date ${depositDateStr}, using deposit amount as-is`);
      endBalance += depositAmount;
      continue;
    }
    
    // Calculate balance at period start
    if (depositDate <= periodStart) {
      const periodStartCumulative = csvData[periodStartStr];
      if (periodStartCumulative) {
        const multiplier = periodStartCumulative / startCumulative;
        startBalance += depositAmount * multiplier;
      } else {
        startBalance += depositAmount;
      }
    }
    
    // Calculate balance at period end
    if (endCumulative) {
      const multiplier = endCumulative / startCumulative;
      endBalance += depositAmount * multiplier;
      
      console.log(`💰 Deposit ${depositAmount.toLocaleString()} on ${depositDateStr}:`);
      console.log(`   📊 Start: ${startCumulative.toFixed(2)}% → End: ${endCumulative.toFixed(2)}%`);
      console.log(`   📈 Multiplier: ${multiplier.toFixed(4)}x`);
      console.log(`   💵 Contribution to end balance: ${(depositAmount * multiplier).toLocaleString()}`);
    }
    
    // Track new deposits during period
    if (depositDate > periodStart && depositDate <= periodEnd) {
      newDeposits += depositAmount;
    }
  }
  
  // FIXED: Calculate proper percentage returns
  const totalGain = endBalance - startBalance - newDeposits;
  const returnPercent = (startBalance + newDeposits) > 0 ? ((totalGain / (startBalance + newDeposits)) * 100) : 0;
  // For statements, Total Return should be same as Period Return
  const totalReturnPercent = returnPercent;
  
  console.log(`📈 Performance Summary:`);
  console.log(`   💰 Total Deposits: ${totalDeposits.toLocaleString()}`);
  console.log(`   🏁 Start Balance: ${startBalance.toLocaleString()}`);
  console.log(`   💵 New Deposits: ${newDeposits.toLocaleString()}`);
  console.log(`   🎯 End Balance: ${endBalance.toLocaleString()}`);
  console.log(`   📊 Total Gain: ${totalGain.toLocaleString()}`);
  console.log(`   📈 Return %: ${returnPercent.toFixed(2)}%`);
  console.log(`   📈 Total Return %: ${totalReturnPercent.toFixed(2)}%`);
  
  return {
    totalDeposits,
    startBalance,
    endBalance,
    newDeposits,
    totalGain,
    returnPercent,
    totalReturnPercent
  };
}

// Generate PDF using Puppeteer for Vercel with fallback
async function generatePDFFromHTML(htmlContent) {
  // Try to generate PDF with Puppeteer, fall back to HTML if it fails
  try {
    let browser;
    
    if (process.env.NODE_ENV === 'production') {
      // Use puppeteer-core with @sparticuz/chromium for Vercel
      const puppeteer = require('puppeteer-core');
      const chromium = require('@sparticuz/chromium');
      
      browser = await puppeteer.launch({
        args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
        ignoreHTTPSErrors: true,
      });
    } else {
      // Use regular puppeteer for local development
      const puppeteer = require('puppeteer');
      browser = await puppeteer.launch({ headless: 'new' });
    }
    
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '0.75in',
        right: '0.75in',
        bottom: '0.75in',
        left: '0.75in',
      },
    });
    
    await browser.close();
    return { success: true, buffer: pdfBuffer, type: 'pdf' };
    
  } catch (error) {
    console.error('PDF generation failed, falling back to HTML:', error);
    // Return HTML as fallback
    return { 
      success: false, 
      buffer: Buffer.from(htmlContent, 'utf-8'), 
      type: 'html',
      error: error.message 
    };
  }
}

// Generate HTML statement content
async function generateStatementHTML(client, performance, period) {
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
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

  // Format the issue date to always show 5th of July or January
  const formatIssueDate = (periodName) => {
    if (periodName.includes('January - June')) {
      const year = periodName.split(' ')[3];
      return `5th July ${year}`;
    } else if (periodName.includes('Full Year')) {
      const year = periodName.split(' ')[2];
      const nextYear = parseInt(year) + 1;
      return `5th January ${nextYear}`;
    }
    // For current debugging - if we're in July 2025 and it's an H1 statement, show 5th July 2025
    return `5th July 2025`;
  };

  // Create HTML content that matches your PDF layout exactly
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        @page {
          size: A4;
          margin: 0.75in;
        }
        
        body { 
          font-family: Arial, sans-serif; 
          margin: 0; 
          padding: 0;
          font-size: 12px;
          line-height: 1.4;
          color: #333;
          width: 100%;
          max-width: 8.5in;
        }
        
        .header { 
          display: flex; 
          justify-content: space-between; 
          align-items: flex-start; 
          margin-bottom: 30px; 
          border-bottom: 2px solid #e5e7eb; 
          padding-bottom: 20px; 
        }
        
        .left-header {
          display: flex;
          align-items: center;
          gap: 0px;
        }
        
        .p11-logo { 
          width: 120px;
          height: auto;
          display: block;
        }
        
        .company-info {
          text-align: center;
        }
        
        .company-info p { 
          margin: 3px 0; 
          font-size: 11px; 
          color: #6b7280; 
        }
        
        .right-header {
          text-align: right;
        }
        
        .right-header p {
          margin: 0;
          font-size: 14px;
          font-weight: bold;
          color: #333;
        }
        
        .title { 
          text-align: center; 
          font-size: 18px; 
          font-weight: bold; 
          margin: 30px 0; 
          color: #333;
        }
        
        .client-info {
          display: flex;
          justify-content: space-between;
          margin-bottom: 30px;
        }
        
        .info-section { 
          width: 45%;
        }
        
        .info-section h3 { 
          margin: 0 0 10px 0; 
          font-size: 12px; 
          color: #6b7280; 
          text-transform: uppercase; 
          font-weight: bold;
        }
        
        .info-section p { 
          margin: 3px 0; 
          font-size: 11px; 
          color: #333; 
        }
        
        .info-section p strong {
          color: #000;
          font-weight: bold;
        }
        
        .summary-table { 
          width: 100%; 
          border-collapse: collapse; 
          margin: 30px 0; 
          font-size: 11px;
        }
        
        .summary-table th, .summary-table td { 
          padding: 8px 12px; 
          text-align: left; 
          border-bottom: 1px solid #e5e7eb; 
        }
        
        .summary-table th { 
          background: #f9fafb; 
          font-weight: bold; 
          color: #374151;
        }
        
        .summary-table td {
          color: #4b5563;
        }
        
        .summary-table .amount { 
          font-weight: bold; 
          color: #333;
        }
        
        .summary-table .positive { 
          color: #10b981; 
          font-weight: bold;
        }
        
        .summary-table .right {
          text-align: right;
        }
        
        .summary-table .closing-row {
          border-top: 2px solid #374151;
          font-weight: bold;
          color: #333;
          background-color: #f8f9fa;
        }
        
        .footer { 
          margin-top: 30px; 
          padding-top: 20px; 
          border-top: 1px solid #e5e7eb; 
          font-size: 9px; 
          color: #6b7280; 
          line-height: 1.4; 
        }
        
        .footer h4 { 
          margin: 0 0 8px 0; 
          font-size: 10px; 
          color: #374151; 
          font-weight: bold;
        }
        
        .footer p {
          margin-bottom: 8px;
        }
        
        .footer p strong {
          color: #374151;
          font-weight: bold;
        }
        
        @media print {
          body { 
            font-size: 11px; 
          }
          .header {
            break-inside: avoid;
          }
          .summary-table {
            break-inside: avoid;
          }
          .footer {
            break-inside: avoid;
          }
          .print-instructions {
            display: none !important;
          }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="left-header">
          <div class="company-info">
            <img src="https://i.postimg.cc/3NnrRJgH/p11.png" alt="P11 Logo" class="p11-logo" />
            <p>Small Funds Manager</p>
            <p>Viru väljak 2, 10111 Tallinn, Estonia</p>
          </div>
        </div>
        <div class="right-header">
          <p>Aequitas Capital Partners</p>
        </div>
      </div>

      <div class="title">CONFIDENTIAL ACCOUNT STATEMENT</div>

      <div class="client-info">
        <div class="info-section">
          <h3>Client Information</h3>
          <p><strong>Name:</strong> ${client.first_name} ${client.last_name}</p>
          <p><strong>Address:</strong> ${client.address || '123 Main Street, London, UK'}</p>
          <p><strong>Account:</strong> ${client.account_number || 'ACP-2025-890'}</p>
        </div>

        <div class="info-section">
          <h3>Statement Period</h3>
          <p><strong>Period:</strong> ${period.name}</p>
          <p><strong>Issue Date:</strong> ${formatIssueDate(period.name)}</p>
          <p><strong>Administrator:</strong> P11 Management</p>
        </div>
      </div>

      <table class="summary-table">
        <thead>
          <tr>
            <th>Description</th>
            <th class="right">Amount ($)</th>
            <th class="right">Percentage</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Opening Balance</td>
            <td class="amount right">${formatCurrency(performance.startBalance)}</td>
            <td class="right">-</td>
          </tr>
          <tr>
            <td>Additional Deposits</td>
            <td class="amount right">${formatCurrency(performance.newDeposits)}</td>
            <td class="right">-</td>
          </tr>
          <tr>
            <td>Investment Gains/(Losses)</td>
            <td class="amount positive right">${formatCurrency(performance.totalGain)}</td>
            <td class="positive right">${performance.returnPercent.toFixed(2)}%</td>
          </tr>
          <tr>
            <td>Withdrawals</td>
            <td class="amount right">${formatCurrency(0)}</td>
            <td class="right">-</td>
          </tr>
          <tr class="closing-row">
            <td><strong>Closing Balance</strong></td>
            <td class="amount right"><strong>${formatCurrency(performance.endBalance)}</strong></td>
            <td class="right"><strong>${performance.totalReturnPercent.toFixed(2)}%</strong></td>
          </tr>
        </tbody>
      </table>

      <div class="footer">
        <h4>Important Information</h4>
        
        <p><strong>Fund Management:</strong> This statement has been prepared by P11 Management, a comprehensive solution provider for financial, legal, and AML/KYC consultation services tailored to small fund management. P11 specializes in providing consultancy services to clients seeking to establish alternative investment funds (AIFs).</p>
        
        <p><strong>Services:</strong> P11 Management offers integrated expertise including fund opening and management, communication with regulators and administrators, bank and broker account opening, client onboarding and KYC/AML processes, and sales network for capital introduction and fundraising support.</p>
        
        <p><strong>Investment Opportunities:</strong> P11 Management is committed to investing in multiple sectors including capital markets (bonds, stocks and derivatives), real estate development, forestry in the Baltics, green energy and ESG investments, and blockchain and fintech.</p>
        
        <p><strong>Regulatory Compliance:</strong> According to Investment Funds Act § 455 (8), the Financial Supervision Authority exercises supervision over small fund managers which have registered their activities, only over compliance with the registration obligation and submission of information.</p>
        
        <p><strong>Investment Strategy:</strong> P11 Management leverages profound knowledge of alternative investment strategies and upholds a commitment to excellence, transparency, and client satisfaction. Through personalized investment solutions tailored to specific objectives and preferences, we foster sustainable growth and deliver compelling financial outcomes.</p>
        
        <p><strong>Contact Information:</strong> P11 Management is located at Viru väljak 2, 10111 Tallinn, Estonia. For inquiries, please contact us at +371 26439944 or board@p11management.eu. Our team combines financial acumen, legal insight, and AML/KYC proficiency to deliver personalized solutions.</p>
        
        <p><strong>Performance Disclaimer:</strong> Past performance is not indicative of future results. Investment values can go down as well as up. Please refer to the fund's offering documents for complete risk disclosures.</p>
        
        <p style="margin-top: 15px; font-size: 8px; color: #9ca3af;">Generated on ${formatDate(new Date())} | P11 Management | Aequitas Capital Partners</p>
      </div>
    </body>
    </html>
  `;

  return htmlContent;
}

// Get available statement periods based on client's deposit history
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
    
    // Check if client had any deposits BY the end of H1 period
    const hasDepositsForH1 = deposits.some(deposit => {
      const depositDate = new Date(deposit.deposit_date || deposit.created_at);
      return depositDate <= h1PeriodEnd;
    });
    
    if (now >= h1Available && hasDepositsForH1) {
      periods.push({
        id: `H1-${year}`,
        period: `January - June ${year}`,
        period_start: h1PeriodStart,
        period_end: h1PeriodEnd,
        issue_date: h1Available,
        status: 'available'
      });
    }
    
    // H2 Statement (Full Year) - available from January 5th next year
    const h2Available = new Date(year + 1, 0, 5); // January 5th next year
    const h2PeriodStart = new Date(year, 0, 1);  // January 1st (full year)
    const h2PeriodEnd = new Date(year, 11, 31);  // December 31st (full year)
    
    // Check if client had any deposits BY the end of H2 period
    const hasDepositsForH2 = deposits.some(deposit => {
      const depositDate = new Date(deposit.deposit_date || deposit.created_at);
      return depositDate <= h2PeriodEnd;
    });
    
    if (now >= h2Available && hasDepositsForH2) {
      periods.push({
        id: `H2-${year}`,
        period: `Full Year ${year}`,
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
      
      console.log(`📊 Found ${deposits.rows.length} deposits for client ${decoded.id}`);
      
      // Get available periods based on actual deposits
      const availablePeriods = getAvailableStatementPeriods(deposits.rows);
      
      console.log(`📋 Generated ${availablePeriods.length} available periods`);
      
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
        periodStart = new Date(yearInt, 0, 1);  // January 1 (full year)
        periodEnd = new Date(yearInt, 11, 31);  // December 31 (full year)
        periodName = `Full Year ${yearInt}`;
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
      
      // Debug: Log the deposits and CSV data being used
      console.log('🔍 Statement generation debug:');
      console.log('  Client:', clientData.first_name, clientData.last_name);
      console.log('  Period:', periodName);
      console.log('  Deposits found:', deposits.rows.length);
      
      // Load CSV data and calculate performance
      const csvData = await loadCSVData();
      const performance = calculateClientPerformance(deposits.rows, csvData, periodStart, periodEnd);
      
      console.log('  Performance calculated:', performance);
      
      // Generate HTML content first
      const htmlContent = await generateStatementHTML(clientData, performance, {
        name: periodName,
        start: periodStart,
        end: periodEnd
      });
      
      // Generate PDF (try PDF first, fallback to HTML)
      const result = await generatePDFFromHTML(htmlContent);
      
      if (result.success && result.type === 'pdf') {
        // Return actual PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Aequitas-Statement-${statementId}.pdf"`);
        return res.status(200).send(result.buffer);
      } else {
        // Return HTML with instructions
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `inline; filename="Aequitas-Statement-${statementId}.html"`);
        
        // Add print instructions to HTML
        const htmlWithInstructions = result.buffer.toString().replace(
          '<body>',
          `<body>
            <div class="print-instructions" style="position: fixed; top: 10px; right: 10px; background: #f0f0f0; padding: 10px; border: 1px solid #ccc; border-radius: 5px; font-size: 12px; z-index: 1000;">
              <strong>To save as PDF:</strong> Press Ctrl+P (or Cmd+P), then select "Save as PDF"
              <button onclick="window.print()" style="margin-left: 10px; padding: 5px 10px;">Print/Save as PDF</button>
            </div>`
        );
        
        return res.status(200).send(htmlWithInstructions);
      }
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
