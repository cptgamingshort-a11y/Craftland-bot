import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  type SlashCommandSubcommandBuilder,
} from 'discord.js';
type Sub = SlashCommandSubcommandBuilder;
const text = (s: Sub, name: string, required = true) =>
  s.addStringOption((o) =>
    o
      .setName(name)
      .setDescription(name.replaceAll('_', ' '))
      .setRequired(required)
      .setMaxLength(name === 'description' || name === 'question' ? 1500 : 500),
  );
const user = (s: Sub, required = true) =>
  s.addUserOption((o) =>
    o.setName('user').setDescription('Member').setRequired(required),
  );
const role = (s: Sub) =>
  s.addRoleOption((o) =>
    o.setName('role').setDescription('Role').setRequired(true),
  );
const num = (s: Sub, name: string, min = 0, max = 100000, required = true) =>
  s.addIntegerOption((o) =>
    o
      .setName(name)
      .setDescription(name.replaceAll('_', ' '))
      .setMinValue(min)
      .setMaxValue(max)
      .setRequired(required),
  );
const sub = (
  b: SlashCommandBuilder,
  name: string,
  fn: (s: Sub) => Sub = (s) => s,
) =>
  b.addSubcommand((s) =>
    fn(s.setName(name).setDescription(name.replaceAll('_', ' '))),
  );
const command = (name: string, description: string) =>
  new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDMPermission(false);
const setup = command('setup', 'Owner-only safe automatic server setup')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addBooleanOption((o) =>
    o
      .setName('configure')
      .setDescription('Open the administrator configuration wizard instead'),
  );
const welcome = command('welcome', 'Welcome settings');
sub(welcome, 'setup', (s) =>
  s
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Welcome channel').setRequired(true),
    )
    .addRoleOption((o) =>
      o
        .setName('member_role')
        .setDescription('Optional auto-assigned Member role'),
    ),
);
sub(welcome, 'test');
sub(welcome, 'disable');
const roles = command('role', 'Protected roles and contribution eligibility');
for (const name of ['give', 'remove'])
  sub(roles, name, (s) => text(role(user(s)), 'reason'));
sub(roles, 'info', role);
sub(roles, 'setup', (s) =>
  role(s)
    .addBooleanOption((o) =>
      o
        .setName('automatic')
        .setDescription('Enable automatic verified assignment')
        .setRequired(true),
    )
    .addBooleanOption((o) =>
      o
        .setName('protected')
        .setDescription('Protect staff roles from automation'),
    )
    .addBooleanOption((o) =>
      o
        .setName('auto_remove')
        .setDescription('Explicitly enable maintenance removal'),
    )
    .addIntegerOption((o) =>
      o
        .setName('maintenance_days')
        .setDescription('Maintenance window')
        .setMinValue(1)
        .setMaxValue(365),
    ),
);
roles.addSubcommandGroup((g) =>
  g
    .setName('requirements')
    .setDescription('Configure factual role rules')
    .addSubcommand((s) =>
      num(
        num(
          num(
            role(s.setName('set').setDescription('Set requirements')),
            'points',
          ),
          'reviews',
        ),
        'active_days',
        0,
        36500,
      )
        .addNumberOption((o) =>
          o
            .setName('quality')
            .setDescription('Optional minimum quality 0–100')
            .setMinValue(0)
            .setMaxValue(100),
        )
        .addIntegerOption((o) =>
          o
            .setName('maintenance_points')
            .setDescription('Points required in maintenance window')
            .setMinValue(0)
            .setMaxValue(100000),
        ),
    )
    .addSubcommand((s) =>
      role(s.setName('view').setDescription('View requirements')),
    ),
);
sub(roles, 'eligibility', (s) => user(s));
sub(roles, 'scan');
const review = command('review', 'Submit and evaluate map reviews');
sub(review, 'submit');
sub(review, 'approve', (s) =>
  text(s, 'id')
    .addNumberOption((o) =>
      o
        .setName('quality')
        .setDescription('Quality 0–100')
        .setMinValue(0)
        .setMaxValue(100),
    )
    .addStringOption((o) =>
      o.setName('reason').setDescription('Approval notes').setMaxLength(500),
    ),
);
sub(review, 'reject', (s) => text(text(s, 'id'), 'reason'));
sub(review, 'history', (s) => user(s, false));
sub(review, 'stats', (s) => user(s, false));
const points = command('points', 'Member points and history');
sub(points, 'balance', (s) => user(s, false));
for (const n of ['add', 'remove'])
  sub(points, n, (s) => text(num(user(s), 'amount', 1), 'reason'));
sub(points, 'history', (s) => user(s, false));
sub(points, 'leaderboard');
const lb = command('leaderboard', 'Community leaderboards');
for (const n of ['weekly', 'monthly', 'history']) sub(lb, n);
sub(lb, 'xp');
const member = command('member', 'Verified member profile').addUserOption((o) =>
  o.setName('user').setDescription('Member').setRequired(true),
);
const ai = command('ai', 'Staff AI assistant using database facts');
sub(ai, 'analyze', (s) => user(s));
sub(ai, 'summary');
sub(ai, 'test');
sub(ai, 'ask', (s) => text(s, 'question'));
const warn = command('warn', 'Warn a member')
  .addUserOption((o) =>
    o.setName('user').setDescription('Member').setRequired(true),
  )
  .addStringOption((o) =>
    o
      .setName('reason')
      .setDescription('Reason')
      .setRequired(true)
      .setMaxLength(500),
  );
const warnings = command('warnings', 'View warnings').addUserOption((o) =>
  o.setName('user').setDescription('Member').setRequired(true),
);
const timeout = command('timeout', 'Timeout a member')
  .addUserOption((o) =>
    o.setName('user').setDescription('Member').setRequired(true),
  )
  .addIntegerOption((o) =>
    o
      .setName('minutes')
      .setDescription('Timeout minutes')
      .setMinValue(1)
      .setMaxValue(40320)
      .setRequired(true),
  )
  .addStringOption((o) =>
    o
      .setName('reason')
      .setDescription('Reason')
      .setRequired(true)
      .setMaxLength(500),
  );
const clear = command('clear', 'Clear recent messages').addIntegerOption((o) =>
  o
    .setName('count')
    .setDescription('Messages, max 100; younger than 14 days')
    .setMinValue(1)
    .setMaxValue(100)
    .setRequired(true),
);
const report = command('report', 'Report users, maps, messages or issues');
sub(report, 'user', (s) => text(user(s), 'description'));
sub(report, 'map', (s) => text(text(s, 'map_code'), 'description'));
sub(report, 'issue', (s) => text(text(s, 'target'), 'description'));
for (const n of ['view', 'claim']) sub(report, n, (s) => text(s, 'id'));
for (const n of ['resolve', 'reject'])
  sub(report, n, (s) => text(text(s, 'id'), 'reason'));
const reports = command('reports', 'List reports for staff');
const rules = command(
  'rules',
  'Publish current Craftland India community rules',
).setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
sub(rules, 'publish');
const activity = command(
  'activity',
  'Verified community tasks and contributions',
);
sub(activity, 'submit', (s) => text(text(s, 'type'), 'description'));
sub(activity, 'approve', (s) => text(s, 'id'));
sub(activity, 'reject', (s) => text(text(s, 'id'), 'reason'));
sub(activity, 'history', (s) => user(s, false));
const game = command('game', 'Craftland coins, hunts, companions and arena');
sub(game, 'profile', (s) => user(s, false));
for (const name of ['help', 'daily', 'hunt', 'battle', 'shop', 'open', 'leaderboard', 'balance', 'zoo', 'team'])
  sub(game, name);
sub(game, 'animal', (s) => s.addStringOption((o) => o
  .setName('name').setDescription('Companion to inspect').setRequired(true)
  .addChoices(...['Fox', 'Wolf', 'Panda', 'Tiger', 'Phoenix', 'Dragon'].map((name) => ({ name, value: name })))));
sub(game, 'team-set', (s) => s
  .addIntegerOption((o) => o.setName('slot').setDescription('Team slot 1 to 3').setMinValue(1).setMaxValue(3).setRequired(true))
  .addStringOption((o) => o.setName('animal').setDescription('Owned companion').setRequired(true)
    .addChoices(...['Fox', 'Wolf', 'Panda', 'Tiger', 'Phoenix', 'Dragon'].map((name) => ({ name, value: name })))));
sub(game, 'give', (s) => s
  .addUserOption((o) => o.setName('user').setDescription('Member to receive coins').setRequired(true))
  .addIntegerOption((o) => o.setName('amount').setDescription('Craft Coins').setMinValue(1).setMaxValue(100000).setRequired(true)));
sub(game, 'sell', (s) => s.addStringOption((o) => o
  .setName('animal').setDescription('Companion from your zoo').setRequired(true)
  .addChoices(...['Fox', 'Wolf', 'Panda', 'Tiger', 'Phoenix', 'Dragon'].map((name) => ({ name, value: name })))));
for (const name of ['slots', 'blackjack'])
  sub(game, name, (s) => s.addIntegerOption((o) => o
    .setName('bet').setDescription('Craft Coins to bet').setMinValue(1).setMaxValue(100000).setRequired(true)));
sub(game, 'highlow', (s) => s
  .addIntegerOption((o) => o.setName('bet').setDescription('Craft Coins to bet').setMinValue(1).setMaxValue(100000).setRequired(true))
  .addStringOption((o) => o.setName('guess').setDescription('Next card goes high or low')
    .setRequired(true).addChoices({ name: 'High', value: 'high' }, { name: 'Low', value: 'low' })));
sub(game, 'buy', (s) =>
  s.addStringOption((o) =>
    o
      .setName('item')
      .setDescription('Item from the Craftland game shop')
      .setRequired(true)
      .addChoices(
        { name: 'Hunt Ticket • 80 coins', value: 'hunt_ticket' },
        { name: 'Lucky Charm • 180 coins', value: 'lucky_charm' },
        { name: 'Map Crate • 260 coins', value: 'map_crate' },
        { name: 'Builder Badge • 500 coins', value: 'builder_badge' },
      ),
  ),
);
export const commands = [
  setup,
  welcome,
  roles,
  review,
  points,
  lb,
  member,
  ai,
  warn,
  warnings,
  timeout,
  clear,
  report,
  reports,
  rules,
  activity,
  game,
  command('level', 'Your XP, level, progress and rank')
    .addUserOption((o) =>
      o.setName('user').setDescription('Member (default: you)'),
    )
    .addIntegerOption((o) =>
      o
        .setName('set')
        .setDescription(
          'Staff only: set an exact level for the selected member',
        )
        .setMinValue(0)
        .setMaxValue(10000),
    ),
  (() => {
    const b = command('xp', 'Staff XP administration');
    for (const name of ['add', 'remove'])
      sub(b, name, (s) => text(num(user(s), 'amount', 1, 1000000), 'reason'));
    sub(b, 'reset', (s) => text(user(s), 'reason'));
    sub(b, 'stats', (s) => user(s));
    return b;
  })(),
  (() => {
    const b = command(
      'level-role',
      'Strict administrator-configured level-role progression',
    ).setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
    sub(b, 'set', (s) => role(num(s, 'level', 1, 10000)));
    sub(b, 'remove', (s) => num(s, 'level', 1, 10000));
    sub(b, 'list');
    sub(b, 'sync');
    sub(b, 'sync-user', (s) => user(s));
    return b;
  })(),
  command(
    'level-config',
    'Administrator XP and level configuration',
  ).setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];
