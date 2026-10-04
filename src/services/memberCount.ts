import { ChannelType, Routes, type Client } from 'discord.js';
import { env } from '../config/env.js';
import { logError } from '../utils/errors.js';

const channelId = '1556062721907363872';
const minimumRenameIntervalMs = 5 * 60_000;
let nextAllowedAt = 0;
let pending: ReturnType<typeof setTimeout> | undefined;

async function syncMemberCount(client: Client) {
  const guild = await client.rest.get(Routes.guild(env.DISCORD_GUILD_ID), {
    query: new URLSearchParams({ with_counts: 'true' }),
  }) as { approximate_member_count?: number };
  if (!Number.isInteger(guild.approximate_member_count)) return;
  const channel = await client.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildVoice) return;
  const name = `Members: ${guild.approximate_member_count}`;
  if (channel.name !== name)
    await channel.setName(name, 'Keep the server member counter up to date');
}

export function queueMemberCountSync(client: Client, immediate = false) {
  if (pending) return;
  const delay = immediate ? 0 : Math.max(30_000, nextAllowedAt - Date.now());
  pending = setTimeout(() => {
    pending = undefined;
    nextAllowedAt = Date.now() + minimumRenameIntervalMs;
    void syncMemberCount(client).catch((error) => logError('member-count', error));
  }, delay);
}
