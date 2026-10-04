import { type GuildMember, type PartialGuildMember } from 'discord.js';
import { db } from '../database/client.js';
import { DateTime } from 'luxon';
export async function ensureUser(
  guildId: string,
  discordId: string,
  username?: string,
  joinedAt?: Date | null,
) {
  return db.user.upsert({
    where: { guildId_discordId: { guildId, discordId } },
    create: { guildId, discordId, username: username ?? discordId, joinedAt },
    update: {
      ...(username ? { username } : {}),
      ...(joinedAt ? { joinedAt } : {}),
    },
  });
}
export function memberUser(member: GuildMember) {
  return ensureUser(
    member.guild.id,
    member.id,
    member.user.username,
    member.joinedAt,
  );
}

/** Persist restorable, manually assigned guild roles when a member leaves. */
export async function saveMemberRoles(
  member: GuildMember | PartialGuildMember,
) {
  const savedRoleIds = member.roles.cache
    .filter((role) => role.id !== member.guild.id && !role.managed)
    .map((role) => role.id);
  await db.user.upsert({
    where: {
      guildId_discordId: {
        guildId: member.guild.id,
        discordId: member.id,
      },
    },
    create: {
      guildId: member.guild.id,
      discordId: member.id,
      username: member.user.username,
      joinedAt: null,
      savedRoleIds,
    },
    update: { savedRoleIds },
  });
  return savedRoleIds;
}

/** Restore saved roles that still exist and are below the bot's role. */
export async function restoreMemberRoles(member: GuildMember) {
  const user = await db.user.findUnique({
    where: {
      guildId_discordId: {
        guildId: member.guild.id,
        discordId: member.id,
      },
    },
  });
  const savedRoleIds = Array.isArray(user?.savedRoleIds)
    ? user.savedRoleIds.filter((id): id is string => typeof id === 'string')
    : [];
  if (!savedRoleIds.length) return { restored: [] as string[], skipped: [] as string[] };

  const bot = await member.guild.members.fetchMe();
  if (!bot.permissions.has('ManageRoles'))
    throw new Error('Bot needs Manage Roles to restore saved member roles.');
  const available: string[] = [];
  const skipped: string[] = [];
  for (const id of savedRoleIds) {
    if (id === member.guild.id) continue;
    const role = await member.guild.roles.fetch(id).catch(() => null);
    if (!role || role.managed || role.position >= bot.roles.highest.position) {
      skipped.push(id);
      continue;
    }
    available.push(role.id);
  }
  if (available.length)
    await member.roles.add(available, 'Restore roles saved from previous membership');
  return { restored: available, skipped };
}

export async function memberStats(guildId: string, discordId: string) {
  const user = await ensureUser(guildId, discordId);
  const week = DateTime.now()
    .setZone('Asia/Kolkata')
    .startOf('week')
    .toJSDate();
  const [
    total,
    weekly,
    approved,
    rejected,
    activities,
    reviews,
    completed,
    days,
  ] = await Promise.all([
    db.pointTransaction.aggregate({
      where: { userId: user.id },
      _sum: { amount: true },
    }),
    db.pointTransaction.aggregate({
      where: { userId: user.id, createdAt: { gte: week } },
      _sum: { amount: true },
    }),
    db.review.count({ where: { userId: user.id, status: 'APPROVED' } }),
    db.review.count({ where: { userId: user.id, status: 'REJECTED' } }),
    db.activity.findMany({
      where: { userId: user.id, status: 'APPROVED' },
      orderBy: { timestamp: 'desc' },
      take: 8,
    }),
    db.review.aggregate({
      where: { userId: user.id, status: 'APPROVED' },
      _avg: { quality: true },
    }),
    db.activity.count({
      where: { userId: user.id, type: 'task', status: 'APPROVED' },
    }),
    db.activity.findMany({
      where: { userId: user.id, status: 'APPROVED' },
      select: { timestamp: true },
    }),
  ]);
  return {
    discordId,
    points: total._sum.amount ?? 0,
    weeklyPoints: weekly._sum.amount ?? 0,
    approvedReviews: approved,
    rejectedReviews: rejected,
    activeDays: new Set(
      days.map((a) =>
        DateTime.fromJSDate(a.timestamp).setZone('Asia/Kolkata').toISODate(),
      ),
    ).size,
    quality: reviews._avg.quality,
    tasksCompleted: completed,
    recentActivity: activities.slice(0, 8).map((a) => ({
      type: a.type,
      description: a.description,
      points: a.points,
      timestamp: a.timestamp.toISOString(),
    })),
  };
}
