FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --only=production
RUN npm run prisma:generate

COPY . .

RUN npm run build

ENV NODE_ENV=production

CMD ["node", "dist/bot/index.js"]
