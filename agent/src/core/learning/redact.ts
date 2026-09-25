export function redactSecrets<T>(value: T): T {
  return visit(value) as T;
}

function visit(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/\b(?:sk|rk|pk)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi, 'Bearer [REDACTED]')
      .replace(
        /\b((?:api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi,
        '$1[REDACTED]',
      );
  }
  if (Array.isArray(value)) {
    return value.map(visit);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /(?:api[_-]?key|authorization|cookie|password|secret|token)/i.test(key)
          ? '[REDACTED]'
          : visit(item),
      ]),
    );
  }
  return value;
}
