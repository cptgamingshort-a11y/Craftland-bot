import { describe, it, expect } from 'vitest';
import { eligibility } from '../src/roles/eligibility.js';
import { hierarchyAllowed, staffAllowed } from '../src/roles/guards.js';
import { pointBalance } from '../src/services/points.js';
import { periodRange, rankEntries } from '../src/leaderboard/calculations.js';
import { normalizeMapCode } from '../src/services/reviews.js';
import { SpamDetector } from '../src/moderation/detection.js';
import { defaults, settingsSchema } from '../src/config/settings.js';
import { RateLimiter } from '../src/utils/rateLimit.js';
import { commands } from '../src/bot/commands/definitions.js';
import { invitePermissions, inviteUrl } from '../src/bot/invite.js';
import { PermissionFlagsBits } from 'discord.js';
import { DateTime } from 'luxon';
import { calculateLevel, progress, threshold } from '../src/xp/calculations.js';
import { planLevelRoles } from '../src/xp/roles.js';
import {
  communityFallbackReply,
  communityReplyKind,
} from '../src/ai/community.js';
import { GeminiService, geminiError } from '../src/ai/gemini.js';
import { parseGameCommand } from '../src/game/prefix.js';
import { minesMultiplier } from '../src/game/service.js';
import { scamPromotionReason } from '../src/moderation/scam.js';
describe('point and leaderboard calculations', () => {
  it('includes removals and does not use floating balances', () =>
    expect(pointBalance([10, 20, -5])).toBe(25));
  it('ranks verified transactions with deterministic ties and excludes nonpositive totals', () =>
    expect(
      rankEntries([
        { discordId: 'b', amount: 10 },
        { discordId: 'a', amount: 20 },
        { discordId: 'a', amount: -10 },
        { discordId: 'c', amount: -1 },
      ]),
    ).toEqual([
      { discordId: 'a', points: 10 },
      { discordId: 'b', points: 10 },
    ]));
  it('uses Kolkata week boundaries across UTC dates', () => {
    const r = periodRange(
      'weekly',
      true,
      DateTime.fromISO('2026-09-28T09:00:00', { zone: 'Asia/Kolkata' }),
    );
    expect(r.start.toISOString()).toBe('2026-09-20T18:30:00.000Z');
    expect(r.end.toISOString()).toBe('2026-09-27T18:30:00.000Z');
  });
});
describe('channel-specific AI replies', () => {
  const channels = { generalChat: '1', doubtSolving: '2', games: '3' };
  it('answers general questions or direct bot addresses, not ordinary chat', () => {
    expect(communityReplyKind('1', channels, 'Good morning everyone')).toBe(
      null,
    );
    expect(communityReplyKind('1', channels, 'Map code kaise banau?')).toBe(
      'chat',
    );
    expect(communityReplyKind('1', channels, 'hello bot', true)).toBe('chat');
    expect(communityReplyKind('1', channels, 'Tumhara h?', true)).toBe('chat');
    expect(communityReplyKind('1', channels, 'mic on script', true)).toBe('chat');
    expect(communityReplyKind('1', channels, 'Currently it is working for basic good but not for advance')).toBe(null);
    expect(communityReplyKind('1', channels, 'improve kar raha hu')).toBe(null);
  });
  describe('Gemini provider failures', () => {
    it('explains transient provider timeouts instead of hiding the cause', () => {
      expect(geminiError({ status: 504 })).toContain('temporarily unavailable');
    });
    it('allows community replies to cap output tokens per request', async () => {
      let outputTokenLimit: number | undefined;
      const service = new GeminiService(
        async (_model, _prompt, _signal, _schema, maxOutputTokens) => {
          outputTokenLimit = maxOutputTokens;
          return { text: 'OK' };
        },
        async () => {},
        true,
      );
      await service.generate(
        'Short question',
        { type: 'test', actorId: 'user', guildId: 'token-limit-test' },
        undefined,
        { maxRetries: 0, maxOutputTokens: 120 },
      );
      expect(outputTokenLimit).toBe(120);
    });
  });
  it('answers short doubts but ignores ordinary game-channel and slash-like messages', () => {
    expect(communityReplyKind('2', channels, 'Map kaise publish karu')).toBe(
      'doubt',
    );
    expect(communityReplyKind('2', channels, 'improve kar raha hu')).toBe(null);
    expect(communityReplyKind('3', channels, 'aaj kya khele?')).toBe(null);
    expect(communityReplyKind('3', channels, '/xp')).toBe(null);
    expect(communityReplyKind('2', channels, '/help')).toBe(null);
    expect(communityReplyKind('9', channels, 'Map kaise publish karu?')).toBe(
      null,
    );
    expect(communityReplyKind('2', channels, 'https://example.com')).toBe(null);
    expect(communityReplyKind('3', channels, 'owo')).toBe(null);
    expect(communityReplyKind('3', channels, 'owo help')).toBe(null);
  });
  it('keeps greetings conversational when Gemini quota is exhausted', () => {
    expect(communityFallbackReply('chat', 'hello')).toContain('Kya haal hai?');
    expect(communityFallbackReply('chat', 'thanks')).toContain(
      'Khushi hui help karke',
    );
    expect(communityFallbackReply('chat', 'Tumhara h?')).toContain(
      'Tum kaise ho?',
    );
    expect(communityFallbackReply('chat', 'good game')).toBe('Haan, bolo 😊');
  });
});
describe('chat game aliases', () => {
  it.each([
    ['g game', 'game', []],
    ['g cash', 'cash', []],
    ['g mine 10', 'mine', ['10']],
    ['g cf 2 heads', 'cf', ['2', 'heads']],
    ['game cf 2', 'cf', ['2']],
    ['game mine 10', 'mine', ['10']],
    ['game cash', 'cash', []],
    ['g cowoncy', 'cash', []],
    ['g zoo', 'zoo', []],
    ['g sell Fox', 'sell', ['Fox']],
    ['g slots 20', 'slots', ['20']],
    ['g blackjack 20', 'blackjack', ['20']],
    ['g highlow 20 high', 'highlow', ['20', 'high']],
    ['g team add Fox 1', 'team', ['add', 'Fox', '1']],
    ['g give <@1308055929043816528> 50', 'give', ['<@1308055929043816528>', '50']],
  ])('parses %s', (input, action, args) => {
    expect(parseGameCommand(input)).toEqual({ action, args });
  });
  it('leaves OwO commands for the OwO bot', () => {
    expect(parseGameCommand('owo help')).toBe(null);
    expect(parseGameCommand('owo daily')).toBe(null);
  });
  it('uses a fair rising mines cashout multiplier', () => {
    expect(minesMultiplier(0, 3)).toBe(1);
    expect(minesMultiplier(1, 3)).toBe(1.4);
    expect(minesMultiplier(7, 3)).toBe(0);
  });
});

describe('scam promotion filter', () => {
  it('flags crypto bonus links and promo-code withdrawal ads', () => {
    expect(scamPromotionReason('Visit crypto-wins.com, enter promo code BET and claim your withdrawal bonus.'))
      .toBe('Unsolicited crypto or gambling promotion');
    expect(scamPromotionReason('CRYPTO withdrawal successful! Activate code BET to claim your bonus.'))
      .toBe('Unsolicited crypto or gambling promotion');
  });
  it('keeps map content and scam warnings', () => {
    expect(scamPromotionReason('Here is my Craftland map screenshot and code.')).toBeNull();
    expect(scamPromotionReason('Scam alert: do not click this crypto bonus link.')).toBeNull();
  });
});
describe('XP progression and managed level roles', () => {
  const formula = { baseXP: 100, incrementXP: 50, maxLevel: 100 };
  it('uses the configured progressive threshold at exact boundaries', () => {
    expect([1, 2, 3, 4, 5].map((level) => threshold(level, formula))).toEqual([
      100, 250, 450, 700, 1000,
    ]);
    expect(calculateLevel(999, formula)).toBe(4);
    expect(calculateLevel(1000, formula)).toBe(5);
    expect(progress(910, formula)).toMatchObject({
      level: 4,
      current: 210,
      required: 300,
      percent: 70,
    });
  });
  it('removes only registered progression roles and preserves unrelated roles', () => {
    expect(
      planLevelRoles(
        ['staff', 'old-level', 'new-level'],
        ['old-level', 'new-level'],
        'new-level',
      ),
    ).toEqual({
      remove: ['old-level'],
      add: undefined,
    });
  });
});
describe('verified role rules', () => {
  const rules = {
    minimumPoints: 20,
    minimumApprovedReviews: 2,
    minimumActiveDays: 3,
    minimumQuality: 80,
  };
  it('requires every threshold and an actual quality score', () => {
    expect(
      eligibility(
        { points: 20, approvedReviews: 2, activeDays: 3, quality: 80 },
        rules,
      ).eligible,
    ).toBe(true);
    expect(
      eligibility(
        { points: 999, approvedReviews: 2, activeDays: 3, quality: null },
        rules,
      ).eligible,
    ).toBe(false);
    expect(
      eligibility(
        { points: 20, approvedReviews: 1, activeDays: 3, quality: 80 },
        rules,
      ).eligible,
    ).toBe(false);
  });
  it('supports configuration without quality', () =>
    expect(
      eligibility(
        { points: 20, approvedReviews: 2, activeDays: 3, quality: null },
        { ...rules, minimumQuality: null },
      ).eligible,
    ).toBe(true));
  const h = {
    bot: 10,
    actor: 9,
    target: 3,
    role: 4,
    owner: false,
    managed: false,
    administrator: false,
    everyone: false,
  };
  it('blocks equal/high roles, managed, admin, everyone and higher targets', () => {
    expect(hierarchyAllowed(h)).toBe(true);
    for (const changes of [
      { role: 10 },
      { actor: 4 },
      { target: 10 },
      { managed: true },
      { administrator: true },
      { everyone: true },
    ])
      expect(hierarchyAllowed({ ...h, ...changes })).toBe(false);
  });
  it('owner cannot bypass bot hierarchy or admin protection', () => {
    expect(hierarchyAllowed({ ...h, owner: true, actor: 1 })).toBe(true);
    expect(hierarchyAllowed({ ...h, owner: true, role: 10 })).toBe(false);
    expect(hierarchyAllowed({ ...h, owner: true, administrator: true })).toBe(
      false,
    );
  });
  it('limits staff to configured roles or administrators', () => {
    expect(staffAllowed(false, ['member'], ['staff'])).toBe(false);
    expect(staffAllowed(false, ['staff'], ['staff'])).toBe(true);
    expect(staffAllowed(true, [], [])).toBe(true);
  });
});
describe('duplicate keys, moderation, configuration and command registration', () => {
  it('normalizes equivalent review map codes', () =>
    expect(normalizeMapCode(' ab 12 ')).toBe(normalizeMapCode('AB12')));
  it('detects floods, duplicates, mentions and word boundaries', () => {
    const c = { ...defaults().moderation, enabled: true };
    const d = new SpamDetector();
    expect(d.inspect('1', 'hello', 0, c, 0)).toBeNull();
    for (let n = 1; n < 4; n++) d.inspect('1', 'hello', 0, c, n);
    expect(d.inspect('1', 'hello', 0, c, 5)).toBe('Duplicate messages');
    expect(d.inspect('2', 'x', 8, c, 0)).toBe('Mention spam');
    expect(d.inspect('3', 'bad', 0, { ...c, badWords: ['bad'] }, 0)).toBe(
      'Configured bad-word filter',
    );
    expect(
      d.inspect('4', 'badminton', 0, { ...c, badWords: ['bad'] }, 0),
    ).toBeNull();
    const f = new SpamDetector();
    for (let n = 0; n < 7; n++)
      expect(f.inspect('5', String(n), 0, c, n)).toBeNull();
    expect(f.inspect('5', '8', 0, c, 8)).toBe('Message flood');
    expect(f.inspect('5', 'later', 0, c, 20000)).toBeNull();
    expect(f.inspect('6', 'bad', 99, { ...c, enabled: false }, 0)).toBeNull();
  });
  it('rate limits and expires old hits', () => {
    const r = new RateLimiter(2, 1000);
    expect(r.allow('a', 0)).toBe(true);
    expect(r.allow('a', 1)).toBe(true);
    expect(r.allow('a', 2)).toBe(false);
    expect(r.allow('a', 1002)).toBe(true);
  });
  it('rejects guessed IDs and unsafe schedules', () => {
    expect(
      settingsSchema.safeParse({
        ...defaults(),
        channels: { ...defaults().channels, welcome: '123' },
      }).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({
        ...defaults(),
        schedule: { ...defaults().schedule, weeklyDay: 8 },
      }).success,
    ).toBe(false);
  });
  it('serializes every slash command to Discord registration JSON', () => {
    const definitions = commands.map((c) => c.toJSON());
    expect(new Set(definitions.map((d) => d.name)).size).toBe(
      definitions.length,
    );
    expect(
      definitions
        .find((d) => d.name === 'role')
        ?.options?.some((o) => o.name === 'requirements'),
    ).toBe(true);
    expect(definitions.map((d) => d.name)).toContain('setup');
    expect(definitions.map((d) => d.name)).toContain('game');
    expect(definitions.map((d) => d.name)).toContain('rules');
    expect(definitions.length).toBe(21);
  });
  it('invite scopes are correct and never request Administrator', () => {
    expect(invitePermissions & PermissionFlagsBits.Administrator).toBe(0n);
    expect(inviteUrl('123456789012345678')).toContain(
      'scope=bot%20applications.commands',
    );
  });
});
