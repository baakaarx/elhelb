#!/bin/sh
set -eu

DB_FILE="${DB_PATH:-/data/elhelb-boards.db}"
DATA_DIR="$(dirname "$DB_FILE")"
mkdir -p "$DATA_DIR" 2>/dev/null || true

if [ ! -w "$DATA_DIR" ]; then
  echo "[ERROR] مجلد البيانات ($DATA_DIR) غير قابل للكتابة لمستخدم الحاوية المعزول (UID 1000)."
  echo "        قم بتشغيل: chown -R 1000:1000 <مجلد_البيانات_على_السيرفر>"
  exit 1
fi

if [ -n "${RAILWAY_ENVIRONMENT:-}${RENDER:-}${VERCEL:-}" ] && [ -z "${TRUST_PROXY:-}" ]; then
  export TRUST_PROXY=1
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

ADMIN_PW_FILE="$DATA_DIR/.admin_init_password"
if [ -z "${ADMIN_INIT_PASSWORD:-}" ] && [ ! -f "$DB_FILE" ]; then
  if [ ! -f "$ADMIN_PW_FILE" ]; then
    (
      umask 077
      node -e "process.stdout.write('Adm-' + require('crypto').randomBytes(12).toString('base64url'))" > "$ADMIN_PW_FILE"
    )
    echo "================================================================"
    echo "🔑 [FIRST BOOT] تم توليد كلمة مرور مبدئية لحساب @admin:"
    echo "   $(cat "$ADMIN_PW_FILE")"
    echo "   (محفوظة بصلاحية 0600 في $ADMIN_PW_FILE — غيّرها من لوحة الإدارة فور الدخول)"
    echo "================================================================"
  fi
  ADMIN_INIT_PASSWORD="$(cat "$ADMIN_PW_FILE")"
  export ADMIN_INIT_PASSWORD
fi

exec node --no-warnings server/index.js
