import dotenv from 'dotenv';
import { z } from 'zod';
dotenv.config({ quiet: true });
const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  FIREBASE_PROJECT_ID: z
    .string()
    .regex(/^[a-z][a-z0-9-]{4,62}$/)
    .default('craftland-4a761'),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().default(''),
  FIREBASE_CLIENT_EMAIL: z.string().default(''),
  FIREBASE_PRIVATE_KEY: z.string().default(''),
  DISCORD_TOKEN: z.string().default(''),
  CLIENT_ID: z.string().default(''),
  CLIENT_SECRET: z.string().default(''),
  DISCORD_GUILD_ID: z.string().default(''),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z
    .string()
    .regex(/^[a-zA-Z0-9._/-]{1,100}$/)
    .default('gemini-3.5-flash-lite'),
  GEMINI_FALLBACK_MODEL: z
    .string()
    .regex(/^[a-zA-Z0-9._/-]{0,100}$/)
    .default('gemini-flash-lite-latest'),
  GEMINI_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(60000)
    .default(20000),
  GEMINI_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(2),
  DISCORD_REGISTER_GLOBAL: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  DASHBOARD_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DASHBOARD_URL: z.url().default('http://localhost:3000'),
  SESSION_SECRET: z.string().default(''),
});
export const env = schema.parse(process.env);
export function requireBotEnv() {
  if (!env.FIREBASE_PROJECT_ID)
    throw new Error('Set FIREBASE_PROJECT_ID in .env.');
  if (
    !env.DISCORD_TOKEN ||
    !/^\d{17,20}$/.test(env.DISCORD_GUILD_ID) ||
    !/^\d{17,20}$/.test(env.CLIENT_ID)
  )
    throw new Error(
      'Set DISCORD_TOKEN, CLIENT_ID and DISCORD_GUILD_ID privately in .env.',
    );
  if (
    env.DASHBOARD_ENABLED &&
    (env.SESSION_SECRET.length < 32 || !env.CLIENT_SECRET)
  )
    throw new Error(
      'Dashboard requires CLIENT_SECRET and SESSION_SECRET (32+ characters).',
    );
  if (
    env.DASHBOARD_ENABLED &&
    env.NODE_ENV === 'production' &&
    !env.DASHBOARD_URL.startsWith('https://')
  )
    throw new Error('Production dashboard requires HTTPS.');
}
