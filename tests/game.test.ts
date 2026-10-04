import { describe, expect, it } from 'vitest';
import {
  cooldownText,
  GAME_COOLDOWNS,
  gameShop,
  getBattleWinChance,
  getDailyReward,
  companionCounts,
  activeTeam,
} from '../src/game/service.js';
import { zooText } from '../src/game/presentation.js';
import { gameXPAmount } from '../src/xp/activity.js';
import { commands } from '../src/bot/commands/definitions.js';

describe('Craftland adventure game rules', () => {
  it('gives a daily reward with a bounded streak bonus', () => {
    expect(getDailyReward(1)).toBe(100);
    expect(getDailyReward(4)).toBe(130);
    expect(getDailyReward(90)).toBe(150);
  });

  it('formats cooldowns consistently and keeps game cooldowns bounded', () => {
    expect(cooldownText(1)).toBe('1m');
    expect(cooldownText(61 * 60_000)).toBe('1h 1m');
    expect(GAME_COOLDOWNS.hunt).toBe(10 * 60_000);
    expect(GAME_COOLDOWNS.daily).toBe(20 * 60 * 60_000);
  });

  it('limits companion-based arena advantage and defines affordable starter items', () => {
    expect(getBattleWinChance(0)).toBe(0.45);
    expect(getBattleWinChance(5)).toBe(0.65);
    expect(getBattleWinChance(100)).toBe(0.65);
    expect(gameShop.hunt_ticket.price).toBeLessThan(gameShop.map_crate.price);
    expect(gameShop.builder_badge.price).toBeGreaterThan(
      gameShop.lucky_charm.price,
    );
  });
});

describe('Companion collection compatibility', () => {
  it('keeps pre-existing unique companions when counts are introduced', () => {
    const oldAccount = { pets: ['Fox', 'Dragon'] };
    expect(companionCounts(oldAccount)).toEqual({ Fox: 1, Dragon: 1 });
    expect(activeTeam(oldAccount)).toEqual(['Fox', 'Dragon']);
    expect(zooText(oldAccount)).toContain('Dragon** • Legendary ×1');
  });
  it('uses the saved three-companion battle team', () => {
    expect(activeTeam({ pets: ['Fox', 'Wolf', 'Dragon'], team: ['Dragon', 'Fox'] }))
      .toEqual(['Dragon', 'Fox']);
  });
});

it('awards games twice the configured message XP', () => {
  expect(gameXPAmount(10)).toBe(20);
});

describe('Craftland game command menu', () => {
  it('registers the economy, animal and gambling slash actions', () => {
    const game = commands.find((command) => command.name === 'game')!.toJSON();
    const names = new Set(game.options?.map((option) => option.name));
    for (const name of ['balance', 'give', 'zoo', 'sell', 'slots', 'blackjack', 'highlow'])
      expect(names.has(name)).toBe(true);
  });
});
