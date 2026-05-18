#!/usr/bin/env bash
# Tests for the `verify-versions` make target.
#
# For each input the target inspects, this script:
#   1. Mutates the file to a deliberately wrong value.
#   2. Asserts `make verify-versions` exits non-zero.
#   3. Restores the original file from a .bak created by sed -i.
#
# If verify-versions stops catching one of these mutations (e.g. a regex
# anchor rots, a path moves), this script fails — protecting the drift
# guard itself from silent regression.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

# Files we mutate. Always restored via the trap below.
GO_MOD="controller/go.mod"
DYNAMO_CONFIG="providers/dynamo/config.go"
GATEWAY_DETECTION="controller/internal/gateway/detection.go"

# Note: we do NOT mutate shared/types/versions.generated.ts here.
# `verify-versions` regenerates that file in place from versions.env and
# diffs against HEAD, so any mutation we make is overwritten before the
# diff runs. Simulating drift would require either rewriting HEAD or
# rewriting versions.env (which would trip the other grep guards first).
# The other three checks below exercise the same code paths.

BACKUPS=(
    "${GO_MOD}.bak"
    "${DYNAMO_CONFIG}.bak"
    "${GATEWAY_DETECTION}.bak"
)

restore() {
    local rc=$?
    for bak in "${BACKUPS[@]}"; do
        if [[ -f ${bak} ]]; then
            mv -f "${bak}" "${bak%.bak}"
        fi
    done
    exit "${rc}"
}
trap restore EXIT INT TERM

# Assert `make verify-versions` exits non-zero. Prints a diagnostic and
# exits this script with non-zero if it unexpectedly succeeded.
expect_fail() {
    local label="$1"
    if make verify-versions >/dev/null 2>&1; then
        echo "❌ verify-versions did NOT fail after mutating: ${label}"
        exit 1
    fi
    echo "✅ verify-versions correctly failed for: ${label}"
}

echo "== Sanity check: verify-versions passes on a clean tree =="
make verify-versions >/dev/null
echo "✅ clean tree passes"

echo "== Mutating ${GO_MOD} =="
sed -i.bak -E 's|(gateway-api-inference-extension )v[0-9][^[:space:]]*|\1v0.0.0-bogus|' "${GO_MOD}"
expect_fail "${GO_MOD}"
mv -f "${GO_MOD}.bak" "${GO_MOD}"

echo "== Mutating ${DYNAMO_CONFIG} =="
sed -i.bak -E 's|^var DynamoVersion = "[^"]*"$|var DynamoVersion = "0.0.0-bogus"|' "${DYNAMO_CONFIG}"
expect_fail "${DYNAMO_CONFIG}"
mv -f "${DYNAMO_CONFIG}.bak" "${DYNAMO_CONFIG}"

echo "== Mutating ${GATEWAY_DETECTION} =="
sed -i.bak -E 's|^var DefaultGAIEVersion = "[^"]*"$|var DefaultGAIEVersion = "v0.0.0-bogus"|' "${GATEWAY_DETECTION}"
expect_fail "${GATEWAY_DETECTION}"
mv -f "${GATEWAY_DETECTION}.bak" "${GATEWAY_DETECTION}"

echo ""
echo "🎉 All verify-versions guard checks behaved as expected."
