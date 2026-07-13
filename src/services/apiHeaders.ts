import type { APIRequestHeaders } from '../types';

const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const MANAGED_HEADER_NAMES = new Set([
  'accept-encoding',
  'authorization',
  'connection',
  'content-length',
  'content-type',
  'expect',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

interface HeaderEntry {
  name: string;
  value: string;
}

interface BuildAPIRequestHeadersOptions {
  json?: boolean;
  requiredHeaderTokens?: Record<string, readonly string[]>;
}

function normalizeAPIBaseUrlForComparison(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

export function isSameAPIBaseUrl(left: string, right: string): boolean {
  const normalizedLeft = normalizeAPIBaseUrlForComparison(left);
  const normalizedRight = normalizeAPIBaseUrlForComparison(right);
  return !!normalizedLeft && normalizedLeft === normalizedRight;
}

export function validateCustomAPIHeader(name: string, value: string): string | undefined {
  const trimmedName = name.trim();
  if (!trimmedName) return '请求头名称不能为空';
  if (!HTTP_HEADER_NAME_PATTERN.test(trimmedName)) {
    return `请求头名称「${trimmedName}」包含无效字符`;
  }
  if (MANAGED_HEADER_NAMES.has(trimmedName.toLowerCase())) {
    return `请求头「${trimmedName}」由应用或网络层管理，不能自定义`;
  }
  if (/[\0-\x08\x0A-\x1F\x7F]/.test(value)) {
    return `请求头「${trimmedName}」的值不能包含换行符或控制字符`;
  }
  return undefined;
}

export function normalizeCustomAPIHeaders(headers: unknown): APIRequestHeaders {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {};

  const normalized = new Map<string, HeaderEntry>();
  for (const [rawName, rawValue] of Object.entries(headers)) {
    if (typeof rawValue !== 'string') continue;
    const name = rawName.trim();
    if (validateCustomAPIHeader(name, rawValue)) continue;
    normalized.set(name.toLowerCase(), { name, value: rawValue.trim() });
  }

  return Object.fromEntries(
    [...normalized.values()].map(({ name, value }) => [name, value])
  );
}

export function buildAPIRequestHeaders(
  apiKey: string,
  customHeaders?: APIRequestHeaders,
  options: BuildAPIRequestHeadersOptions = {}
): APIRequestHeaders {
  const headers = new Map<string, HeaderEntry>();
  const setHeader = (name: string, value: string) => {
    headers.set(name.toLowerCase(), { name, value });
  };

  if (options.json) {
    setHeader('Content-Type', 'application/json');
  }
  if (apiKey.trim()) {
    setHeader('Authorization', `Bearer ${apiKey.trim()}`);
  }

  for (const [name, value] of Object.entries(normalizeCustomAPIHeaders(customHeaders))) {
    setHeader(name, value);
  }

  for (const [name, requiredTokens] of Object.entries(options.requiredHeaderTokens || {})) {
    const existing = headers.get(name.toLowerCase());
    const tokens = new Map<string, string>();
    for (const token of existing?.value.split(',') || []) {
      const trimmed = token.trim();
      if (trimmed) tokens.set(trimmed.toLowerCase(), trimmed);
    }
    for (const token of requiredTokens) {
      const trimmed = token.trim();
      if (trimmed) tokens.set(trimmed.toLowerCase(), trimmed);
    }
    setHeader(existing?.name || name, [...tokens.values()].join(','));
  }

  return Object.fromEntries(
    [...headers.values()].map(({ name, value }) => [name, value])
  );
}
