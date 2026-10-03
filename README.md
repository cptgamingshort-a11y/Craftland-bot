# Craftland India Discord Management Bot

TypeScript, Discord.js, Gemini, and Firebase Admin with Cloud Firestore as the bot's persistent store. Records live below `guilds/{guildId}/...` so each Discord server has its own data. Firestore collections and documents are created automatically on first use; do not paste browser Firebase config or create SQL Connect tables.

## 1. Install

Use Node.js 24 LTS. In PowerShell from this folder:

```powershell
npm ci
Copy-Item .env.example .env
```

## 2. Create Firebase credentials

In Firebase Console, select project `craftland-4a761`, create the default Cloud Firestore database (Standard edition; select the region where the bot will run), and open **Project settings → Service accounts**. Generate a private key JSON file and save it as `serviceAccountKey.json` in this project root. Never upload or commit it. The file is in `.gitignore`.

The bot uses Firebase Admin SDK. It does not use the Web SDK, Analytics, or SQL Connect. For deployment, prefer a secret manager or workload identity over a downloaded key. If using a service account, grant it Firestore data access (`roles/datastore.user`) in Google Cloud IAM; avoid broad Editor access. Another supported option is `GOOGLE_APPLICATION_CREDENTIALS` pointing to a protected JSON file.

Configure the following in `.env`:

```dotenv
FIREBASE_PROJECT_ID=craftland-4a761
FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
```

Alternatively leave the service-account path blank and set `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY` as protected environment secrets (escape newlines as `\\n`). Do not use both methods. `npm start` performs a Firestore connectivity check before connecting Discord. No `DATABASE_URL` is needed.

## 3. Create and invite the Discord bot

In [Discord Developer Portal](https://discord.com/developers/applications), create an application, add a bot, and store its token privately as `DISCORD_TOKEN` in `.env`. Set `CLIENT_ID` to the Application ID and `DISCORD_GUILD_ID` to Craftland India's server ID. Do not paste secrets into chat or Discord. Enable **Server Members Intent** and **Message Content Intent** under the Bot settings.

Register slash commands and generate the invite URL:

```powershell
npm run register
npm run invite
```

Authorize the generated URL yourself for Craftland India. The invite asks for `bot` and `applications.commands` scopes and the minimum configured permissions: View Channels, Send Messages, Embed Links, Read Message History, Manage Roles, Manage Messages, and Moderate Members. Administrator is not requested. Put the bot role below trusted staff roles and above the community roles it must manage.

## 4. Gemini AI

Set `GEMINI_API_KEY` and, optionally, `GEMINI_MODEL` (default `gemini-flash-latest`) in `.env`. No key is needed to start non-AI features; AI replies safely fall back to verified database facts. `/ai test` checks Gemini without exposing credentials. Never send Firebase or Discord credentials to Gemini.

## 5. Run and configure the server

```powershell
npm run build
npm start
```

Or use `npm run dev` during development. After the bot is online and slash commands are registered, the **server owner** runs `/setup` to safely inspect and create missing roles, categories, and channels. Existing resources are reused; the command does not delete or modify existing roles/channels. `/setup configure:true` opens the settings wizard. Created resources and configuration changes are audited to Firestore.

The setup command needs Manage Roles, Manage Channels, View Channels, Send Messages, Embed Links, Read Message History, Manage Messages, and Moderate Members. It does not need Administrator. If a matching role is managed, Administrator, or at/above the bot's highest role, setup stops safely so the owner can resolve the hierarchy.

## Features and commands

- Professional Craftland India join welcome; optional configured Member role.
- Contribution points, approved/rejected map reviews, reports, warnings/timeouts, audit logging and scheduled weekly leaderboard (`Asia/Kolkata`).
- Message XP with cooldown, duplicate/spam checks, a configurable daily cap and progressive levels. XP remains separate from contribution points.
- A separate Craft Coins game in `#games`: daily rewards, cooldown-based hunts, collectible companions, a no-stake solo arena, shop items, Map Crates, coin flips, a persistent 3×3 Mines game and a coin leaderboard. Game balances do not change XP or contribution points.
- Welcome messages post in the existing configured welcome channel. XP level-up embeds post in the configured `#level` channel.
- Gemini posts one AI-assisted community prompt each day in the configured announcement channel at 11:00 Asia/Kolkata by default. Activity counts in the embed come from Firestore; the prompt contains no member statistics. Change the time in `/setup configure:true`.
- Channel AI replies are enabled for questions in the configured `#general-chat` and short questions in `#doubt-solving`. In `#games`, the bot replies to its recognized `g ...`, `game ...`, and `/game` commands only. Slash-like text and OwO commands do not trigger community AI. Only the triggering message is sent to Gemini, and AI replies cannot perform moderation or role actions.
- An administrator can publish the current privacy, fair-play, AI, and community rules with `/rules publish`; re-running it edits the bot's own current rules post.
- `/level`, `/xp`, `/level-config`, `/level-role set|remove|list|sync|sync-user`, and `/leaderboard xp|weekly`. Level roles are exact-level mappings; only registered progression roles are replaced when the member changes level.
- `/game` includes help, balance, daily, coin gifts, hunts, a counted companion zoo, companion details, a three-slot battle team, sales, shop, battles, crates, leaderboard, slots, blackjack, and high-low. Chat aliases include `g help`, `g cash`, `g give @member 50`, `g zoo`, `g zoo Fox`, `g team add Fox 1`, `g slots 10`, `g blackjack 10`, `g highlow 10 high`, `g cf 10`, `g mine 10`, plus `game ...`; prefix games work in configured games and general-chat channels. Eligible game actions award twice the configured message XP, subject to the daily XP cap. `owo ...` belongs to the OwO bot and Craftland does not reply to it. Slash commands remain limited to `#games`. Wager transactions, wallet balances and active Mines boards are stored per guild in Firestore.
- `/ai analyze`, `/ai summary`, `/ai ask`, and `/ai test`. Decisions, eligibility and statistics come from deterministic code and Firestore; Gemini only summarizes supplied records.
- Optional administrator dashboard: set `DASHBOARD_ENABLED=true`, `CLIENT_SECRET`, a random `SESSION_SECRET` (32+ characters), and HTTPS `DASHBOARD_URL` for production.

## Verify

### Keep the bot running after VS Code closes

On this Windows PC, the `CraftlandIndiaBot` Scheduled Task starts
`scripts/run-bot-forever.ps1` when the current user signs in. It runs the built
`dist/index.js` independently of VS Code and restarts the process if it exits.
After code changes, run `npm run build` and restart the task with
`Stop-ScheduledTask -TaskName CraftlandIndiaBot` followed by
`Start-ScheduledTask -TaskName CraftlandIndiaBot`. Check
`Get-ScheduledTask -TaskName CraftlandIndiaBot`, `bot-managed.log`, and
`bot-managed.stdout.log`.
The PC must remain powered on, awake, connected to the Internet, and signed in.

### Keep the bot online when this PC is off

Deploy the bot as a **Cloud Run service in Firebase project `craftland-4a761`**.
Firebase Hosting serves the dashboard, but a Discord Gateway bot needs a
continuous process. Cloud Run must use **minimum instances 1, maximum instances
1, and CPU always allocated** (`--no-cpu-throttling`). This requires an active
Google Cloud billing account and incurs ongoing charges. Cloud Run can still
restart an instance, so Discord reconnects automatically. The container serves
a small `/health` endpoint while the dashboard is disabled.

Install the official Google Cloud CLI, sign in with the Google account that owns
the Firebase project, and enable billing for that project. Create a dedicated
Cloud Run service account with `roles/datastore.user`; grant it
`roles/secretmanager.secretAccessor` on the bot's secrets. Store the existing
`DISCORD_TOKEN` and optional `GEMINI_API_KEY` in Secret Manager. Do not upload
the local Firebase private key: Cloud Run uses its service identity for
Firestore. `.gcloudignore` and `.dockerignore` exclude local credentials.

Deploy from this directory, replacing the placeholders with the existing public
Discord IDs and the dedicated service account. Create the named secrets first.

```powershell
gcloud run deploy craftland-bot --project craftland-4a761 --region asia-south1 --source . --service-account craftland-bot@craftland-4a761.iam.gserviceaccount.com --min-instances 1 --max-instances 1 --no-cpu-throttling --cpu 1 --memory 512Mi --no-allow-unauthenticated --set-env-vars "NODE_ENV=production,FIREBASE_PROJECT_ID=craftland-4a761,CLIENT_ID=YOUR_CLIENT_ID,DISCORD_GUILD_ID=YOUR_GUILD_ID,DASHBOARD_ENABLED=false" --set-secrets "DISCORD_TOKEN=craftland-discord-token:latest,GEMINI_API_KEY=craftland-gemini-api-key:latest"
```

If Gemini is not configured, omit its entry from `--set-secrets`. Verify Cloud
Run logs show `Craftland India connected as ...` and test a Discord command.
Then stop and disable the local `CraftlandIndiaBot` Scheduled Task to avoid two
bot sessions and duplicate scheduled posts. Do not stop the local bot before
the cloud copy is verified.


```powershell
npm run check
npm audit --omit=dev
```

`npm run check` runs ESLint, TypeScript/dashboard builds, and unit tests. `npm run test:firestore` is an opt-in integration suite and requires a Firestore emulator or a disposable Firebase project with private Admin credentials; never point tests at production data. `/ai test` checks Gemini. The dashboard `/health` route checks Firestore and Discord readiness without returning credentials.

## Credentials and migration

Never commit `.env`, Firebase service-account JSON, bot tokens, OAuth secrets, or Gemini keys. The old PostgreSQL-backed code has been replaced by Firestore storage; this does not copy records from any prior PostgreSQL database. If an old live database contains records that must be retained, export and migrate that data separately before switching the bot over. Revoke and replace any credential that was exposed in a tracked file or screenshot.
"# Craftland-bot" 
"# Craftland-bot" 
