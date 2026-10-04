// Local unauthenticated dashboard preview. OAuth requires real application credentials.
import { Client, GatewayIntentBits } from 'discord.js';
import { startDashboard } from '../src/services/dashboard.js';
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const stop = startDashboard(client);
process.once('SIGINT', () => {
  stop();
  client.destroy();
});
