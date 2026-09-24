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

# Public mode: sign-in required, per-wallet data, credits. Data lives on a volume.
ENV SERIES_MODE=public \
    SERIES_DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=5344

VOLUME ["/data"]
EXPOSE 5344
# Runs as root like Промт's containers: the bind-mounted data dir on the host is root-owned.

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5344/health || exit 1

CMD ["node", "server/index.mjs"]
