# ⚠️ DO NOT DEPLOY THIS TO CLOUDFLARE PAGES/WORKERS

This repository contains a **Discord bot** that needs to run 24/7 on a server.

## This CANNOT be deployed to Cloudflare because:

1. Discord bots need persistent WebSocket connections
2. Cloudflare Workers are stateless serverless functions
3. The bot needs to maintain database connections
4. It requires 24/7 uptime to monitor Discord

## Correct Deployment:

### For the Worker (Detection API):
1. Go to `worker/` directory
2. Follow instructions in `worker/README.md`
3. Deploy ONLY the worker with `wrangler deploy`

### For the Bot (Discord monitoring):
1. Deploy to your home server / VPS / Railway / Render
2. Follow instructions in `DEPLOYMENT.md`
3. The bot will CALL the worker API for detections

## If you see this error:
```
✘ [ERROR] Missing entry-point to Worker script
```

**You're trying to deploy the bot to Cloudflare - STOP!**

Delete any Cloudflare Pages deployment and deploy the bot to a proper server instead.
