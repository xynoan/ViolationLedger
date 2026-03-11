import db from '../database.js';
import { normalizePhoneNumber } from './phoneUtils.js';
import { GRACE_PERIOD_MINUTES } from '../routes/violations.js';

const INFOBIP_BASE_URL = process.env.INFOBIP_BASE_URL || 'api.infobip.com';
const INFOBIP_API_KEY = process.env.INFOBIP_SMS_API_KEY || process.env.INFOBIP_API_KEY || '';
const INFOBIP_SMS_API_URL = `https://${INFOBIP_BASE_URL}/sms/2/text/advanced`;
const SMS_SENDER = process.env.INFOBIP_SMS_SENDER || process.env.SMS_SENDER || 'ViolationLedger';
const MAX_SMS_LENGTH = 918; // conservative for multipart/encoding differences

function normalizePlateForMatch(plateNumber) {
  if (!plateNumber) return '';
  return String(plateNumber).replace(/\s+/g, '').toUpperCase();
}

function validateConfig() {
  if (!INFOBIP_API_KEY) {
    return { valid: false, error: 'INFOBIP_SMS_API_KEY (or INFOBIP_API_KEY) not configured in environment' };
  }
  if (!INFOBIP_BASE_URL) {
    return { valid: false, error: 'INFOBIP_BASE_URL not configured in environment' };
  }
  return { valid: true };
}

export async function sendSmsMessage(recipient, message) {
  const configCheck = validateConfig();
  if (!configCheck.valid) return { success: false, error: configCheck.error };

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return { success: false, error: 'Message cannot be empty' };
  }

  const normalizedRecipient = normalizePhoneNumber(recipient);
  if (!normalizedRecipient) {
    return { success: false, error: 'Invalid recipient phone number format' };
  }

  const text = message.trim();
  if (text.length > MAX_SMS_LENGTH) {
    return { success: false, error: `Message exceeds maximum length of ${MAX_SMS_LENGTH} characters` };
  }

  // Infobip SMS Advanced format
  const payload = {
    messages: [
      {
        destinations: [{ to: normalizedRecipient }],
        from: SMS_SENDER,
        text
      }
    ]
  };

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 30000);

  try {
    const response = await fetch(INFOBIP_SMS_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `App ${INFOBIP_API_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify(payload),
      signal: abortController.signal
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const msg = data?.requestError?.serviceException?.text || data?.requestError?.message || `HTTP ${response.status}: ${response.statusText}`;
      return { success: false, error: msg, httpStatus: response.status };
    }

    const messageData = data?.messages?.[0];
    const statusGroupId = messageData?.status?.groupId;
    const statusName = messageData?.status?.groupName || messageData?.status?.name;

    // Infobip: groupId 1 = PENDING, 3 = DELIVERED (provider dependent). Treat 1/3 as success-ish.
    const isSuccess = statusGroupId === 1 || statusGroupId === 3;

    if (!isSuccess) {
      const errText =
        messageData?.status?.description ||
        messageData?.error?.description ||
        statusName ||
        'SMS provider rejected message';
      return { success: false, error: errText, status: statusName };
    }

    return {
      success: true,
      messageId: messageData?.messageId,
      status: statusName || 'accepted'
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

    const currentTime = new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Manila',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });

    const message =
      `Hi ${vehicle.ownerName}, ` +
      `your vehicle ${vehicle.plateNumber} was detected illegally parked at ${locationId} on ${currentTime}. ` +
      `Please move it within ${GRACE_PERIOD_MINUTES} minutes to avoid ticket. - ViolationLedger`;

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

export default {
  sendSmsMessage,
  sendViolationSms
};

