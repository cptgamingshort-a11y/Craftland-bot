import { EmbedBuilder } from 'discord.js';
import type { Settings } from '../config/settings.js';

export const COMMUNITY_RULES_TITLE = '📜 Craftland India • Community Rules';

export function communityRulesEmbed(config: Settings) {
  const channel = (id: string, name: string) => (id ? `<#${id}>` : `#${name}`);
  return new EmbedBuilder()
    .setColor(0xc49a55)
    .setTitle(COMMUNITY_RULES_TITLE)
    .setDescription(
      'Help keep Craftland India friendly, useful, and safe for every creator. These updated rules supersede earlier rule posts.',
    )
    .addFields(
      {
        name: '🤝 Respect each other',
        value:
          'No harassment, hate speech, threats, discrimination, or personal attacks. Keep feedback constructive.',
      },
      {
        name: '🛠️ Share Craftland content responsibly',
        value:
          'Share your own maps or credit the creator. No cheats, hacks, exploits, scams, NSFW content, or unsafe links.',
      },
      {
        name: '💬 Use channels and play fairly',
        value: `Keep questions in ${channel(config.channels.doubtSolving, 'doubt-solving')}, chat in ${channel(config.channels.generalChat, 'general-chat')}, and games in ${channel(config.channels.games, 'games')}. No flooding, XP farming, coin farming, or abusing bot commands.`,
      },
      {
        name: '🔒 Protect privacy and use AI wisely',
        value:
          'Never post passwords, API keys, private credentials, or sensitive personal information. The AI assistant may process questions in the configured chat channels; its suggestions are not official staff decisions.',
      },
      {
        name: '🛡️ Follow staff guidance',
        value:
          'Follow Discord’s rules and reasonable staff instructions. Serious or repeated violations may lead to a warning, timeout, kick, or ban based on context.',
      },
    )
    .setFooter({ text: 'Craftland India • Create. Share. Learn. Grow.' });
}
