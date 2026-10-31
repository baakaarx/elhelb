FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev --no-fund --loglevel=error

COPY . .
RUN chmod +x /app/docker-entrypoint.sh && npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DB_PATH=/data/elhelb-boards.db

EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
