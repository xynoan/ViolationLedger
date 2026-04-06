import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import db from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server directory
dotenv.config({ path: path.join(__dirname, '.env') });

function requiredEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

function optionalEnv(name) {
  const value = process.env[name];
  return value == null ? undefined : String(value).trim();
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function normalizeEmail(email) {
  return String(email || '').toLowerCase().trim();
}

function upsertUser({
  id,
  email,
  password,
  name,
  role,
  status = 'active',
  contactNumber,
  mustResetPassword = 0,
}) {
  const emailNormalized = normalizeEmail(email);
  const now = new Date().toISOString();
  const passwordHash = sha256(password);

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(emailNormalized);
  if (existing) {
    db.prepare(
      `
      UPDATE users
      SET password = ?,
          name = ?,
          role = ?,
          status = ?,
          contactNumber = ?,
          mustResetPassword = ?
      WHERE email = ?
    `
    ).run(
      passwordHash,
      name || emailNormalized,
      role,
      status,
      contactNumber || null,
      mustResetPassword ? 1 : 0,
      emailNormalized
    );
    return { action: 'updated', email: emailNormalized };
  }

  db.prepare(
    `
    INSERT INTO users (id, email, password, name, role, createdAt, status, contactNumber, mustResetPassword)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    id,
    emailNormalized,
    passwordHash,
    name || emailNormalized,
    role,
    now,
    status,
    contactNumber || null,
    mustResetPassword ? 1 : 0
  );
  return { action: 'created', email: emailNormalized };
}

function printUsage() {
  console.log('\nUsage: set these in server/.env (or export), then run: node create-default-users.js\n');
  console.log('Encoder user env vars:');
  console.log('  ENCODER_EMAIL, ENCODER_PASSWORD');
  console.log('  Optional: ENCODER_NAME, ENCODER_CONTACT_NUMBER, ENCODER_STATUS, ENCODER_MUST_RESET_PASSWORD\n');
  console.log('Barangay user env vars:');
  console.log('  BARANGAY_EMAIL, BARANGAY_PASSWORD');
  console.log('  Optional: BARANGAY_NAME, BARANGAY_CONTACT_NUMBER, BARANGAY_STATUS, BARANGAY_MUST_RESET_PASSWORD\n');
  console.log('Notes:');
  console.log('  - This script will CREATE or UPDATE users by email.');
  console.log("  - Roles are set to 'encoder' and 'barangay_user'.");
  console.log("  - Set *_MUST_RESET_PASSWORD=1 if you want to force change password on first login.\n");
}

try {
  const encoderEmail = requiredEnv('ENCODER_EMAIL');
  const encoderPassword = requiredEnv('ENCODER_PASSWORD');
  const barangayEmail = requiredEnv('BARANGAY_EMAIL');
  const barangayPassword = requiredEnv('BARANGAY_PASSWORD');

  console.log('Creating/updating default users...');

  const encoderResult = upsertUser({
    id: 'USER-ENCODER-001',
    email: encoderEmail,
    password: encoderPassword,
    name: optionalEnv('ENCODER_NAME'),
    role: 'encoder',
    status: optionalEnv('ENCODER_STATUS') || 'active',
    contactNumber: optionalEnv('ENCODER_CONTACT_NUMBER'),
    mustResetPassword: Number(optionalEnv('ENCODER_MUST_RESET_PASSWORD') || 0) ? 1 : 0,
  });

  const barangayResult = upsertUser({
    id: 'USER-BARANGAY-001',
    email: barangayEmail,
    password: barangayPassword,
    name: optionalEnv('BARANGAY_NAME'),
    role: 'barangay_user',
    status: optionalEnv('BARANGAY_STATUS') || 'active',
    contactNumber: optionalEnv('BARANGAY_CONTACT_NUMBER'),
    mustResetPassword: Number(optionalEnv('BARANGAY_MUST_RESET_PASSWORD') || 0) ? 1 : 0,
  });

  const users = db
    .prepare('SELECT id, email, name, role, status, mustResetPassword FROM users WHERE email IN (?, ?)')
    .all(normalizeEmail(encoderEmail), normalizeEmail(barangayEmail));

  console.log(`✅ Encoder: ${encoderResult.action}`);
  console.log(`✅ Barangay: ${barangayResult.action}`);
  console.log('\nUser Details:');
  for (const u of users) {
    console.log(`  - ${u.email} | ${u.role} | status=${u.status} | mustResetPassword=${u.mustResetPassword} | id=${u.id}`);
  }

  // Ensure database write is flushed before exit
  if (typeof db.saveImmediate === 'function') {
    db.saveImmediate();
  }
  db.close();
  process.exit(0);
} catch (error) {
  console.error('❌ Error creating/updating users:', error?.message || String(error));
  printUsage();
  try {
    db.close();
  } catch {
    // ignore
  }
  process.exit(1);
}

