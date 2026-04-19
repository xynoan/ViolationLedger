/**
 * Normalizes a plate for matching OCR output to the vehicle registry.
 * Strips non-alphanumeric characters so "ABC 123", "ABC-123", and "abc123" align.
 */
export function normalizePlateForOcrMatch(plate: unknown): string {
  if (typeof plate !== 'string') return '';
  return plate.replace(/\W+/g, '').toUpperCase();
}
