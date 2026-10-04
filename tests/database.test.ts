import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '../src/database/client.js';
import { firestore } from '../src/database/firebase.js';
import { submitReview, decideReview } from '../src/services/reviews.js';
import { changePoints } from '../src/services/points.js';
import { settings, saveSettings } from '../src/services/configuration.js';
import { ensureUser, memberStats } from '../src/services/members.js';
import { buyItem, claimDaily, hunt } from '../src/game/service.js';
// Run only against a disposable Firestore emulator project.
describe.skipIf(
  process.env.RUN_FIRESTORE_TESTS !== 'true' ||
    !process.env.FIRESTORE_EMULATOR_HOST,
)('Firestore transaction safety', () => {
  const guildId = `test-${Date.now()}`;
  beforeAll(async () => {
    await settings(guildId);
  });
  afterAll(async () => {
    await firestore().recursiveDelete(
      firestore().collection('guilds').doc(guildId),
    );
    await db.$disconnect();
  });
  it('rejects duplicate review submission at the database boundary', async () => {
    const input = {
      mapName: 'Map',
      creator: 'Creator',
      mapCode: ' abc123 ',
      content: 'Verified review',
      result: 'Pass',
    };
    await submitReview(guildId, 'member1', input);
    await expect(
      submitReview(guildId, 'member1', { ...input, mapCode: 'ABC123' }),
    ).rejects.toThrow('already submitted');
  });
  it('only credits one competing approval and rejects self approval', async () => {
    const r = await submitReview(guildId, 'member2', {
      mapName: 'Map2',
      creator: 'Creator',
      mapCode: 'second',
      content: 'Review',
      result: 'Pass',
    });
    await expect(
      decideReview(guildId, r.id, 'member2', true, 'Self'),
    ).rejects.toThrow('own review');
    const result = await Promise.allSettled([
      decideReview(guildId, r.id, 'staff1', true, 'Pass', 80),
      decideReview(guildId, r.id, 'staff2', true, 'Pass', 90),
    ]);
    expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await db.pointTransaction.count({
        where: { sourceKey: `review:${r.id}` },
      }),
    ).toBe(1);
  });
  it('rejected reviews award no points', async () => {
    const r = await submitReview(guildId, 'member3', {
      mapName: 'Bad map',
      creator: 'Creator',
      mapCode: 'third',
      content: 'Review',
      result: 'Fail',
    });
    await decideReview(guildId, r.id, 'staff1', false, 'Insufficient evidence');
    expect(
      await db.pointTransaction.count({
        where: { sourceKey: `review:${r.id}` },
      }),
    ).toBe(0);
  });
  it('rolls back duplicate point awards and blocks self-awards', async () => {
    await expect(
      changePoints(guildId, 'staff1', 'staff1', 10, 'Self', 'self'),
    ).rejects.toThrow('yourself');
    const key = `test:${guildId}`;
    await changePoints(guildId, 'member1', 'staff1', 10, 'Good work', key);
    await expect(
      changePoints(guildId, 'member1', 'staff1', 10, 'Duplicate', key),
    ).rejects.toThrow();
    expect(await db.pointTransaction.count({ where: { sourceKey: key } })).toBe(
      1,
    );
    expect(
      await db.activity.count({
        where: { guildId, metadata: { path: ['sourceKey'], equals: key } },
      }),
    ).toBe(1);
  });
  it('counts exact Kolkata dates and preserves usernames during analysis', async () => {
    const user = await ensureUser(guildId, 'member4', 'ActualName');
    for (const timestamp of [
      new Date('2026-09-20T18:29:00Z'),
      new Date('2026-09-20T18:31:00Z'),
      new Date('2026-09-20T19:00:00Z'),
    ])
      await db.activity.create({
        data: {
          guildId,
          userId: user.id,
          type: 'task',
          description: 'Completed task',
          status: 'APPROVED',
          metadata: {},
          timestamp,
        },
      });
    const stats = await memberStats(guildId, 'member4');
    expect(stats.activeDays).toBe(2);
    expect(stats.tasksCompleted).toBe(3);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).username,
    ).toBe('ActualName');
  });
  it('keeps game coins separate and enforces daily, hunt ticket and replay rules', async () => {
    const start = new Date('2026-09-27T12:00:00.000Z');
    const daily = await claimDaily(guildId, 'game-member', 'daily-1', start);
    expect(daily.reward).toBe(100);
    await expect(
      claimDaily(
        guildId,
        'game-member',
        'daily-2',
        new Date(start.getTime() + 60 * 60_000),
      ),
    ).rejects.toThrow('Daily reward is ready');
    await buyItem(
      guildId,
      'game-member',
      'buy-ticket',
      'hunt_ticket',
      new Date(start.getTime() + 60_000),
    );
    const first = await hunt(
      guildId,
      'game-member',
      'hunt-1',
      new Date(start.getTime() + 2 * 60_000),
      0.99,
      20,
      'Fox',
    );
    expect(first.coins).toBe(20);
    const second = await hunt(
      guildId,
      'game-member',
      'hunt-2',
      new Date(start.getTime() + 3 * 60_000),
      0.99,
      25,
      'Wolf',
    );
    expect(second.usedTicket).toBe(true);
    expect(second.replayed).toBe(false);
    expect(
      await hunt(
        guildId,
        'game-member',
        'hunt-2',
        new Date(start.getTime() + 3 * 60_000),
        0.99,
        25,
        'Wolf',
      ),
    ).toMatchObject({ replayed: true });
    expect(
      await db.gameAccount.findUnique({
        where: { guildId_userId: { guildId, userId: 'game-member' } },
      }),
    ).toMatchObject({ coins: 65, inventory: { hunt_ticket: 0 } });
    expect(await db.pointTransaction.count({ where: { guildId } })).toBe(0);
  });
  it('rolls back configuration together with wizard role changes', async () => {
    const row = await db.botConfiguration.findUniqueOrThrow({
      where: { guildId },
    });
    const config = await settings(guildId);
    await expect(
      saveSettings(
        guildId,
        'staff1',
        { ...config, welcomeEnabled: true },
        row.version,
        async () => {
          throw new Error('Role configuration failed');
        },
      ),
    ).rejects.toThrow('Role configuration failed');
    expect(
      (await db.botConfiguration.findUniqueOrThrow({ where: { guildId } }))
        .version,
    ).toBe(row.version);
    await saveSettings(guildId, 'staff1', config, row.version);
    await expect(
      saveSettings(guildId, 'staff1', config, row.version),
    ).rejects.toThrow('Configuration changed');
  });
  it('cannot decide a review from a different guild', async () => {
    const r = await db.review.findFirstOrThrow({ where: { guildId } });
    await expect(
      decideReview('different-guild', r.id, 'staff1', true, 'Bad scope'),
    ).rejects.toThrow('not found');
    await firestore().recursiveDelete(
      firestore().collection('guilds').doc('different-guild'),
    );
  });
});
