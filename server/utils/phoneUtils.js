/**
 * Phone number utility functions
 */

/**
 * Normalize phone number to international format (63XXXXXXXXX)
 * Accepts: 09XXXXXXXXX, +639XXXXXXXXX, 639XXXXXXXXX, or 9XXXXXXXXX
 * Returns: 63XXXXXXXXX (12 digits total)
 * 
 * @param {string} phoneNumber - Phone number in any format
 * @returns {string|null} - Normalized phone number in international format (63XXXXXXXXX) or null if invalid
 */
export function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return null;
  
  // Remove spaces, dashes, parentheses
  let normalized = phoneNumber.trim().replace(/[\s\-\(\)]/g, '');
  
  // Convert to international format (63XXXXXXXXX)
  if (normalized.startsWith('+63')) {
    // +639XXXXXXXXX -> 639XXXXXXXXX
    normalized = '63' + normalized.substring(3);
  } else if (normalized.startsWith('63')) {
    // Already in international format: 639XXXXXXXXX
    // Keep as is
  } else if (normalized.startsWith('0')) {
    // 09XXXXXXXXX -> 639XXXXXXXXX
    normalized = '63' + normalized.substring(1);
  } else if (normalized.startsWith('9')) {
    // 9XXXXXXXXX -> 639XXXXXXXXX
    normalized = '63' + normalized;
  } else {
    // Invalid format
    return null;
  }
  
  // Validate: must be 12 digits starting with 63
  // Format: 63XXXXXXXXXX (63 + 10 digits = 12 total)
  // Philippine mobile numbers: 639XXXXXXXXX (12 digits total)
  // Examples: 639171234567, 639947143705
  if (!/^63\d{10}$/.test(normalized)) {
    return null;
  }
  
  return normalized;
}
