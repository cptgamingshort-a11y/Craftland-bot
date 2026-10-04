import {
  AttachmentBuilder,
  PermissionFlagsBits,
  type Client,
  type GuildMember,
  type Role,
} from 'discord.js';
import { db } from '../database/client.js';
import { settings } from '../services/configuration.js';
import { assertRole } from '../roles/guards.js';
import { audit } from '../services/audit.js';
import { levelConfig } from './config.js';
import {
  levelConfigLock,
  memberXPLock,
  transactionLock,
  withDatabaseLocks,
} from '../utils/locks.js';
import { logError, UserError } from '../utils/errors.js';
import { ensureUser } from '../services/members.js';
import { createLevelUpBanner } from './levelUpBanner.js';
const privileged = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ManageMessages,
];
export async function assertLevelRole(role: Role, actor?: GuildMember) {
  const guild = role.guild;
  const c = await settings(guild.id);
  const bot = await guild.members.fetchMe();
  const related = [
    c.roles.member,
    c.roles.creator,
    c.roles.reviewer,
    c.roles.seniorReviewer,
    c.roles.eventTeam,
    c.roles.moderator,
    ...c.roles.staff,
  ];
  if (
    role.id === guild.id ||
    role.managed ||
    role.position >= bot.roles.highest.position ||
    role.permissions.has(privileged, false) ||
    related.includes(role.id) ||
    (await db.roleConfiguration.findUnique({
      where: { guildId_roleId: { guildId: guild.id, roleId: role.id } },
    }))
  )
    throw new UserError(
      `"${role.name}" is privileged, above the bot, or belongs to another role system; it cannot be a level role.`,
    );
  if (
    !bot.permissions.has(PermissionFlagsBits.ManageRoles) ||
    (actor &&
      actor.id !== guild.ownerId &&
      actor.roles.highest.position <= role.position)
  )
    throw new UserError(
      'Manage Roles / role hierarchy protection blocked this mapping.',
    );
}
export async function setLevelRole(
  guildId: string,
  level: number,
  role: Role,
  actor: GuildMember,
) {
  const config = await levelConfig(guildId);
  if (!Number.isInteger(level) || level < 1 || level > config.maxLevel)
    throw new UserError(`Level must be 1–${config.maxLevel}.`);
  await assertLevelRole(role, actor);
  await db.$transaction(async (tx) => {
    await transactionLock(tx, levelConfigLock(guildId));
    const other = await tx.levelRole.findFirst({
      where: { guildId, roleId: role.id, level: { not: level } },
    });
    if (other)
      throw new UserError(
        'This role is already registered to another level. Choose a distinct role for each level.',
      );
    await tx.levelRole.upsert({
      where: { guildId_level: { guildId, level } },
      create: { guildId, level, roleId: role.id, roleName: role.name },
      update: { roleId: role.id, roleName: role.name, enabled: true },
    });
    await tx.levelRoleResource.upsert({
      where: { guildId_roleId: { guildId, roleId: role.id } },
      create: { guildId, roleId: role.id, roleName: role.name },
      update: { roleName: role.name },
    });
    await tx.userXP.updateMany({
      where: { guildId },
      data: { roleSyncPending: true },
    });
    await tx.auditLog.create({
      data: {
        guildId,
        actorId: actor.id,
        action: 'LEVEL_ROLE_MAPPING_SET',
        data: { level, roleId: role.id, roleName: role.name },
      },
    });
  });
}
export async function removeLevelRole(
  guildId: string,
  level: number,
  actorId: string,
) {
  await db.$transaction(async (tx) => {
    await transactionLock(tx, levelConfigLock(guildId));
    const result = await tx.levelRole.updateMany({
      where: { guildId, level, enabled: true },
      data: { enabled: false },
    });
    if (!result.count)
      throw new UserError('No active mapping exists for this level.');
    await tx.userXP.updateMany({
      where: { guildId },
      data: { roleSyncPending: true },
    });
    await tx.auditLog.create({
      data: {
        guildId,
        actorId,
        action: 'LEVEL_ROLE_MAPPING_REMOVED',
        data: { level },
      },
    });
  });
}
export function planLevelRoles(
  current: string[],
  registered: string[],
  desired?: string,
) {
  return {
    remove: current.filter((id) => registered.includes(id) && id !== desired),
    add: desired && !current.includes(desired) ? desired : undefined,
  };
}
async function pendingLevelChanges(guildId: string, userId: string) {
  return (await db.levelChange.findMany({ where: { guildId, userId } }))
    .filter((change) => !change.processedAt)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
}

export async function syncUserLevelRoles(
  client: Client,
  guildId: string,
  discordId: string,
  force = false,
) {
  const user = await ensureUser(guildId, discordId);
  await levelConfig(guildId);
  return withDatabaseLocks(
    [
      { key: levelConfigLock(guildId), shared: true },
      { key: memberXPLock(guildId, user.id) },
    ],
    async (held) => {
      const account = await db.userXP.upsert({
        where: { userId: user.id },
        create: { guildId, userId: user.id },
        update: {},
      });
      if (!force && !account.roleSyncPending)
        return { changed: false, removed: [], assigned: undefined };
      const guild = await client.guilds.fetch(guildId);
      const member = await guild.members
        .fetch({ user: discordId, force: true })
        .catch(() => null);
      if (!member) {
        await db.userXP.update({
          where: { id: account.id },
          data: { roleSyncPending: false },
        });
        for (const change of await pendingLevelChanges(guildId, user.id))
          await db.levelChange.update({
            where: { id: change.id },
            data: { processedAt: new Date(), lastError: 'Member left the server' },
          });
        return { changed: false, removed: [], assigned: undefined };
      }
      const mappings = (await db.levelRole.findMany({ where: { guildId } }))
        .filter((role) => role.enabled && role.level <= account.level)
        .sort((a, b) => b.level - a.level)
        .slice(0, 1);
      const registry = await db.levelRoleResource.findMany({
        where: { guildId },
      });
      const desired = mappings[0]?.roleId;
      const plan = planLevelRoles(
        [...member.roles.cache.keys()],
        registry.map((r) => r.roleId),
        desired,
      );
      const bot = await guild.members.fetchMe();
      const removed: Role[] = [];
      let newRole: Role | undefined;
      try {
        if (desired) {
          newRole = (await guild.roles.fetch(desired)) ?? undefined;
          if (!newRole)
            throw new UserError(
              `Required level role ${desired} no longer exists.`,
            );
          await assertLevelRole(newRole);
          assertRole(bot, member, newRole);
        }
        for (const id of plan.remove) {
          const role = await guild.roles.fetch(id);
          if (!role) continue;
          await assertLevelRole(role);
          assertRole(bot, member, role);
          removed.push(role);
        }
        // All roles are checked before the first mutation. Only registered level roles are removed.
        if (removed.length || plan.add)
          await audit(
            client,
            guildId,
            bot.id,
            'LEVEL_ROLE_CHANGE_REQUESTED',
            member.id,
            {
              level: account.level,
              previous: removed.map((r) => r.id),
              next: desired ?? null,
            },
          );
        held();
        if (removed.length)
          await member.roles.remove(
            removed,
            'Strict configured level-role progression',
          );
        if (plan.add && newRole) {
          held();
          try {
            await member.roles.add(newRole, 'Verified database level');
          } catch (error) {
            if (removed.length) {
              await member.roles
                .add(
                  removed,
                  'Restore previous level roles after assignment failure',
                )
                .catch((restore) => logError('level-role-restore', restore));
            }
            throw error;
          }
        }
        if (removed.length || plan.add)
          await audit(
            client,
            guildId,
            bot.id,
            'LEVEL_ROLE_CHANGED',
            member.id,
            {
              level: account.level,
              previous: removed.map((r) => ({ id: r.id, name: r.name })),
              next: newRole ? { id: newRole.id, name: newRole.name } : null,
            },
          );
        const pending = await pendingLevelChanges(guildId, user.id);
        const event = pending.find((e) => e.newLevel === account.level);
        const config = await db.levelConfig.findUniqueOrThrow({
          where: { guildId },
        });
        const c = await settings(guildId);
        if (event && event.newLevel > event.oldLevel && !event.notifiedAt) {
          const channelId = config.levelUpChannelId || c.channels.announcement;
          if (channelId) {
            const ch = await client.channels.fetch(channelId);
            if (
              !ch ||
              !('guildId' in ch) ||
              ch.guildId !== guildId ||
              !ch.isSendable()
            )
              throw new UserError(
                'Level-up channel is unavailable; notification will be retried.',
              );
            const description = config.levelUpMessage
              .replaceAll('{user}', `<@${member.id}>`)
              .replaceAll('{level}', String(account.level));
            const banner = await createLevelUpBanner(
              member.displayAvatarURL({ extension: 'png', size: 128 }),
              event.oldLevel,
              account.level,
            );
            held();
            await ch.send({
              content: description.slice(0, 2000),
              files: [new AttachmentBuilder(banner, { name: 'level-up.png' })],
              allowedMentions: { parse: [], users: [member.id] },
            });
            await db.levelChange.update({
              where: { id: event.id },
              data: { notifiedAt: new Date() },
            });
          }
        }
        for (const change of pending)
          await db.levelChange.update({
            where: { id: change.id }, data: { processedAt: new Date(), lastError: null },
          });
        await db.userXP.update({
          where: { id: account.id },
          data: { roleSyncPending: false },
        });
        return {
          changed: removed.length > 0 || Boolean(plan.add),
          removed: removed.map((r) => r.id),
          assigned: desired,
        };
      } catch (error) {
        const reason =
          error instanceof UserError
            ? error.message
            : 'Discord role/notification request failed';
        logError('level-role-sync', error);
        for (const change of await pendingLevelChanges(guildId, user.id))
          await db.levelChange.update({
            where: { id: change.id },
            data: { attempts: { increment: 1 }, lastError: reason },
          });
        await audit(
          client,
          guildId,
          bot.id,
          'LEVEL_ROLE_SYNC_FAILED',
          member.id,
          { level: account.level, reason },
        );
        return {
          changed: false,
          removed: [],
          assigned: undefined,
          error: reason,
        };
      }
    },
  );
}
export async function syncGuildLevelRoles(
  client: Client,
  guildId: string,
  force = false,
) {
  const rows = await db.userXP.findMany({
    where: { guildId, ...(force ? {} : { roleSyncPending: true }) },
    include: { user: { select: { discordId: true } } },
  });
  let changed = 0,
    failed = 0;
  for (const row of rows) {
    try {
      const result = await syncUserLevelRoles(
        client,
        guildId,
        row.user.discordId,
        force,
      );
      if (result.changed) changed++;
      if ('error' in result && result.error) failed++;
    } catch (error) {
      failed++;
      logError('level-role-sync', error);
    }
  }
  return { checked: rows.length, changed, failed };
}
