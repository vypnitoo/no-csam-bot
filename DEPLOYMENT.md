# Deployment Guide

This bot uses a **hybrid architecture**:
- **Cloudflare Worker**: Handles image detection (serverless, FREE)
- **Discord Bot**: Runs on your server (Node.js, persistent)

## Architecture Overview

```
Discord Message → Bot (Your Server) → Cloudflare Worker → AI Detection → Response
                       ↓
                  Database & Ban Logic
```

## Step 1: Deploy Cloudflare Worker

The worker handles the computationally expensive image detection.

### 1.1 Prerequisites
- Cloudflare account (free tier is fine)
- wrangler CLI installed: `npm install -g wrangler`

### 1.2 Deploy Worker

```bash
cd worker
npm install

# Login to Cloudflare
wrangler login

# Set secrets (sensitive data)
wrangler secret put CLOUDFLARE_ACCOUNT_ID
# Paste your Cloudflare account ID

wrangler secret put CLOUDFLARE_API_TOKEN
# Paste your Cloudflare API token

wrangler secret put API_KEY
# Generate and paste a random secure key (used by bot to auth with worker)

# Deploy the worker
npm run deploy
```

**Output will show your worker URL like:**
```
https://no-csam-detector.your-subdomain.workers.dev
```

**Save this URL!** You'll need it for the bot configuration.

### 1.3 Get Cloudflare Credentials

1. **Account ID:**
   - Go to https://dash.cloudflare.com/
   - Click any domain or Workers
   - Copy Account ID from the right sidebar

2. **API Token:**
   - Go to https://dash.cloudflare.com/profile/api-tokens
   - Click "Create Token"
   - Use template "Edit Cloudflare Workers"
   - Create and copy the token

## Step 2: Deploy Discord Bot

The bot runs persistently on your server and calls the worker for detections.

### 2.1 On Your Home Lab (Recommended)

```bash
# Clone repository
git clone https://github.com/vypnitoo/no-csam-bot.git
cd no-csam-bot

# Install dependencies
npm install

# Configure environment
cp .env.example .env
nano .env  # or use any text editor
```

**Edit .env file:**
```env
# Discord Bot
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret

# Worker Configuration
WORKER_URL=https://no-csam-detector.your-subdomain.workers.dev
WORKER_API_KEY=same_key_you_set_in_worker_secrets

# Security
JWT_SECRET=random_32_char_string_here
ENCRYPTION_KEY=random_32_char_string_here
```

**Setup database:**
```bash
npm run prisma:generate
npm run prisma:migrate
```

**Build and run:**
```bash
npm run build

# Option 1: Run with PM2 (recommended for 24/7)
npm install -g pm2
pm2 start dist/bot/index.js --name no-csam-bot
pm2 save
pm2 startup

# Option 2: Run with Docker
docker-compose up -d
```

### 2.2 Alternative: Railway.app (Free Tier)

1. Go to https://railway.app
2. Sign up and connect GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select `no-csam-bot` repository
5. Add environment variables (same as .env above)
6. Deploy!

**Important:** Railway needs a Procfile:
```bash
echo "worker: node dist/bot/index.js" > Procfile
git add Procfile
git commit -m "Add Procfile for Railway"
git push
```

### 2.3 Alternative: Render.com (Free Tier)

1. Go to https://render.com
2. Create new "Web Service"
3. Connect GitHub repo
4. Build Command: `npm install && npm run build`
5. Start Command: `node dist/bot/index.js`
6. Add environment variables
7. Deploy!

## Step 3: Configure Discord Bot

1. **Create Discord Application:**
   - Go to https://discord.com/developers/applications
   - Click "New Application"
   - Go to "Bot" tab → Reset Token → Copy token (use in .env)

2. **Enable Intents:**
   - Enable "MESSAGE CONTENT INTENT"
   - Enable "GUILD MEMBERS INTENT"
   - Save changes

3. **Invite Bot to Server:**
   - Go to OAuth2 → URL Generator
   - Select scopes: `bot`, `applications.commands`
   - Select permissions:
     - Manage Messages
     - Ban Members
     - Send Messages
     - Embed Links
     - Add Reactions
     - Read Message History
   - Copy and visit the generated URL
   - Add bot to your server

## Step 4: Server Configuration

After bot joins your server:

1. **Set Moderator Roles:**
   - Find role IDs (Enable Developer Mode in Discord → Right-click role → Copy ID)
   - Update in database or wait for dashboard

2. **Create Alert Channel:**
   - Create a private channel for mod alerts
   - Copy channel ID
   - Update in database or dashboard

## Testing

1. **Test Worker:**
```bash
curl -X POST https://your-worker.workers.dev \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://example.com/test.jpg"}'
```

2. **Test Bot:**
   - Send a test image in Discord
   - Check bot logs: `pm2 logs no-csam-bot`
   - Verify detection happens

## Monitoring

### Check Bot Status
```bash
pm2 status
pm2 logs no-csam-bot
```

### Check Worker Logs
```bash
wrangler tail no-csam-detector
```

### View Database
```bash
npm run prisma:studio
```

## Troubleshooting

### Worker not responding
- Check secrets are set: `wrangler secret list`
- Check worker logs: `wrangler tail`
- Verify Cloudflare API token has correct permissions

### Bot not detecting images
- Verify WORKER_URL is correct in bot .env
- Verify WORKER_API_KEY matches worker secret
- Check bot logs for errors
- Test worker directly with curl

### Database errors
- Run: `npm run prisma:generate`
- Delete database and re-migrate: `rm -f dev.db && npm run prisma:migrate`

## Cost Breakdown

**100% FREE for moderate use:**
- Cloudflare Worker: 100k requests/day FREE
- Your home lab: $0 (you already have it)
- Railway/Render: FREE tier available
- Database: SQLite (no cost)

**Scales to thousands of servers at no cost!**

## Performance

With this architecture:
- **Worker:** Processes images in ~1-3 seconds
- **Bot:** Uses minimal resources on your N100
- **Total latency:** 1-3 seconds per image
- **Capacity:** 100k images/day FREE

Perfect for your Intel N100 home lab!
