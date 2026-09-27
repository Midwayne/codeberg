export function redactSecrets<T>(value: T): T {
  return visit(value) as T;
}

function visit(value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
      .replace(/\b(?:sk|rk|pk)-(?:ant-)?[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
      .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi, 'Bearer [REDACTED]')
      .replace(/\b((?:authorization|proxy-authorization|x-api-key|set-cookie)\s*:\s*)[^\r\n]+/gi, '$1[REDACTED]')
      .replace(
        /\b((?:[A-Z0-9_]*(?:API_KEY|TOKEN|PASSWORD|SECRET|PRIVATE_KEY|CREDENTIAL)[A-Z0-9_]*|api[_-]?key|token|password|secret)\s*[:=]\s*)[^\s,;]+/gi,
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
        /(?:api[_-]?key|authorization|cookie|password|secret|token|private[_-]?key|credential)/i.test(key)
          ? '[REDACTED]'
          : visit(item),
      ]),
    );
  }
  return value;
}
