#!/usr/bin/env bash
# VIK-143: rent one RunPod GPU pod, run Chatterbox on it (spikes/chatterbox/server.py), run the listening set against it from here, and ALWAYS terminate the pod.
# Costs money while it runs: read the settings below. Read docs/spikes/chatterbox.md and the runpod-jobs skill first.
#
#   spikes/chatterbox/run.sh                # the run; results land in .vikaki/voice-eval/chatterbox/
#
# Safety, in layers (runpod-jobs, Rule 0): the account spend cap (set it in the console); the pod's own dead-man's-switch (max lifetime, idle watchdog) from `rp`;
# this script's trap, which terminates on any exit; and a final check that the account has no pod left. The RunPod key is read from .env by name and never printed.
set -uo pipefail
cd "$(dirname "$0")/../.."
HERE=spikes/chatterbox
SCRATCH="${TMPDIR:-/tmp}/vik143-$$"; mkdir -p "$SCRATCH"; chmod 700 "$SCRATCH"
OUT="${OUT:-.vikaki/voice-eval/chatterbox}"; mkdir -p "$OUT"
RP_SRC="${RP_SRC:-$HOME/.claude/skills/runpod-jobs/scripts/rp}"

# The key, by name, through the same parser Node uses for .env (a .env is not a shell script). Not printed.
if [ -z "${RUNPOD_API_KEY:-}" ]; then
  RUNPOD_API_KEY="$(node -e 'const e=require("node:util").parseEnv(require("fs").readFileSync(".env","utf8"));process.stdout.write(e.RUNPOD_API_KEY||"")')"
fi
[ -n "$RUNPOD_API_KEY" ] || { echo "run: RUNPOD_API_KEY is not in the environment or .env" >&2; exit 1; }
export RUNPOD_API_KEY

# `rp` only opens tcp ports; the proxy URL needs an http one. Make a copy with that one word changed, and refuse if the line is not there.
grep -qF '${POD_PORT}/tcp' "$RP_SRC" || { echo "run: rp changed; its port line is not what this script patches" >&2; exit 1; }
sed 's|${POD_PORT}/tcp|${POD_PORT}/http|' "$RP_SRC" > "$SCRATCH/rp"; chmod +x "$SCRATCH/rp"
RP="$SCRATCH/rp"

TOKEN="$(head -c 24 /dev/urandom | base64 | tr -d '/+=\n')"   # this run's key for the server; the pod dies with it
scrub() { sed -u "s|$TOKEN|[token]|g"; }
podlog() { "$RP" logs --tail "$1" 2>&1 | jq -Rr 'fromjson? | "[\(.source)] \(.line)"' | scrub; }

export RP_POD_NAME=vik143-chatterbox RP_COMPUTE_TYPE=GPU RP_GPU_TYPE="${RP_GPU_TYPE:-NVIDIA GeForce RTX 4090}" RP_CLOUD_TYPE="${RP_CLOUD_TYPE:-COMMUNITY}" RP_INTERRUPTIBLE=false
export RP_POD_IMAGE=runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04 RP_POD_PORT=8000 RP_CONTAINER_DISK_GB=40 RP_VOLUME_GB=0
export RP_MAX_HOURLY_USD="${RP_MAX_HOURLY_USD:-1.00}" RP_MAX_LIFETIME_SECS="${RP_MAX_LIFETIME_SECS:-7200}" RP_IDLE_TIMEOUT_SECS=900 RP_EXIT_GRACE_SECS=30
export RP_STATE_FILE="$SCRATCH/state"

sed "s|__TOKEN__|$TOKEN|; s|__SERVER_B64__|$(base64 -w0 $HERE/server.py)|" $HERE/job.sh.tmpl > "$SCRATCH/job.sh"
export RP_JOB_CMD="echo $(base64 -w0 "$SCRATCH/job.sh") | base64 -d > /tmp/job.sh && bash /tmp/job.sh"

teardown() {
  trap - EXIT INT TERM
  echo "run: tearing down" >&2
  "$RP" down 2>&1 | scrub >&2
  left="$(runpodctl pod list 2>&1 | head -c 300)"
  echo "run: pods left on the account: $left" >&2
  rm -rf "$SCRATCH"
}
trap teardown EXIT INT TERM

started=$(date +%s)
ID="$("$RP" up 2> >(scrub >&2))" || { echo "run: could not create the pod" >&2; exit 1; }
echo "run: pod $ID created $(( $(date +%s) - started ))s in" >&2
URL="https://${ID}-8000.proxy.runpod.net"

# Wait for the server, watching the log as we go (a stuck image pull or a failed install shows here, not at the 2 h limit).
ready=0
for i in $(seq 1 120); do
  sleep 15
  if curl -fsS -m10 "$URL/health" 2>/dev/null | grep -q '"ready":true'; then ready=1; break; fi
  if [ $((i % 4)) -eq 0 ]; then
    { echo "--- $(( $(date +%s) - started ))s"; podlog 6; } | tee -a "$OUT/boot.log" >&2
    # Without runpodctl on the pod its own dead-man's-switch cannot terminate it (an image with no curl or wget did this): do not go on with only the trap.
    recent="$(podlog 200)"; if grep -q "no runpodctl" <<<"$recent"; then echo "run: the pod has no runpodctl, so its self-terminate would not work; stopping" >&2; exit 1; fi
  fi
done
[ "$ready" = 1 ] || { echo "run: the server never became ready" >&2; podlog 40 | tee -a "$OUT/boot.log" >&2; exit 1; }
cold=$(( $(date +%s) - started ))
echo "run: ready after ${cold}s (create to first healthy answer)" >&2
echo "{\"cold_start_s\": $cold, \"pod\": \"$ID\"}" > "$OUT/cold-start.json"
curl -fsS -m10 "$URL/health" >> "$OUT/cold-start.json"; echo >> "$OUT/cold-start.json"
podlog 40 > "$OUT/pod-log-at-ready.log"

export CHATTERBOX_URL="$URL/v1" CHATTERBOX_API_KEY="$TOKEN"
pnpm exec tsx scripts/tts-bench.ts --engines chatterbox --blind --out "$OUT/blind" 2>&1 | scrub
cp "$OUT/blind/results.json" "$OUT/results-run1.json"
pnpm exec tsx scripts/tts-bench.ts --engines chatterbox --out "$OUT/repeat" 2>&1 | scrub | tail -16
cp "$OUT/repeat/results.json" "$OUT/results-run2.json"
echo "run: done, $(( $(date +%s) - started ))s of pod time; results in $OUT" >&2
