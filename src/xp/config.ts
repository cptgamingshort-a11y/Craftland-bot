import { z } from 'zod';
import { db } from '../database/client.js';
import { settings } from '../services/configuration.js';
import { threshold, MAX_XP } from './calculations.js';
import { transactionLock, levelConfigLock } from '../utils/locks.js';
import { UserError } from '../utils/errors.js';
const id = z
  .string()
  .regex(/^\d{17,20}$/)
  .or(z.literal(''));
export const levelConfigSchema = z
  .object({
    enabled: z.boolean(),
    xpPerMessage: z.number().int().min(0).max(10000),
    cooldownSeconds: z.number().int().min(10).max(86400),
    dailyLimit: z.number().int().min(0).max(1_000_000),
    duplicateWindowSeconds: z.number().int().min(60).max(86400),
    minimumMessageLength: z.number().int().min(1).max(1000),
    baseXP: z.number().int().min(1).max(1_000_000),
    incrementXP: z.number().int().min(0).max(1_000_000),
    maxLevel: z.number().int().min(1).max(10000),
    levelUpChannelId: id,
    levelUpMessage: z.string().min(1).max(1500),
    ignoredChannelIds: z.array(id).max(100),
    timezone: z.literal('Asia/Kolkata'),
  })
  .refine((c) => threshold(c.maxLevel + 1, c) <= MAX_XP, {
    message:
      'Formula exceeds the supported XP range; reduce coefficients/maxLevel.',
  });
export async function levelConfig(guildId: string) {
  await settings(guildId);
  return db.levelConfig.upsert({
    where: { guildId },
    create: { guildId },
    update: {},
  });
}
export async function saveLevelConfig(
  guildId: string,
  actorId: string,
  value: unknown,
  expectedVersion: number,
) {
  const data = levelConfigSchema.parse(value);
  return db.$transaction(async (tx) => {
    await transactionLock(tx, levelConfigLock(guildId));
    const result = await tx.levelConfig.updateMany({
      where: { guildId, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (!result.count)
      throw new UserError('Level configuration changed. Reopen /level-config.');
    await tx.auditLog.create({
      data: { guildId, actorId, action: 'LEVEL_CONFIGURATION_CHANGED', data },
    });
    return tx.levelConfig.findUniqueOrThrow({ where: { guildId } });
  });
}
