# Anubis-Security-Tool web
# Build:  docker build -t anubis-web .
# Never bakes .env / secrets into the image: pass them at runtime (env_file / -e).

FROM node:24-bookworm AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ build-essential \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV npm_config_legacy_peer_deps=true
COPY package.json package-lock.json .npmrc ./
COPY build ./build
RUN npm ci
COPY . .
RUN npm run build \
  && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="Anubis-Security-Tool web" \
      org.opencontainers.image.source="https://github.com/Anubis-Security-Tool/anubis-web" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5577 \
    DB_PATH=/data \
    TRUST_PROXY=1
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/src/app ./src/app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 5577
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5577)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "./src/app/app.js"]
