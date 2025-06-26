// In your existing api/users.js, replace the POST section with this:

if (req.method === 'POST') {
  // Create new user with setup requirement
  const { firstName, lastName, email, initialDeposit = 0 } = req.body;
  
  if (!firstName || !lastName || !email) {
    return res.status(400).json({
      success: false,
      error: 'First name, last name, and email are required'
    });
  }
  
  // Check if user exists
  const existingUser = await sql`SELECT id FROM users WHERE email = ${email}`;
  if (existingUser.rows.length > 0) {
    return res.status(409).json({
      success: false,
      error: 'User with this email already exists'
    });
  }
  
  // Generate default password: FirstnameLastname123!
  const defaultPassword = `${firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase()}${lastName.charAt(0).toUpperCase() + lastName.slice(1).toLowerCase()}123!`;
  const hashedPassword = await bcrypt.hash(defaultPassword, 12);
  
  // Create user
  const userId = 'usr_' + Date.now();
  const result = await sql`
    INSERT INTO users (
      id, email, password_hash, role, first_name, last_name,
      account_value, starting_balance, setup_status, setup_step, password_must_change
    )
    VALUES (
      ${userId}, ${email}, ${hashedPassword}, 'client', ${firstName}, ${lastName},
      ${parseFloat(initialDeposit)}, ${parseFloat(initialDeposit)}, 
      'pending', 1, true
    )
    RETURNING id, email, first_name, last_name
  `;
  
  const newUser = result.rows[0];
  
  return res.status(201).json({
    success: true,
    message: 'User created - setup required',
    user: newUser,
    tempPassword: defaultPassword,
    setupInstructions: `
New user created: ${email}
Temporary password: ${defaultPassword}
User must:
1. Login and change password
2. Complete account setup
3. Wait for admin approval
    `
  });
}
