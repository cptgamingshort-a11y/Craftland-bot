import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ChannelSelectMenuInteraction,
  type RoleSelectMenuInteraction,
  type ModalSubmitInteraction,
  type Guild,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
import { db } from '../../database/client.js';
import { settings, saveSettings } from '../../services/configuration.js';
import { type Settings } from '../../config/settings.js';
import { UserError } from '../../utils/errors.js';
import { automaticSetup } from '../../services/serverSetup.js';
import { auditNotification } from '../../services/audit.js';
type Session = {
  guildId: string;
  userId: string;
  step: number;
  expires: number;
  config: Settings;
  version: number;
  requirements?: { points: number; reviews: number; activeDays: number };
};
const sessions = new Map<string, Session>();
const steps = [
  'Welcome channel',
  'Announcement channel',
  'Leaderboard channel',
  'Review channel',
  'Log channel',
  'Games channel',
  'General chat channel',
  'Doubt-solving channel',
  'Member role',
  'Creator role',
  'Reviewer role',
  'Staff roles',
  'Point configuration',
  'Creator requirements',
  'Weekly leaderboard and daily announcement schedule',
];
const channelKeys = [
  'welcome',
  'announcement',
  'leaderboard',
  'review',
  'log',
  'games',
  'generalChat',
  'doubtSolving',
] as const;
const roleKeys = ['member', 'creator', 'reviewer'] as const;
type WizardInteraction =
  | ButtonInteraction
  | ChannelSelectMenuInteraction
  | RoleSelectMenuInteraction
  | ModalSubmitInteraction;
export async function validateSettings(guild: Guild, config: Settings) {
  const bot = await guild.members.fetchMe();
  for (const id of Object.values(config.channels).filter(Boolean)) {
    const channel = await guild.channels.fetch(id);
    if (
      !channel ||
      !channel.isTextBased() ||
      !channel
        .permissionsFor(bot)
        ?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
        ])
    )
      throw new UserError(
        'A channel is missing or bot cannot view/send embeds there.',
      );
  }
  for (const id of [
    config.roles.member,
    config.roles.creator,
    config.roles.reviewer,
  ].filter(Boolean)) {
    const r = await guild.roles.fetch(id);
    if (
      !r ||
      r.managed ||
      r.id === guild.id ||
      r.permissions.has(PermissionFlagsBits.Administrator) ||
      r.position >= bot.roles.highest.position
    )
      throw new UserError(
        'Selected role is protected, managed, or above the bot.',
      );
  }
  if (
    config.roles.staff.some((id) =>
      [config.roles.member, config.roles.creator].includes(id),
    )
  )
    throw new UserError(
      'Member/Creator roles cannot also be configured as staff.',
    );
}
function view(key: string, s: Session) {
  const customId = `setup:${key}:select`;
  const content = `**Craftland India setup — ${s.step + 1}/15**\n${steps[s.step]}\nSelections stay private and are saved after the final step. Wizard expires in 15 minutes.`;
  if (s.step < 8)
    return {
      content,
      components: [
        new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder(steps[s.step]!)
            .setChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
            ),
        ),
      ],
    };
  if (s.step < 12)
    return {
      content,
      components: [
        new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
          new RoleSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder(steps[s.step]!)
            .setMinValues(1)
            .setMaxValues(s.step === 11 ? 10 : 1),
        ),
      ],
    };
  return {
    content,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`setup:${key}:edit`)
          .setLabel('Configure')
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}
export async function startSetup(i: ChatInputCommandInteraction) {
  if (!i.options.getBoolean('configure')) return automaticSetup(i);
  if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator))
    throw new UserError('Administrator required.');
  const config = await settings(i.guildId!);
  const row = await db.botConfiguration.findUniqueOrThrow({
    where: { guildId: i.guildId! },
  });
  for (const [key, s] of sessions)
    if (s.expires < Date.now()) sessions.delete(key);
  const key = randomUUID();
  const s: Session = {
    guildId: i.guildId!,
    userId: i.user.id,
    step: 0,
    expires: Date.now() + 900000,
    config,
    version: row.version,
  };
  sessions.set(key, s);
  await i.reply({ ...view(key, s), flags: MessageFlags.Ephemeral });
}
export async function setupInteraction(i: WizardInteraction) {
  const [, key, action] = i.customId.split(':');
  const s = sessions.get(key!);
  if (
    !s ||
    s.expires < Date.now() ||
    s.guildId !== i.guildId ||
    s.userId !== i.user.id ||
    !i.memberPermissions?.has(PermissionFlagsBits.Administrator)
  )
    throw new UserError(
      'Wizard expired or unauthorized. Run /setup configure:true again.',
    );
  if (action === 'edit' && i.isButton()) {
    const m = new ModalBuilder()
      .setCustomId(`setup:${key}:modal:${s.step}`)
      .setTitle(steps[s.step]!);
    const fields =
      s.step === 12
        ? [['points', 'Points JSON', JSON.stringify(s.config.points)]]
        : s.step === 13
          ? [
              ['points', 'Minimum points', ''],
              ['reviews', 'Approved reviews', ''],
              ['days', 'Active contribution days', ''],
            ]
          : [
              [
                'day',
                'Weekday (1=Monday, 7=Sunday)',
                String(s.config.schedule.weeklyDay),
              ],
              [
                'hour',
                'Hour (Asia/Kolkata)',
                String(s.config.schedule.weeklyHour),
              ],
              ['minute', 'Minute', String(s.config.schedule.weeklyMinute)],
              [
                'announcement_hour',
                'Daily announcement hour (IST, 0–23)',
                String(s.config.schedule.dailyAnnouncementHour),
              ],
            ];
    for (const [id, label, value] of fields)
      m.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(id!)
            .setLabel(label!)
            .setStyle(
              s.step === 12 ? TextInputStyle.Paragraph : TextInputStyle.Short,
            )
            .setValue(value!)
            .setRequired(true)
            .setMaxLength(s.step === 12 ? 1500 : 6),
        ),
      );
    await i.showModal(m);
    return;
  }
  if (i.isChannelSelectMenu() && s.step < 8)
    s.config.channels[channelKeys[s.step]!] = i.values[0]!;
  else if (i.isRoleSelectMenu() && s.step >= 8 && s.step < 12) {
    if (s.step === 11) s.config.roles.staff = i.values;
    else s.config.roles[roleKeys[s.step - 8]!] = i.values[0]!;
  } else if (i.isModalSubmit() && Number(i.customId.split(':')[3]) === s.step) {
    if (s.step === 12) {
      try {
        s.config.points = JSON.parse(i.fields.getTextInputValue('points'));
      } catch {
        throw new UserError(
          'Enter a valid JSON object of activity names and points.',
        );
      }
    } else if (s.step === 13) {
      const n = (id: string) => {
        const raw = i.fields.getTextInputValue(id);
        const v = Number(raw);
        if (
          !/^\d+$/.test(raw) ||
          !Number.isSafeInteger(v) ||
          v < 0 ||
          v > 100000
        )
          throw new UserError(
            'Requirements must be integers from 0 to 100000.',
          );
        return v;
      };
      s.requirements = {
        points: n('points'),
        reviews: n('reviews'),
        activeDays: n('days'),
      };
    } else if (s.step === 14) {
      const int = (id: string, min: number, max: number) => {
        const raw = i.fields.getTextInputValue(id);
        const value = Number(raw);
        if (
          !/^\d+$/.test(raw) ||
          !Number.isSafeInteger(value) ||
          value < min ||
          value > max
        )
          throw new UserError(`Enter a whole number from ${min} to ${max}.`);
        return value;
      };
      s.config.schedule.weeklyDay = int('day', 1, 7);
      s.config.schedule.weeklyHour = int('hour', 0, 23);
      s.config.schedule.weeklyMinute = int('minute', 0, 59);
      s.config.schedule.dailyAnnouncementHour = int('announcement_hour', 0, 23);
    } else throw new UserError('Unexpected setup step.');
  } else throw new UserError('Stale setup component.');
  if (s.step === 14) {
    await i.deferUpdate();
    s.config.welcomeEnabled = true;
    s.config.autoMemberRole = true;
    await validateSettings(i.guild!, s.config);
    const creator = await i.guild!.roles.fetch(s.config.roles.creator);
    const actor = await i.guild!.members.fetch(i.user.id);
    const bot = await i.guild!.members.fetchMe();
    if (!creator) throw new UserError('Creator role is missing.');
    // Validate role against the actor without using the administrator as a target.
    if (
      creator.permissions.has(
        [
          PermissionFlagsBits.ManageGuild,
          PermissionFlagsBits.ManageRoles,
          PermissionFlagsBits.ModerateMembers,
          PermissionFlagsBits.KickMembers,
          PermissionFlagsBits.BanMembers,
        ],
        false,
      )
    )
      throw new UserError('Creator must be a normal contribution role.');
    if (
      actor.id !== i.guild!.ownerId &&
      actor.roles.highest.position <= creator.position
    )
      throw new UserError(
        'Creator role must be below the configuring administrator.',
      );
    if (bot.roles.highest.position <= creator.position)
      throw new UserError('Creator role must be below the bot.');
    await saveSettings(s.guildId, s.userId, s.config, s.version, async (tx) => {
      const r = await tx.roleConfiguration.upsert({
        where: { guildId_roleId: { guildId: s.guildId, roleId: creator.id } },
        create: {
          guildId: s.guildId,
          roleId: creator.id,
          name: creator.name,
          autoAssign: true,
        },
        update: { name: creator.name, autoAssign: true, protected: false },
      });
      await tx.roleRequirement.upsert({
        where: { roleConfigurationId: r.id },
        create: {
          roleConfigurationId: r.id,
          minimumPoints: s.requirements!.points,
          minimumApprovedReviews: s.requirements!.reviews,
          minimumActiveDays: s.requirements!.activeDays,
        },
        update: {
          minimumPoints: s.requirements!.points,
          minimumApprovedReviews: s.requirements!.reviews,
          minimumActiveDays: s.requirements!.activeDays,
        },
      });
      for (const roleId of s.config.roles.staff)
        await tx.roleConfiguration.upsert({
          where: { guildId_roleId: { guildId: s.guildId, roleId } },
          create: {
            guildId: s.guildId,
            roleId,
            name: 'Staff',
            protected: true,
          },
          update: { protected: true, autoAssign: false, autoRemove: false },
        });
    });
    await auditNotification(i.client, s.guildId, 'CONFIGURATION_CHANGED', s.userId, undefined, {
      channels: s.config.channels,
      roles: s.config.roles,
      schedule: s.config.schedule,
      points: s.config.points,
      creatorRequirements: s.requirements,
    });
    sessions.delete(key!);
    await i.editReply({
      content:
        '✅ Craftland India configuration saved. Welcome and verified Creator eligibility are enabled. Use /role requirements and the dashboard for further settings.',
      components: [],
    });
    return;
  }
  s.step++;
  if (i.isModalSubmit()) {
    await i.deferUpdate();
    await i.editReply(view(key!, s));
  } else await i.update(view(key!, s));
}
