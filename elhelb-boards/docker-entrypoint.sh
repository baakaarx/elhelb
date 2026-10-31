#!/bin/sh
set -eu

DATA_DIR="$(dirname "${DB_PATH:-/data/elhelb-boards.db}")"
mkdir -p "$DATA_DIR"

SECRET_FILE="$DATA_DIR/.jwt_secret"
if [ -z "${JWT_SECRET:-}" ]; then
  if [ ! -f "$SECRET_FILE" ]; then
    umask 077
    node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))" > "$SECRET_FILE"
  fi
  JWT_SECRET="$(cat "$SECRET_FILE")"
  export JWT_SECRET
fi

exec node --no-warnings server/index.js
