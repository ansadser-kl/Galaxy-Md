FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    SESSION_DIR=/data/session

# System tools:
#   ffmpeg  - audio/video commands, YouTube video+audio merge, voice notes
#   webp    - anim_dump, used only by the .mp4 command
#   tini    - proper PID 1 (clean shutdown, no zombie ffmpeg processes)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg webp tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Fail early if ffmpeg is missing; only warn about anim_dump (.mp4 command).
RUN ffmpeg -version | head -n 1 \
    && (command -v anim_dump >/dev/null 2>&1 \
        && echo "anim_dump: found" \
        || echo "WARNING: anim_dump not found - the .mp4 command will not work")

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY . .

# Mount a persistent volume at /data (Railway, Docker -v ...). It then keeps:
#   /data/session   main WhatsApp login
#   /data/session2.. clone bots linked with .pair
#   /data/yt-auth.json  YouTube login (.ytlogin)
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "index.js"]
