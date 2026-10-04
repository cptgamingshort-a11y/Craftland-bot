import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits,
  type Guild,
  type Role,
  type NonThreadGuildBasedChannel,
  type OverwriteResolvable,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { db } from '../database/client.js';
import { settings, saveSettings } from './configuration.js';
import { notify } from './audit.js';
import { env } from '../config/env.js';
import { UserError, logError } from '../utils/errors.js';
import { withDatabaseLocks } from '../utils/locks.js';

export const setupRoles = [
  'Member',
  'Creator',
  'Map Reviewer',
  'Senior Reviewer',
  'Event Team',
  'Moderator',
  'Staff',
] as const;
export const setupCategories = [
  '☕ INFORMATION',
  '💙 ROLES',
  '📌 NOTICE BOARD',
  '🌹 GENERAL ZONE',
  '🛠️ CREATOR HUB',
  '🛡️ STAFF ZONE',
] as const;
export const setupChannels = [
  {
    name: 'about-server',
    displayName: '☕・about・server',
    category: 0,
    readonly: true,
    private: false,
  },
  {
    name: 'about-owners',
    displayName: '☕・about・owners',
    category: 0,
    readonly: true,
    private: false,
  },
  {
    name: 'rules',
    displayName: '✅・rules',
    category: 0,
    readonly: true,
    private: false,
  },
  {
    name: 'welcome',
    displayName: '☕・welcome',
    category: 0,
    readonly: true,
    private: false,
  },
  {
    name: 'discord-guidelines',
    displayName: '☕・discord・guidelines',
    category: 0,
    readonly: true,
    private: false,
  },
  {
    name: 'self-roles',
    displayName: '💙・self・roles',
    category: 1,
    readonly: false,
    private: false,
  },
  {
    name: 'announcements',
    displayName: '📢・📍・announcement',
    category: 2,
    readonly: true,
    private: false,
  },
  {
    name: 'youtube-updates',
    displayName: '📢・📍・yt・updates',
    category: 2,
    readonly: true,
    private: false,
  },
  {
    name: 'tourney-promo',
    displayName: '📍・tourney・promo',
    category: 2,
    readonly: false,
    private: false,
  },
  {
    name: 'tourney-promo-2',
    displayName: '📍・tourney・promo²',
    category: 2,
    readonly: false,
    private: false,
  },
  {
    name: 'server-updates',
    displayName: '📍・server・updates',
    category: 2,
    readonly: true,
    private: false,
  },
  {
    name: 'giveaways',
    displayName: '📍・giveaways',
    category: 2,
    readonly: false,
    private: false,
  },
  {
    name: 'leaderboard',
    displayName: '📊・leaderboard',
    category: 2,
    readonly: true,
    private: false,
  },
  {
    name: 'general-chat',
    displayName: '☃️・general・chat',
    category: 3,
    readonly: false,
    private: false,
  },
  {
    name: 'media',
    displayName: '☃️・media',
    category: 3,
    readonly: false,
    private: false,
  },
  {
    name: 'bot-commands',
    displayName: '🤖・bot-commands',
    category: 3,
    readonly: false,
    private: false,
  },
  {
    name: 'games',
    displayName: '🎮・games',
    category: 3,
    readonly: false,
    private: false,
  },
  {
    name: 'map-reviews',
    displayName: '🗺️・map-reviews',
    category: 4,
    readonly: false,
    private: false,
  },
  {
    name: 'craftland-helping',
    displayName: '💁🏻・craftland-helping',
    category: 4,
    readonly: false,
    private: false,
  },
  {
    name: 'reports',
    displayName: '🚨・reports',
    category: 5,
    readonly: false,
    private: true,
  },
  {
    name: 'logs',
    displayName: '📜・logs',
    category: 5,
    readonly: true,
    private: true,
  },
  {
    name: 'staff-announcements',
    displayName: '📂・staff-announcements',
    category: 5,
    readonly: true,
    private: true,
  },
  {
    name: 'staff-rules',
    displayName: '📌・staff-rules',
    category: 5,
    readonly: true,
    private: true,
  },
  {
    name: 'staff-chat',
    displayName: '👔・staff-chat',
    category: 5,
    readonly: false,
    private: true,
  },
] as const;
export type Creation = {
  kind: 'Role' | 'Category' | 'Channel';
  name: string;
  id?: string;
  stage: 'REQUESTED' | 'CREATED' | 'UPDATED';
};
export function normalizedResourceName(name: string) {
  return (
    name
      .normalize('NFKC')
      .toLowerCase()
      // Discord server names commonly use decorative Unicode prefixes. Keep
      // matching focused on the readable ASCII resource name so e.g.
      // "𒀽〢welcome" matches "welcome" without fuzzy substring matches.
      .replace(/[^a-z0-9]+/g, '')
  );
}
const resourceAliases: Record<string, string[]> = {
  announcements: ['announcment', 'announcement'],
  'bot-commands': ['bot-command'],
  'craftland-helping': ['help-and-feedback'],
  logs: ['mod-logs'],
  'self-roles': ['role-info'],
  'youtube-updates': ['yt-updates'],
  '☕ INFORMATION': ['start-here'],
  '🌹 GENERAL ZONE': ['community'],
  '🛡️ STAFF ZONE': ['staff', 'staffmembers'],
  Creator: ['mapcreator'],
};
function resourceMatchRank(
  actual: string,
  requested: string,
): number | undefined {
  const actualNormalized = normalizedResourceName(actual);
  const requestedNormalized = normalizedResourceName(requested);
  if (actualNormalized === requestedNormalized) return 0;
  if (
    (resourceAliases[requested] ?? []).some(
      (alias) => actualNormalized === normalizedResourceName(alias),
    )
  )
    return 1;
  return undefined;
}
export function findMatchingResource<T extends { name: string; id: string }>(
  resources: T[],
  name: string,
): T | undefined {
  return resources
    .map((resource) => ({
      resource,
      rank: resourceMatchRank(resource.name, name),
    }))
    .filter(
      (match): match is { resource: T; rank: number } =>
        match.rank !== undefined,
    )
    .sort((a, b) => {
      // Prefer explicitly known legacy spellings; otherwise keep the oldest
      // Discord resource when a bot-created duplicate is still present.
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (/^\d+$/.test(a.resource.id) && /^\d+$/.test(b.resource.id))
        return BigInt(a.resource.id) < BigInt(b.resource.id)
          ? -1
          : BigInt(a.resource.id) > BigInt(b.resource.id)
            ? 1
            : 0;
      return a.resource.id.localeCompare(b.resource.id);
    })[0]?.resource;
}
export function selectSetupRoleCandidate<T extends Role>(
  resources: T[],
  name: string,
  guildId: string,
  botPosition: number,
) {
  let resourceName = name;
  let role = findMatchingResource(resources, name);
  if (
    name === 'Moderator' &&
    role &&
    (role.id === guildId ||
      role.managed ||
      role.permissions.has(PermissionFlagsBits.Administrator) ||
      role.position >= botPosition)
  ) {
    // Never adopt or edit a protected Administrator/moderator role. Use a
    // distinct least-privilege role for this bot's staff-channel wiring.
    resourceName = 'Craftland Moderator';
    role = findMatchingResource(resources, resourceName);
  }
  return { role, resourceName };
}
export function assertSetupRole(role: Role, guild: Guild, botPosition: number) {
  if (
    role.id === guild.id ||
    role.managed ||
    role.permissions.has(PermissionFlagsBits.Administrator) ||
    role.position >= botPosition
  )
    throw new UserError(
      `Existing role "${role.name}" is Administrator, managed, or at/above the bot. Setup leaves it untouched. Use a safe matching role and place the bot above it.`,
    );
  if (
    ['Member', 'Creator', 'Map Reviewer', 'Senior Reviewer', 'Event Team'].some(
      (n) => normalizedResourceName(n) === normalizedResourceName(role.name),
    ) &&
    role.permissions.has(
      [
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.ManageGuild,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ModerateMembers,
        PermissionFlagsBits.KickMembers,
        PermissionFlagsBits.BanMembers,
      ],
      false,
    )
  )
    throw new UserError(
      `"${role.name}" has privileged permissions and cannot safely be used as a community role.`,
    );
}
function privateResource(
  channel: NonThreadGuildBasedChannel,
  guild: Guild,
  allowed: Set<string>,
  botId: string,
) {
  if (
    !('permissionOverwrites' in channel) ||
    channel
      .permissionsFor(guild.roles.everyone)
      ?.has(PermissionFlagsBits.ViewChannel)
  )
    throw new UserError(
      `Existing "${channel.name}" is not staff-private. Setup will not alter its permissions.`,
    );
  for (const o of channel.permissionOverwrites.cache.values())
    if (o.allow.has(PermissionFlagsBits.ViewChannel)) {
      if (
        o.type === OverwriteType.Member &&
        ![guild.ownerId, botId].includes(o.id)
      )
        throw new UserError(
          `Existing "${channel.name}" exposes access through a member overwrite. Review it before setup.`,
        );
      if (
        o.type === OverwriteType.Role &&
        !allowed.has(o.id) &&
        !guild.roles.cache
          .get(o.id)
          ?.permissions.has(PermissionFlagsBits.Administrator)
      )
        throw new UserError(
          `Existing "${channel.name}" grants access to a non-staff role. Review it before setup.`,
        );
    }
}
export async function provisionServer(
  guild: Guild,
  actorId: string,
  record: (creation: Creation) => Promise<void>,
) {
  if (actorId !== guild.ownerId)
    throw new UserError(
      'Only the actual server owner can run automatic /setup.',
    );
  const bot = await guild.members.fetchMe();
  const required = [
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ModerateMembers,
  ];
  if (!bot.permissions.has(required))
    throw new UserError(
      'Auto-setup needs Manage Roles, Manage Channels, Manage Messages, Moderate Members, View Channels, Send Messages, Embed Links and Read Message History. Administrator is not required.',
    );
  const roles = await guild.roles.fetch();
  const channels = await guild.channels.fetch();
  const roleMap = new Map<string, Role>();
  const categoryMap = new Map<string, NonThreadGuildBasedChannel>();
  const channelMap = new Map<string, NonThreadGuildBasedChannel>();
  for (const name of setupRoles) {
    const { role } = selectSetupRoleCandidate(
      [...roles.values()],
      name,
      guild.id,
      bot.roles.highest.position,
    );
    if (role) {
      assertSetupRole(role, guild, bot.roles.highest.position);
      roleMap.set(name, role);
    }
  }
  const staffIds = new Set(
    ['Staff', 'Moderator']
      .map((n) => roleMap.get(n)?.id)
      .filter((id): id is string => Boolean(id)),
  );
  for (const role of roles.values()) {
    const name = normalizedResourceName(role.name);
    if (
      ['staff', 'staffmembers', 'craftlandmoderator', 'moderator'].includes(
        name,
      )
    )
      staffIds.add(role.id);
  }
  for (const name of setupCategories) {
    const category = findMatchingResource(
      [...channels.values()].filter((c): c is NonThreadGuildBasedChannel =>
        Boolean(c && c.type === ChannelType.GuildCategory),
      ),
      name,
    );
    if (category) {
      if (name === '🛡️ STAFF ZONE')
        privateResource(category, guild, staffIds, bot.id);
      categoryMap.set(name, category);
    }
  }
  for (const spec of setupChannels) {
    const ch = findMatchingResource(
      [...channels.values()].filter((c): c is NonThreadGuildBasedChannel =>
        Boolean(c && c.type !== ChannelType.GuildCategory),
      ),
      spec.name,
    );
    if (ch) {
      if (
        ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(
          ch.type,
        ) ||
        !ch
          .permissionsFor(bot)
          ?.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
            PermissionFlagsBits.ReadMessageHistory,
          ])
      )
        throw new UserError(
          `Existing "${spec.name}" has the wrong type or missing bot permissions. Setup will not modify it.`,
        );
      if (spec.private) privateResource(ch, guild, staffIds, bot.id);
      channelMap.set(spec.name, ch);
    }
  }
  const reason = `Craftland India owner-authorized auto-setup (${actorId})`;
  for (const name of setupRoles)
    if (!roleMap.has(name)) {
      // Re-check immediately before mutation; the database setup lock serializes bot runs.
      const { role: fresh, resourceName } = selectSetupRoleCandidate(
        [...(await guild.roles.fetch()).values()],
        name,
        guild.id,
        (await guild.members.fetchMe()).roles.highest.position,
      );
      if (fresh) {
        assertSetupRole(
          fresh,
          guild,
          (await guild.members.fetchMe()).roles.highest.position,
        );
        roleMap.set(name, fresh);
        continue;
      }
      await record({ kind: 'Role', name: resourceName, stage: 'REQUESTED' });
      const role = await guild.roles.create({
        name: resourceName,
        permissions:
          name === 'Moderator'
            ? [
                PermissionFlagsBits.ManageMessages,
                PermissionFlagsBits.ModerateMembers,
              ]
            : [],
        reason,
      });
      roleMap.set(name, role);
      await record({
        kind: 'Role',
        name: role.name,
        id: role.id,
        stage: 'CREATED',
      });
    }
  const overwrites = (
    privateChannel: boolean,
    readonly = false,
  ): OverwriteResolvable[] => [
    {
      id: guild.id,
      type: OverwriteType.Role,
      allow: privateChannel
        ? []
        : [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.UseApplicationCommands,
            ...(readonly ? [] : [PermissionFlagsBits.SendMessages]),
          ],
      deny: privateChannel
        ? [PermissionFlagsBits.ViewChannel]
        : readonly
          ? [
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.CreatePublicThreads,
              PermissionFlagsBits.CreatePrivateThreads,
              PermissionFlagsBits.SendMessagesInThreads,
            ]
          : [],
    },
    {
      id: bot.id,
      type: OverwriteType.Member,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    },
    ...['Staff', 'Moderator'].map((name) => ({
      id: roleMap.get(name)!.id,
      type: OverwriteType.Role,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
      ],
    })),
  ];
  for (const name of setupCategories) {
    let category = categoryMap.get(name);
    if (!category) {
      category = findMatchingResource(
        [...(await guild.channels.fetch()).values()].filter(
          (c): c is NonThreadGuildBasedChannel =>
            Boolean(c && c.type === ChannelType.GuildCategory),
        ),
        name,
      );
      if (category) {
        if (name === '🛡️ STAFF ZONE')
          privateResource(
            category,
            guild,
            new Set([
              ...staffIds,
              ...['Staff', 'Moderator'].map((n) => roleMap.get(n)!.id),
            ]),
            bot.id,
          );
      }
    }
    if (!category) {
      await record({ kind: 'Category', name, stage: 'REQUESTED' });
      category = await guild.channels.create({
        name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: overwrites(name === '🛡️ STAFF ZONE'),
        reason,
      });
      await record({
        kind: 'Category',
        name,
        id: category.id,
        stage: 'CREATED',
      });
    } else if (category.name !== name) {
      await record({
        kind: 'Category',
        name,
        id: category.id,
        stage: 'REQUESTED',
      });
      category = await category.setName(name, reason);
      await record({
        kind: 'Category',
        name,
        id: category.id,
        stage: 'UPDATED',
      });
    }
    categoryMap.set(name, category);
  }
  for (const spec of setupChannels) {
    let channel = channelMap.get(spec.name);
    if (!channel) {
      channel = findMatchingResource(
        [...(await guild.channels.fetch()).values()].filter(
          (c): c is NonThreadGuildBasedChannel =>
            Boolean(c && c.type !== ChannelType.GuildCategory),
        ),
        spec.name,
      );
      if (channel) {
        if (
          ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(
            channel.type,
          ) ||
          !channel
            .permissionsFor(bot)
            ?.has([
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
            ])
        )
          throw new UserError(
            `A conflicting "${spec.name}" appeared during setup.`,
          );
        if (spec.private)
          privateResource(
            channel,
            guild,
            new Set([
              ...staffIds,
              ...['Staff', 'Moderator'].map((n) => roleMap.get(n)!.id),
            ]),
            bot.id,
          );
      }
    }
    if (channel) {
      const parentId = categoryMap.get(setupCategories[spec.category]!)!.id;
      const rename = channel.name !== spec.displayName;
      const move = channel.parentId !== parentId;
      if (rename || move) {
        await record({
          kind: 'Channel',
          name: spec.name,
          id: channel.id,
          stage: 'REQUESTED',
        });
        if (rename) channel = await channel.setName(spec.displayName, reason);
        if (move)
          channel = await channel.setParent(parentId, {
            lockPermissions: false,
            reason,
          });
        await record({
          kind: 'Channel',
          name: spec.name,
          id: channel.id,
          stage: 'UPDATED',
        });
      }
      channelMap.set(spec.name, channel);
      continue;
    }
    await record({ kind: 'Channel', name: spec.name, stage: 'REQUESTED' });
    const ch = await guild.channels.create({
      name: spec.displayName,
      type: ChannelType.GuildText,
      parent: categoryMap.get(setupCategories[spec.category]!)!.id,
      permissionOverwrites: overwrites(spec.private, spec.readonly),
      reason,
    });
    channelMap.set(spec.name, ch);
    await record({
      kind: 'Channel',
      name: spec.name,
      id: ch.id,
      stage: 'CREATED',
    });
  }
  return { roles: roleMap, categories: categoryMap, channels: channelMap };
}
export async function automaticSetup(i: ChatInputCommandInteraction) {
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = await i.guild!.fetch();
  if (i.user.id !== guild.ownerId)
    throw new UserError(
      'Only the server owner can run automatic /setup. Administrators can use /setup configure:true.',
    );
  const created: Creation[] = [];
  const updated: Creation[] = [];
  try {
    await withDatabaseLocks(
      [{ key: `server-setup:${guild.id}` }],
      async (held) => {
        const config = await settings(guild.id);
        const row = await db.botConfiguration.findUniqueOrThrow({
          where: { guildId: guild.id },
        });
        const resources = await provisionServer(
          guild,
          i.user.id,
          async (creation) => {
            held();
            if (creation.stage === 'CREATED' || creation.stage === 'UPDATED') {
              const resources = creation.stage === 'CREATED' ? created : updated;
              resources.push(creation);
              console.info(
                JSON.stringify({
                  guildId: guild.id,
                  actorId: i.user.id,
                  action:
                    creation.stage === 'CREATED'
                      ? 'AUTO_RESOURCE_CREATED'
                      : 'AUTO_RESOURCE_UPDATED',
                  ...creation,
                }),
              );
            }
            await db.auditLog.create({
              data: {
                guildId: guild.id,
                actorId: i.user.id,
                action: `AUTO_${creation.kind.toUpperCase()}_${creation.stage}`,
                data: creation,
              },
            });
          },
        );
        held();
        const ch = (name: string) => resources.channels.get(name)!.id;
        const role = (name: string) => resources.roles.get(name)!.id;
        config.channels = {
          ...config.channels,
          welcome: ch('welcome'),
          rules: ch('rules'),
          announcement: ch('announcements'),
          review: ch('map-reviews'),
          reports: ch('reports'),
          leaderboard: ch('leaderboard'),
          botCommands: ch('bot-commands'),
          games: ch('games'),
          generalChat: ch('general-chat'),
          doubtSolving: ch('craftland-helping'),
          log: ch('logs'),
        };
        config.roles = {
          ...config.roles,
          member: role('Member'),
          creator: role('Creator'),
          reviewer: role('Map Reviewer'),
          seniorReviewer: role('Senior Reviewer'),
          eventTeam: role('Event Team'),
          moderator: role('Moderator'),
          staff: [
            ...new Set([
              ...config.roles.staff,
              role('Moderator'),
              role('Staff'),
            ]),
          ],
        };
        config.welcomeEnabled = true;
        config.autoMemberRole = true;
        await saveSettings(
          guild.id,
          i.user.id,
          config,
          row.version,
          async (tx) => {
            for (const [name, r] of resources.roles)
              await tx.roleConfiguration.upsert({
                where: { guildId_roleId: { guildId: guild.id, roleId: r.id } },
                create: {
                  guildId: guild.id,
                  roleId: r.id,
                  name,
                  protected: !['Member', 'Creator'].includes(name),
                },
                update: !['Member', 'Creator'].includes(name)
                  ? {
                      name,
                      protected: true,
                      autoAssign: false,
                      autoRemove: false,
                    }
                  : { name },
              });
            await tx.auditLog.create({
              data: {
                guildId: guild.id,
                actorId: i.user.id,
                action: 'AUTO_SETUP_COMPLETE',
                data: { created },
              },
            });
          },
        );
        await db.guild.update({
          where: { id: guild.id },
          data: { name: guild.name, setupStatus: 'COMPLETE' },
        });
        for (const resource of created)
          await notify(
            i.client,
            guild.id,
            ch('logs'),
            'Automatically created resource',
            `${resource.kind}: **${resource.name}**\nID: ${resource.id}\nRequested by <@${i.user.id}>`,
          );
        const summary = new EmbedBuilder()
          .setColor(0xc49a55)
          .setTitle('✅ CRAFTLAND INDIA SETUP COMPLETE')
          .setDescription(
            `**Created:**\n• ${created.filter((c) => c.kind === 'Role').length} Roles\n• ${created.filter((c) => c.kind === 'Category').length} Categories\n• ${created.filter((c) => c.kind === 'Channel').length} Channels\n\n**Configured:**\n• Welcome System\n• Role System\n• Review System\n• Reports\n• Weekly Leaderboard\n• AI Management\n• Logging`,
          )
          .setFooter({ text: 'Craftland India • Community Management' });
        summary.addFields({
          name: 'Reference design applied',
          value: `• ${updated.filter((c) => c.kind === 'Category').length} categories renamed\n• ${updated.filter((c) => c.kind === 'Channel').length} channels renamed or moved`,
        });
        summary.addFields({
          name: 'Next steps',
          value: `Use /setup configure:true to choose contribution requirements and schedule. Level-role mappings are configured with /level-role set.${env.GEMINI_API_KEY ? '' : ' AI is ready for configuration; add GEMINI_API_KEY privately to enable provider responses.'}`,
        });
        await i.editReply({
          embeds: [summary],
          allowedMentions: { parse: [] },
        });
      },
      true,
    );
  } catch (error) {
    logError('auto-setup', error);
    await i.editReply({
      content: `Setup stopped safely. ${error instanceof UserError ? error.message : 'A Discord or database request failed; check service logs.'}\nCreated so far: ${created.filter((c) => c.kind === 'Role').length} roles, ${created.filter((c) => c.kind === 'Category').length} categories, ${created.filter((c) => c.kind === 'Channel').length} channels. Updated so far: ${updated.filter((c) => c.kind === 'Category').length} categories and ${updated.filter((c) => c.kind === 'Channel').length} channels. No existing resources were deleted. Rerun /setup after resolving the issue.`,
      embeds: [],
    });
  }
}
