import db from '../database.js';
import { getGracePeriodMinutes } from '../runtime_config.js';

// iProgSMS configuration
const IPROGSMS_API_TOKEN = process.env.IPROGSMS_API_TOKEN || '';
const IPROGSMS_BASE_URL = process.env.IPROGSMS_BASE_URL || 'https://www.iprogsms.com';
const IPROGSMS_SEND_PATH = '/api/v1/sms_messages';
const MAX_SMS_LENGTH = Number.parseInt(process.env.SMS_MAX_LENGTH || '', 10) || 160;

function normalizePlateForMatch(plateNumber) {
  if (!plateNumber) return '';
  return String(plateNumber).replace(/\s+/g, '').toUpperCase();
}

function validateConfig() {
  if (!IPROGSMS_API_TOKEN) {
    return { valid: false, error: 'IPROGSMS_API_TOKEN not configured in environment' };
  }
  if (!IPROGSMS_BASE_URL) {
    return { valid: false, error: 'IPROGSMS_BASE_URL not configured in environment' };
  }
  return { valid: true };
}

function fitSmsMessage(text, maxLen = MAX_SMS_LENGTH) {
  const normalized = String(text ?? '').trim();
  if (normalized.length <= maxLen) return normalized;
  if (maxLen <= 3) return normalized.slice(0, Math.max(0, maxLen));
  return `${normalized.slice(0, maxLen - 3)}...`;
}

export async function sendSmsMessage(recipient, message) {
  const configCheck = validateConfig();
  if (!configCheck.valid) return { success: false, error: configCheck.error };

  const text = fitSmsMessage(message);
  const normalizedRecipient = String(recipient || '').trim();
  if (!normalizedRecipient) {
    return { success: false, error: 'Invalid recipient phone number format' };
  }

  // iProgSMS expects api_token, message, phone_number (per template)
  const url = new URL(IPROGSMS_SEND_PATH, IPROGSMS_BASE_URL);
  const bodyParams = new URLSearchParams();
  bodyParams.set('api_token', IPROGSMS_API_TOKEN);
  bodyParams.set('message', text);
  bodyParams.set('phone_number', normalizedRecipient);

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 30000);

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: bodyParams.toString(),
      signal: abortController.signal,
    });

    const textBody = await response.text();

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText} - ${textBody || 'No response body'}`,
        httpStatus: response.status,
      };
    }

    // iProgSMS docs are not fully specified here; consider any 2xx as success
    return {
      success: true,
      messageId: null,
      status: 'accepted',
      rawResponse: textBody,
    };
  } catch (err) {
    const errorMsg = err?.name === 'AbortError' ? 'SMS request timeout (30s exceeded)' : err?.message || 'Network error';
    return { success: false, error: errorMsg };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function sendViolationSms(plateNumber, locationId, violationId) {
  try {
    const normalizedPlate = normalizePlateForMatch(plateNumber);
    const vehicle = db
      .prepare(`SELECT * FROM vehicles WHERE REPLACE(UPPER(plateNumber), ' ', '') = ?`)
      .get(normalizedPlate);

    if (!vehicle) {
      return { success: false, error: `Vehicle with plate number ${plateNumber} not found in database` };
    }
    if (!vehicle.contactNumber) {
      return { success: false, error: `Vehicle ${vehicle.plateNumber} has no contact number registered` };
    }

    const shortWhen = new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const graceMin = getGracePeriodMinutes();
    const message =
      `Hi ${vehicle.ownerName}, your vehicle ${vehicle.plateNumber} is illegally parked at ${locationId} ` +
      `(${shortWhen}). Please move it within ${graceMin} min to avoid ticket.`;

    const smsResult = await sendSmsMessage(vehicle.contactNumber, message);

    const messageLogId = `SMS-${violationId}-${Date.now()}`;
    const sentAt = new Date().toISOString();

    try {
      db.prepare(`
        INSERT INTO sms_logs (
          id, violationId, plateNumber, contactNumber, message,
          status, statusMessage, sentAt, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        messageLogId,
        violationId,
        vehicle.plateNumber,
        vehicle.contactNumber,
        message,
        smsResult.success ? 'sent' : 'failed',
        smsResult.success ? `Message ID: ${smsResult.messageId || 'N/A'}, Status: ${smsResult.status || 'N/A'}` : smsResult.error,
        sentAt,
        smsResult.success ? null : smsResult.error
      );
    } catch (logErr) {
      console.error('❌ [SMS] Failed to log message to database:', {
        error: logErr.message,
        messageLogId,
        violationId
      });
    }

    return smsResult.success
      ? { success: true, messageLogId }
      : { success: false, messageLogId, error: smsResult.error };
  } catch (err) {
    console.error('❌ [SMS] sendViolationSms exception:', {
      plateNumber,
      violationId,
      error: err.message,
      stack: err.stack
    });
    return { success: false, error: err.message || 'Unexpected error in sendViolationSms' };
  }
}

export function getSmsServiceStatus() {
  const configCheck = validateConfig();

  return {
    provider: 'iProgSMS',
    configured: configCheck.valid,
    status: configCheck.valid ? 'healthy' : 'unhealthy',
    apiUrl: IPROGSMS_BASE_URL,
    message: configCheck.valid
      ? 'iProgSMS SMS service ready'
      : configCheck.error,
    maxMessageLength: MAX_SMS_LENGTH
  };
}

export default {
  sendSmsMessage,
  sendViolationSms
};

