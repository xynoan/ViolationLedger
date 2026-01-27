import db from './database.js';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Admin user credentials
const adminEmail = 'ledgerviolation@gmail.com';
const adminPassword = 'ledger123!';
const adminName = 'Admin User';
const adminRole = 'admin';

try {
  console.log('Creating admin user...');
  
  // Hash the password (same method as auth.js)
  const passwordHash = crypto.createHash('sha256').update(adminPassword).digest('hex');
  
  // Check if user already exists
  const existingUser = db.prepare('SELECT * FROM users WHERE email = ?').get(adminEmail.toLowerCase().trim());
  
  if (existingUser) {
    // Update existing user
    console.log('User already exists. Updating...');
    db.prepare(`
      UPDATE users 
      SET password = ?, name = ?, role = ?
      WHERE email = ?
    `).run(
      passwordHash,
      adminName,
      adminRole,
      adminEmail.toLowerCase().trim()
    );
    console.log('✅ Admin user updated successfully!');
  } else {
    // Create new user
    const userId = 'USER-ADMIN-001';
    const now = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO users (id, email, password, name, role, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      adminEmail.toLowerCase().trim(),
      passwordHash,
      adminName,
      adminRole,
      now
    );
    console.log('✅ Admin user created successfully!');
  }
  
  // Display user info
  const user = db.prepare('SELECT id, email, name, role FROM users WHERE email = ?').get(adminEmail.toLowerCase().trim());
  console.log('\nUser Details:');
  console.log('  Email:', user.email);
  console.log('  Name:', user.name);
  console.log('  Role:', user.role);
  console.log('  ID:', user.id);
  console.log('\n✅ You can now log in with:');
  console.log('   Email: ledgerviolation@gmail.com');
  console.log('   Password: ledger123!');
  
  // Save database
  db.close();
  process.exit(0);
} catch (error) {
  console.error('❌ Error creating admin user:', error);
  console.error('   Details:', error.message);
  process.exit(1);
}
