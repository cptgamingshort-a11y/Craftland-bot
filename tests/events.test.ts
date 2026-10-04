import { describe, it, expect, vi } from 'vitest';
import { Client, Events, GatewayIntentBits, MessageFlags, type Interaction } from 'discord.js';
import { interactionHandler, registerEvents } from '../src/bot/events/index.js';
import { env } from '../src/config/env.js';
describe('Discord wiring', () => {
  it('registers join, message, interaction and error handlers without a login', () => {
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    registerEvents(client);
    for (const event of [
      Events.GuildMemberAdd,
      Events.MessageCreate,
      Events.InteractionCreate,
      Events.Error,
      Events.Warn,
    ])
      expect(client.listenerCount(event)).toBe(1);
    client.destroy();
  });
});

describe('Mines button responses', () => {
  function button(customId: string, userId = 'owner') {
    const click = {
      customId,
      guildId: env.DISCORD_GUILD_ID,
      user: { id: userId },
      deferred: false,
      replied: false,
      isRepliable: () => true,
      isButton: () => true,
      inGuild: () => true,
      deferUpdate: vi.fn(async () => { click.deferred = true; }),
      reply: vi.fn(async () => {}),
      editReply: vi.fn(async () => {}),
      followUp: vi.fn(async () => {}),
    };
    return click;
  }

  it('rejects another member privately without changing the board', async () => {
    const click = button('game:mines:tile:owner:game-id:1', 'visitor');
    await interactionHandler(click as unknown as Interaction);
    expect(click.deferUpdate).not.toHaveBeenCalled();
    expect(click.reply).toHaveBeenCalledWith(expect.objectContaining({
      flags: MessageFlags.Ephemeral,
      content: 'This mines board belongs to another member.',
    }));
    expect(click.editReply).not.toHaveBeenCalled();
  });

  it('keeps the board intact when a deferred click fails', async () => {
    const click = button('game:mines:tile:owner:game-id:bad');
    await interactionHandler(click as unknown as Interaction);
    expect(click.deferUpdate).toHaveBeenCalledOnce();
    expect(click.followUp).toHaveBeenCalledWith(expect.objectContaining({
      flags: MessageFlags.Ephemeral,
      content: 'That mines tile is invalid.',
    }));
    expect(click.editReply).not.toHaveBeenCalled();
  });
});
