// Lightweight validation helpers — no external dependencies needed.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(value) {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

function isNonEmptyString(value, maxLength = 5000) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

module.exports = { isValidUUID, isNonEmptyString };