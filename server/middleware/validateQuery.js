export function validateSuiteQL(query) {
  const writePatterns = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE)\b/i;
  if (writePatterns.test(query)) {
    throw new Error('Write operations are not permitted in dashboard queries');
  }
  return query;
}
