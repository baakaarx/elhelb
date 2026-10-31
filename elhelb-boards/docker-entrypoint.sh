#!/bin/sh
set -eu

DATA_DIR="$(dirname "${DB_PATH:-/data/elhelb-boards.db}")"
mkdir -p "$DATA_DIR" 2>/dev/null || true

if [ ! -w "$DATA_DIR" ]; then
  echo "[ERROR] مجلد البيانات ($DATA_DIR) غير قابل للكتابة لمستخدم الحاوية المعزول (UID 1000)."
  echo "        قم بتشغيل: chown -R 1000:1000 <مجلد_البيانات_على_السيرفر>"
  exit 1
fi

SECRET_FILE="$DATA_DIR/.jwt_secret"
if [ -z "${JWT_SECRET:-}" ]; then
  if [ ! -f "$SECRET_FILE" ]; then
    (
      umask 077
      node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))" > "$SECRET_FILE"
    )
  fi
  JWT_SECRET="$(cat "$SECRET_FILE")"
  export JWT_SECRET
fi

exec node --no-warnings server/index.js
