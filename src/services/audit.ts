import { type Client, EmbedBuilder } from 'discord.js';
import { db } from '../database/client.js';
import { settings } from './configuration.js';
import { logError } from '../utils/errors.js';
import { redactSecrets } from '../ai/gemini.js';
export async function notify(
  client: Client,
  guildId: string,
  channelId: string,
  title: string,
  description: string,
) {
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (
      channel &&
      'guildId' in channel &&
      channel.guildId === guildId &&
      channel.isSendable()
    )
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf0a52b)
            .setTitle(title.slice(0, 256))
            .setDescription(description.slice(0, 4000))
            .setTimestamp(),
        ],
        allowedMentions: { parse: [] },
      });
  } catch (e) {
    logError('notification', e);
  }
}
export async function audit(
  client: Client,
  guildId: string,
  actorId: string,
  action: string,
  targetId?: string,
  data: Record<string, unknown> | unknown[] = {},
) {
  await db.auditLog.create({
    data: { guildId, actorId, action, targetId, data },
  });
  await auditNotification(client, guildId, action, actorId, targetId, data);
}
export async function auditNotification(
  client: Client,
  guildId: string,
  action: string,
  actorId: string,
  targetId?: string,
  details?: unknown,
) {
  const c = await settings(guildId);
  let detail = '';
  if (details !== undefined) {
    try {
      const value = JSON.stringify(redactSecrets(details), null, 2);
      if (value && value !== '{}' && value !== '[]')
        detail = `\n\n**Details**\n\`\`\`json\n${value.slice(0, 3000)}\n\`\`\``;
    } catch {
      detail = '\n\nDetails could not be safely rendered.';
    }
  }
  await notify(
    client,
    guildId,
    c.channels.log,
    action,
    `Actor ID: ${actorId}\nTarget ID: ${targetId ?? '—'}${detail}`,
  );
}
