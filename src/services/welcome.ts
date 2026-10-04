import { EmbedBuilder, type Client, type GuildMember } from 'discord.js';
import { logError } from '../utils/errors.js';

export async function sendWelcome(
  client: Client,
  member: GuildMember,
  channelId: string,
) {
  if (!channelId) return;
  const mention = `<@${member.id}>`;
  const welcome = new EmbedBuilder()
    .setColor(0xc49a55)
    .setTitle('📌 Welcome to Craftland India')
    .setDescription(
      [
        `👋 Welcome, ${mention}! Join creators, builders, and Craftland fans from across India.`,
        '',
        '**Get started**',
        '📖 Read the rules  ·  🎮 Explore maps',
        '🛠️ Share creations  ·  🤝 Meet the community',
        '',
        '**Create. Share. Learn. Grow.**',
      ].join('\n'),
    )
    .setThumbnail(member.displayAvatarURL({ size: 128 }))
    .setFooter({ text: 'Craftland India • Community Welcome' });

  try {
    const channel = await client.channels.fetch(channelId);
    if (
      channel &&
      'guildId' in channel &&
      channel.guildId === member.guild.id &&
      channel.isSendable()
    ) {
      await channel.send({
        content: `🎉 Welcome ${mention} to Craftland India!`,
        embeds: [welcome],
        allowedMentions: { parse: [], users: [member.id] },
      });
    }
  } catch (error) {
    logError('welcome-message', error);
  }
}
