import { PermissionFlagsBits, type Client, type GuildMember } from 'discord.js';
import { db } from '../database/client.js';
import { settings } from './configuration.js';
import { notify } from './audit.js';
import { UserError } from '../utils/errors.js';

export async function assignBotRole(client: Client, member: GuildMember) {
  if (!member.user.bot) return;
  const config = await settings(member.guild.id);
  if (!config.roles.bot) return;
  const role = await member.guild.roles.fetch(config.roles.bot);
  const self = await member.guild.members.fetchMe();
  if (
    !role ||
    role.managed ||
    role.permissions.has(PermissionFlagsBits.Administrator) ||
    role.permissions.bitfield !== 0n ||
    role.position >= self.roles.highest.position ||
    !self.permissions.has(PermissionFlagsBits.ManageRoles)
  )
    throw new UserError('Configured Bot role is missing or unsafe to assign.');
  if (member.roles.cache.has(role.id)) return;
  await member.roles.add(role, 'Automatic Bot role on joining');
  await db.auditLog.create({
    data: {
      guildId: member.guild.id,
      actorId: self.id,
      action: 'BOT_ROLE_ASSIGNED',
      targetId: member.id,
      data: { roleId: role.id, source: 'bot_join' },
    },
  });
  await notify(
    client,
    member.guild.id,
    config.channels.log,
    'Bot joined server',
    `Bot: <@${member.id}>\nRole: **${role.name}**\nID: ${role.id}\nAutomatically assigned on joining`,
  );
}
