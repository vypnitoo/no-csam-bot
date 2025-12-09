# Cloudflare Worker Deployment

This worker handles image detection for the Discord bot.

## Deploy to Cloudflare Workers

### 1. Install Wrangler
```bash
npm install -g wrangler
```

### 2. Login to Cloudflare
```bash
wrangler login
```

### 3. Set Secrets
```bash
# Your Cloudflare Account ID
wrangler secret put CLOUDFLARE_ACCOUNT_ID
# Paste your account ID

# Your Cloudflare API Token (for AI Workers)
wrangler secret put CLOUDFLARE_API_TOKEN
# Paste your API token

# API Key (random secure string - bot will use this to auth)
wrangler secret put API_KEY
# Generate and paste a random secure key
```

### 4. Deploy
```bash
# From the worker/ directory
npm run deploy

# Or from root directory
cd worker && npm run deploy
```

### 5. Get Your Worker URL
After deployment, you'll see:
```
https://no-csam-detector.YOUR-SUBDOMAIN.workers.dev
```

**Copy this URL** - you need it for the bot's `.env` file!

## Configuration

Edit `../wrangler.toml` if you want to change the worker name.

## Testing

Test your worker with curl:
```bash
curl -X POST https://your-worker.workers.dev \
  -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "https://example.com/image.jpg"}'
```

## Logs

View real-time logs:
```bash
wrangler tail no-csam-detector
```

## Costs

**100% FREE** up to 100,000 requests per day!
