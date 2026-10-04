import {
  PermissionFlagsBits,
  PermissionsBitField,
  type Guild,
} from 'discord.js';
import { normalizedResourceName } from './serverSetup.js';

const rolePolicy: Record<string, bigint[]> = {
  member: [],
  creator: [],
  eventteam: [PermissionFlagsBits.CreateEvents],
  mapreviewer: [],
  seniorreviewer: [],
  moderator: [
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ModerateMembers,
  ],
  staff: [],
};

/** Add only the named role's least-privilege permissions; preserve all others. */
export async function syncNamedRolePermissions(guild: Guild) {
  const roles = await guild.roles.fetch();
  const bot = await guild.members.fetchMe();
  const report: Array<{
    role: string;
    added: string[];
    alreadyPresent: string[];
    skipped?: string;
  }> = [];

  for (const [name, grants] of Object.entries(rolePolicy)) {
    const matches = [...roles.values()].filter(
      (role) => normalizedResourceName(role.name) === name,
    );
    if (!matches.length) {
      report.push({ role: name, added: [], alreadyPresent: [], skipped: 'not found by exact name' });
      continue;
    }
    for (const role of matches) {
      if (!grants.length) {
        report.push({ role: role.name, added: [], alreadyPresent: [] });
        continue;
      }
      if (
        role.id === guild.id ||
        role.managed ||
        role.permissions.has(PermissionFlagsBits.Administrator) ||
        role.position >= bot.roles.highest.position
      ) {
        report.push({
          role: role.name,
          added: [],
          alreadyPresent: [],
          skipped: 'protected, managed, or above bot role',
        });
        continue;
      }
      const missing = grants.filter((permission) => !role.permissions.has(permission));
      const alreadyPresent = grants
        .filter((permission) => role.permissions.has(permission))
        .map((permission) => new PermissionsBitField(permission).toArray()[0]!);
      if (!missing.length) {
        report.push({ role: role.name, added: [], alreadyPresent });
        continue;
      }
      const combined = missing.reduce(
        (bitfield, permission) => bitfield | permission,
        role.permissions.bitfield,
      );
      await role.setPermissions(
        new PermissionsBitField(combined),
        'Apply approved least-privilege role permissions by exact role name',
      );
      report.push({
        role: role.name,
        added: missing.map(
          (permission) => new PermissionsBitField(permission).toArray()[0]!,
        ),
        alreadyPresent,
      });
    }
  }
  console.info(
    JSON.stringify({
      scope: 'named-role-permission-sync',
      guildId: guild.id,
      report,
      time: new Date().toISOString(),
    }),
  );
  return report;
}
