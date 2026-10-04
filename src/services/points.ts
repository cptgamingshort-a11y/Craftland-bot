import { db } from '../database/client.js';
import { UserError } from '../utils/errors.js';
import { ensureUser } from './members.js';
export function pointBalance(amounts: number[]) {
  return amounts.reduce((a, b) => a + b, 0);
}
export async function changePoints(
  guildId: string,
  discordId: string,
  actorId: string,
  amount: number,
  reason: string,
  sourceKey: string,
  type = 'manual',
) {
  if (actorId === discordId)
    throw new UserError('You cannot award yourself points.');
  if (
    !Number.isSafeInteger(amount) ||
    amount === 0 ||
    Math.abs(amount) > 100000
  )
    throw new UserError('Amount must be a non-zero integer, at most 100000.');
  const user = await ensureUser(guildId, discordId);
  return db.$transaction(async (tx) => {
    const p = await tx.pointTransaction.create({
      data: { guildId, userId: user.id, amount, reason, actorId, sourceKey },
    });
    await tx.activity.create({
      data: {
        guildId,
        userId: user.id,
        type,
        description: reason,
        points: amount,
        status: 'APPROVED',
        reviewerId: actorId,
        metadata: { sourceKey },
      },
    });
    await tx.auditLog.create({
      data: {
        guildId,
        actorId,
        action: 'POINTS_CHANGED',
        targetId: discordId,
        data: { amount, reason, sourceKey },
      },
    });
    return p;
  });
}
