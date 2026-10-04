import { PermissionFlagsBits, type GuildMember, type Role } from 'discord.js';
import { UserError } from '../utils/errors.js';
export type Hierarchy = {
  bot: number;
  actor: number;
  target: number;
  role: number;
  owner: boolean;
  managed: boolean;
  administrator: boolean;
  everyone: boolean;
};
export function hierarchyAllowed(h: Hierarchy): boolean {
  return (
    !h.managed &&
    !h.administrator &&
    !h.everyone &&
    h.bot > h.role &&
    h.bot > h.target &&
    (h.owner || (h.actor > h.role && h.actor > h.target))
  );
}
export function staffAllowed(
  isAdmin: boolean,
  actorRoles: string[],
  configuredRoles: string[],
): boolean {
  return isAdmin || actorRoles.some((r) => configuredRoles.includes(r));
}
export function assertRole(
  bot: GuildMember,
  target: GuildMember,
  role: Role,
  actor?: GuildMember,
) {
  const allowed = hierarchyAllowed({
    bot: bot.roles.highest.position,
    actor: actor?.roles.highest.position ?? bot.roles.highest.position,
    target: target.roles.highest.position,
    role: role.position,
    owner: actor?.id === target.guild.ownerId,
    managed: role.managed,
    administrator: role.permissions.has(PermissionFlagsBits.Administrator),
    everyone: role.id === target.guild.id,
  });
  if (
    !bot.permissions.has(PermissionFlagsBits.ManageRoles) ||
    !allowed ||
    target.id === target.guild.ownerId ||
    target.permissions.has(PermissionFlagsBits.Administrator)
  )
    throw new UserError(
      'Role action blocked by permissions, protected role, or member/role hierarchy.',
    );
}
export function assertModeration(
  bot: GuildMember,
  target: GuildMember,
  actor?: GuildMember,
) {
  if (
    target.id === target.guild.ownerId ||
    target.permissions.has(PermissionFlagsBits.Administrator) ||
    target.roles.highest.position >= bot.roles.highest.position ||
    (actor &&
      actor.id !== target.guild.ownerId &&
      target.roles.highest.position >= actor.roles.highest.position) ||
    actor?.id === target.id
  )
    throw new UserError(
      'Moderation blocked by protected member or role hierarchy.',
    );
}
