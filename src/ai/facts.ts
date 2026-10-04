import { db } from '../database/client.js';
import { eligibilityFacts } from '../roles/service.js';
import { xpStats, xpStandings } from '../xp/service.js';
import { periodRange } from '../leaderboard/calculations.js';
import { standings } from '../leaderboard/service.js';
import { type GuildMember } from 'discord.js';
export async function memberAIFacts(member: GuildMember) {
  const guildId = member.guild.id;
  const facts = await eligibilityFacts(guildId, member.id);
  const user = await db.user.findUniqueOrThrow({
    where: { guildId_discordId: { guildId, discordId: member.id } },
  });
  const xp = await xpStats(guildId, member.id);
  return {
    stats: (({ discordId: _discordId, ...stats }) => stats)(facts.stats),
    roles: facts.roles.map(({ roleId: _roleId, ...role }) => role),
    xp: (({ discordId: _discordId, ...record }) => record)(xp),
    currentRoles: member.roles.cache
      .filter((r) => r.id !== guildId)
      .map((r) => r.name),
    warnings: await db.warning.count({ where: { guildId, userId: user.id } }),
  };
}
export async function communityAIFacts(guildId: string, question: string) {
  const { start, end } = periodRange('weekly');
  const [
    members,
    activeMembers,
    approvedReviews,
    rejectedReviews,
    tasksCompleted,
    reports,
    moderation,
    totalXP,
    topXP,
    contributors,
  ] = await Promise.all([
    db.user.count({ where: { guildId } }),
    db.user.count({ where: { guildId, lastActiveAt: { gte: start } } }),
    db.review.count({
      where: {
        guildId,
        status: 'APPROVED',
        decidedAt: { gte: start, lt: end },
      },
    }),
    db.review.count({
      where: {
        guildId,
        status: 'REJECTED',
        decidedAt: { gte: start, lt: end },
      },
    }),
    db.activity.count({
      where: {
        guildId,
        type: 'task',
        status: 'APPROVED',
        timestamp: { gte: start, lt: end },
      },
    }),
    db.report.groupBy({
      by: ['type', 'status'],
      where: { guildId },
      _count: true,
    }),
    db.moderationAction.groupBy({
      by: ['type'],
      where: { guildId, createdAt: { gte: start, lt: end } },
      _count: true,
    }),
    db.xPTransaction.aggregate({
      where: { guildId, createdAt: { gte: start, lt: end } },
      _sum: { amount: true },
    }),
    xpStandings(guildId, start, end),
    standings(guildId, start, end),
  ]);
  const topXPEarners = await Promise.all(
    topXP.slice(0, 10).map(async (row) => {
      const user = await db.user.findUnique({
        where: { guildId_discordId: { guildId, discordId: row.discordId } },
      });
      return {
        member: user?.username ?? 'Unknown member',
        xp: row.xp,
        level: row.level,
        levelIncreases: row.levelIncreases,
      };
    }),
  );
  const topContributors = await Promise.all(
    contributors.slice(0, 10).map(async (row) => {
      const user = await db.user.findUnique({
        where: { guildId_discordId: { guildId, discordId: row.discordId } },
      });
      return { member: user?.username ?? 'Unknown member', points: row.points };
    }),
  );
  const facts: Record<string, unknown> = {
    scope:
      'Current Kolkata week; top lists limited to available tracked records',
    members,
    activeMembers,
    approvedReviews,
    rejectedReviews,
    tasksCompleted,
    weeklyXP: totalXP._sum.amount ?? 0,
    topXPEarners,
    topContributors,
    reports,
    moderation,
  };
  if (/close|next level|eligib|qualif|role/i.test(question)) {
    const users = await db.userXP.findMany({
      where: { guildId },
      orderBy: { xp: 'desc' },
      take: 20,
      include: { user: { select: { discordId: true } } },
    });
    const candidates = [];
    for (const u of users) {
      const memberFacts = await eligibilityFacts(guildId, u.user.discordId);
      const xpFacts = await xpStats(guildId, u.user.discordId);
      candidates.push({
        member: u.user.username,
        stats: (({ discordId: _discordId, ...stats }) => stats)(
          memberFacts.stats,
        ),
        roles: memberFacts.roles.map(({ roleId: _roleId, ...role }) => role),
        xp: (({ discordId: _discordId, ...record }) => record)(xpFacts),
      });
    }
    facts.candidates = candidates;
    facts.candidateScope =
      'Top twenty tracked XP accounts, not a complete server scan';
  }
  if (/report|moderation|spam|toxic|abus|suspicious/i.test(question)) {
    facts.pendingReports = await db.report.findMany({
      where: { guildId, status: 'PENDING' },
      select: { id: true, type: true, target: true, description: true },
      take: 10,
    });
    facts.suspiciousXP = await db.auditLog.findMany({
      where: {
        guildId,
        action: 'XP_SUSPICIOUS_ACTIVITY',
        createdAt: { gte: start },
      },
      select: { targetId: true, data: true, createdAt: true },
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
  }
  return facts;
}
