# syntax=docker/dockerfile:1.7
# ============================================================================
# aistack - Multi-stage Dockerfile
# ----------------------------------------------------------------------------
# Stage 1 (builder): install full deps + compile TypeScript -> dist/
# Stage 2 (runtime): copy compiled output + core production deps, run as non-root.
# Target image size: < 200MB.
# ============================================================================

# ---------- Stage 1: builder ----------
# node:20-alpine multi-arch index digest (linux/amd64 + linux/arm64). Refresh
# periodically: `docker buildx imagetools inspect node:20-alpine`.
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder

# Build deps required by better-sqlite3 native module
RUN apk add --no-cache \
        python3 \
        make \
        g++ \
        ca-certificates

WORKDIR /build

# Install deps with full devDependencies (needed for tsc)
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Copy sources and compile
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
COPY templates ./templates
RUN npm run build

# Prune to core production deps. Optional integrations such as local WASM
# embeddings and managed sandboxes are lazy-loaded by the app and can be
# installed by operators who need them; omitting them keeps the base image small.
RUN npm prune --omit=dev --omit=optional

# ---------- Stage 2: runtime ----------
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runtime

# Runtime deps only (sqlite shared lib not required: better-sqlite3 is statically linked)
RUN apk add --no-cache \
        tini \
        ca-certificates \
        libstdc++ \
    && addgroup -S aistack \
    && adduser -S -D -h /home/aistack -G aistack aistack

ENV NODE_ENV=production \
    AISTACK_DATA_DIR=/data \
    AISTACK_CONFIG_PATH=/etc/aistack/agentstack.config.json \
    PATH=/app/node_modules/.bin:$PATH

WORKDIR /app

# Copy compiled artifacts + pruned production deps from builder
COPY --from=builder --chown=aistack:aistack /build/dist ./dist
COPY --from=builder --chown=aistack:aistack /build/node_modules ./node_modules
COPY --from=builder --chown=aistack:aistack /build/package.json ./package.json
COPY --from=builder --chown=aistack:aistack /build/migrations ./migrations
COPY --from=builder --chown=aistack:aistack /build/templates ./templates

# Persistent state lives outside /app
RUN mkdir -p /data /etc/aistack \
    && chown -R aistack:aistack /data /etc/aistack

USER aistack

VOLUME ["/data"]

# Default config can be overridden by mounting at /etc/aistack/agentstack.config.json
# Web server (when enabled) listens on 3001 by default
EXPOSE 3001

# Liveness: when running as the web daemon, hit /health/live; CLI-only
# invocations (e.g. one-shot `aistack run`) ignore HEALTHCHECK anyway.
# Falls back to `--version` if the HTTP port isn't open yet (start_period).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:3001/api/v1/system/health/live', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))" \
    || node /app/dist/cli/index.js --version \
    || exit 1

# Use tini as PID 1 for proper signal forwarding (graceful shutdown)
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/dist/cli/index.js"]
CMD ["--help"]
