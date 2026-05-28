# Deploying aistack On-Prem

aistack is local-first by default (a single CLI binary on your laptop), but
regulated industries (banking, healthcare, defense) need to run it inside
their own infrastructure. This guide covers three deployment paths:

1. [Docker Compose](#1-docker-compose-single-host) — single-host on-prem
2. [Kubernetes via Helm](#2-kubernetes-via-helm) — multi-tenant cluster
3. [Air-gapped install](#3-air-gapped-install) — no outbound network

All three use the same image: `ghcr.io/blackms/aistack:<version>` (or a tarball
exported from it). Source: [`Dockerfile`](../Dockerfile),
[`charts/aistack/`](../charts/aistack/),
[`.github/workflows/release-docker.yml`](../.github/workflows/release-docker.yml).

---

## 1. Docker Compose (single host)

**Use when**: you have one VM/server, want minimal moving parts, OK with
SQLite local storage.

### Quick start

```bash
# 1. Pull the compose file (or git clone the repo)
curl -O https://raw.githubusercontent.com/blackms/aistack/main/docker-compose.yml

# 2. Provide secrets via an .env file alongside the compose file
cat > .env <<'EOF'
JWT_SECRET=$(openssl rand -hex 32)
REFRESH_SECRET=$(openssl rand -hex 32)
ANTHROPIC_API_KEY=sk-ant-...
EOF

# 3. Start
docker compose up -d

# 4. Tail logs
docker compose logs -f aistack
```

The web UI is available at `http://<host>:3001`. Data persists in the named
volume `aistack-data` (`/var/lib/docker/volumes/<project>_aistack-data/_data`).

### Optional profiles

| Profile     | Adds                                | When to use                                  |
| ----------- | ----------------------------------- | -------------------------------------------- |
| `postgres`  | Postgres 16 backend                 | Multi-instance / higher concurrency          |
| `otel`      | OpenTelemetry collector (4317/4318) | Forward traces/metrics to Datadog/Honeycomb  |

```bash
docker compose --profile postgres --profile otel up -d
```

When enabling `otel`, drop your own `otel-collector-config.yaml` next to
`docker-compose.yml` (see
[official examples](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/examples)).

### Development mode

For local iteration, overlay `docker-compose.dev.yml` (builds from the local
`Dockerfile`, mounts `./dist` so you can `npm run dev` on the host):

```bash
npm run build
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

---

## 2. Kubernetes via Helm

**Use when**: you already run K8s, want HA / rolling upgrades / standardized
secret management, multi-tenant isolation.

### Prerequisites

- Kubernetes >= 1.24
- Helm 3.x
- (Optional) cert-manager + ingress-nginx for TLS

### Install from the chart in this repo

```bash
git clone https://github.com/blackms/aistack.git
cd aistack

helm install aistack ./charts/aistack \
  --namespace aistack --create-namespace \
  --set-string secrets.create.JWT_SECRET="$(openssl rand -hex 32)" \
  --set-string secrets.create.REFRESH_SECRET="$(openssl rand -hex 32)" \
  --set-string secrets.create.ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  --set persistence.enabled=true \
  --set persistence.size=10Gi
```

### Local quickstart with kind

```bash
# Spin up a throwaway local cluster
kind create cluster --name aistack

# Lint and render before installing (catches template errors early)
helm lint ./charts/aistack
helm template aistack ./charts/aistack | kubectl apply --dry-run=client -f -

# Install with PoC secrets
helm install aistack ./charts/aistack \
  --namespace aistack --create-namespace \
  --set-string secrets.create.JWT_SECRET=dev-secret-do-not-use \
  --set-string secrets.create.REFRESH_SECRET=dev-refresh-do-not-use

# Port-forward and visit http://localhost:3001
kubectl -n aistack port-forward svc/aistack 3001:3001
```

### Common overrides (`values.yaml`)

```yaml
image:
  repository: ghcr.io/blackms/aistack
  tag: "1.6.1"

replicaCount: 1            # keep at 1 unless using Postgres backend

persistence:
  enabled: true
  size: 20Gi
  storageClass: gp3        # cloud-specific

ingress:
  enabled: true
  className: nginx
  hosts:
    - host: aistack.internal.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: aistack-tls
      hosts: [aistack.internal.example.com]

resources:
  requests: { cpu: 250m, memory: 512Mi }
  limits:   { cpu: 2000m, memory: 2Gi }
```

### Secret management (production)

For production never put secrets in committed `values.yaml`. Use one of:

1. **External Secrets Operator** (recommended) — point `secrets.existingSecret`
   at an ESO-managed Secret that syncs from Vault / AWS Secrets Manager /
   Azure Key Vault.
2. **Sealed Secrets** — encrypt a Secret with your cluster public key,
   commit the SealedSecret, then `--set secrets.existingSecret=aistack-secrets`.
3. **Vault Agent Injector** — annotate the pod and let Vault inject env vars.

In all three cases the chart skips creating its own Secret when
`secrets.existingSecret` is set.

### Uninstall

```bash
helm uninstall aistack -n aistack
# PVCs are NOT deleted automatically (data is preserved):
kubectl -n aistack delete pvc -l app.kubernetes.io/instance=aistack
```

---

## 3. Air-gapped install

**Use when**: the cluster has no outbound internet (defense, regulated
production network). You stage the artifacts on a workstation that *does*
have internet, then transfer them over a one-way bridge / removable media.

### Step 1 — stage on a connected host

```bash
VERSION=1.6.1

# Pull and save the image
docker pull --platform linux/amd64 ghcr.io/blackms/aistack:${VERSION}
docker save ghcr.io/blackms/aistack:${VERSION} -o aistack-${VERSION}.tar
gzip aistack-${VERSION}.tar

# Package the chart
helm package ./charts/aistack --destination .
# -> aistack-0.1.0.tgz

# Bundle everything
tar czf aistack-airgap-${VERSION}.tar.gz \
  aistack-${VERSION}.tar.gz \
  aistack-0.1.0.tgz \
  docs/DEPLOY.md
```

Transfer `aistack-airgap-${VERSION}.tar.gz` to the air-gapped network.

### Step 2 — load on the target

```bash
tar xzf aistack-airgap-1.6.1.tar.gz

# Load image into the local container runtime, then retag for your internal
# registry and push it there (cluster nodes must pull from a reachable registry).
gunzip aistack-1.6.1.tar.gz
docker load -i aistack-1.6.1.tar
docker tag ghcr.io/blackms/aistack:1.6.1 registry.internal.local/aistack:1.6.1
docker push registry.internal.local/aistack:1.6.1

# Install the chart, overriding the image repo
helm install aistack ./aistack-0.1.0.tgz \
  --namespace aistack --create-namespace \
  --set image.repository=registry.internal.local/aistack \
  --set image.tag=1.6.1 \
  --set-string secrets.existingSecret=aistack-secrets   # pre-create this
```

For nodes that pull directly from a local container store (no registry), use
`ctr -n=k8s.io images import aistack-1.6.1.tar` on each node and set
`image.pullPolicy=Never` in values.

---

## Troubleshooting

| Symptom                                | Check                                          |
| -------------------------------------- | ---------------------------------------------- |
| Pod CrashLoopBackOff at startup        | `kubectl logs` — missing JWT_SECRET is common  |
| `EACCES` writing to `/data`            | `podSecurityContext.fsGroup` must match volume |
| Helm `lint` warns about non-empty CRDs | Ignore — no CRDs are shipped                   |
| Image > 200MB                          | Verify `npm prune --omit=dev` ran in builder   |

See also: [`OPERATIONS.md`](OPERATIONS.md), [`SECURITY.md`](SECURITY.md).
