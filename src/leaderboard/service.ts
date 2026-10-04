import { type Client } from 'discord.js';
import { db } from '../database/client.js';
import { settings } from '../services/configuration.js';
import { notify } from '../services/audit.js';
import { aiAnswer } from '../ai/service.js';
import { periodRange } from './calculations.js';
import { xpStandings } from '../xp/service.js';
export async function standings(guildId: string, start: Date, end: Date) {
  const totals = await db.pointTransaction.groupBy({
    by: ['userId'],
    where: { guildId, createdAt: { gte: start, lt: end } },
    _sum: { amount: true },
    orderBy: { _sum: { amount: 'desc' } },
  });
  // Firestore rejects `in: []`; an empty week is a valid leaderboard state.
  if (totals.length === 0) return [];
  const users = await db.user.findMany({
    where: { id: { in: totals.map((t) => t.userId) } },
    select: { id: true, discordId: true },
  });
  return totals
    .map((t) => ({
      discordId: users.find((u) => u.id === t.userId)?.discordId ?? '',
      points: t._sum.amount ?? 0,
    }))
    .filter((t) => t.points > 0)
    .sort(
      (a, b) => b.points - a.points || a.discordId.localeCompare(b.discordId),
    )
    .slice(0, 25);
}
export async function publishWeekly(client: Client, guildId: string) {
  const c = await settings(guildId);
  const { start, end } = periodRange('weekly', true);
  const where = {
    guildId_period_startsAt: { guildId, period: 'weekly', startsAt: start },
  };
  let board = await db.leaderboard.findUnique({ where });
  if (board?.messageId) return;
  if (!board) {
    const entries = await standings(guildId, start, end);
    const xpEntries = await xpStandings(guildId, start, end);
    const contributionRows = await db.activity.findMany({
      where: { guildId, timestamp: { gte: start, lt: end } },
      select: { type: true, status: true },
    });
    const contributions = contributionRows.reduce<Record<string, number>>(
      (counts, row) => {
        if (row.status === 'APPROVED')
          counts[row.type] = (counts[row.type] ?? 0) + 1;
        return counts;
      },
      {},
    );
    const statistics = {
      totalWeeklyXP: xpEntries.reduce((n, r) => n + r.xp, 0),
      approvedMapReviews: contributions.map_review ?? 0,
      levelIncreases: xpEntries.reduce((n, r) => n + r.levelIncreases, 0),
    };
    const summary = await aiAnswer(
      'Summarize this completed week. Congratulate contributors.',
      { start, end, entries, xpEntries, contributions, statistics },
      { type: 'weekly_leaderboard_summary', actorId: client.user!.id, guildId },
    );
    board = await db.leaderboard.upsert({
      where,
      create: {
        guildId,
        period: 'weekly',
        startsAt: start,
        endsAt: end,
        entries,
        xpEntries,
        statistics,
        summary,
      },
      update: {},
    });
  }
  const channel = await client.channels.fetch(
    c.channels.leaderboard || c.channels.announcement,
  );
  if (
    !channel ||
    !('guildId' in channel) ||
    channel.guildId !== guildId ||
    !channel.isSendable()
  )
    throw new Error('Configure a sendable leaderboard channel.');
  const entries = board.entries as { discordId: string; points: number }[];
  const xpEntries = (board.xpEntries ?? []) as {
    discordId: string;
    xp: number;
    level: number;
  }[];
  const message = await channel.send({
    content: `🏆 **CRAFTLAND INDIA — WEEKLY LEADERBOARD**\n**Top contributors**\n${
      entries
        .slice(0, 10)
        .map(
          (r, i) =>
            `${['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`} <@${r.discordId}> — ${r.points} points`,
        )
        .join('\n') || 'No points this week.'
    }\n\n**Top XP earners**\n${
      xpEntries
        .slice(0, 5)
        .map(
          (r, i) =>
            `${['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`} <@${r.discordId}> — Level ${r.level} • ${r.xp} XP`,
        )
        .join('\n') || 'No XP recorded this week.'
    }\n\n${board.summary.slice(0, 1000)}\nCongratulations everyone! 🎉`,
    allowedMentions: { parse: [] },
  });
  await db.leaderboard.update({
    where: { id: board.id },
    data: { messageId: message.id },
  });
  await notify(
    client,
    guildId,
    c.channels.log,
    'LEADERBOARD_PUBLISHED',
    `Period: ${start.toISOString()}`,
  );
}
