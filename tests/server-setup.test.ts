import { PermissionFlagsBits, type Role } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  findMatchingResource,
  normalizedResourceName,
  setupCategories,
  setupChannels,
  selectSetupRoleCandidate,
} from '../src/services/serverSetup.js';

describe('reference-inspired server layout', () => {
  it('keeps the reference category groups and required bot channels', () => {
    expect(setupCategories).toEqual([
      '☕ INFORMATION',
      '💙 ROLES',
      '📌 NOTICE BOARD',
      '🌹 GENERAL ZONE',
      '🛠️ CREATOR HUB',
      '🛡️ STAFF ZONE',
    ]);
    for (const name of [
      'welcome',
      'rules',
      'announcements',
      'map-reviews',
      'reports',
      'leaderboard',
      'bot-commands',
      'games',
      'logs',
    ])
      expect(setupChannels.some((channel) => channel.name === name)).toBe(true);
  });

  it('decorates channels like the reference and keeps staff channels private', () => {
    const displayNames = setupChannels.map((channel) => channel.displayName);
    expect(displayNames).toContain('☕・about・server');
    expect(displayNames).toContain('☕・about・owners');
    expect(displayNames).toContain('✅・rules');
    expect(displayNames).toContain('☕・discord・guidelines');
    expect(displayNames).toContain('💙・self・roles');
    expect(displayNames).toContain('📢・📍・announcement');
    expect(displayNames).toContain('📢・📍・yt・updates');
    expect(displayNames).toContain('☃️・general・chat');
    expect(displayNames).toContain('📍・tourney・promo²');

    for (const name of [
      'reports',
      'logs',
      'staff-announcements',
      'staff-rules',
      'staff-chat',
    ]) {
      expect(
        setupChannels.find((channel) => channel.name === name)?.private,
      ).toBe(true);
    }
  });
});

describe('decorated existing server resource matching', () => {
  it('ignores decorative Unicode prefixes while keeping exact names', () => {
    expect(normalizedResourceName('𒀽〢welcome')).toBe('welcome');
    expect(
      findMatchingResource(
        [{ id: 'welcome-id', name: '𒀽〢welcome' }],
        'welcome',
      )?.id,
    ).toBe('welcome-id');
    expect(
      findMatchingResource(
        [{ id: 'start-id', name: '🍁〢START HERE' }],
        '☕ INFORMATION',
      )?.id,
    ).toBe('start-id');
  });

  it('reuses the existing spelling variants from the Craftland server', () => {
    expect(
      findMatchingResource(
        [{ id: 'announcements-id', name: '𒀽〢announcment' }],
        'announcements',
      )?.id,
    ).toBe('announcements-id');
    expect(
      findMatchingResource([{ id: 'mod-logs-id', name: '𒀽〢mod-logs' }], 'logs')
        ?.id,
    ).toBe('mod-logs-id');
    expect(
      findMatchingResource(
        [{ id: 'yt-id', name: '📢・📍・yt・updates' }],
        'youtube-updates',
      )?.id,
    ).toBe('yt-id');
    expect(
      findMatchingResource(
        [{ id: 'help-id', name: 'help-and-feedback' }],
        'craftland-helping',
      )?.id,
    ).toBe('help-id');
    expect(
      findMatchingResource([{ id: 'roles-id', name: 'role-info' }], 'self-roles')
        ?.id,
    ).toBe('roles-id');
  });

  it('prefers the older existing server category when setup-created duplicates remain', () => {
    expect(
      findMatchingResource(
        [
          { id: '1553890671058878536', name: '🎮 COMMUNITY' },
          { id: '1529466370054688858', name: '🍁〢COMMUNITY' },
        ],
        '🎮 COMMUNITY',
      )?.id,
    ).toBe('1529466370054688858');
  });
});

function role(
  name: string,
  id: string,
  position: number,
  administrator = false,
) {
  return {
    name,
    id,
    position,
    managed: false,
    permissions: {
      has: (permission: bigint) =>
        permission === PermissionFlagsBits.Administrator && administrator,
    },
  } as unknown as Role;
}

describe('safe setup role selection', () => {
  it('does not reuse an Administrator Moderator role and chooses a distinct safe role', () => {
    const protectedRole = role('✧ MODERATOR', 'admin-role', 38, true);
    const safeRole = role('Craftland Moderator', 'safe-role', 20);
    const result = selectSetupRoleCandidate(
      [protectedRole, safeRole],
      'Moderator',
      'guild',
      39,
    );

    expect(result.resourceName).toBe('Craftland Moderator');
    expect(result.role?.id).toBe('safe-role');
    expect(
      result.role?.permissions.has(PermissionFlagsBits.Administrator),
    ).toBe(false);
  });

  it('uses the safe alternate name when the protected role exists but no safe role does', () => {
    const result = selectSetupRoleCandidate(
      [role('✧ MODERATOR', 'admin-role', 38, true)],
      'Moderator',
      'guild',
      39,
    );

    expect(result.resourceName).toBe('Craftland Moderator');
    expect(result.role).toBeUndefined();
  });

  it('keeps a normal Moderator role when it is below the bot and non-privileged', () => {
    const safeRole = role('Moderator', 'safe-role', 20);
    const result = selectSetupRoleCandidate(
      [safeRole],
      'Moderator',
      'guild',
      39,
    );

    expect(result.resourceName).toBe('Moderator');
    expect(result.role).toBe(safeRole);
  });
});
