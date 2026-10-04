import 'dotenv/config';

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
if (!token || !guildId) throw new Error('DISCORD_TOKEN and DISCORD_GUILD_ID are required.');

const apply = process.argv.includes('--apply');
const base = 'https://discord.com/api/v10';
const headers = {
  Authorization: `Bot ${token}`,
  'Content-Type': 'application/json',
  'X-Audit-Log-Reason': encodeURIComponent('Craftland India channel presentation refresh'),
};
async function request(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${result.message}`);
  return result;
}

const channels = await request('GET', `/guilds/${guildId}/channels`);
const updates = [
  ['𒀽〢welcome', { topic: 'Welcome to Craftland India! Start with #rules, then introduce yourself in #general-chat.' }],
  ['𒀽〢rules', { topic: 'Community rules and fair play. Please read before posting or sharing your work.' }],
  ['𒀽〢announcements', { topic: 'Official Craftland India updates, events and important notices.' }],
  ['𒀽〢general-chat', { topic: 'Meet other Craftland creators, share progress and talk about building maps.' }],
  ['𒀽〢doubt-solving', { topic: 'Ask Craftland editing and scripting questions. Include your goal, steps tried and screenshots when useful.' }],
  ['𒀽〢level', { topic: 'Level milestones and XP progress from the Craftland Team bot.' }],
  ['𒀽〢bot-commands', { topic: 'Use Craftland Team slash commands here. Use #games for game commands.' }],
  ['𒀽〢games', { topic: 'Craft Coins, hunt, battle and mini games. Keep game commands here.' }],
  ['𒀽〢map-share', { topic: 'Share your Craftland map with its code, genre, screenshots and a short description.' }],
  ['𒀽〢map-codes', { topic: 'Post playable map codes and tell members what to expect.' }],
  ['𒀽〢youtube-links', { topic: 'Share Craftland tutorials and creator videos with a short description.' }],
  ['map-reviews', { topic: 'Request constructive feedback on your map. Include the map code and the area you want reviewed.' }],
  ['leaderboard', { topic: 'Community XP and weekly leaderboard updates.' }],
  ['𒀽〢request-cover-img', { topic: 'Request cover art for your Craftland map. Include theme, title and reference details.' }],
];
for (const [name, desired] of updates) {
  const channel = channels.find((item) => item.name === name);
  if (!channel) {
    console.log(`SKIP missing: ${name}`);
    continue;
  }
  const changes = Object.fromEntries(Object.entries(desired).filter(([key, value]) => channel[key] !== value));
  if (!Object.keys(changes).length) continue;
  console.log(`${apply ? 'UPDATE' : 'PLAN'} ${name}: ${JSON.stringify(changes)}`);
  if (apply) await request('PATCH', `/channels/${channel.id}`, changes);
}

const community = channels.find((item) => item.name === '🍁〢COMMUNITY' && item.type === 4);
if (!community) throw new Error('Community category was not found.');
if (!channels.some((item) => /^(𒀽〢)?suggestions$/.test(item.name))) {
  const newChannel = {
    name: '𒀽〢suggestions',
    type: 0,
    parent_id: community.id,
    topic: 'Suggest improvements for the server, events and Craftland community. One idea per message; explain why it helps.',
    rate_limit_per_user: 30,
  };
  console.log(`${apply ? 'CREATE' : 'PLAN'} suggestions in COMMUNITY`);
  if (apply) await request('POST', `/guilds/${guildId}/channels`, newChannel);
}
console.log(apply ? 'Presentation sync complete.' : 'Dry run complete. Pass --apply to make changes.');
