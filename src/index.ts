import { Client, Events, GatewayIntentBits } from 'discord.js';
import { env, requireBotEnv } from './config/env.js';
import { db } from './database/client.js';
import { registerEvents } from './bot/events/index.js';
import { startScheduler } from './services/scheduler.js';
import { startDashboard } from './services/dashboard.js';
import { logError } from './utils/errors.js';
import { settings } from './services/configuration.js';
import { queueMemberCountSync } from './services/memberCount.js';
import { primeGameProfiles } from './game/service.js';
import { syncNamedRolePermissions } from './services/rolePermissions.js';
import {
  validateFirebaseConfiguration,
  databaseHealthCheck,
  closeFirebase,
} from './database/firebase.js';
import { setTimeout as pause } from 'node:timers/promises';
import { createServer } from 'node:http';
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  allowedMentions: { parse: [] },
});
let stopJobs: (() => void) | undefined;
let closeWeb: (() => void) | undefined;
const cloudHealthServer =
  (process.env.K_SERVICE || process.env.RENDER) && !env.DASHBOARD_ENABLED
    ? createServer((_req, res) => {
        res.writeHead(client.isReady() ? 200 : 503, {
          'content-type': 'application/json',
        });
        res.end(JSON.stringify({ ready: client.isReady() }));
      }).listen(env.PORT, '0.0.0.0')
    : undefined;
registerEvents(client);
client.once(Events.ClientReady, () => {
  void (async () => {
    console.log(`Craftland India connected as ${client.user?.tag}`);
    try {
      const guild = await client.guilds.fetch(env.DISCORD_GUILD_ID);
      await syncNamedRolePermissions(guild);
    } catch (e) {
      logError('named-role-permission-sync', e);
    }
    queueMemberCountSync(client, true);
    stopJobs = startScheduler(client);
    if (env.DASHBOARD_ENABLED) closeWeb = startDashboard(client);
    await settings(env.DISCORD_GUILD_ID);
  })().catch((e) => logError('ready', e));
});
async function shutdown() {
  startupAbort.abort();
  stopJobs?.();
  closeWeb?.();
  cloudHealthServer?.close();
  client.destroy();
  await closeFirebase();
  process.exitCode = 0;
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
process.on('unhandledRejection', (e) => logError('unhandled-rejection', e));
const startupAbort = new AbortController();
async function warmDatabase() {
  await db.$connect();
  await databaseHealthCheck();
  try {
    const count = await primeGameProfiles(env.DISCORD_GUILD_ID);
    console.log(`Warmed ${count} game profiles.`);
  } catch (e) {
    logError('game-profile-warmup', e);
  }
  try {
    await settings(env.DISCORD_GUILD_ID);
  } catch (e) {
    logError('settings-warmup', e);
  }
}
async function retryDatabaseInBackground() {
  let delay = 15000;
  while (!startupAbort.signal.aborted) {
    try {
      await warmDatabase();
      console.log('Firestore recovered; full bot features are available.');
      return;
    } catch (e) {
      logError('database-background-retry', e);
      try {
        await pause(delay, undefined, { signal: startupAbort.signal });
      } catch {
        return;
      }
      delay = Math.min(delay * 2, 60000);
    }
  }
}
async function main() {
  requireBotEnv();
  validateFirebaseConfiguration();
  try {
    await warmDatabase();
  } catch (e) {
    logError('database-startup-degraded', e);
    void retryDatabaseInBackground();
  }
  if (!startupAbort.signal.aborted) await client.login(env.DISCORD_TOKEN);
}
await main().catch(async (e) => {
  if (startupAbort.signal.aborted) return;
  logError('login', e);
  client.destroy();
  cloudHealthServer?.close();
  await closeFirebase();
  process.exitCode = 1;
});
