/**
 * Practical email format check (not full RFC 5322).
 * Allows typical forms like user.name+tag@example.co.uk
 */
const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return EMAIL_REGEX.test(trimmed);
}

/** Normalize for API: trim + lowercase local part is uncommon; lowercase full address is standard. */
export function sanitizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
