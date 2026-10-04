import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  escapeMarkdown,
  type ButtonInteraction,
  type Message,
} from 'discord.js';
import { settings } from '../services/configuration.js';
import { randomInt } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { RateLimiter } from '../utils/rateLimit.js';
import { UserError, logError } from '../utils/errors.js';
import { awardGameXP } from '../xp/activity.js';
import {
  cashoutMines,
  startBlackjack,
  playBlackjack,
  battle,
  activeTeam,
  buyItem,
  claimDaily,
  coinFlip,
  giveCoins,
  getGameProfile,
  gameLeaderboard,
  gameShop,
  highLow,
  hunt,
  minesMultiplier,
  revealMineTile,
  startMines,
  openCrate,
  sellCompanion,
  setTeamSlot,
  slots,
  type MinesGame,
  type BlackjackGame,
  type ShopItem,
} from './service.js';
import { animalText, battleText, zooText } from './presentation.js';

type PrefixAction = 'game' | 'cash' | 'mine' | 'cf' | 'daily' | 'hunt' | 'help' | 'give' | 'zoo' | 'sell' | 'slots' | 'blackjack' | 'highlow' | 'shop' | 'buy' | 'battle' | 'open' | 'top' | 'team';
export type ParsedGameCommand = { action: PrefixAction; args: string[] };
const prefixLimit = new RateLimiter(8, 60_000);
const coin = (n: number) => `${n.toLocaleString()} Craft Coins`;
const coinFlipGif = fileURLToPath(new URL('../../assets/coin-flip.gif', import.meta.url));

export function parseGameCommand(content: string): ParsedGameCommand | null {
  const match = content.trim().match(/^(?:g|game)\s+(game|cash|cowoncy|balance|mine|mines|cf|coinflip|daily|hunt|help|give|zoo|inv|sell|slots|blackjack|bj|highlow|shop|buy|battle|open|top|team)(?:\s+(.+))?$/i);
  if (!match) return null;
  const aliases: Record<string, PrefixAction> = {
    cowoncy: 'cash', balance: 'cash', mines: 'mine', coinflip: 'cf',
    inv: 'zoo', bj: 'blackjack',
  };
  const raw = match[1]!.toLowerCase();
  return {
    action: aliases[raw] ?? raw as PrefixAction,
    args: match[2]?.trim().split(/\s+/).filter(Boolean) ?? [],
  };
}

function gameEmbed(title: string, description: string) {
  return new EmbedBuilder()
    .setColor(0xc49a55)
    .setTitle(title)
    .setDescription(description.slice(0, 4000))
    .setFooter({ text: 'Craftland India • Adventure Game' })
    .setTimestamp();
}

function minesComponents(ownerId: string, game: MinesGame, ended = false, hitTile?: number) {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let row = 0; row < 3; row++) {
    const buttons = Array.from({ length: 3 }, (_, col) => {
      const tile = row * 3 + col;
      const safe = game.safeTiles.includes(tile);
      const hit = tile === hitTile;
      return new ButtonBuilder()
        .setCustomId(`game:mines:tile:${ownerId}:${game.id}:${tile}`)
        .setLabel(safe ? '💎' : hit ? '💣' : ended && game.mineTiles.includes(tile) ? '💣' : '❔')
        .setStyle(safe ? ButtonStyle.Success : hit ? ButtonStyle.Danger : ButtonStyle.Secondary)
        .setDisabled(ended || safe || game.safeTiles.length >= 9 - game.mineCount);
    });
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons));
  }
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`game:mines:cashout:${ownerId}:${game.id}`)
        .setLabel(`Cash out ${coin(Math.floor(game.bet * game.multiplier))}`)
        .setStyle(ButtonStyle.Success)
        .setDisabled(ended || game.safeTiles.length === 0),
    ),
  );
  return rows;
}

function minesText(game: MinesGame, ended = false) {
  if (ended)
    return `Bet: **${coin(game.bet)}** • Mines: **${game.mineCount}**\nSafe tiles: **${game.safeTiles.length}** • Final multiplier: **${game.multiplier.toFixed(2)}×**`;
  const next =
    game.safeTiles.length >= 9 - game.mineCount
      ? null
      : minesMultiplier(game.safeTiles.length + 1, game.mineCount);
  return `Bet: **${coin(game.bet)}** • Mines: **${game.mineCount}**\nCash out now: **${coin(Math.floor(game.bet * game.multiplier))} (${game.multiplier.toFixed(2)}×)**\n${next === null ? 'All safe tiles are open; cash out now.' : `Next safe tile: **${coin(Math.floor(game.bet * next))} (${next.toFixed(2)}×)**`}`;
}

const cardLabel = (value: number) => value === 1 ? 'A' : value === 11 ? 'J' : value === 12 ? 'Q' : value === 13 ? 'K' : String(value);

function highLowButtons(ownerId: string, gameId: string, bet: number, firstCard: number) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...(['high', 'low', 'same'] as const).map((guess) => new ButtonBuilder()
      .setCustomId(`game:highlow:${guess}:${ownerId}:${gameId}:${bet}:${firstCard}`)
      .setLabel(guess === 'high' ? 'Higher ×2' : guess === 'low' ? 'Lower ×2' : 'Same ×6')
      .setStyle(ButtonStyle.Primary)),
  )];
}

function blackjackView(game: BlackjackGame, ended = false, result?: { outcome?: string; payout?: number }) {
  const dealer = ended ? game.dealerCards.join(' · ') : `${game.dealerCards[0]} · 🂠`;
  const dealerTotal = ended ? game.dealerCards.reduce((sum, card) => sum + card, 0) : '?';
  const playerTotal = game.playerCards.reduce((sum, card) => sum + card, 0);
  return `Bet: **${coin(game.bet)}**\n\n**Dealer [${dealerTotal}]**\n${dealer}\n\n**You [${playerTotal}]**\n${game.playerCards.join(' · ')}\n\n${ended ? `**${result?.outcome?.toUpperCase() ?? 'DONE'}** • Payout: **${coin(result?.payout ?? 0)}**` : 'Choose **Hit** for another card or **Stand** to reveal the dealer.'}`;
}

function blackjackButtons(ownerId: string, game: BlackjackGame) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`game:blackjack:hit:${ownerId}:${game.id}:${game.playerCards.length}`)
      .setLabel('👊 Hit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`game:blackjack:stand:${ownerId}:${game.id}:${game.playerCards.length}`)
      .setLabel('🛑 Stand').setStyle(ButtonStyle.Danger),
  )];
}

function parseBet(raw: string | undefined, defaultBet = 10) {
  if (raw === undefined) return defaultBet;
  if (!/^\d+$/.test(raw))
    throw new UserError('Bet must be a whole number. Example: `g mine 10`.');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > 100_000)
    throw new UserError('Bet must be from 1 to 100,000 coins.');
  return value;
}

type GameReplyPayload = Parameters<Message['reply']>[0];

async function sendGameReply(
  message: Message,
  response: Message | undefined,
  payload: GameReplyPayload,
) {
  if (response)
    return response.edit(payload as Parameters<Message['edit']>[0]);
  return message.reply(payload);
}

async function animatedGame<T extends { replayed: boolean }>(
  message: Message,
  response: Message | undefined,
  opening: string,
  play: () => Promise<T>,
  finish: (result: T) => string,
  sourceKey: string,
  activity: string,
) {
  const sent = await sendGameReply(message, response, {
    content: opening,
    allowedMentions: { parse: [] },
  });
  try {
    const result = await play();
    if (result.replayed) {
      await sent.edit({ content: 'This game action was already saved.' });
      return;
    }
    void awardGameXP(message.client, message.guildId!, message.author.id, sourceKey, activity)
      .catch((error) => logError('game-xp', error));
    await sent.edit({ content: finish(result), allowedMentions: { parse: [] } });
  } catch (error) {
    if (!(error instanceof UserError)) logError('animated-game', error);
    await sent.edit({
      content: error instanceof UserError ? error.message : 'Game failed. Please try again.',
      allowedMentions: { parse: [] },
    });
  }
}

export async function handleGamePrefix(
  message: Message,
  command: ParsedGameCommand,
  response?: Message,
) {
  const guildId = message.guildId!;
  const config = await settings(guildId);
  const allowedChannels = [config.channels.games, config.channels.generalChat].filter(Boolean);
  if (!allowedChannels.includes(message.channelId))
    throw new UserError(
      config.channels.games
        ? `Game commands work in <#${config.channels.games}> and general chat.`
        : 'Ask an administrator to configure the games channel with /setup.',
    );
  if (!prefixLimit.allow(`${guildId}:${message.author.id}`))
    throw new UserError('Game command limit reached. Try again in a minute.');

  const userId = message.author.id;
  const sourceKey = `prefix-game:${message.id}`;
  if (command.action === 'game' || command.action === 'help') {
    await sendGameReply(message, response, {
      embeds: [gameEmbed('🎮 Craftland Games',
        '**🏆 Rankings**\n`g top`\n\n' +
        '**🪙 Economy**\n`g cash` `g give @user 50` `g daily` `g shop` `g buy hunt_ticket`\n\n' +
        '**🐾 Animals**\n`g zoo` `g zoo Fox` `g hunt` `g sell Fox` `g team` `g team add Fox 1` `g battle` `g open`\n\n' +
        '**🎰 Quick games**\n`g slots 10` `g cf 10 heads` `g blackjack 10` `g highlow 10 high` `g mine 10`\n\n' +
        'Use `/game` for slash commands. `owo` commands belong to the OwO bot.')],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (command.action === 'cash') {
    const account = await getGameProfile(guildId, userId);
    await sendGameReply(message, response, {
      content: `🪙 **| ${escapeMarkdown(message.author.username)}**, you currently have **__${account.coins.toLocaleString()}__ Craft Coins!**`,
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (command.action === 'zoo') {
    const account = await getGameProfile(guildId, userId);
    const description = command.args[0]
      ? animalText(account, command.args[0]) ?? 'Unknown companion.'
      : zooText(account);
    await sendGameReply(message, response, {
      embeds: [gameEmbed(command.args[0] ? '🐾 Companion info' : '🐾 Your zoo', description)],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (command.action === 'team') {
    if (command.args[0] === 'add' || command.args[0] === 'remove') {
      const add = command.args[0] === 'add';
      const slot = Number(command.args[add ? 2 : 1]);
      const result = await setTeamSlot(guildId, userId, sourceKey, slot, add ? command.args[1] ?? '' : null);
      if (result.replayed) return;
      await sendGameReply(message, response, {
        embeds: [gameEmbed('⚔️ Your team', result.animal
          ? `Slot **${slot}** now has **${result.animal}**.` : `Slot **${slot}** cleared.`)],
        allowedMentions: { parse: [] },
      });
      return;
    }
    const account = await getGameProfile(guildId, userId);
    const team = activeTeam(account);
    await sendGameReply(message, response, {
      embeds: [gameEmbed('⚔️ Your team', team.length
        ? team.map((name, index) => `**${index + 1}.** ${name}`).join('\n')
        : 'No companions yet. Try `g hunt`.')],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (command.action === 'top') {
    const rows = await gameLeaderboard(guildId, 10);
    await sendGameReply(message, response, {
      embeds: [gameEmbed('🏆 Craftland Coin Rankings', rows.length
        ? rows.map((row, index) => `${index + 1}. <@${row.userId}> — ${coin(row.coins)}`).join('\n')
        : 'No coins earned yet.')],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (command.action === 'shop') {
    await sendGameReply(message, response, {
      embeds: [gameEmbed('🛒 Craftland Shop', Object.entries(gameShop)
        .map(([key, item]) => `\`${key}\` • **${coin(item.price)}** — ${item.description}`)
        .join('\n'))],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (command.action === 'buy') {
    const item = command.args[0] as ShopItem;
    const result = await buyItem(guildId, userId, sourceKey, item);
    if (result.replayed) return;
    await sendGameReply(message, response, {
      embeds: [gameEmbed('🛒 Purchase complete', `Bought **${gameShop[item].name}**. Balance: **${coin(result.remainingCoins!)}**.`)],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (command.action === 'battle' || command.action === 'open') {
    const result = command.action === 'battle'
      ? await battle(guildId, userId, sourceKey)
      : await openCrate(guildId, userId, sourceKey);
    if (result.replayed) return;
    if (command.action === 'battle')
      void awardGameXP(message.client, guildId, userId, sourceKey, 'Craftland battle game activity')
        .catch((error) => logError('game-xp', error));
    await sendGameReply(message, response, {
      embeds: [gameEmbed(command.action === 'battle' ? '⚔️ Arena battle' : '📦 Map Crate',
        command.action === 'battle'
          ? battleText(result)
          : `Found **${result.animal}**${result.duplicate ? ' again. Duplicate converted to 30 coins.' : '!'} `)],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (command.action === 'give') {
    const recipientId = command.args[0]?.match(/^<@!?(\d{17,20})>$/)?.[1];
    const recipient = recipientId ? await message.guild!.members.fetch(recipientId).catch(() => null) : null;
    if (!recipient || recipient.user.bot) throw new UserError('Use `g give @member 50` with a human member.');
    const amount = Number(command.args[1]);
    const result = await giveCoins(guildId, userId, recipientId!, sourceKey, amount);
    if (result.replayed) return;
    await sendGameReply(message, response, {
      embeds: [gameEmbed('🪙 Coin gift', `Sent **${coin(amount)}** to <@${recipientId}>. Balance: **${coin(result.remainingCoins!)}**.`)],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (command.action === 'sell') {
    if (!command.args[0]) throw new UserError('Choose an animal to sell. Example: `g sell Fox`.');
    const result = await sellCompanion(guildId, userId, sourceKey, command.args[0] ?? '');
    if (result.replayed) return;
    await sendGameReply(message, response, {
      content: `🐾 **${escapeMarkdown(message.author.username)}** sold **${result.animal}** for 🪙 **${result.reward!.toLocaleString()}** Craft Coins!`,
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (command.action === 'slots') {
    const bet = parseBet(command.args[0]);
    await animatedGame(
      message, response,
      `🎰 **SLOTS** • ${escapeMarkdown(message.author.username)} bet 🪙 **${bet.toLocaleString()}**\n┃ ❔ │ ❔ │ ❔ ┃\nSpinning...`,
      () => slots(guildId, userId, sourceKey, bet),
      (result) => `🎰 **SLOTS** • ${escapeMarkdown(message.author.username)} bet 🪙 **${bet.toLocaleString()}**\n┃ ${result.symbols!.join(' │ ')} ┃\n${result.payout! > 0 ? `Won 🪙 **${result.payout!.toLocaleString()}**!` : 'No match this time.'}`,
      sourceKey, 'Craftland slots game activity',
    );
    return;
  }
  if (['blackjack', 'highlow'].includes(command.action)) {
    const bet = parseBet(command.args[0]);
    const guess = command.args[1]?.toLowerCase();
    if (command.action === 'highlow' && !guess) {
      const profile = await getGameProfile(guildId, userId);
      if (profile.coins < bet) throw new UserError('Not enough Craft Coins.');
      const firstCard = randomInt(1, 14);
      await sendGameReply(message, response, {
        embeds: [gameEmbed('🃏 High / Low',
          `**${escapeMarkdown(message.author.username)}** • Bet: **${coin(bet)}**\n\n**${cardLabel(firstCard)}** 🂠 → 🂠\nWill the next card be higher, lower, or the same?`) ],
        components: highLowButtons(userId, message.id, bet, firstCard),
        allowedMentions: { parse: [] },
      });
      return;
    }
    if (command.action === 'highlow' && guess !== 'high' && guess !== 'low')
      throw new UserError('Use `g highlow 10 high` or `g highlow 10 low`.');
    if (command.action === 'blackjack') {
      const sent = await sendGameReply(message, response, {
        content: `🃏 **Blackjack** • ${escapeMarkdown(message.author.username)} bets 🪙 **${bet.toLocaleString()}**\nDealing cards... 🂠 🂠`,
        allowedMentions: { parse: [] },
      });
      try {
        const active = (await getGameProfile(guildId, userId)).activeBlackjack as BlackjackGame | null;
        const game = active ?? (await startBlackjack(guildId, userId, sourceKey, bet)).blackjackGame!;
        await sent.edit({
          content: '',
          embeds: [gameEmbed('🃏 Blackjack', blackjackView(game))],
          components: blackjackButtons(userId, game),
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        if (!(error instanceof UserError)) logError('blackjack-start', error);
        await sent.edit({
          content: error instanceof UserError ? error.message : 'Blackjack failed. Please try again.',
          allowedMentions: { parse: [] },
        });
      }
    } else {
      await animatedGame(
        message, response,
        `🃏 **HIGH / LOW** • Bet: 🪙 **${bet.toLocaleString()}**\nYour guess: **${guess}**\n🂠 → 🂠  Revealing cards...`,
        () => highLow(guildId, userId, sourceKey, bet, guess as 'high' | 'low'),
        (result) => `🃏 **HIGH / LOW** • Bet: 🪙 **${bet.toLocaleString()}**\n${result.firstCard} → ${result.secondCard} • **${result.outcome}**\nPayout: **${coin(result.payout!)}**`,
        sourceKey, 'Craftland highlow game activity',
      );
    }
    return;
  }
  if (command.action === 'daily') {
    const result = await claimDaily(guildId, userId, sourceKey);
    if (result.replayed) return;
    void awardGameXP(message.client, guildId, userId, sourceKey, 'Craftland daily game activity')
      .catch((error) => logError('game-xp', error));
    await sendGameReply(message, response, {
      embeds: [gameEmbed('☀️ Daily coins', `You received **${coin(result.reward ?? 0)}**. Streak: **${result.streak ?? 1}** day(s).`)],
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (command.action === 'hunt') {
    const result = await hunt(guildId, userId, sourceKey);
    if (result.replayed) return;
    void awardGameXP(message.client, guildId, userId, sourceKey, 'Craftland hunt game activity')
      .catch((error) => logError('game-xp', error));
    await sendGameReply(message, response, {
      content: `🌿 **${escapeMarkdown(message.author.username)}** went hunting! ${result.animal ? `Caught **${result.animal}** ${result.duplicate ? 'again' : ''}!` : 'The trail was quiet this time.'}\n🪙 Earned **${(result.coins ?? 0).toLocaleString()}** Craft Coins.${result.usedTicket ? ' 🎟️ Hunt Ticket used.' : ''}${result.usedCharm ? ' ✨ Lucky Charm used.' : ''}`,
      allowedMentions: { parse: [] },
    });
    return;
  }
  if (command.action === 'mine') {
    const account = await getGameProfile(guildId, userId);
    const active = account.activeMines as MinesGame | null;
    if (command.args[0]?.toLowerCase() === 'cashout') {
      if (!active) throw new UserError('You have no active Mines game. Try `g mine 10`.');
      const result = await cashoutMines(guildId, userId, active.id, sourceKey);
      if (result.replayed) return;
      await sendGameReply(message, response, {
        embeds: [gameEmbed('💰 Mines • Cashed out', `${minesText(result.minesGame!, true)}\nYou received **${coin(result.payout ?? 0)}**.`)],
        allowedMentions: { parse: [] },
      });
      return;
    }
    if (active) {
      await sendGameReply(message, response, {
        embeds: [gameEmbed('💣 Mines • Resume your board', `Your active bet is safe. Continue or cash out.\n${minesText(active)}`)],
        components: minesComponents(userId, active),
        allowedMentions: { parse: [] },
      });
      return;
    }
  }
  const bet = parseBet(command.args[0]);
  if (command.action === 'cf') {
    const guess = command.args[1]?.toLowerCase();
    if (guess && guess !== 'heads' && guess !== 'tails')
      throw new UserError('Coin flip choice must be `heads` or `tails`.');
    const sent = await sendGameReply(message, response, {
      content: `🪙 **${escapeMarkdown(message.author.username)}** bet **${bet.toLocaleString()}** Craft Coins\nFlipping the coin...`,
      files: [new AttachmentBuilder(coinFlipGif, { name: 'coin-flip.gif' })],
      allowedMentions: { parse: [] },
    });
    const visibleAt = Date.now();
    try {
      const result = await coinFlip(guildId, userId, sourceKey, bet, guess as 'heads' | 'tails' | undefined);
      if (result.replayed) {
        await sent.edit({ content: 'This coin flip was already saved.', attachments: [] });
        return;
      }
      void awardGameXP(message.client, guildId, userId, sourceKey, 'Craftland coin flip game activity')
        .catch((error) => logError('game-xp', error));
      await pause(Math.max(0, 850 - (Date.now() - visibleAt)));
      await sent.edit({
        content: `🪙 **${escapeMarkdown(message.author.username)}** bet **${bet.toLocaleString()}** and chose **${result.picked}**\nThe coin landed **${result.landed}**! ${result.won ? `🎉 Won **${result.payout.toLocaleString()}** Craft Coins.` : `Lost **${bet.toLocaleString()}** Craft Coins.`}`,
        attachments: [],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      if (!(error instanceof UserError)) logError('coin-flip', error);
      await sent.edit({
        content: error instanceof UserError ? error.message : 'Coin flip failed. Please try again.',
        attachments: [],
        allowedMentions: { parse: [] },
      });
    }
    return;
  }
  const mineCount = command.args[1] === undefined ? 3 : Number(command.args[1]);
  const result = await startMines(guildId, userId, sourceKey, bet, mineCount);
  if (result.replayed) return;
  void awardGameXP(message.client, guildId, userId, sourceKey, 'Craftland Mines game activity')
    .catch((error) => logError('game-xp', error));
  const game = result.minesGame!;
  await sendGameReply(message, response, {
    embeds: [gameEmbed('💣 Mines', `Choose a tile and cash out before you hit a mine.\n${minesText(game)}`)],
    components: minesComponents(userId, game),
    allowedMentions: { parse: [] },
  });
}

export async function handleHighLowButton(i: ButtonInteraction) {
  const [, , guess, ownerId, gameId, rawBet, rawCard] = i.customId.split(':');
  if (ownerId !== i.user.id) throw new UserError('This game belongs to another member.');
  if (guess !== 'high' && guess !== 'low' && guess !== 'same')
    throw new UserError('That choice is invalid.');
  const bet = Number(rawBet);
  const firstCard = Number(rawCard);
  const result = await highLow(i.guildId!, i.user.id, `highlow:${gameId}`, bet, guess, firstCard);
  if (result.replayed) throw new UserError('This High / Low game has already ended.');
  void awardGameXP(i.client, i.guildId!, i.user.id, `highlow:${gameId}`, 'Craftland highlow game activity')
    .catch((error) => logError('game-xp', error));
  await i.editReply({
    embeds: [gameEmbed('🃏 High / Low',
      `**${cardLabel(firstCard)}** → **${cardLabel(result.secondCard!)}**\nYou chose **${guess}** • Result: **${result.outcome}**\n${result.payout! > 0 ? `Payout: **${coin(result.payout!)}**` : `Lost **${coin(bet)}**`}`)],
    components: [],
    allowedMentions: { parse: [] },
  });
}

export async function handleBlackjackButton(i: ButtonInteraction) {
  const [, , action, ownerId, gameId, rawCards] = i.customId.split(':');
  if (ownerId !== i.user.id) throw new UserError('This Blackjack game belongs to another member.');
  if (action !== 'hit' && action !== 'stand') throw new UserError('That Blackjack move is invalid.');
  const expectedCards = Number(rawCards);
  if (!Number.isInteger(expectedCards) || expectedCards < 2 || expectedCards > 21)
    throw new UserError('That Blackjack hand is invalid.');
  const result = await playBlackjack(
    i.guildId!, i.user.id,
    `blackjack:${gameId}:${expectedCards}:${action}`,
    gameId!, action, expectedCards,
  );
  if (result.replayed) throw new UserError('That Blackjack move was already played.');
  const game = result.blackjackGame!;
  const ended = result.outcome !== 'playing';
  if (ended) void awardGameXP(i.client, i.guildId!, i.user.id, `blackjack:${gameId}`, 'Craftland blackjack game activity')
    .catch((error) => logError('game-xp', error));
  await i.editReply({
    embeds: [gameEmbed('🃏 Blackjack', blackjackView(game, ended, result))],
    components: ended ? [] : blackjackButtons(i.user.id, game),
    allowedMentions: { parse: [] },
  });
}

export async function handleMinesButton(i: ButtonInteraction) {
  const [, , action, ownerId, gameId, rawTile] = i.customId.split(':');
  if (ownerId !== i.user.id)
    throw new UserError('This mines board belongs to another member.');
  const guildId = i.guildId!;
  if (action === 'cashout') {
    const result = await cashoutMines(guildId, i.user.id, gameId!, `mines-cashout:${gameId}`);
    if (result.replayed) {
      await i.followUp({
        content: 'This cashout was already processed.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await i.editReply({
      embeds: [gameEmbed('💰 Mines • Cashed out', `${minesText(result.minesGame!, true)}\nYou received **${coin(result.payout ?? 0)}**.`)],
      components: minesComponents(i.user.id, result.minesGame!, true),
      allowedMentions: { parse: [] },
    });
    return;
  }
  const tile = Number(rawTile);
  const result = await revealMineTile(guildId, i.user.id, gameId!, tile);
  const game = result.minesGame!;
  if (result.hitMine) {
    await i.editReply({
      embeds: [gameEmbed('💥 Mine hit!', `${minesText(game, true)}\nThe **${coin(game.bet)}** bet is gone. Better luck next round!`)],
      components: minesComponents(i.user.id, game, true, tile),
      allowedMentions: { parse: [] },
    });
    return;
  }
  await i.editReply({
    embeds: [gameEmbed('💣 Mines', `Safe tile! Keep going or cash out.\n${minesText(game)}`)],
    components: minesComponents(i.user.id, game),
    allowedMentions: { parse: [] },
  });
}
