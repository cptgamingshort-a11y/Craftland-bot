import { DateTime } from 'luxon';
import { createHash } from 'node:crypto';
import { db } from '../database/client.js';
import { ensureUser } from '../services/members.js';
import { levelConfig } from './config.js';
import {
  calculateLevel,
  MAX_XP,
  progress,
  threshold,
  type Formula,
} from './calculations.js';
import {
  transactionLock,
  levelConfigLock,
  memberXPLock,
} from '../utils/locks.js';
import { UserError } from '../utils/errors.js';
type MessageInput = {
  content: string;
  channelId: string;
  spamReason?: string | null;
  bot?: boolean;
  system?: boolean;
  webhook?: boolean;
};
export type XPInput = {
  guildId: string;
  discordId: string;
  actorId: string;
  sourceKey: string;
  source: 'message' | 'activity' | 'manual' | 'reset' | 'level_set' | 'formula';
  amount?: number;
  level?: number;
  reason: string;
  message?: MessageInput;
  now?: Date;
};
export function normalizeXPMessage(content: string) {
  return content
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
export async function applyXP(input: XPInput) {
  await levelConfig(input.guildId);
  const user = await ensureUser(input.guildId, input.discordId);
  if (
    input.source === 'manual' ||
    input.source === 'reset' ||
    input.source === 'level_set'
  )
    if (input.actorId === input.discordId)
      throw new UserError('You cannot adjust your own XP or level.');
  // Ensure the deterministic XP document exists before opening the unit of
  // work. The Firestore repository stages transaction writes, so a document
  // created by an upsert inside the same transaction cannot be read again
  // during that transaction (first-message XP otherwise fails on new members).
  await db.userXP.upsert({
    where: { userId: user.id },
    create: { guildId: input.guildId, userId: user.id },
    update: {},
  });
  return db.$transaction(async (tx) => {
    await transactionLock(tx, levelConfigLock(input.guildId), true);
    await transactionLock(tx, memberXPLock(input.guildId, user.id));
    const existing = await tx.xPTransaction.findUnique({
      where: { sourceKey: input.sourceKey },
    });
    if (existing)
      return {
        awarded: false,
        reason: 'duplicate_event',
        transaction: existing,
        changed: false,
      };
    const config = await tx.levelConfig.findUniqueOrThrow({
      where: { guildId: input.guildId },
    });
    const account = await tx.userXP.findUniqueOrThrow({
      where: { userId: user.id },
    });
    const now = input.now ?? new Date();
    const local = DateTime.fromJSDate(now).setZone('Asia/Kolkata');
    const dailyKey = local.toISODate()!;
    const weekKey = local.startOf('week').toISODate()!;
    const monthKey = local.startOf('month').toISODate()!;
    const daily = account.dailyKey === dailyKey ? account.dailyMessageXP : 0;
    let amount = input.amount ?? 0;
    let hashes = account.recentMessageHashes as { hash: string; at: number }[];
    let rejection: string | undefined;
    if (input.source === 'message') {
      const message = input.message;
      if (!message) throw new UserError('Message context required.');
      if (message.bot || message.system || message.webhook)
        return { awarded: false, reason: 'ignored_author', changed: false };
      const content = normalizeXPMessage(message.content);
      const hash = createHash('sha256').update(content).digest('hex');
      hashes = hashes.filter(
        (h) => h.at > now.getTime() - config.duplicateWindowSeconds * 1000,
      );
      if (
        !config.enabled ||
        (config.ignoredChannelIds as string[]).includes(message.channelId)
      )
        rejection = 'disabled_channel';
      else if (content.length < config.minimumMessageLength)
        rejection = 'short_message';
      else if (message.spamReason) rejection = message.spamReason;
      else if (hashes.some((h) => h.hash === hash))
        rejection = 'duplicate_message';
      else if (
        account.lastXPAt &&
        now.getTime() - account.lastXPAt.getTime() <
          config.cooldownSeconds * 1000
      )
        rejection = 'cooldown';
      else if (daily >= config.dailyLimit) rejection = 'daily_limit';
      if (content)
        hashes = [
          ...hashes.filter((h) => h.hash !== hash),
          { hash, at: now.getTime() },
        ].slice(-50);
      if (rejection) {
        const suspicious =
          !['cooldown', 'short_message', 'disabled_channel'].includes(
            rejection,
          ) &&
          (!account.lastSuspiciousAt ||
            now.getTime() - account.lastSuspiciousAt.getTime() >= 60000);
        await tx.userXP.update({
          where: { id: account.id },
          data: {
            recentMessageHashes: hashes,
            ...(suspicious ? { lastSuspiciousAt: now } : {}),
          },
        });
        if (suspicious)
          await tx.auditLog.create({
            data: {
              guildId: input.guildId,
              actorId: input.actorId,
              action: 'XP_SUSPICIOUS_ACTIVITY',
              targetId: input.discordId,
              data: {
                reason: rejection,
                channelId: message.channelId,
                sourceKey: input.sourceKey,
              },
            },
          });
        return { awarded: false, reason: rejection, changed: false };
      }
      amount = Math.min(config.xpPerMessage, config.dailyLimit - daily);
    }
    if (input.source === 'activity') {
      if (!config.enabled) rejection = 'disabled';
      else if (daily >= config.dailyLimit) rejection = 'daily_limit';
      if (rejection)
        return { awarded: false, reason: rejection, changed: false };
      amount = Math.min(amount, config.xpPerMessage * 2, config.dailyLimit - daily);
    }
    if (input.source === 'reset') amount = -account.xp;
    if (input.source === 'level_set') {
      if (
        input.level === undefined ||
        !Number.isInteger(input.level) ||
        input.level < 0 ||
        input.level > config.maxLevel
      )
        throw new UserError(`Level must be 0–${config.maxLevel}.`);
      amount = threshold(input.level, config as Formula) - account.xp;
    }
    if (!Number.isSafeInteger(amount) || Math.abs(amount) > MAX_XP)
      throw new UserError('Invalid XP amount.');
    const xp = Math.max(0, Math.min(MAX_XP, account.xp + amount));
    amount = xp - account.xp;
    const level = calculateLevel(xp, config as Formula);
    const changed = level !== account.level;
    const transaction = await tx.xPTransaction.create({
      data: {
        guildId: input.guildId,
        userId: user.id,
        actorId: input.actorId,
        sourceKey: input.sourceKey,
        source: input.source,
        amount,
        xpBefore: account.xp,
        xpAfter: xp,
        levelBefore: account.level,
        levelAfter: level,
        reason: input.reason,
        createdAt: now,
        metadata: input.message ? { channelId: input.message.channelId } : {},
      },
    });
    await tx.userXP.update({
      where: { id: account.id },
      data: {
        xp,
        level,
        configVersion: config.version,
        weeklyXP: (account.weekKey === weekKey ? account.weeklyXP : 0) + amount,
        monthlyXP:
          (account.monthKey === monthKey ? account.monthlyXP : 0) + amount,
        weekKey,
        monthKey,
        dailyKey,
        dailyMessageXP:
          daily + (input.source === 'message' || input.source === 'activity' ? amount : 0),
        recentMessageHashes: hashes,
        ...(input.source === 'message' && amount > 0 ? { lastXPAt: now } : {}),
        ...(changed ? { roleSyncPending: true } : {}),
      },
    });
    if (changed)
      await tx.levelChange.create({
        data: {
          guildId: input.guildId,
          userId: user.id,
          transactionId: transaction.id,
          oldLevel: account.level,
          newLevel: level,
        },
      });
    if (input.source !== 'message' || changed)
      await tx.auditLog.create({
        data: {
          guildId: input.guildId,
          actorId: input.actorId,
          action: changed ? 'LEVEL_CHANGED' : 'XP_CHANGED',
          targetId: input.discordId,
          data: {
            amount,
            oldLevel: account.level,
            newLevel: level,
            source: input.source,
            transactionId: transaction.id,
          },
        },
      });
    return { awarded: amount > 0, transaction, changed, reason: 'applied' };
  });
}
export async function xpStats(guildId: string, discordId: string) {
  const config = await levelConfig(guildId);
  const user = await ensureUser(guildId, discordId);
  const account = await db.userXP.upsert({
    where: { userId: user.id },
    create: { guildId, userId: user.id },
    update: {},
  });
  const local = DateTime.now().setZone('Asia/Kolkata');
  const [weekly, monthly, rank] = await Promise.all([
    db.xPTransaction.aggregate({
      where: {
        guildId,
        userId: user.id,
        createdAt: { gte: local.startOf('week').toJSDate() },
      },
      _sum: { amount: true },
    }),
    db.xPTransaction.aggregate({
      where: {
        guildId,
        userId: user.id,
        createdAt: { gte: local.startOf('month').toJSDate() },
      },
      _sum: { amount: true },
    }),
    db.userXP.count({
      where: {
        guildId,
        OR: [
          { xp: { gt: account.xp } },
          { xp: account.xp, user: { discordId: { lt: discordId } } },
        ],
      },
    }),
  ]);
  return {
    discordId,
    ...progress(account.xp, config as Formula),
    weeklyXP: weekly._sum.amount ?? 0,
    monthlyXP: monthly._sum.amount ?? 0,
    rank: rank + 1,
    lastXPAt: account.lastXPAt,
    roleSyncPending: account.roleSyncPending,
  };
}
export async function recalibrateLevels(guildId: string, actorId: string) {
  const config = await levelConfig(guildId);
  const users = await db.userXP.findMany({
    where: { guildId, configVersion: { not: config.version } },
    include: { user: { select: { discordId: true } } },
  });
  for (const row of users)
    await applyXP({
      guildId,
      discordId: row.user.discordId,
      actorId,
      source: 'formula',
      sourceKey: `formula:${guildId}:${config.version}:${row.userId}`,
      reason: 'Level formula configuration changed',
    });
}
export async function xpStandings(guildId: string, start?: Date, end?: Date) {
  if (!start) {
    const rows = await db.userXP.findMany({
      where: { guildId, xp: { gt: 0 } },
      orderBy: [{ xp: 'desc' }, { user: { discordId: 'asc' } }],
      take: 25,
      include: { user: { select: { discordId: true } } },
    });
    return rows.map((r) => ({
      discordId: r.user.discordId,
      xp: r.xp,
      level: r.level,
      levelIncreases: 0,
    }));
  }
  const rows = await db.xPTransaction.groupBy({
    by: ['userId'],
    where: { guildId, createdAt: { gte: start, ...(end ? { lt: end } : {}) } },
    _sum: { amount: true },
    orderBy: { _sum: { amount: 'desc' } },
  });
  const top = rows.filter((r) => (r._sum.amount ?? 0) > 0).slice(0, 25);
  const result = [];
  for (const row of top) {
    const user = await db.user.findUniqueOrThrow({ where: { id: row.userId } });
    const events = await db.xPTransaction.findMany({
      where: {
        guildId,
        userId: row.userId,
        createdAt: { gte: start, ...(end ? { lt: end } : {}) },
      },
      select: { levelBefore: true, levelAfter: true },
    });
    const latest = await db.xPTransaction.findFirst({
      where: {
        guildId,
        userId: row.userId,
        ...(end ? { createdAt: { lt: end } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    result.push({
      discordId: user.discordId,
      xp: row._sum.amount ?? 0,
      level: latest?.levelAfter ?? 0,
      levelIncreases: events.reduce(
        (sum, e) => sum + Math.max(0, e.levelAfter - e.levelBefore),
        0,
      ),
    });
  }
  return result.sort(
    (a, b) => b.xp - a.xp || a.discordId.localeCompare(b.discordId),
  );
}
