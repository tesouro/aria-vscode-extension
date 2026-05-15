export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function toNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function toStringSafe(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function normalizeTextForLookup(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function parseListTokens(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function extractKeywordTokens(text: string): string[] {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

  const stopwords = new Set(['API', 'ENDPOINT', 'PROJETO', 'DADOS', 'BASE', 'SISTEMA', 'SERVICO']);
  const tokens = normalized
    .split(/[^A-Z0-9]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4 && !stopwords.has(item));

  return Array.from(new Set(tokens));
}

export function decodeJwtClaims(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.');
  if (parts.length < 2) {
    return undefined;
  }

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function summarizeForLog(value: unknown, maxDepth = 2, maxArrayItems = 5, maxStringLength = 240): string {
  const seen = new WeakSet<object>();

  const walk = (input: unknown, depth: number): unknown => {
    if (input === null || input === undefined) { return input; }
    if (typeof input === 'string') {
      return input.length > maxStringLength
        ? `${input.slice(0, maxStringLength)}…<${input.length - maxStringLength} chars omitted>`
        : input;
    }
    if (typeof input === 'number' || typeof input === 'boolean') { return input; }
    if (typeof input === 'bigint') { return input.toString(); }
    if (typeof input === 'function') { return '[Function]'; }

    if (Array.isArray(input)) {
      if (depth >= maxDepth) { return `[Array(${input.length})]`; }
      return input.slice(0, maxArrayItems).map((item) => walk(item, depth + 1));
    }

    if (typeof input === 'object') {
      if (depth >= maxDepth) { return '[Object]'; }
      if (seen.has(input)) { return '[Circular]'; }
      seen.add(input);
      const record = input as Record<string, unknown>;
      const keys = Object.keys(record);
      const result: Record<string, unknown> = {};
      for (const key of keys.slice(0, maxArrayItems)) {
        result[key] = walk(record[key], depth + 1);
      }
      if (keys.length > maxArrayItems) {
        result.__moreKeys = keys.length - maxArrayItems;
      }
      return result;
    }

    try { return String(input); } catch { return '[Unserializable]'; }
  };

  try {
    return JSON.stringify(walk(value, 0), null, 2);
  } catch {
    return toStringSafe(value);
  }
}

export function normalizeEndpointPath(value: unknown): string {
  return toStringSafe(value).trim().replace(/^\/+/, '');
}

export function normalizeEndpointFieldKey(itemName: string): string {
  return itemName.replace(/^P\d+_/, '').trim().toUpperCase();
}

export function buildMetadataKey(idBancoExterno: number, idBancoEsquema?: number): string {
  return (idBancoEsquema && idBancoEsquema > 0)
    ? `${idBancoExterno}:${idBancoEsquema}`
    : `${idBancoExterno}:sem-esquema`;
}
