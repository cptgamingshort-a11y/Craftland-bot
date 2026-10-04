import { env } from '../config/env.js';
export class UserError extends Error {}
export function safeError(error: unknown): string {
  let text =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error';
  for (const value of [
    env.DISCORD_TOKEN,
    env.GEMINI_API_KEY,
    process.env.AI_API_KEY,
    env.CLIENT_SECRET,
    env.SESSION_SECRET,
    env.FIREBASE_PRIVATE_KEY,
    env.FIREBASE_CLIENT_EMAIL,
  ])
    if (value) text = text.split(value).join('[REDACTED]');
  return text
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED DATABASE]')
    .replace(
      /-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(
      /(?:api[_-]?key|token|password|key)=([^&\s]+)/gi,
      'credential=[REDACTED]',
    )
    .slice(0, 1000);
}
export function logError(scope: string, error: unknown) {
  console.error(
    JSON.stringify({
      level: 'error',
      scope,
      message: safeError(error),
      time: new Date().toISOString(),
    }),
  );
}
