# Series Lab studio process (the same server as `npm run lab:serve`).
# This is not the Cloudflare Pages site at studio.w3ir.io.
# Build:  docker build -t series-lab:local .
# Run:    see deploy/series-lab/docker-compose.yml and docs/HOSTING.md
# At run time set SERIES_ALLOWED_HOSTS and AUTH_DOMAIN to the studio hostname.
# The image does not bake those in, and the process exits if they are missing.
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
# server/index.mjs imports these at start (creator docs pages); test/dockerfile.test.mjs guards the list.
COPY scripts/site-html.mjs scripts/site-pages.mjs scripts/legal-pages.mjs scripts/inline-md.mjs ./scripts/

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

# node:alpine has no GNU wget. Probe with the runtime that is actually in the image.
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5344/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
