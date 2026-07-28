export type ErrorCategory =
  | 'network'
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'server'
  | 'provider'
  | 'unknown';

interface ErrorPattern {
  category: ErrorCategory;
  patterns: RegExp[];
  i18nKey: string;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    category: 'network',
    patterns: [
      /fetch/i,
      /network/i,
      /Failed to fetch/i,
      /load failed/i,
      /ERR_NAME_NOT_RESOLVED/i,
      /ERR_CONNECTION_REFUSED/i,
      /ERR_INTERNET_DISCONNECTED/i,
    ],
    i18nKey: 'chat.errors.network',
  },
  {
    category: 'auth',
    patterns: [
      /401/i,
      /Unauthorized/i,
      /auth/i,
      /api key/i,
      /token/i,
    ],
    i18nKey: 'chat.errors.auth',
  },
  {
    category: 'rate_limit',
    patterns: [
      /429/i,
      /rate limit/i,
      /too many requests/i,
    ],
    i18nKey: 'chat.errors.rate_limit',
  },
  {
    category: 'timeout',
    patterns: [
      /timeout/i,
      /timed out/i,
      /abort/i,
    ],
    i18nKey: 'chat.errors.timeout',
  },
  {
    category: 'server',
    patterns: [
      /500/i,
      /503/i,
      /server error/i,
      /internal server/i,
    ],
    i18nKey: 'chat.errors.server',
  },
  {
    category: 'provider',
    patterns: [
      /opencode/i,
      /ai-gateway/i,
      /model not found/i,
      /insufficient_quota/i,
    ],
    i18nKey: 'chat.errors.provider',
  },
];

export function getUserFacingChatError(
  message: string | null | undefined,
  t: (key: string) => string,
): string {
  if (!message) {
    return t('chat.errors.unexpected');
  }

  for (const { patterns, i18nKey } of ERROR_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(message)) {
        return t(i18nKey);
      }
    }
  }

  return t('chat.errors.unknown') + ': ' + message;
}