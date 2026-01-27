import db from '../database.js';
import { normalizePhoneNumber } from './phoneUtils.js';

const INFOBIP_BASE_URL = process.env.INFOBIP_BASE_URL || 'api.infobip.com';
const INFOBIP_API_KEY = process.env.INFOBIP_API_KEY || '4c3957d8340aba10e5f48bff2b1f7236-fd58a93c-79b7-4abe-b929-42e2caabdab1';
const INFOBIP_API_URL = `https://${INFOBIP_BASE_URL}/viber/2/messages`;
const VIBER_SENDER = process.env.VIBER_SENDER || 'IBSelfServe';
const MAX_MESSAGE_LENGTH = 1000;

function validateConfig() {
  if (!INFOBIP_API_KEY) {
    return { valid: false, error: 'INFOBIP_API_KEY not configured in environment' };
  }
  if (!INFOBIP_BASE_URL) {
    return { valid: false, error: 'INFOBIP_BASE_URL not configured in environment' };
  }
  return { valid: true };
}

function formatPhoneForViber(phoneNumber) {
  let cleaned = phoneNumber.trim().replace(/[\s\-\(\)\+]/g, '');
  
  if (cleaned.startsWith('63')) {
    return cleaned;
  }
  else if (cleaned.startsWith('0')) {
    return '63' + cleaned.substring(1);
  }
  else {
    return '63' + cleaned;
  }
}

export async function sendViberMessage(recipient, message, options = {}) {
  const configCheck = validateConfig();
  if (!configCheck.valid) {
    return { success: false, error: configCheck.error };
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return { success: false, error: 'Message cannot be empty' };
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return { success: false, error: `Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters` };
  }

  const recipientFormatted = formatPhoneForViber(recipient);
  
  console.log('📤 [Viber] Sending message:', {
    originalNumber: recipient,
    formattedNumber: recipientFormatted,
    sender: VIBER_SENDER,
    messageLength: message.length,
    isPromotional: options.isPromotional || false
  });

  // Prepare request payload (Infobip Viber Business Messages API v2 format)
  const payload = {
    messages: [
      {
        sender: VIBER_SENDER,
        destinations: [
          {
            to: recipientFormatted
          }
        ],
        content: {
          text: message.trim(),
          type: 'TEXT'
        }
      }
    ]
  };

  // Add optional image URL
  if (options.imageUrl) {
    payload.messages[0].content.type = 'IMAGE';
    payload.messages[0].content.imageUrl = options.imageUrl;
    if (message.trim()) {
      payload.messages[0].content.text = message.trim(); // Caption for image
    }
  }

  // Add optional CTA button (both text and URL required if using button)
  if (options.buttonText && options.buttonUrl) {
    payload.messages[0].content.buttonText = options.buttonText;
    payload.messages[0].content.buttonURL = options.buttonUrl;
  }

  // Create abort controller for timeout
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 30000); // 30 second timeout

  try {
    // Make API request
    const response = await fetch(INFOBIP_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `App ${INFOBIP_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: abortController.signal
    });

    // Handle HTTP errors
    if (!response.ok) {
      return await handleHttpError(response, recipientFormatted);
    }

    const data = await response.json();
    
    if (data.requestError) {
      const errorMsg = data.requestError.serviceException?.text || data.requestError.message || 'API error';
      console.error('❌ [Viber] API Error:', {
        recipient: recipientFormatted,
        error: errorMsg,
        fullResponse: data
      });
      return { 
        success: false, 
        error: errorMsg
      };
    }
    
    if (data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
      const messageData = data.messages[0];
      
      if (messageData.error) {
        const error = messageData.error;
        const errorCodeMsg = getErrorCodeMessage(error.id, error.name, error.description);
        const errorMsg = `${error.groupName || 'Error'} (${error.id || 'N/A'}): ${errorCodeMsg}`;
        
        console.error('❌ [Viber] API Error Code in Response:', {
          recipient: recipientFormatted,
          errorGroup: error.groupName,
          errorId: error.id,
          errorName: error.name,
          errorDescription: error.description,
          message: errorCodeMsg
        });
        
        return {
          success: false,
          error: errorMsg,
          errorCode: error.id,
          errorGroup: error.groupName
        };
      }
      
      if (messageData.status && messageData.status.groupId) {
        const statusGroup = messageData.status.groupId;
        const statusGroupName = messageData.status.groupName;
        
        const isSuccess = statusGroup === 1 || statusGroup === 3;
        
        if (statusGroup === 5) {
          const statusCodeMsg = getErrorCodeMessage(
            messageData.status.id, 
            messageData.status.name, 
            messageData.status.description
          );
          const errorMsg = `${statusGroupName || 'Rejected'} (${messageData.status.id || 'N/A'}): ${statusCodeMsg}`;
          
          console.error('❌ [Viber] Message Rejected:', {
            recipient: recipientFormatted,
            statusGroup: statusGroupName,
            statusId: messageData.status.id,
            statusName: messageData.status.name,
            statusDescription: messageData.status.description,
            message: statusCodeMsg
          });
          
          return {
            success: false,
            error: errorMsg,
            status: statusGroupName,
            statusGroup: statusGroup,
            statusId: messageData.status.id
          };
        }
        else if (statusGroup === 2) {
          const statusCodeMsg = getErrorCodeMessage(
            messageData.status.id,
            messageData.status.name,
            messageData.status.description
          );
          const errorMsg = `${statusGroupName || 'Undeliverable'} (${messageData.status.id || 'N/A'}): ${statusCodeMsg}`;
          
          console.error('❌ [Viber] Message Undeliverable:', {
            recipient: recipientFormatted,
            statusGroup: statusGroupName,
            statusId: messageData.status.id,
            statusDescription: messageData.status.description,
            message: statusCodeMsg
          });
          
          return {
            success: false,
            error: errorMsg,
            status: statusGroupName,
            statusGroup: statusGroup,
            statusId: messageData.status.id
          };
        }
        else if (statusGroup === 4) {
          const statusCodeMsg = getErrorCodeMessage(
            messageData.status.id,
            messageData.status.name,
            messageData.status.description
          );
          const errorMsg = `${statusGroupName || 'Expired'} (${messageData.status.id || 'N/A'}): ${statusCodeMsg}`;
          
          console.warn('⚠️ [Viber] Message Expired:', {
            recipient: recipientFormatted,
            statusGroup: statusGroupName,
            statusId: messageData.status.id,
            message: statusCodeMsg
          });
          
          return {
            success: false,
            error: errorMsg,
            status: statusGroupName,
            statusGroup: statusGroup,
            statusId: messageData.status.id
          };
        }
        else if (isSuccess) {
          console.log('✅ [Viber] Message sent successfully:', {
            recipient: recipientFormatted,
            messageId: messageData.messageId,
            status: messageData.status,
            statusGroup: statusGroupName,
            fullResponse: messageData
          });
          
          return {
            success: true,
            messageId: messageData.messageId,
            status: statusGroupName || messageData.status.name,
            statusGroup: statusGroup,
            statusId: messageData.status.id
          };
        }
        else {
          const errorMsg = messageData.status.description || statusGroupName || 'Unknown status';
          console.warn('⚠️ [Viber] Unknown status:', {
            recipient: recipientFormatted,
            statusGroup: statusGroup,
            statusGroupName: statusGroupName,
            status: messageData.status
          });
          
          return {
            success: false,
            error: errorMsg,
            status: statusGroupName,
            statusGroup: statusGroup
          };
        }
      }
    }
    
    console.error('❌ [Viber] Unexpected response format:', data);
    return { 
      success: false, 
      error: `Unexpected API response format: ${JSON.stringify(data)}`
    };

  } catch (err) {
    const errorMsg = err.name === 'AbortError' 
      ? 'Viber request timeout (30s exceeded)'
      : err.message || 'Network error';
    
    console.error('❌ [Viber] Exception:', {
      recipient: recipientFormatted,
      error: errorMsg,
      type: err.name
    });

    return { 
      success: false, 
      error: errorMsg
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function getErrorCodeMessage(errorCode, errorName, description) {
  const chatClientErrors = {
    7001: 'Unknown application - Verify application configuration',
    7002: 'Unknown user - User not registered or device does not support Viber',
    7003: 'Blocked user - User has opted out of communication',
    7004: 'Unauthorized access - Check API credentials',
    7005: 'Forbidden access - Verify sender registration and permissions',
    7006: 'Bad request - Invalid message format or parameters',
    7007: 'Illegal traffic type - Message content does not match registered traffic type',
    7008: 'Invalid template args - Missing or invalid template parameters',
    7009: 'Invalid template - Template is incorrect or not registered',
    7010: 'No session - Session expired or not initiated',
    7011: 'Account issue - Contact Support for account assistance',
    7012: 'Deployment configuration error - Contact Support',
    7013: 'Media hosting error - Check media URL and hosting',
    7014: 'Media upload error - Check network and media file requirements',
    7015: 'Media metadata error - Review media metadata',
    7016: 'Spam rate limit - Sender quality rating restrictions',
    7017: 'Too many requests - Rate limit exceeded',
    7018: 'Internal bad mapping - Invalid request parameters',
    7019: 'Provider billing error - Billing integration issue',
    7020: 'Device reproduction error - Content display issue on device',
    7021: 'Limited functionality - Feature restricted on provider side',
    7022: 'Media unsupported - Media format not supported',
    7023: 'Data mismatch - Data inconsistency detected',
    7024: 'Not allowed sending time - Outside permitted time window',
    7025: 'Unsupported mobile app version - Update required',
    7026: 'Message type exhausted - API limit reached',
    7027: 'Blocked content - Content violates policies',
    7029: 'User identity changed - Authentication details invalid',
    7030: 'Template blocked by user - User blocked this template',
    7031: 'Invalid WA flow - Flow state or mode incorrect',
    7032: 'Frequency capping - Marketing template limit reached',
    7033: 'Marketing opt-out - User disabled marketing messages',
    7034: 'Sender not registered - Sender not registered on platform'
  };

  const chatProviderErrors = {
    7036: 'Template not synced - Wait for ad synchronization (up to 10 minutes)',
    7037: 'Template not available - Ad synchronization failed or business not eligible',
    7038: 'Invalid WA account type - OBO WABA not supported',
    7050: 'Provider internal error - Wait and retry, contact Support if persists',
    7051: 'Provider timeout - Connection issue with provider',
    7052: 'Provider DR error - Delivery report mechanism issue'
  };

  const chatSystemErrors = {
    7080: 'Internal error - Contact Support',
    7081: 'Configuration error - Sender not registered or configuration issue',
    7082: 'Temporary gateway error - Contact Support',
    7083: 'Service not activated - Service not enabled for account',
    7084: 'Missing sender metadata - Required sender metadata missing'
  };

  const generalStatusCodes = {
    11: 'REJECTED_SOURCE - Sender ID not registered on account',
    12: 'REJECTED_NOT_ENOUGH_CREDITS - Account out of credits, top up required',
    13: 'REJECTED_SENDER - Sender ID blocklisted',
    14: 'REJECTED_DESTINATION_BLOCKLISTED - Destination blocklisted',
    51: 'MISSING_TO - Recipient parameter missing or empty',
    52: 'REJECTED_DESTINATION - Invalid destination number',
    100: 'UNDELIVERABLE_REJECTED_PLATFORM - Invalid or malformed request'
  };

  if (errorCode !== undefined) {
    if (chatClientErrors[errorCode]) return chatClientErrors[errorCode];
    if (chatProviderErrors[errorCode]) return chatProviderErrors[errorCode];
    if (chatSystemErrors[errorCode]) return chatSystemErrors[errorCode];
    if (generalStatusCodes[errorCode]) return generalStatusCodes[errorCode];
  }

  return description || errorName || 'Unknown error';
}

async function handleHttpError(response, recipient) {
  let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
  let errorDetails = null;
  
  try {
    const errorData = await response.json();
    
    // Infobip error format
    if (errorData.requestError) {
      const serviceException = errorData.requestError.serviceException;
      const apiMessage = serviceException?.text 
        || errorData.requestError.message 
        || errorMessage;
      
      // Extract error code details if available
      if (serviceException) {
        errorDetails = {
          messageId: serviceException.messageId,
          text: serviceException.text
        };
      }
      
      // Handle 404 specifically (endpoint not found)
      if (response.status === 404) {
        errorMessage = `Endpoint not found: ${apiMessage}. `;
        errorMessage += 'This usually means: ';
        errorMessage += '1) The API endpoint URL is incorrect, ';
        errorMessage += '2) The sender is not registered, ';
        errorMessage += '3) The service is not enabled for your account. ';
        errorMessage += 'Verify sender registration in Infobip portal and ensure you are using the correct API endpoint.';
      }
      // Provide specific error messages for common status codes
      else {
        switch (response.status) {
          case 401:
            errorMessage = `Unauthorized: ${apiMessage}. Check your INFOBIP_API_KEY and ensure it has proper permissions.`;
            break;
          case 403:
            errorMessage = `Forbidden: ${apiMessage}. Verify API key permissions and sender registration in Infobip portal.`;
            break;
          case 429:
            errorMessage = `Rate limit exceeded: ${apiMessage}. Please wait before retrying.`;
            break;
          case 400:
            errorMessage = `Bad Request: ${apiMessage}. Check message format, recipient number, and request parameters.`;
            break;
          case 500:
          case 502:
          case 503:
            errorMessage = `Server error: ${apiMessage}. Infobip service may be temporarily unavailable. Retry later.`;
            break;
          default:
            errorMessage = `${errorMessage}: ${apiMessage}`;
        }
      }
      
      console.error('❌ [Viber] HTTP Error:', {
        status: response.status,
        recipient: recipient,
        error: apiMessage,
        errorDetails: errorDetails,
        fullResponse: errorData
      });
    } 
    // Check for error objects in response (from status/error codes)
    else if (errorData.messages && Array.isArray(errorData.messages)) {
      const messageData = errorData.messages[0];
      
      if (messageData.error) {
        const error = messageData.error;
        const errorCodeMsg = getErrorCodeMessage(error.id, error.name, error.description);
        errorMessage = `${error.groupName || 'Error'} (${error.id || 'N/A'}): ${errorCodeMsg}`;
        
        console.error('❌ [Viber] API Error Code:', {
          status: response.status,
          recipient: recipient,
          errorGroup: error.groupName,
          errorId: error.id,
          errorName: error.name,
          errorDescription: error.description,
          message: errorCodeMsg
        });
      }
      else if (messageData.status) {
        const status = messageData.status;
        const statusGroup = status.groupId;
        
        if (statusGroup === 5) {
          const statusCodeMsg = getErrorCodeMessage(status.id, status.name, status.description);
          errorMessage = `${status.groupName || 'Rejected'} (${status.id || 'N/A'}): ${statusCodeMsg}`;
          
          console.error('❌ [Viber] Message Rejected:', {
            status: response.status,
            recipient: recipient,
            statusGroup: status.groupName,
            statusId: status.id,
            statusName: status.name,
            statusDescription: status.description,
            message: statusCodeMsg
          });
        }
      } else {
        errorMessage = errorData.message || errorMessage;
      }
    } else {
      errorMessage = errorData.message || errorMessage;
    }
  } catch {
    const text = await response.text().catch(() => '');
    if (text) {
      errorMessage += ` - ${text}`;
    }
    console.error('❌ [Viber] HTTP Error (non-JSON):', {
      status: response.status,
      recipient: recipient,
      text: text.substring(0, 100)
    });
  }
  
  return { 
    success: false, 
    error: errorMessage,
    errorDetails: errorDetails
  };
}

export async function sendViolationViber(plateNumber, locationId, violationId) {
  try {
    const vehicle = db
      .prepare('SELECT * FROM vehicles WHERE plateNumber = ?')
      .get(plateNumber);

    if (!vehicle) {
      return { 
        success: false, 
        error: `Vehicle with plate number ${plateNumber} not found in database` 
      };
    }

    if (!vehicle.contactNumber) {
      return { 
        success: false, 
        error: `Vehicle ${plateNumber} has no contact number registered` 
      };
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
    
    const message = `🅿️ PARKING VIOLATION ALERT 🅿️

Vehicle: ${plateNumber}
Location: ${locationId}
Time Detected: ${currentTime}

⚠️ Your vehicle has been detected illegally parked at the above location.

Please remove your vehicle immediately to avoid penalties and towing.

For inquiries or to report an error, please contact your local Barangay office.

Thank you for your cooperation.

---
Park Smart Monitor
Automated Parking Enforcement System`;

    const viberResult = await sendViberMessage(vehicle.contactNumber, message, {
      isPromotional: false
    });

    const messageLogId = `VIBER-${violationId}-${Date.now()}`;
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
        plateNumber,
        vehicle.contactNumber,
        message,
        viberResult.success ? 'sent' : 'failed',
        viberResult.success ? `Message ID: ${viberResult.messageId || 'N/A'}, Status: ${viberResult.status || 'N/A'}` : viberResult.error,
        sentAt,
        viberResult.success ? null : viberResult.error
      );
    } catch (logErr) {
      console.error('❌ [Viber] Failed to log message to database:', {
        error: logErr.message,
        messageLogId,
        violationId
      });
    }

    if (viberResult.success) {
      console.log('✅ [Viber] Violation message sent:', {
        plateNumber,
        violationId,
        messageLogId,
        messageId: viberResult.messageId
      });
      return { success: true, messageLogId };
    } else {
      console.warn('⚠️ [Viber] Violation message failed:', {
        plateNumber,
        violationId,
        error: viberResult.error
      });
      return { 
        success: false, 
        messageLogId, 
        error: viberResult.error 
      };
    }

  } catch (err) {
    console.error('❌ [Viber] sendViolationViber exception:', {
      plateNumber,
      violationId,
      error: err.message,
      stack: err.stack
    });
    return { 
      success: false, 
      error: err.message || 'Unexpected error in sendViolationViber' 
    };
  }
}

export function getViberServiceStatus() {
  const configCheck = validateConfig();
  
  return {
    provider: 'Infobip Viber Business Messages',
    sender: VIBER_SENDER,
    configured: configCheck.valid,
    status: configCheck.valid ? 'healthy' : 'unhealthy',
    apiUrl: INFOBIP_API_URL,
    baseUrl: INFOBIP_BASE_URL,
    message: configCheck.valid
      ? `Infobip Viber Business Messages service ready - Sender: ${VIBER_SENDER} (using shared sender)`
      : configCheck.error || 'Missing INFOBIP_API_KEY or INFOBIP_BASE_URL in environment',
    maxMessageLength: MAX_MESSAGE_LENGTH,
    channel: 'VIBER_BM'
  };
}

export default {
  sendViberMessage,
  sendViolationViber,
  getViberServiceStatus
};
