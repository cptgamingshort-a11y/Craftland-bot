import { REST, Routes, ChannelType, PermissionFlagsBits } from 'discord.js';
import { env } from '../dist/config/env.js';
import { db } from '../dist/database/client.js';
import { closeFirebase } from '../dist/database/firebase.js';

const guildId = env.DISCORD_GUILD_ID;
const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
const startCategoryId = '1529464831705354301';
const bot = await rest.get(Routes.user('@me'));

async function ensureChannel(name, type, extras = {}) {
  const channels = await rest.get(Routes.guildChannels(guildId));
  const existing = channels.find((channel) =>
    channel.name === name && channel.type === type && channel.parent_id === startCategoryId);
  if (existing) return existing;
  return rest.post(Routes.guildChannels(guildId), {
    body: { name, type, parent_id: startCategoryId, ...extras },
    reason: 'Craftland India server information layout requested by the server owner',
  });
}

const readOnly = [
  { id: guildId, type: 0, allow: '0', deny: String(PermissionFlagsBits.SendMessages) },
  { id: bot.id, type: 1, allow: String(PermissionFlagsBits.SendMessages | PermissionFlagsBits.EmbedLinks), deny: '0' },
];

try {
  const guild = await rest.get(Routes.guild(guildId), {
    query: new URLSearchParams({ with_counts: 'true' }).toString(),
  });
  if (guild.name !== 'Craftland India!') throw new Error(`Unexpected guild: ${guild.name}`);

  const roleInfo = await ensureChannel('role-info', ChannelType.GuildText, {
    topic: 'Craftland India staff, creator, booster, and level roles.',
    permission_overwrites: readOnly,
  });
  const boosters = await ensureChannel('server-boosters', ChannelType.GuildText, {
    topic: 'Discord server boost notices and appreciation.',
    permission_overwrites: readOnly,
  });
  const countName = `Members: ${guild.approximate_member_count ?? 0}`;
  const channels = await rest.get(Routes.guildChannels(guildId));
  const existingCount = channels.find((channel) =>
    channel.type === ChannelType.GuildVoice && channel.parent_id === startCategoryId &&
    /^Members: \d+$/i.test(channel.name));
  const count = existingCount ?? await ensureChannel(countName, ChannelType.GuildVoice, {
    permission_overwrites: [{
      id: guildId, type: 0, allow: '0', deny: String(PermissionFlagsBits.Connect),
    }],
  });

  const flags = (guild.system_channel_flags ?? 0) | 1; // Suppress join notices; keep boost notices visible.
  if (guild.system_channel_id !== boosters.id || guild.system_channel_flags !== flags)
    await rest.patch(Routes.guild(guildId), {
      body: { system_channel_id: boosters.id, system_channel_flags: flags },
      reason: 'Route future server boost notices to #server-boosters',
    });

  const roles = await rest.get(Routes.guildRoles(guildId));
  const roleByName = new Map(roles.map((role) => [role.name, role]));
  const descriptions = [
    ['⊹ MODERATOR', 'Moderation team'],
    ['⊹ CRAFTLAND VOLUNTEER', 'Community volunteer'],
    ['⊹ CRAFTLAND MONITOR', 'Community monitor'],
    ['Map Reviewer', 'Reviews and feedback for Craftland maps'],
    ['Senior Reviewer', 'Senior map reviewer'],
    ['⊹ CONTEST ORGANISER', 'Community contests and events'],
    ['⊹ BADGE CREATOR', 'Creates community badges'],
    ['⊹ ADMIN VERIFIED {CREATOR}', 'Verified Craftland creator'],
    ['⊹ CREATORS', 'Craftland creators'],
    ['⊹ YOUTUBER', 'Video creators'],
    ['⊹ SERVER BOOSTER', 'Members boosting the server'],
  ];
  const important = descriptions.flatMap(([name, description]) => {
    const role = roleByName.get(name);
    return role ? [`<@&${role.id}> — ${description}`] : [];
  });
  const levelRoles = await db.levelRole.findMany({ where: { guildId }, take: 100 });
  const levels = levelRoles.filter((row) => row.enabled)
    .sort((a, b) => a.level - b.level)
    .map((row) => `**Level ${row.level}** → <@&${row.roleId}>`);
  const embeds = [
    {
      color: 0xc49a55,
      title: '🏷️ Craftland India • Important Roles',
      description: important.join('\n\n'),
      footer: { text: 'Craftland India • Role Directory' },
    },
    {
      color: 0xc49a55,
      title: '🏅 Level Roles',
      description: `Earn XP through community activity. Use \`/level\` to see your progress.\n\n${levels.join('\n')}`,
      footer: { text: 'Craftland India • Role Directory' },
    },
  ];
  const messages = await rest.get(Routes.channelMessages(roleInfo.id), {
    query: new URLSearchParams({ limit: '50' }).toString(),
  });
  const prior = messages.find((message) => message.author.id === bot.id &&
    message.embeds?.[0]?.footer?.text === 'Craftland India • Role Directory');
  const body = { embeds, allowed_mentions: { parse: [] } };
  if (prior) await rest.patch(Routes.channelMessage(roleInfo.id, prior.id), { body });
  else await rest.post(Routes.channelMessages(roleInfo.id), { body });

  console.log(JSON.stringify({ roleInfo: roleInfo.id, boosters: boosters.id, memberCount: count.id, members: guild.approximate_member_count }));
} finally {
  await closeFirebase();
}
