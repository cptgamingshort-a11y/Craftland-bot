import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  OverwriteType,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type Client,
  type GuildMember,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
  type UserSelectMenuInteraction,
  type VoiceChannel,
  type VoiceState,
} from 'discord.js';
import { UserError } from '../utils/errors.js';

const SOURCE_CHANNEL_SUFFIX = 'create-a-voice-channel';
const TEMP_CATEGORY_SUFFIX = 'temp voice';
type VoiceInteraction = ButtonInteraction | UserSelectMenuInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

function panelEmbed(ownerId: string, name: string, region: string | null, locked: boolean, waiting: boolean, chatDisabled: boolean) {
  return new EmbedBuilder()
    .setColor(0xe83e65)
    .setTitle('TempVoice Interface')
    .setDescription(
      `Manage **${name}** from this voice channel’s chat.\n` +
      `Owner: <@${ownerId}>\n` +
      `Privacy: **${locked ? 'Private' : 'Public'}**  •  Waiting room: **${waiting ? 'On' : 'Off'}**  •  Chat: **${chatDisabled ? 'Off' : 'On'}**\n` +
      `Region: **${region ?? 'Automatic'}**\n\n` +
      'Use the buttons below to change the room, manage access, or close it.',
    )
    .setFooter({ text: 'Craftland India • Temporary Voice' });
}

function panelRows(voiceId: string, ownerId: string, locked: boolean, waiting: boolean, chatDisabled: boolean) {
  const suffix = `${voiceId}:${ownerId}`;
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`tv:name:${suffix}`).setLabel('Name').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`tv:limit:${suffix}`).setLabel('Limit').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`tv:privacy:${suffix}`).setLabel(locked ? 'Unlock' : 'Privacy').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`tv:waiting:${suffix}`).setLabel(waiting ? 'Waiting: On' : 'Waiting Room').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`tv:chat:${suffix}`).setLabel(chatDisabled ? 'Chat: Off' : 'Chat').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`tv:trust:${suffix}`).setLabel('Trust').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`tv:untrust:${suffix}`).setLabel('Untrust').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`tv:invite:${suffix}`).setLabel('Invite').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`tv:kick:${suffix}`).setLabel('Kick').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`tv:region:${suffix}`).setLabel('Region').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`tv:block:${suffix}`).setLabel('Block').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`tv:unblock:${suffix}`).setLabel('Unblock').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`tv:claim:${suffix}`).setLabel('Claim').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`tv:transfer:${suffix}`).setLabel('Transfer').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`tv:delete:${suffix}`).setLabel('Delete').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function isStaff(member: GuildMember) {
  return member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageChannels) ||
    member.roles.cache.some((role) =>
      ['staff', 'moderator', 'senior reviewer'].includes(role.name.toLowerCase()),
    );
}

async function ownedContext(i: VoiceInteraction, voiceId: string, ownerId: string) {
  const guild = i.guild;
  if (!guild || i.channel?.type !== ChannelType.GuildVoice || i.channelId !== voiceId)
    throw new UserError('Use these controls in the temporary voice channel’s built-in chat.');
  const actor = await guild.members.fetch(i.user.id);
  const ownerOverwrite = i.channel.permissionOverwrites.cache.find(
    (overwrite) => overwrite.type === OverwriteType.Member && overwrite.allow.has(PermissionFlagsBits.ManageChannels),
  );
  if (!ownerOverwrite) throw new UserError('This room has no current owner. Use Claim from inside the voice room.');
  if (ownerOverwrite.id !== ownerId)
    throw new UserError('Room ownership changed. Use the updated control panel.');
  if (ownerId !== actor.id && !isStaff(actor))
    throw new UserError('Only this room’s owner or server staff can use these controls.');
  const voice = i.channel as VoiceChannel;
  const everyoneOverwrite = voice.permissionOverwrites.cache.get(guild.id);
  const locked = everyoneOverwrite?.deny.has(PermissionFlagsBits.ViewChannel) ?? false;
  const waiting = !locked && (everyoneOverwrite?.deny.has(PermissionFlagsBits.Connect) ?? false);
  const chatDisabled = everyoneOverwrite?.deny.has(PermissionFlagsBits.SendMessages) ?? false;
  return { guild, voice, ownerId, locked, waiting, chatDisabled, actor };
}

async function updatePanel(voice: VoiceChannel, ownerId: string) {
  const guildId = voice.guild.id;
  const everyone = voice.permissionOverwrites.cache.get(guildId);
  const locked = everyone?.deny.has(PermissionFlagsBits.ViewChannel) ?? false;
  const waiting = !locked && (everyone?.deny.has(PermissionFlagsBits.Connect) ?? false);
  const chatDisabled = everyone?.deny.has(PermissionFlagsBits.SendMessages) ?? false;
  const recent = await voice.messages.fetch({ limit: 20 });
  const panel = recent.find((message) => message.author.id === message.client.user.id && message.components.length > 0 && message.embeds[0]?.title === 'TempVoice Interface');
  if (panel)
    await panel.edit({
      embeds: [panelEmbed(ownerId, voice.name, voice.rtcRegion, locked, waiting, chatDisabled)],
      components: panelRows(voice.id, ownerId, locked, waiting, chatDisabled),
      allowedMentions: { parse: [] },
    });
}

export async function onVoiceChannelChanged(client: Client, before: VoiceState, after: VoiceState) {
  if (after.guild.id !== process.env.DISCORD_GUILD_ID || after.member?.user.bot) return;
  const guild = after.guild;
  if (
    after.channelId && before.channelId !== after.channelId &&
    after.channel?.name.toLowerCase().endsWith(SOURCE_CHANNEL_SUFFIX)
  ) {
    const categories = guild.channels.cache.filter(
      (channel) => channel.type === ChannelType.GuildCategory && channel.name.toLowerCase().endsWith(TEMP_CATEGORY_SUFFIX),
    );
    if (categories.size !== 1) throw new Error(`Expected one Temp Voice category, found ${categories.size}.`);
    const category = categories.first();
    if (!category || category.type !== ChannelType.GuildCategory)
      throw new Error('Temp Voice category is not a category channel.');
    const member = after.member!;
    const display = member.displayName.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 48) || 'Member';
    const voice = await guild.channels.create({
      name: `🔊・${display}`.slice(0, 100),
      type: ChannelType.GuildVoice,
      parent: category,
      reason: `Temporary voice created for ${member.user.tag}`,
    });
    await voice.permissionOverwrites.edit(guild.id, {
      ViewChannel: true,
      Connect: true,
      SendMessages: true,
      ReadMessageHistory: true,
    });
    await voice.permissionOverwrites.edit(member.id, {
      ViewChannel: true,
      Connect: true,
      Speak: true,
      SendMessages: true,
      ReadMessageHistory: true,
      ManageChannels: true,
    });
    await voice.send({
      embeds: [panelEmbed(member.id, voice.name, voice.rtcRegion, false, false, false)],
      components: panelRows(voice.id, member.id, false, false, false),
      allowedMentions: { parse: [] },
    });
    await member.voice.setChannel(voice, 'Move member into their new temporary voice channel');
  }

  const departed = before.channel;
  if (
    departed && departed.id !== after.channelId &&
    departed.parent?.name.toLowerCase().endsWith(TEMP_CATEGORY_SUFFIX) &&
    departed.type === ChannelType.GuildVoice && departed.members.size === 0
  )
    await departed.delete('Temporary voice channel became empty');
}

export async function handleTempVoiceInteraction(i: VoiceInteraction) {
  const [namespace, action, voiceId, ownerId] = i.customId.split(':');
  if (namespace !== 'tv' || !action || !voiceId || !ownerId)
    throw new UserError('Unknown temporary voice action.');

  if (action === 'claim') {
    if (!i.guild || i.channel?.type !== ChannelType.GuildVoice || i.channelId !== voiceId)
      throw new UserError('Claim from inside the temporary voice channel.');
    const voice = i.channel as VoiceChannel;
    const actor = await i.guild.members.fetch(i.user.id);
    if (actor.voice.channelId !== voice.id)
      throw new UserError('Join this voice room before claiming it.');
    const currentOwner = voice.permissionOverwrites.cache.find(
      (overwrite) => overwrite.type === OverwriteType.Member && overwrite.allow.has(PermissionFlagsBits.ManageChannels),
    );
    if (!currentOwner || voice.members.has(currentOwner.id))
      throw new UserError('The room can be claimed only after its owner leaves the voice room.');
    await voice.permissionOverwrites.delete(currentOwner.id);
    await voice.permissionOverwrites.edit(actor.id, {
      ViewChannel: true, Connect: true, Speak: true, SendMessages: true,
      ReadMessageHistory: true, ManageChannels: true,
    });
    await updatePanel(voice, actor.id);
    await i.reply({ content: 'This temporary room is now yours.', flags: MessageFlags.Ephemeral });
    return;
  }

  const { guild, voice, locked, waiting, chatDisabled } = await ownedContext(i, voiceId, ownerId);

  if (i.isModalSubmit()) {
    if (action === 'limit') {
      const value = Number(i.fields.getTextInputValue('limit'));
      if (!Number.isInteger(value) || value < 0 || value > 99)
        throw new UserError('Limit 0 se 99 ke beech hona chahiye. 0 ka matlab unlimited.');
      await voice.setUserLimit(value);
      await i.reply({ content: value === 0 ? 'User limit removed.' : `User limit **${value}** set.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (action === 'name') {
      const name = i.fields.getTextInputValue('name').trim().replace(/@everyone|@here/gi, '').slice(0, 100);
      if (!name) throw new UserError('Enter a voice channel name.');
      await voice.setName(name, 'Temporary voice renamed by its owner');
      await updatePanel(voice, ownerId);
      await i.reply({ content: `Room renamed to **${name}**.`, flags: MessageFlags.Ephemeral });
      return;
    }
    throw new UserError('Unknown temporary voice action.');
  }

  if (i.isStringSelectMenu()) {
    if (action !== 'region-pick') throw new UserError('Unknown temporary voice action.');
    const region = i.values[0];
    const allowed = ['automatic', 'brazil', 'hongkong', 'india', 'japan', 'rotterdam', 'singapore', 'southafrica', 'sydney', 'us-central', 'us-east', 'us-south', 'us-west'];
    if (!region || !allowed.includes(region)) throw new UserError('Choose a listed voice region.');
    await voice.setRTCRegion(region === 'automatic' ? null : region, 'Temporary voice region changed');
    await updatePanel(voice, ownerId);
    await i.reply({ content: `Voice region set to **${region === 'automatic' ? 'Automatic' : region}**.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (i.isUserSelectMenu()) {
    const selected = i.users.first();
    if (!selected || selected.bot) throw new UserError('Choose a server member.');
    const target = await guild.members.fetch(selected.id);
    if (['trust-pick', 'invite-pick'].includes(action)) {
      if (target.id === ownerId) throw new UserError('The room owner already has access.');
      await voice.permissionOverwrites.edit(target.id, {
        ViewChannel: true, Connect: true,
        ...(action === 'trust-pick' ? { Speak: true, SendMessages: true, ReadMessageHistory: true } : {}),
      });
      await i.reply({ content: `${target} can now ${action === 'trust-pick' ? 'join and use room chat' : 'join the room'}.`, flags: MessageFlags.Ephemeral, allowedMentions: { users: [target.id] } });
      return;
    }
    if (action === 'kick-pick') {
      if (target.voice.channelId !== voice.id) throw new UserError('That member is not in this voice room.');
      await target.voice.setChannel(null, 'Removed by temporary voice owner');
      await i.reply({ content: `${target.displayName} was removed from the voice room.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (action === 'block-pick') {
      if (target.id === ownerId) throw new UserError('You cannot block the room owner.');
      await voice.permissionOverwrites.edit(target.id, { ViewChannel: false, Connect: false, SendMessages: false, ReadMessageHistory: false });
      if (target.voice.channelId === voice.id) await target.voice.setChannel(null, 'Blocked from temporary voice room');
      await i.reply({ content: `${target.displayName} is blocked from this room.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (action === 'unblock-pick' || action === 'untrust-pick') {
      if (target.id === ownerId) throw new UserError('You cannot remove the owner’s room access.');
      await voice.permissionOverwrites.edit(target.id, {
        ViewChannel: null, Connect: null,
        ...(action === 'untrust-pick' ? { Speak: null, SendMessages: null, ReadMessageHistory: null } : {}),
      });
      await i.reply({ content: `${target.displayName}’s ${action === 'untrust-pick' ? 'trusted access was removed' : 'block was removed'}.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (action === 'transfer-pick') {
      if (target.voice.channelId !== voice.id) throw new UserError('Transfer ownership to someone currently in this voice room.');
      await voice.permissionOverwrites.delete(ownerId).catch(() => undefined);
      await voice.permissionOverwrites.edit(target.id, {
        ViewChannel: true, Connect: true, Speak: true, SendMessages: true,
        ReadMessageHistory: true, ManageChannels: true,
      });
      await updatePanel(voice, target.id);
      await i.reply({ content: `Room ownership transferred to ${target}.`, flags: MessageFlags.Ephemeral, allowedMentions: { users: [target.id] } });
      return;
    }
    throw new UserError('Unknown temporary voice action.');
  }

  if (action === 'limit' || action === 'name') {
    const input = action === 'limit'
      ? new TextInputBuilder().setCustomId('limit').setLabel('Users (0 = unlimited)').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(2).setValue(String(voice.userLimit))
      : new TextInputBuilder().setCustomId('name').setLabel('Channel name').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(100).setValue(voice.name);
    await i.showModal(new ModalBuilder()
      .setCustomId(`tv:${action}:${voiceId}:${ownerId}`)
      .setTitle(action === 'limit' ? 'Set voice user limit' : 'Rename voice channel')
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)));
    return;
  }

  if (action === 'privacy') {
    const next = !locked;
    await voice.permissionOverwrites.edit(guild.id, {
      ViewChannel: next ? false : true,
      Connect: next ? false : true,
      SendMessages: next || chatDisabled ? false : true,
      ReadMessageHistory: next ? false : true,
    });
    await voice.permissionOverwrites.edit(ownerId, {
      ViewChannel: true, Connect: true, Speak: true, SendMessages: true,
      ReadMessageHistory: true, ManageChannels: true,
    });
    await updatePanel(voice, ownerId);
    await i.reply({ content: next ? 'Room is private. Use Invite or Trust to add members.' : 'Room is open to server members.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (action === 'waiting') {
    const next = !waiting;
    await voice.permissionOverwrites.edit(guild.id, { Connect: next ? false : true });
    await voice.permissionOverwrites.edit(ownerId, { ViewChannel: true, Connect: true, Speak: true, SendMessages: true, ReadMessageHistory: true, ManageChannels: true });
    await updatePanel(voice, ownerId);
    await i.reply({ content: next ? 'Waiting room is on: new members cannot join yet.' : 'Waiting room is off.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (action === 'chat') {
    const next = !chatDisabled;
    await voice.permissionOverwrites.edit(guild.id, { SendMessages: next ? false : true });
    await voice.permissionOverwrites.edit(ownerId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, ManageChannels: true });
    await updatePanel(voice, ownerId);
    await i.reply({ content: next ? 'Room chat is now owner/staff only.' : 'Room chat is open to members who can view the room.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (action === 'region') {
    const regions = [
      ['automatic', 'Automatic'], ['brazil', 'Brazil'], ['hongkong', 'Hong Kong'], ['india', 'India'],
      ['japan', 'Japan'], ['rotterdam', 'Rotterdam'], ['singapore', 'Singapore'], ['southafrica', 'South Africa'],
      ['sydney', 'Sydney'], ['us-central', 'US Central'], ['us-east', 'US East'], ['us-south', 'US South'], ['us-west', 'US West'],
    ];
    const select = new StringSelectMenuBuilder()
      .setCustomId(`tv:region-pick:${voiceId}:${ownerId}`)
      .setPlaceholder('Choose a voice region')
      .addOptions(regions.map(([value, label]) => ({ value: value!, label: label!, default: value === (voice.rtcRegion ?? 'automatic') })));
    await i.reply({ content: 'Choose a region for this voice room:', components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)], flags: MessageFlags.Ephemeral });
    return;
  }
  if (['trust', 'untrust', 'invite', 'kick', 'block', 'unblock', 'transfer'].includes(action)) {
    const select = new UserSelectMenuBuilder()
      .setCustomId(`tv:${action}-pick:${voiceId}:${ownerId}`)
      .setPlaceholder(action === 'transfer' ? 'Choose the new owner' : action === 'kick' ? 'Choose someone in this room' : `Choose a member to ${action}`)
      .setMinValues(1)
      .setMaxValues(1);
    await i.reply({ content: 'Choose one member:', components: [new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select)], flags: MessageFlags.Ephemeral });
    return;
  }
  if (action === 'delete') {
    const confirm = new ButtonBuilder().setCustomId(`tv:delete-confirm:${voiceId}:${ownerId}`).setLabel('Confirm delete').setStyle(ButtonStyle.Danger);
    await i.reply({ content: 'Delete this voice room?', components: [new ActionRowBuilder<ButtonBuilder>().addComponents(confirm)], flags: MessageFlags.Ephemeral });
    return;
  }
  if (action === 'delete-confirm') {
    await i.update({ content: 'Temporary room deleted.', components: [] });
    await voice.delete('Temporary voice room deleted by its owner');
    return;
  }
  throw new UserError('Unknown temporary voice action.');
}
