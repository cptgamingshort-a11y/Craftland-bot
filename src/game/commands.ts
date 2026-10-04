import {
  EmbedBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { settings } from '../services/configuration.js';
import { UserError } from '../utils/errors.js';
import { awardGameXP } from '../xp/activity.js';
import {
  battle,
  blackjack,
  buyItem,
  activeTeam,
  claimDaily,
  gameLeaderboard,
  gameShop,
  getGameProfile,
  giveCoins,
  highLow,
  hunt,
  openCrate,
  sellCompanion,
  setTeamSlot,
  slots,
  type GameActionResult,
  type ShopItem,
} from './service.js';
import { animalText, battleText, zooText } from './presentation.js';

const coin = (n: number) => `${n.toLocaleString()} Craft Coins`;
const gameEmbed = (title: string, description: string) =>
  new EmbedBuilder()
    .setColor(0xc49a55)
    .setTitle(title)
    .setDescription(description.slice(0, 4000))
    .setFooter({ text: 'Craftland India • Adventure Game' })
    .setTimestamp();

export async function handleGameCommand(i: ChatInputCommandInteraction) {
  await i.deferReply();
  const config = await settings(i.guildId!);
  if (!config.channels.games)
    throw new UserError(
      'Game channel is not configured. Ask an administrator to run /setup.',
    );
  if (i.channelId !== config.channels.games) {
    await i.editReply({
      content: `Use game commands in <#${config.channels.games}>.`,
      allowedMentions: { parse: [] },
    });
    return;
  }
  const sub = i.options.getSubcommand();
  const userId = i.user.id;
  if (sub === 'help') {
    await i.editReply({ embeds: [gameEmbed('🎮 Craftland Command List',
      '**🏆 Rankings**\n`/game leaderboard`\n\n' +
      '**🪙 Economy**\n`/game balance` `/game give` `/game daily` `/game shop` `/game buy`\n\n' +
      '**🐾 Animals**\n`/game zoo` `/game animal` `/game hunt` `/game sell` `/game team` `/game team-set` `/game battle` `/game open`\n\n' +
      '**🎲 Gambling**\n`/game slots` `/game blackjack` `/game highlow` `g cf 10` `g mine 10`\n\n' +
      'Chat commands use `g` or `game`. `owo` belongs to the OwO bot.')],
    });
    return;
  }
  if (sub === 'balance') {
    const profile = await getGameProfile(i.guildId!, userId);
    await i.editReply({ content: `🪙 You have **${coin(profile.coins)}**.` });
    return;
  }
  if (sub === 'zoo') {
    const profile = await getGameProfile(i.guildId!, userId);
    await i.editReply({
      embeds: [gameEmbed('🐾 Your zoo', zooText(profile))],
    });
    return;
  }
  if (sub === 'animal') {
    const profile = await getGameProfile(i.guildId!, userId);
    await i.editReply({ embeds: [gameEmbed('🐾 Companion info', animalText(profile, i.options.getString('name', true)) ?? 'Unknown companion.')] });
    return;
  }
  if (sub === 'team') {
    const profile = await getGameProfile(i.guildId!, userId);
    const team = activeTeam(profile);
    await i.editReply({ embeds: [gameEmbed('⚔️ Your team', team.length
      ? team.map((name, index) => `**${index + 1}.** ${name}`).join('\n')
      : 'No companions yet. Try `/game hunt`.')] });
    return;
  }
  if (sub === 'profile') {
    const target = i.options.getUser('user') ?? i.user;
    const member = await i.guild!.members.fetch(target.id).catch(() => null);
    if (!member) throw new UserError('Choose a member of Craftland India.');
    const profile = await getGameProfile(i.guildId!, target.id);
    const inventory = Object.entries(
      profile.inventory as Record<string, number>,
    )
      .filter(([, count]) => count > 0)
      .map(
        ([key, count]) => `${gameShop[key as ShopItem]?.name ?? key} ×${count}`,
      );
    const pets = profile.pets as string[];
    await i.editReply({
      embeds: [
        gameEmbed(
          `🪙 ${target.username}'s Craftland Adventure`,
          `**Balance:** ${coin(profile.coins)}\n**Daily streak:** ${profile.dailyStreak} days\n**Companions:** ${pets.length ? pets.join(', ') : 'None yet — try `/game hunt`'}\n**Items:** ${inventory.join(', ') || 'No items'}`,
        ).setThumbnail(target.displayAvatarURL({ size: 256 })),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (sub === 'shop') {
    const lines = Object.values(gameShop).map(
      (item) => `**${item.name} — ${coin(item.price)}**\n${item.description}`,
    );
    await i.editReply({
      embeds: [gameEmbed('🛒 Craftland Game Shop', lines.join('\n\n'))],
    });
    return;
  }
  if (sub === 'leaderboard') {
    const rows = await gameLeaderboard(i.guildId!, 10);
    await i.editReply({
      embeds: [
        gameEmbed(
          '🏆 Craftland Coin Leaderboard',
          rows.length
            ? rows
                .map(
                  (row, index) =>
                    `${['🥇', '🥈', '🥉'][index] ?? `**${index + 1}.**`} <@${row.userId}> — ${coin(row.coins)}`,
                )
                .join('\n')
            : 'No coins earned yet. Claim `/game daily` to get started!',
        ),
      ],
      allowedMentions: { parse: [] },
    });
    return;
  }

  let result: GameActionResult;
  if (sub === 'daily')
    result = await claimDaily(i.guildId!, userId, `game:${i.id}`);
  else if (sub === 'hunt')
    result = await hunt(i.guildId!, userId, `game:${i.id}`);
  else if (sub === 'battle')
    result = await battle(i.guildId!, userId, `game:${i.id}`);
  else if (sub === 'buy')
    result = await buyItem(
      i.guildId!,
      userId,
      `game:${i.id}`,
      i.options.getString('item', true) as ShopItem,
    );
  else if (sub === 'open')
    result = await openCrate(i.guildId!, userId, `game:${i.id}`);
  else if (sub === 'team-set')
    result = await setTeamSlot(i.guildId!, userId, `game:${i.id}`,
      i.options.getInteger('slot', true), i.options.getString('animal', true));
  else if (sub === 'give') {
    const recipient = i.options.getUser('user', true);
    if (recipient.bot) throw new UserError('Choose a human member.');
    if (!await i.guild!.members.fetch(recipient.id).catch(() => null))
      throw new UserError('Choose a member of this server.');
    const amount = i.options.getInteger('amount', true);
    result = await giveCoins(i.guildId!, userId, recipient.id, `game:${i.id}`, amount);
  } else if (sub === 'sell')
    result = await sellCompanion(i.guildId!, userId, `game:${i.id}`, i.options.getString('animal', true));
  else if (sub === 'slots')
    result = await slots(i.guildId!, userId, `game:${i.id}`, i.options.getInteger('bet', true));
  else if (sub === 'blackjack')
    result = await blackjack(i.guildId!, userId, `game:${i.id}`, i.options.getInteger('bet', true));
  else if (sub === 'highlow')
    result = await highLow(i.guildId!, userId, `game:${i.id}`, i.options.getInteger('bet', true), i.options.getString('guess', true) as 'high' | 'low');
  else throw new UserError('Unknown game action.');

  if (result.replayed) {
    await i.editReply({
      embeds: [
        gameEmbed('Already processed', 'This game action was already saved.'),
      ],
    });
    return;
  }
  if (['daily', 'hunt', 'battle', 'slots', 'blackjack', 'highlow'].includes(sub))
    await awardGameXP(
      i.client,
      i.guildId!,
      userId,
      `game:${i.id}`,
      `Craftland ${sub} game activity`,
    );
  if (['give', 'sell', 'slots', 'blackjack', 'highlow', 'team-set'].includes(sub)) {
    const details = sub === 'team-set'
      ? `Team slot **${result.tile}** now has **${result.animal}**.`
      : sub === 'give'
      ? `Sent **${coin(i.options.getInteger('amount', true))}** to <@${i.options.getUser('user', true).id}>. Balance: **${coin(result.remainingCoins!)}**.`
      : sub === 'sell'
        ? `Sold **${result.animal}** for **${coin(result.reward!)}**.`
        : sub === 'slots'
          ? `${result.symbols!.join(' | ')}\nPayout: **${coin(result.payout!)}**.`
          : sub === 'blackjack'
            ? `You: **${result.playerTotal}** • Dealer: **${result.dealerTotal}**\n${result.outcome!.toUpperCase()} • Payout: **${coin(result.payout!)}**.`
            : `${result.firstCard} → ${result.secondCard} (${result.outcome})\nPayout: **${coin(result.payout!)}**.`;
    await i.editReply({ embeds: [gameEmbed('🎮 Craftland Games', details)], allowedMentions: { parse: [] } });
    return;
  }
  const text =
    sub === 'daily'
      ? `You received **${coin(result.reward!)}**. Daily streak: **${result.streak}**.`
      : sub === 'hunt'
        ? `${result.animal ? (result.duplicate ? `You found another **${result.animal}**. Duplicate converted to coins!` : `A **${result.animal}** joined your companions!`) : 'The trail was quiet this time.'}\nYou earned **${coin(result.coins!)}**.${result.usedTicket ? '\nHunt Ticket used.' : ''}${result.usedCharm ? '\nLucky Charm used.' : ''}`
        : sub === 'battle'
          ? battleText(result)
          : sub === 'buy'
            ? `Purchased **${gameShop[result.item as ShopItem].name}**. Remaining balance: **${coin(result.remainingCoins!)}**.`
            : `Your Map Crate revealed **${result.animal}**${result.duplicate ? ' again; the duplicate became 30 coins.' : ', now in your companion collection.'}`;
  await i.editReply({
    embeds: [gameEmbed('🎮 Craftland Adventure', text)],
    allowedMentions: { parse: [] },
  });
}
