#!/usr/bin/env bash
# Build and run the SWE-bench harness container.
#
# Design: this script is the single dispatcher for both host-side
# (`build`, `aggregate`) and in-container work (`baseline`, `aistack`). We
# avoid a separate entrypoint shim by passing an inline `bash -c` payload
# to the container, which keeps the full execution path readable in one
# file at review time.
#
# Usage:
#   ./scripts/run-local.sh build
#   ./scripts/run-local.sh baseline [--limit N]
#   ./scripts/run-local.sh aistack  [--limit N]
#   ./scripts/run-local.sh aggregate
#
# Requires:
#   - Docker daemon running (the inner harness spawns per-task containers,
#     so we mount /var/run/docker.sock — Docker-in-Docker via socket sharing)
#   - .env file at benchmarks/swe-bench/.env with at minimum:
#       ANTHROPIC_API_KEY=sk-ant-...
#       AISTACK_MODEL_SNAPSHOT=claude-sonnet-4-5-20250514
#       HF_TOKEN=hf_...    # optional, raises HuggingFace rate limits
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH_DIR="$(dirname "$HERE")"
REPO_ROOT="$(cd "$BENCH_DIR/../.." && pwd)"
IMAGE="aistack-swebench:latest"
RESULTS_DIR="$BENCH_DIR/results"

# In-container dispatch: dumps SWE-bench Verified once, runs the requested
# runner, converts per-task JSONs to the predictions format SWE-bench
# expects, then invokes the official evaluation harness. Defined here (not
# as a separate file in the image) so reviewers see the full pipeline at
# once.
IN_CONTAINER_DISPATCH='
set -euo pipefail
RESULTS=/work/results
mode=$1; shift

ensure_tasks() {
  if [ ! -f "$RESULTS/_tasks.json" ]; then
    echo "[bench] dumping SWE-bench Verified -> $RESULTS/_tasks.json"
    python -c "
import json
from datasets import load_dataset
ds = load_dataset(\"princeton-nlp/SWE-bench_Verified\", split=\"test\")
rows = [dict(r) for r in ds]
open(\"/work/results/_tasks.json\",\"w\").write(json.dumps(rows))
print(f\"[bench] wrote {len(rows)} tasks\")
"
  fi
}

predictions_to_swebench() {
  python -c "
import json, os, sys
in_dir, out_file = sys.argv[1], sys.argv[2]
preds = []
for name in sorted(os.listdir(in_dir)):
    if not name.endswith(\".json\") or name.startswith(\"_\") or name == \"harness_report.json\":
        continue
    r = json.load(open(os.path.join(in_dir, name)))
    if not r.get(\"patch\"): continue
    preds.append({\"instance_id\": r[\"task_id\"],
                  \"model_patch\": r[\"patch\"],
                  \"model_name_or_path\": r.get(\"model_snapshot\",\"unknown\")})
json.dump(preds, open(out_file,\"w\"))
print(f\"[bench] {len(preds)} predictions -> {out_file}\")
" "$1" "$2"
}

run_harness() {
  local preds=$1
  local report_out=$2
  python -m swebench.harness.run_evaluation \
    --predictions_path "$preds" \
    --max_workers 4 \
    --run_id "aistack-$(date +%s)" \
    --dataset_name princeton-nlp/SWE-bench_Verified \
    --report_dir "$(dirname "$report_out")"
  local generated
  generated=$(ls -t "$(dirname "$report_out")"/*.json | grep -v _tasks | head -n1)
  cp "$generated" "$report_out"
}

case "$mode" in
  baseline)
    ensure_tasks
    tsx /work/benchmarks/swe-bench/baseline.ts --out "$RESULTS/baseline" "$@"
    predictions_to_swebench "$RESULTS/baseline" "$RESULTS/baseline/_preds.json"
    run_harness "$RESULTS/baseline/_preds.json" "$RESULTS/baseline/harness_report.json"
    ;;
  aistack)
    ensure_tasks
    tsx /work/benchmarks/swe-bench/run.ts --out "$RESULTS/aistack" "$@"
    predictions_to_swebench "$RESULTS/aistack" "$RESULTS/aistack/_preds.json"
    run_harness "$RESULTS/aistack/_preds.json" "$RESULTS/aistack/harness_report.json"
    ;;
  *) echo "unknown in-container mode: $mode" >&2; exit 1 ;;
esac
'

cmd="${1:-help}"
shift || true

case "$cmd" in
  build)
    GIT_SHA="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    docker build \
      --build-arg "GIT_SHA=$GIT_SHA" \
      -t "$IMAGE" \
      -f "$BENCH_DIR/Dockerfile" \
      "$REPO_ROOT"
    ;;
  baseline|aistack)
    if [[ ! -f "$BENCH_DIR/.env" ]]; then
      cat >&2 <<EOF
ERROR: $BENCH_DIR/.env missing. Create it with at minimum:
  ANTHROPIC_API_KEY=sk-ant-...
  AISTACK_MODEL_SNAPSHOT=claude-sonnet-4-5-20250514
  HF_TOKEN=hf_...    # optional
EOF
      exit 2
    fi
    mkdir -p "$RESULTS_DIR"
    docker run --rm \
      --env-file "$BENCH_DIR/.env" \
      -v "$RESULTS_DIR:/work/results" \
      -v /var/run/docker.sock:/var/run/docker.sock \
      "$IMAGE" bash -c "$IN_CONTAINER_DISPATCH _ $cmd $*"
    ;;
  aggregate)
    # Pure aggregation can run on the host if tsx is available; otherwise
    # do it inside the image (no API keys, no network).
    if command -v tsx >/dev/null 2>&1; then
      tsx "$BENCH_DIR/aggregate.ts" --root "$RESULTS_DIR"
    else
      docker run --rm -v "$RESULTS_DIR:/work/results" "$IMAGE" \
        tsx /work/benchmarks/swe-bench/aggregate.ts --root /work/results
    fi
    ;;
  help|--help|-h)
    sed -n '1,28p' "$0"
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    sed -n '1,28p' "$0" >&2
    exit 1
    ;;
esac
