import { PermissionFlagsBits } from 'discord.js';
import { env } from '../config/env.js';
export const invitePermissions = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ModerateMembers,
].reduce((a, b) => a | b, 0n);
export function inviteUrl(clientId: string) {
  if (!/^\d{17,20}$/.test(clientId))
    throw new Error('Set CLIENT_ID to your Application ID.');
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=${invitePermissions}`;
}
if (
  process.argv[1]?.endsWith('invite.ts') ||
  process.argv[1]?.endsWith('invite.js')
)
  console.log(inviteUrl(env.CLIENT_ID));
