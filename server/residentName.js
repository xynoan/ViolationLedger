/** Join structured resident name parts for storage in `residents.name` (display + search). */
export function composeResidentDisplayName(firstName, middleName, lastName, nameSuffix) {
  return [firstName, middleName, lastName, nameSuffix]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .join(' ')
    .trim();
}
