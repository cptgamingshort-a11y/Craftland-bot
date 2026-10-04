import { type Client, type GuildMember, PermissionFlagsBits } from 'discord.js';
import { db } from '../database/client.js';
import { memberStats } from '../services/members.js';
import { settings } from '../services/configuration.js';
import { audit, notify } from '../services/audit.js';
import { assertRole } from './guards.js';
import { eligibility } from './eligibility.js';
import { logError, UserError } from '../utils/errors.js';
export async function eligibilityFacts(guildId: string, discordId: string) {
  const stats = await memberStats(guildId, discordId);
  const roles = await db.roleConfiguration.findMany({
    where: { guildId },
    include: { requirement: true },
  });
  return {
    stats,
    roles: roles
      .filter((r) => r.requirement)
      .map((r) => ({
        roleId: r.roleId,
        name: r.name,
        ...eligibility(stats, r.requirement!),
      })),
  };
}
export async function assignRole(
  client: Client,
  target: GuildMember,
  roleId: string,
  actor?: GuildMember,
  automatic = false,
) {
  const role = await target.guild.roles.fetch(roleId);
  const bot = await target.guild.members.fetchMe();
  if (!role) throw new UserError('Role no longer exists.');
  assertRole(bot, target, role, actor);
  if (automatic) {
    const config = await db.roleConfiguration.findUnique({
      where: { guildId_roleId: { guildId: target.guild.id, roleId } },
      include: { requirement: true },
    });
    const c = await settings(target.guild.id);
    if (
      !config?.autoAssign ||
      config.protected ||
      !config.requirement ||
      c.roles.staff.includes(roleId) ||
      role.permissions.has(
        [
          PermissionFlagsBits.ManageGuild,
          PermissionFlagsBits.ManageRoles,
          PermissionFlagsBits.ModerateMembers,
          PermissionFlagsBits.BanMembers,
          PermissionFlagsBits.KickMembers,
        ],
        false,
      )
    )
      throw new UserError('Automatic assignment prohibited for this role.');
    if (
      !eligibility(
        await memberStats(target.guild.id, target.id),
        config.requirement,
      ).eligible
    )
      throw new UserError('Verified requirements are not met.');
  }
  if (target.roles.cache.has(roleId)) return;
  const actorId = actor?.id ?? client.user!.id;
  await audit(
    client,
    target.guild.id,
    actorId,
    'ROLE_ASSIGNMENT_REQUESTED',
    target.id,
    { roleId, automatic },
  );
  await target.roles.add(
    role,
    'Verified Craftland India contribution / authorized staff',
  );
  await audit(client, target.guild.id, actorId, 'ROLE_ASSIGNED', target.id, {
    roleId,
    automatic,
  });
  if (automatic) {
    const c = await settings(target.guild.id);
    await notify(
      client,
      target.guild.id,
      c.channels.announcement,
      '🎉 ROLE UNLOCKED',
      `Congratulations <@${target.id}>!\nBased on your verified contribution history, you have unlocked 🏆 ${role.name}.\nKeep contributing to Craftland India!`,
    );
  }
}
export async function scanRoles(client: Client, guildId: string) {
  const guild = await client.guilds.fetch(guildId);
  const c = await settings(guildId);
  const bot = await guild.members.fetchMe();
  const configs = await db.roleConfiguration.findMany({
    where: { guildId },
    include: { requirement: true },
  });
  const users = await db.user.findMany({
    where: { guildId },
    select: { discordId: true },
  });
  for (const user of users) {
    const member = await guild.members.fetch(user.discordId).catch(() => null);
    if (!member || member.user.bot) continue;
    const stats = await memberStats(guildId, member.id);
    for (const r of configs) {
      if (!r.requirement || r.protected || c.roles.staff.includes(r.roleId))
        continue;
      try {
        if (
          r.autoAssign &&
          !member.roles.cache.has(r.roleId) &&
          eligibility(stats, r.requirement).eligible
        )
          await assignRole(client, member, r.roleId, undefined, true);
        if (
          r.autoRemove &&
          r.maintenanceDays &&
          r.requirement.maintenancePoints !== null &&
          member.roles.cache.has(r.roleId)
        ) {
          const role = await guild.roles.fetch(r.roleId);
          if (
            !role ||
            role.permissions.has(
              [
                PermissionFlagsBits.Administrator,
                PermissionFlagsBits.ManageGuild,
                PermissionFlagsBits.ManageRoles,
                PermissionFlagsBits.ModerateMembers,
                PermissionFlagsBits.KickMembers,
                PermissionFlagsBits.BanMembers,
              ],
              false,
            )
          )
            continue;
          assertRole(bot, member, role);
          const since = new Date(Date.now() - r.maintenanceDays * 86400000);
          const u = await db.user.findUniqueOrThrow({
            where: { guildId_discordId: { guildId, discordId: member.id } },
          });
          const points = await db.pointTransaction.aggregate({
            where: { userId: u.id, createdAt: { gte: since } },
            _sum: { amount: true },
          });
          if ((points._sum.amount ?? 0) < r.requirement.maintenancePoints) {
            await audit(
              client,
              guildId,
              bot.id,
              'ROLE_REMOVAL_REQUESTED',
              member.id,
              { roleId: r.roleId, automatic: true },
            );
            await member.roles.remove(
              role,
              'Explicitly configured contribution role maintenance',
            );
            await audit(client, guildId, bot.id, 'ROLE_REMOVED', member.id, {
              roleId: r.roleId,
              automatic: true,
            });
          }
        }
      } catch (e) {
        logError('role-scan', e);
      }
    }
  }
}
