# =============================================================================
# Sonora — Bot de Música e Painel Web em Tempo Real para Discord
# Dockerfile Multi-Stage para Alojamento 24/7 (VPS / Cloud)
# =============================================================================

FROM node:22-bookworm-slim AS base

# Instalar dependências do sistema: ffmpeg, python3, ca-certificates e curl (para yt-dlp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    curl \
    ca-certificates \
    build-essential \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/database/package.json ./packages/database/
COPY packages/audio-engine/package.json ./packages/audio-engine/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/

RUN npm install

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg

EXPOSE 3001

VOLUME ["/app/data", "/app/backups"]

CMD ["node", "apps/server/dist/index.js"]
