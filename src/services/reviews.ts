import { db } from '../database/client.js';
import { ensureUser } from './members.js';
import { settings } from './configuration.js';
import { UserError } from '../utils/errors.js';
import { z } from 'zod';
export function normalizeMapCode(input: string) {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}
export async function submitReview(
  guildId: string,
  discordId: string,
  input: {
    mapName: string;
    creator: string;
    mapCode: string;
    content: string;
    result: string;
  },
) {
  input = z
    .object({
      mapName: z.string().trim().min(1).max(200),
      creator: z.string().trim().min(1).max(200),
      mapCode: z.string().trim().min(1).max(200),
      content: z.string().trim().min(1).max(2000),
      result: z.string().trim().min(1).max(200),
    })
    .parse(input);
  const user = await ensureUser(guildId, discordId);
  try {
    return await db.$transaction(async (tx) => {
      const r = await tx.review.create({
        data: {
          guildId,
          userId: user.id,
          ...input,
          mapCode: normalizeMapCode(input.mapCode),
        },
      });
      await tx.activity.create({
        data: {
          guildId,
          userId: user.id,
          type: 'map_review',
          description: input.mapName,
          metadata: { reviewId: r.id, mapCode: r.mapCode },
        },
      });
      await tx.auditLog.create({
        data: {
          guildId,
          actorId: discordId,
          action: 'REVIEW_SUBMITTED',
          data: { reviewId: r.id },
        },
      });
      return r;
    });
  } catch (e) {
    if (
      e instanceof Error &&
      'code' in e &&
      ((e as { code?: number | string }).code === 6 ||
        (e as { code?: number | string }).code === 'already-exists')
    )
      throw new UserError('You already submitted a review for this map code.');
    throw e;
  }
}
export async function decideReview(
  guildId: string,
  reviewId: string,
  actorId: string,
  approved: boolean,
  reason: string,
  quality?: number,
) {
  const c = await settings(guildId);
  return db.$transaction(async (tx) => {
    const r = await tx.review.findFirst({
      where: { id: reviewId, guildId },
      include: { user: true },
    });
    if (!r) throw new UserError('Review not found in this server.');
    if (r.user.discordId === actorId)
      throw new UserError('You cannot approve or reject your own review.');
    const status = approved ? 'APPROVED' : 'REJECTED';
    const changed = await tx.review.updateMany({
      where: { id: r.id, status: 'PENDING' },
      data: {
        status,
        reviewerId: actorId,
        reason,
        quality: approved ? quality : null,
        decidedAt: new Date(),
      },
    });
    if (!changed.count)
      throw new UserError('This review has already been decided.');
    const points = approved ? (c.points.approved_review ?? 0) : 0;
    await tx.activity.updateMany({
      where: {
        guildId,
        userId: r.userId,
        metadata: { path: ['reviewId'], equals: r.id },
      },
      data: { status, points, reviewerId: actorId, timestamp: new Date() },
    });
    if (points)
      await tx.pointTransaction.create({
        data: {
          guildId,
          userId: r.userId,
          amount: points,
          actorId,
          reason: `Approved review: ${r.mapName}`,
          sourceKey: `review:${r.id}`,
        },
      });
    await tx.auditLog.create({
      data: {
        guildId,
        actorId,
        action: `REVIEW_${status}`,
        targetId: r.user.discordId,
        data: { reviewId, points, reason },
      },
    });
    return r;
  });
}
