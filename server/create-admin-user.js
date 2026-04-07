import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import db from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server directory
dotenv.config({ path: path.join(__dirname, '.env') });

const adminEmail = process.env.ADMIN_EMAIL?.trim();
const adminPassword = process.env.ADMIN_PASSWORD;
const adminName = (process.env.ADMIN_NAME || 'Admin User').trim();
const adminRole = 'admin';

if (!adminEmail || !adminPassword) {
  console.error('❌ Missing required environment variables.');
  console.error('   Set ADMIN_EMAIL and ADMIN_PASSWORD in .env (or export them) before running this script.');
  console.error('   Optional: ADMIN_NAME (default: "Admin User")');
  process.exit(1);
}

try {
  console.log('Creating admin user...');

  const emailNormalized = adminEmail.toLowerCase().trim();

  // Hash the password (same method as auth.js)
  const passwordHash = crypto.createHash('sha256').update(adminPassword).digest('hex');

  // Check if user already exists
  const existingUser = db.prepare('SELECT * FROM users WHERE email = ?').get(emailNormalized);

  if (existingUser) {
    // Update existing user
    console.log('User already exists. Updating...');
    db.prepare(`
      UPDATE users 
      SET password = ?, name = ?, role = ?, isActivated = 1, activationToken = NULL, activationExpires = NULL
      WHERE email = ?
    `).run(
      passwordHash,
      adminName,
      adminRole,
      emailNormalized
    );
    console.log('✅ Admin user updated successfully!');
  } else {
    // Create new user
    const userId = 'USER-ADMIN-001';
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO users (id, email, password, name, role, createdAt, status, mustResetPassword, isActivated, activationToken, activationExpires)
      VALUES (?, ?, ?, ?, ?, ?, 'active', 0, 1, NULL, NULL)
    `).run(
      userId,
      emailNormalized,
      passwordHash,
      adminName,
      adminRole,
      now
    );
    console.log('✅ Admin user created successfully!');
  }

  // Display user info
  const user = db.prepare('SELECT id, email, name, role FROM users WHERE email = ?').get(emailNormalized);
  console.log('\nUser Details:');
  console.log('  Email:', user.email);
  console.log('  Name:', user.name);
  console.log('  Role:', user.role);
  console.log('  ID:', user.id);
  console.log('\n✅ You can now log in with the credentials from your .env (ADMIN_EMAIL / ADMIN_PASSWORD).');
  
  // Save database
  db.close();
  process.exit(0);
} catch (error) {
  console.error('❌ Error creating admin user:', error);
  console.error('   Details:', error.message);
  process.exit(1);
}
