#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -gt 0 ]; then
  lockfiles=("$@")
else
  shopt -s nullglob
  lockfiles=(.github/workflows/*.lock.yml)
  shopt -u nullglob
fi

if [ "${#lockfiles[@]}" -eq 0 ]; then
  echo "No gh-aw lock files found."
  exit 0
fi

for file in "${lockfiles[@]}"; do
  perl -0pi -e 's/[ \t]+\n/\n/g; s/\n+\z/\n/' "$file"
  echo "Normalized $file"
done
