# Series Lab — public platform image (replaces Промт api + streamlit).
# Build:  docker build -t series-lab:local .
# Run:    see deploy/series-lab/docker-compose.yml and docs/DEPLOY-PLATFORM.md
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY bin ./bin
COPY src ./src
COPY server ./server
COPY schemas ./schemas
COPY presets ./presets
COPY templates ./templates
COPY libraries ./libraries
COPY scripts/backup-db.mjs ./scripts/backup-db.mjs

# Public mode: sign-in required, per-wallet data, credits. Data lives on a volume.
ENV SERIES_MODE=public \
    SERIES_DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=5344

# Official node image user (uid/gid 1000). Bind-mounted /data on the host must be
# writable by this uid — see docs/DEPLOY-PLATFORM.md (one-time chown on old volumes).
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 5344
USER node

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5344/health || exit 1

CMD ["node", "server/index.mjs"]
