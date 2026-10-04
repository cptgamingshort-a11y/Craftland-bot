import { REST, Routes } from 'discord.js';
import { env, requireBotEnv } from '../config/env.js';
import { commands } from './commands/definitions.js';
import { logError } from '../utils/errors.js';
async function main() {
  requireBotEnv();
  const definitions = commands.map((c) => c.toJSON());
  const result = await new REST({ version: '10' })
    .setToken(env.DISCORD_TOKEN)
    .put(Routes.applicationGuildCommands(env.CLIENT_ID, env.DISCORD_GUILD_ID), {
      body: definitions,
    });
  console.log(
    `Registered ${Array.isArray(result) ? result.length : definitions.length} guild slash commands.`,
  );
}
main().catch((e) => {
  logError('registration', e);
  process.exitCode = 1;
});
