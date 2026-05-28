# syntax=docker/dockerfile:1.7
# ============================================================================
# aistack - Multi-stage Dockerfile
# ----------------------------------------------------------------------------
# Stage 1 (builder): install full deps + compile TypeScript -> dist/
# Stage 2 (runtime): copy compiled output + production deps, run as non-root.
# Target image size: < 200MB (node:20-slim base ~ 75MB).
# ============================================================================

# ---------- Stage 1: builder ----------
# node:20-slim multi-arch index digest (linux/amd64 + linux/arm64). Refresh
# periodically: `docker buildx imagetools inspect node:20-slim`.
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS builder

# Build deps required by better-sqlite3 native module
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 \
        make \
        g++ \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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

# Prune to production-only deps (re-resolves and drops dev packages)
RUN npm prune --omit=dev

# ---------- Stage 2: runtime ----------
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0 AS runtime

# Runtime deps only (sqlite shared lib not required: better-sqlite3 is statically linked)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        tini \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system aistack \
    && useradd --system --gid aistack --create-home --shell /bin/bash aistack

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
