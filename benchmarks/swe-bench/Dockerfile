# SWE-bench Verified evaluation harness for aistack
#
# Reproducibility goals:
#   - Pin Python, Node, OS so anyone re-running gets bit-identical eval results
#   - Use the official SWE-bench harness which spins per-task containers internally
#   - Keep image self-contained: clone aistack source, build it, install deps
#
# Build: docker build -t aistack-swebench:latest -f Dockerfile ../..
# Run:   docker run --rm --env-file .env -v $(pwd)/results:/work/results \
#          aistack-swebench:latest <mode> [args]
#
# Modes: baseline | aistack | aggregate

FROM python:3.11.9-slim-bookworm

# --- System deps ---------------------------------------------------------
# build-essential needed by some Python wheels SWE-bench tasks compile
# docker.io client needed so the harness can spawn per-task eval containers
# git is required by SWE-bench to apply patches
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        curl \
        git \
        ca-certificates \
        docker.io \
    && rm -rf /var/lib/apt/lists/*

# --- Node 20 (for aistack runner) ----------------------------------------
ENV NODE_VERSION=20.18.0
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# --- SWE-bench harness (pinned) ------------------------------------------
# Pin to a specific release so re-runs are comparable
ARG SWEBENCH_VERSION=2.1.4
RUN pip install --no-cache-dir \
        swebench==${SWEBENCH_VERSION} \
        datasets==2.21.0 \
        huggingface_hub==0.25.2 \
        anthropic==0.39.0

# --- aistack source ------------------------------------------------------
# Build context is the repo root (see build comment above)
WORKDIR /work
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY benchmarks/swe-bench ./benchmarks/swe-bench

RUN npm ci --ignore-scripts \
    && npm run build \
    && npm install -g tsx@4.19.2

# --- Runtime config ------------------------------------------------------
# Results land here so callers can bind-mount /work/results
RUN mkdir -p /work/results
VOLUME ["/work/results"]

# Record build metadata so result JSONs can stamp it
ARG GIT_SHA=unknown
ENV AISTACK_GIT_SHA=${GIT_SHA}
ENV SWEBENCH_VERSION=${SWEBENCH_VERSION}
ENV DATASET_REVISION=main

# No ENTRYPOINT: the host-side `scripts/run-local.sh` passes an explicit
# `bash -c "<commands>"` invocation. This keeps the in-container dispatch
# logic in a single file that's easy to read in code review (see
# `scripts/run-local.sh`'s `run_in_container` function) instead of split
# across an entrypoint shim.
CMD ["bash"]
