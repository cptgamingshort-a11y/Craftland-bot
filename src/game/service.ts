import { randomInt, randomUUID } from 'node:crypto';
import { db } from '../database/client.js';
import { UserError } from '../utils/errors.js';

export const GAME_COOLDOWNS = {
  daily: 20 * 60 * 60 * 1000,
  hunt: 10 * 60 * 1000,
  battle: 45 * 60 * 1000,
} as const;

export const gameShop = {
  hunt_ticket: {
    name: 'Hunt Ticket',
    price: 80,
    description: 'Skip one hunt cooldown.',
  },
  lucky_charm: {
    name: 'Lucky Charm',
    price: 180,
    description: 'Boost your next hunt catch chance.',
  },
  map_crate: {
    name: 'Map Crate',
    price: 260,
    description: 'Open it to find a collectible companion.',
  },
  builder_badge: {
    name: 'Builder Badge',
    price: 500,
    description: 'A cosmetic profile badge.',
  },
} as const;
export type ShopItem = keyof typeof gameShop;
const companions = ['Fox', 'Wolf', 'Panda', 'Tiger', 'Phoenix', 'Dragon'];
export const companionCatalog: Record<string, { icon: string; rank: string; sell: number; description: string }> = {
  Fox: { icon: '🦊', rank: 'Common', sell: 50, description: 'A quick forest companion.' },
  Wolf: { icon: '🐺', rank: 'Common', sell: 60, description: 'A loyal pack hunter.' },
  Panda: { icon: '🐼', rank: 'Uncommon', sell: 75, description: 'A calm and sturdy friend.' },
  Tiger: { icon: '🐯', rank: 'Rare', sell: 90, description: 'A fierce arena challenger.' },
  Phoenix: { icon: '🔥', rank: 'Epic', sell: 120, description: 'A companion born from flame.' },
  Dragon: { icon: '🐉', rank: 'Legendary', sell: 150, description: 'A mighty sky guardian.' },
};
export function companionCounts(account: { pets?: unknown; petCounts?: unknown }) {
  const stored = account.petCounts && typeof account.petCounts === 'object' && !Array.isArray(account.petCounts)
    ? account.petCounts as Record<string, number> : {};
  const counts = { ...stored };
  for (const pet of Array.isArray(account.pets) ? account.pets as string[] : [])
    counts[pet] = Math.max(1, counts[pet] ?? 0);
  return counts;
}
export function activeTeam(account: { pets?: unknown; team?: unknown }) {
  const pets = Array.isArray(account.pets) ? account.pets as string[] : [];
  const saved = Array.isArray(account.team) ? account.team as string[] : [];
  return (saved.length ? saved : pets.slice(0, 3)).filter((pet) => pets.includes(pet)).slice(0, 3);
}
export type GameAccount = Awaited<ReturnType<typeof getGameProfile>>;
export type GameActionResult = {
  replayed: boolean;
  reward?: number;
  streak?: number;
  coins?: number;
  animal?: string | null;
  duplicate?: boolean;
  usedTicket?: boolean;
  usedCharm?: boolean;
  won?: boolean;
  item?: ShopItem;
  remainingCoins?: number;
  minesGame?: MinesGame;
  blackjackGame?: BlackjackGame;
  hitMine?: boolean;
  multiplier?: number;
  payout?: number;
  tile?: number;
  symbols?: string[];
  playerTotal?: number;
  dealerTotal?: number;
  outcome?: string;
  firstCard?: number;
  secondCard?: number;
  guess?: string;
  team?: string[];
  enemyTeam?: string[];
  turns?: number;
};
export type MinesGame = {
  id: string;
  bet: number;
  mineCount: number;
  mineTiles: number[];
  safeTiles: number[];
  multiplier: number;
  status: 'active';
  startedAt: string;
};

export type BlackjackGame = {
  id: string;
  bet: number;
  playerCards: number[];
  dealerCards: number[];
};

export function minesMultiplier(safePicks: number, mineCount: number) {
  if (safePicks <= 0) return 1;
  if (safePicks > 9 - mineCount) return 0;
  let survival = 1;
  for (let i = 0; i < safePicks; i++)
    survival *= (9 - mineCount - i) / (9 - i);
  return Math.round((0.93 / survival) * 100) / 100;
}

function remaining(last: Date | null | undefined, duration: number, now: Date) {
  return last ? Math.max(0, last.getTime() + duration - now.getTime()) : 0;
}
export function cooldownText(ms: number) {
  const minutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${rest}m` : `${minutes}m`;
}
export function getDailyReward(streak: number) {
  return 100 + Math.min(Math.max(streak - 1, 0), 5) * 10;
}
export function getBattleWinChance(companionCount: number) {
  return Math.min(0.75, 0.45 + Math.min(companionCount, 5) * 0.04);
}

type StoredProfile = Awaited<ReturnType<typeof db.gameAccount.upsert>>;
const profileCache = new Map<string, StoredProfile>();
const profileKey = (guildId: string, userId: string) => `${guildId}:${userId}`;

export async function primeGameProfiles(guildId: string) {
  const accounts = await db.gameAccount.findMany({ where: { guildId }, take: 500 });
  for (const account of accounts)
    profileCache.set(profileKey(guildId, account.userId), account);
  return accounts.length;
}

export async function getGameProfile(guildId: string, userId: string) {
  const key = profileKey(guildId, userId);
  const cached = profileCache.get(key);
  if (cached) return cached;
  const account = await db.gameAccount.upsert({
    where: { guildId_userId: { guildId, userId } },
    create: { guildId, userId },
    update: {},
  });
  profileCache.set(key, account);
  return account;
}

async function transact(
  guildId: string,
  userId: string,
  sourceKey: string,
  action: (
    account: NonNullable<Awaited<ReturnType<typeof getGameProfile>>>,
    now: Date,
  ) => Promise<{
    accountPatch: Record<string, unknown>;
    amount: number;
    type: string;
    reason: string;
    metadata?: Record<string, unknown>;
    result: Record<string, unknown>;
  }>,
  now = new Date(),
): Promise<GameActionResult> {
  // Persist the deterministic account document before the Firestore transaction
  // so its first write can be read within the transaction.
  await getGameProfile(guildId, userId);
  let updatedProfile: StoredProfile | undefined;
  const result = await db.$transaction(async (tx) => {
    const previous = await tx.gameTransaction.findUnique({
      where: { guildId_sourceKey: { guildId, sourceKey } },
    });
    if (previous) return { replayed: true };
    const account = await tx.gameAccount.findUniqueOrThrow({
      where: { guildId_userId: { guildId, userId } },
    });
    const outcome = await action(account, now);
    if (account.coins + outcome.amount < 0)
      throw new UserError('You do not have enough Craft Coins for that.');
    await tx.gameAccount.update({
      where: { guildId_userId: { guildId, userId } },
      data: { ...outcome.accountPatch, coins: account.coins + outcome.amount },
    });
    await tx.gameTransaction.create({
      data: {
        guildId,
        userId,
        sourceKey,
        type: outcome.type,
        amount: outcome.amount,
        reason: outcome.reason,
        metadata: outcome.metadata ?? {},
        createdAt: now,
      },
    });
    updatedProfile = { ...account, ...outcome.accountPatch, coins: account.coins + outcome.amount };
    return { replayed: false, ...outcome.result } as GameActionResult;
  });
  if (updatedProfile) profileCache.set(profileKey(guildId, userId), updatedProfile);
  return result;
}

function validateBet(bet: number) {
  if (!Number.isSafeInteger(bet) || bet < 1 || bet > 100_000)
    throw new UserError('Bet must be a whole number from 1 to 100,000 coins.');
}

export function startMines(
  guildId: string,
  userId: string,
  sourceKey: string,
  bet: number,
  mineCount = 3,
  now = new Date(),
) {
  validateBet(bet);
  if (!Number.isInteger(mineCount) || mineCount < 1 || mineCount > 8)
    throw new UserError('Mines must be between 1 and 8.');
  const tiles = Array.from({ length: 9 }, (_, i) => i);
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [tiles[i], tiles[j]] = [tiles[j]!, tiles[i]!];
  }
  const game: MinesGame = {
    id: randomUUID(),
    bet,
    mineCount,
    mineTiles: tiles.slice(0, mineCount).sort((a, b) => a - b),
    safeTiles: [],
    multiplier: 1,
    status: 'active',
    startedAt: now.toISOString(),
  };
  return transact(
    guildId,
    userId,
    sourceKey,
    async (account) => {
      if (account.activeMines)
        throw new UserError('Finish your active mines game first.');
      return {
        accountPatch: { activeMines: game },
        amount: -bet,
        type: 'mines_start',
        reason: `Mines • bet ${bet}`,
        metadata: { gameId: game.id, mineCount },
        result: { minesGame: game },
      };
    },
    now,
  );
}

export async function revealMineTile(
  guildId: string,
  userId: string,
  gameId: string,
  tile: number,
) {
  if (!Number.isInteger(tile) || tile < 0 || tile > 8)
    throw new UserError('That mines tile is invalid.');
  let updatedProfile: StoredProfile | undefined;
  const result = await db.$transaction(async (tx) => {
    const account = await tx.gameAccount.findUniqueOrThrow({
      where: { guildId_userId: { guildId, userId } },
    });
    const game = account.activeMines as MinesGame | null;
    if (!game || game.id !== gameId)
      throw new UserError('This mines game has expired. Start another one.');
    if (game.safeTiles.includes(tile))
      throw new UserError('That tile is already open. Choose another one.');
    const hitMine = game.mineTiles.includes(tile);
    const nextSafe = hitMine ? game.safeTiles : [...game.safeTiles, tile];
    const multiplier = minesMultiplier(nextSafe.length, game.mineCount);
    const sourceKey = `mines:${game.id}:tile:${tile}`;
    const previous = await tx.gameTransaction.findUnique({
      where: { guildId_sourceKey: { guildId, sourceKey } },
    });
    if (previous) return { replayed: true, hitMine, minesGame: game };
    const activeMines = hitMine ? null : { ...game, safeTiles: nextSafe, multiplier };
    await tx.gameAccount.update({
      where: { guildId_userId: { guildId, userId } },
      data: { activeMines },
    });
    await tx.gameTransaction.create({
      data: {
        guildId,
        userId,
        sourceKey,
        type: hitMine ? 'mines_loss' : 'mines_reveal',
        amount: 0,
        reason: hitMine ? 'Mines • hit a mine' : `Mines • safe tile ${tile + 1}`,
        metadata: { gameId, tile, hitMine, safePicks: nextSafe.length, multiplier },
        createdAt: new Date(),
      },
    });
    updatedProfile = { ...account, activeMines };
    return {
      replayed: false,
      hitMine,
      minesGame: { ...game, safeTiles: nextSafe, multiplier },
      multiplier,
    };
  });
  if (updatedProfile) profileCache.set(profileKey(guildId, userId), updatedProfile);
  return result;
}

export async function cashoutMines(
  guildId: string,
  userId: string,
  gameId: string,
  sourceKey: string,
) {
  const result = await transact(guildId, userId, sourceKey, async (current) => {
    const active = current.activeMines as MinesGame | null;
    if (!active || active.id !== gameId)
      throw new UserError('This mines game has already ended.');
    const payout = Math.floor(active.bet * active.multiplier);
    return {
      accountPatch: { activeMines: null },
      amount: payout,
      type: 'mines_cashout',
      reason: `Mines • cash out at ${active.multiplier}x`,
      metadata: { gameId, multiplier: active.multiplier },
      result: { payout, multiplier: active.multiplier, minesGame: active },
    };
  });
  return result;
}

export function coinFlip(
  guildId: string,
  userId: string,
  sourceKey: string,
  bet: number,
  guess?: 'heads' | 'tails',
  now = new Date(),
) {
  validateBet(bet);
  const picked = guess ?? (randomInt(2) ? 'heads' : 'tails');
  const landed = randomInt(2) ? 'heads' : 'tails';
  const won = picked === landed;
  const payout = won ? bet * 2 : 0;
  return transact(
    guildId,
    userId,
    sourceKey,
    async (account) => {
      if (account.coins < bet)
        throw new UserError(`You need at least ${bet} coins to bet.`);
      return {
        accountPatch: {},
        amount: won ? bet : -bet,
        type: 'coin_flip',
        reason: `Coin flip • picked ${picked}, landed ${landed}`,
        metadata: { picked, landed, won, bet },
        result: { won, reward: payout },
      };
    },
    now,
  ).then((result) => ({ ...result, picked, landed, won, payout }));
}

export async function giveCoins(
  guildId: string,
  senderId: string,
  recipientId: string,
  sourceKey: string,
  amount: number,
) {
  validateBet(amount);
  if (senderId === recipientId) throw new UserError('Choose another member.');
  await Promise.all([
    getGameProfile(guildId, senderId),
    getGameProfile(guildId, recipientId),
  ]);
  let updatedSender: StoredProfile | undefined;
  let updatedRecipient: StoredProfile | undefined;
  const result = await db.$transaction(async (tx) => {
    const previous = await tx.gameTransaction.findUnique({
      where: { guildId_sourceKey: { guildId, sourceKey } },
    });
    if (previous) return { replayed: true };
    const sender = await tx.gameAccount.findUniqueOrThrow({
      where: { guildId_userId: { guildId, userId: senderId } },
    });
    const recipient = await tx.gameAccount.findUniqueOrThrow({
      where: { guildId_userId: { guildId, userId: recipientId } },
    });
    if (sender.coins < amount) throw new UserError('Not enough Craft Coins.');
    await tx.gameAccount.update({
      where: { guildId_userId: { guildId, userId: senderId } },
      data: { coins: sender.coins - amount },
    });
    await tx.gameAccount.update({
      where: { guildId_userId: { guildId, userId: recipientId } },
      data: { coins: recipient.coins + amount },
    });
    await tx.gameTransaction.create({
      data: {
        guildId, userId: senderId, sourceKey, type: 'gift_sent', amount: -amount,
        reason: `Gift to ${recipientId}`, metadata: { recipientId },
      },
    });
    await tx.gameTransaction.create({
      data: {
        guildId, userId: recipientId, sourceKey: `${sourceKey}:received`,
        type: 'gift_received', amount, reason: `Gift from ${senderId}`,
        metadata: { senderId },
      },
    });
    updatedSender = { ...sender, coins: sender.coins - amount };
    updatedRecipient = { ...recipient, coins: recipient.coins + amount };
    return { replayed: false, remainingCoins: sender.coins - amount };
  });
  if (updatedSender) profileCache.set(profileKey(guildId, senderId), updatedSender);
  if (updatedRecipient) profileCache.set(profileKey(guildId, recipientId), updatedRecipient);
  return result;
}

export function sellCompanion(
  guildId: string,
  userId: string,
  sourceKey: string,
  animal: string,
) {
  const chosen = companions.find((name) => name.toLowerCase() === animal.toLowerCase());
  if (!chosen) throw new UserError('Choose a companion from your zoo.');
  return transact(guildId, userId, sourceKey, async (account) => {
    const pets = [...(account.pets as string[])];
    const index = pets.indexOf(chosen);
    if (index < 0) throw new UserError(`You do not own ${chosen}.`);
    const petCounts = companionCounts(account);
    petCounts[chosen]!--;
    if (petCounts[chosen] === 0) pets.splice(index, 1);
    const team = activeTeam(account).filter((pet) => pets.includes(pet));
    const reward = companionCatalog[chosen]!.sell;
    return {
      accountPatch: { pets, petCounts, team }, amount: reward, type: 'companion_sale',
      reason: `Sold ${chosen}`, metadata: { animal: chosen },
      result: { animal: chosen, reward },
    };
  });
}

export function setTeamSlot(
  guildId: string, userId: string, sourceKey: string, slot: number, animal: string | null,
) {
  if (!Number.isInteger(slot) || slot < 1 || slot > 3)
    throw new UserError('Team slot must be 1, 2, or 3.');
  return transact(guildId, userId, sourceKey, async (account) => {
    const pets = account.pets as string[];
    const chosen = animal ? companions.find((name) => name.toLowerCase() === animal.toLowerCase()) : null;
    if (animal && (!chosen || !pets.includes(chosen)))
      throw new UserError('Choose a companion from your zoo.');
    const team = [...activeTeam(account)];
    if (chosen && team.some((pet, index) => pet === chosen && index !== slot - 1))
      throw new UserError('That companion is already in another team slot.');
    if (chosen) team[slot - 1] = chosen;
    else team.splice(slot - 1, 1);
    return {
      accountPatch: { team }, amount: 0, type: 'team_update',
      reason: chosen ? `Team slot ${slot} • ${chosen}` : `Team slot ${slot} cleared`,
      metadata: { slot, animal: chosen }, result: { animal: chosen, tile: slot },
    };
  });
}

export function slots(guildId: string, userId: string, sourceKey: string, bet: number) {
  validateBet(bet);
  const icons = ['🍒', '🍋', '⭐', '💎'];
  const symbols = Array.from({ length: 3 }, () => icons[randomInt(icons.length)]!);
  const multiplier = symbols.every((icon) => icon === symbols[0])
    ? 4
    : new Set(symbols).size === 2 ? 1 : 0;
  const payout = bet * multiplier;
  return transact(guildId, userId, sourceKey, async (account) => {
    if (account.coins < bet) throw new UserError('Not enough Craft Coins.');
    return {
      accountPatch: {}, amount: payout - bet, type: 'slots',
      reason: `Slots • ${symbols.join(' ')}`,
      metadata: { bet, symbols, payout },
      result: { symbols, payout, won: payout > bet },
    };
  });
}

export function highLow(
  guildId: string, userId: string, sourceKey: string, bet: number,
  guess: 'high' | 'low' | 'same',
  shownCard?: number,
) {
  validateBet(bet);
  if (shownCard !== undefined && (!Number.isInteger(shownCard) || shownCard < 1 || shownCard > 13))
    throw new UserError('That card is invalid. Start a new game.');
  const firstCard = shownCard ?? randomInt(1, 14);
  const secondCard = randomInt(1, 14);
  const outcome = secondCard > firstCard ? 'high' : secondCard < firstCard ? 'low' : 'same';
  const payout = outcome === 'same' && guess !== 'same' ? bet : outcome === guess ? bet * (guess === 'same' ? 6 : 2) : 0;
  return transact(guildId, userId, sourceKey, async (account) => {
    if (account.coins < bet) throw new UserError('Not enough Craft Coins.');
    return {
      accountPatch: {}, amount: payout - bet, type: 'highlow',
      reason: `High Low • ${firstCard} → ${secondCard}`,
      metadata: { bet, guess, firstCard, secondCard, payout },
      result: { firstCard, secondCard, guess, payout, outcome, won: payout > bet },
    };
  });
}

export function blackjack(guildId: string, userId: string, sourceKey: string, bet: number) {
  validateBet(bet);
  const card = () => randomInt(1, 11);
  let playerTotal = card() + card();
  let dealerTotal = card() + card();
  while (playerTotal < 17) playerTotal += card();
  while (dealerTotal < 17) dealerTotal += card();
  const outcome = playerTotal > 21 ? 'loss'
    : dealerTotal > 21 || playerTotal > dealerTotal ? 'win'
      : playerTotal === dealerTotal ? 'push' : 'loss';
  const payout = outcome === 'win' ? bet * 2 : outcome === 'push' ? bet : 0;
  return transact(guildId, userId, sourceKey, async (account) => {
    if (account.coins < bet) throw new UserError('Not enough Craft Coins.');
    return {
      accountPatch: {}, amount: payout - bet, type: 'blackjack',
      reason: `Quick Blackjack • ${outcome}`,
      metadata: { bet, playerTotal, dealerTotal, payout },
      result: { playerTotal, dealerTotal, payout, outcome, won: outcome === 'win' },
    };
  });
}

const blackjackCard = () => randomInt(1, 11);
const blackjackTotal = (cards: number[]) => cards.reduce((total, card) => total + card, 0);

export function startBlackjack(guildId: string, userId: string, sourceKey: string, bet: number) {
  validateBet(bet);
  return transact(guildId, userId, sourceKey, async (account) => {
    if (account.activeBlackjack) throw new UserError('Finish your current Blackjack game first.');
    if (account.coins < bet) throw new UserError('Not enough Craft Coins.');
    const blackjackGame: BlackjackGame = {
      id: randomUUID(), bet,
      playerCards: [blackjackCard(), blackjackCard()],
      dealerCards: [blackjackCard(), blackjackCard()],
    };
    return {
      accountPatch: { activeBlackjack: blackjackGame }, amount: -bet,
      type: 'blackjack_start', reason: `Blackjack • bet ${bet}`,
      metadata: { gameId: blackjackGame.id, bet }, result: { blackjackGame },
    };
  });
}

export function playBlackjack(
  guildId: string, userId: string, sourceKey: string,
  gameId: string, action: 'hit' | 'stand', expectedCards: number,
) {
  return transact(guildId, userId, sourceKey, async (account) => {
    const current = account.activeBlackjack as BlackjackGame | null;
    if (!current || current.id !== gameId)
      throw new UserError('This Blackjack game has ended. Start another one.');
    if (current.playerCards.length !== expectedCards)
      throw new UserError('This Blackjack hand has changed. Use its latest buttons.');
    const blackjackGame: BlackjackGame = {
      ...current,
      playerCards: action === 'hit' ? [...current.playerCards, blackjackCard()] : [...current.playerCards],
      dealerCards: [...current.dealerCards],
    };
    const playerTotal = blackjackTotal(blackjackGame.playerCards);
    if ((action === 'stand' || playerTotal === 21) && playerTotal <= 21)
      while (blackjackTotal(blackjackGame.dealerCards) < 17)
        blackjackGame.dealerCards.push(blackjackCard());
    const dealerTotal = blackjackTotal(blackjackGame.dealerCards);
    const ended = action === 'stand' || playerTotal >= 21;
    const outcome = !ended ? 'playing'
      : playerTotal > 21 ? 'loss'
        : dealerTotal > 21 || playerTotal > dealerTotal ? 'win'
          : playerTotal === dealerTotal ? 'push' : 'loss';
    const payout = !ended ? 0 : outcome === 'win' ? current.bet * 2 : outcome === 'push' ? current.bet : 0;
    return {
      accountPatch: { activeBlackjack: ended ? null : blackjackGame },
      amount: payout, type: ended ? 'blackjack_finish' : 'blackjack_hit',
      reason: `Blackjack • ${outcome}`,
      metadata: { gameId, action, outcome, payout },
      result: { blackjackGame, playerTotal, dealerTotal, outcome, payout, won: outcome === 'win' },
    };
  });
}

export async function claimDaily(
  guildId: string,
  userId: string,
  sourceKey: string,
  now = new Date(),
) {
  return transact(
    guildId,
    userId,
    sourceKey,
    async (account) => {
      const wait = remaining(account.lastDailyAt, GAME_COOLDOWNS.daily, now);
      if (wait)
        throw new UserError(`Daily reward is ready in ${cooldownText(wait)}.`);
      const streak =
        account.lastDailyAt &&
        now.getTime() - account.lastDailyAt.getTime() < 48 * 60 * 60 * 1000
          ? account.dailyStreak + 1
          : 1;
      const reward = getDailyReward(streak);
      return {
        accountPatch: { lastDailyAt: now, dailyStreak: streak },
        amount: reward,
        type: 'daily',
        reason: `Daily reward • streak ${streak}`,
        result: { reward, streak },
      };
    },
    now,
  );
}

export async function hunt(
  guildId: string,
  userId: string,
  sourceKey: string,
  now = new Date(),
  roll = randomInt(0, 10_000) / 10_000,
  coins = randomInt(20, 61),
  animal = companions[randomInt(0, companions.length)]!,
) {
  return transact(
    guildId,
    userId,
    sourceKey,
    async (account) => {
      const inventory = { ...(account.inventory as Record<string, number>) };
      const ticketCount = inventory.hunt_ticket ?? 0;
      const wait = remaining(account.lastHuntAt, GAME_COOLDOWNS.hunt, now);
      const usedTicket = wait > 0 && ticketCount > 0;
      if (wait && !usedTicket)
        throw new UserError(
          `Your next hunt is ready in ${cooldownText(wait)}.`,
        );
      if (usedTicket) inventory.hunt_ticket = ticketCount - 1;
      const charmCount = inventory.lucky_charm ?? 0;
      const usedCharm = charmCount > 0;
      if (usedCharm) inventory.lucky_charm = charmCount - 1;
      const pets = [...(account.pets as string[])];
      const petCounts = companionCounts(account);
      const caught = roll < (usedCharm ? 0.45 : 0.2);
      const duplicate = caught && pets.includes(animal);
      if (caught && !duplicate) pets.push(animal);
      if (caught) petCounts[animal] = (petCounts[animal] ?? 0) + 1;
      const bonus = duplicate ? 20 : 0;
      return {
        accountPatch: {
          lastHuntAt: now,
          inventory,
          pets,
          petCounts,
        },
        amount: coins + bonus,
        type: 'hunt',
        reason: caught
          ? duplicate
            ? `Hunt • duplicate ${animal}`
            : `Hunt • found ${animal}`
          : 'Hunt • trail coins',
        metadata: {
          caught: caught && !duplicate ? animal : null,
          usedTicket,
          usedCharm,
        },
        result: {
          coins: coins + bonus,
          animal: caught ? animal : null,
          duplicate,
          usedTicket,
          usedCharm,
        },
      };
    },
    now,
  );
}

export async function battle(
  guildId: string,
  userId: string,
  sourceKey: string,
  now = new Date(),
  roll = randomInt(0, 10_000) / 10_000,
  payout = randomInt(50, 101),
) {
  return transact(
    guildId,
    userId,
    sourceKey,
    async (account) => {
      const wait = remaining(account.lastBattleAt, GAME_COOLDOWNS.battle, now);
      if (wait)
        throw new UserError(`The arena reopens in ${cooldownText(wait)}.`);
      const won = roll < getBattleWinChance(activeTeam(account).length);
      const reward = won ? payout : 5;
      const team = activeTeam(account);
      const enemyTeam = Array.from({ length: 3 }, () => companions[randomInt(companions.length)]!);
      const turns = randomInt(4, 13);
      return {
        accountPatch: { lastBattleAt: now },
        amount: reward,
        type: 'battle',
        reason: won ? 'Arena battle • victory' : 'Arena battle • consolation',
        metadata: { won, team, enemyTeam, turns },
        result: { won, reward, team, enemyTeam, turns },
      };
    },
    now,
  );
}

export async function buyItem(
  guildId: string,
  userId: string,
  sourceKey: string,
  item: ShopItem,
  now = new Date(),
) {
  const product = gameShop[item];
  if (!product) throw new UserError('That shop item is unavailable.');
  return transact(
    guildId,
    userId,
    sourceKey,
    async (account) => {
      const inventory = { ...(account.inventory as Record<string, number>) };
      inventory[item] = (inventory[item] ?? 0) + 1;
      return {
        accountPatch: { inventory },
        amount: -product.price,
        type: 'purchase',
        reason: `Shop • ${product.name}`,
        metadata: { item },
        result: { item, remainingCoins: account.coins - product.price },
      };
    },
    now,
  );
}

export async function openCrate(
  guildId: string,
  userId: string,
  sourceKey: string,
  now = new Date(),
  animal = companions[randomInt(0, companions.length)]!,
) {
  return transact(
    guildId,
    userId,
    sourceKey,
    async (account) => {
      const inventory = { ...(account.inventory as Record<string, number>) };
      if ((inventory.map_crate ?? 0) < 1)
        throw new UserError('Buy a Map Crate from `/game shop` first.');
      inventory.map_crate!--;
      const pets = [...(account.pets as string[])];
      const petCounts = companionCounts(account);
      const duplicate = pets.includes(animal);
      if (!duplicate) pets.push(animal);
      petCounts[animal] = (petCounts[animal] ?? 0) + 1;
      return {
        accountPatch: { inventory, pets, petCounts },
        amount: duplicate ? 30 : 0,
        type: 'crate_open',
        reason: duplicate
          ? `Map Crate • duplicate ${animal}`
          : `Map Crate • ${animal}`,
        metadata: { animal, duplicate },
        result: { animal, duplicate },
      };
    },
    now,
  );
}

export async function gameLeaderboard(guildId: string, limit = 10) {
  return db.gameAccount.findMany({
    where: { guildId, coins: { gt: 0 } },
    orderBy: [{ coins: 'desc' }, { userId: 'asc' }],
    take: limit,
  });
}
