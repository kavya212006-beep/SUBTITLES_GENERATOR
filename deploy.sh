#!/bin/bash
set -e

echo "🚀 Building Subtitle Generator Free..."
npm run build

echo ""
echo "☁️ Deploying to Cloudflare Workers (Static Assets)..."
npx wrangler deploy

echo ""
echo "🎉 Deployment complete! Your Subtitle Generator is live and free for anyone to use."
