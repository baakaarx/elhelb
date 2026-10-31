#!/usr/bin/env bash
set -euo pipefail
umask 022

# ==============================================================================
# ELHELB GROUP — المثبّت المباشر المؤمَّن من ملف الضغط (خاص بقسم الـ IT)
# يعمل بمستخدم نظام معزول محدود الصلاحيات (User=elhelb) عبر systemd
# الاستخدام:
#   1) تشغيل على IP السيرفر مباشرة (http://SERVER_IP:3000):
#        sudo bash setup-from-zip.sh
#   2) تشغيل على دومين رسمي بشهادة HTTPS مجانية تلقائية عبر Caddy:
#        sudo DOMAIN=boards.elhelbgroup.com bash setup-from-zip.sh
# ==============================================================================

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "❌ يرجى تشغيل السكريبت بصلاحيات المدير (sudo):"
  echo "   sudo bash setup-from-zip.sh"
  exit 1
fi

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="/opt/elhelb-boards"
DATA_DIR="/opt/elhelb-data"
BACKUP_DIR="/opt/elhelb-backups"
SERVICE_USER="elhelb"
DOMAIN="${DOMAIN:-}"
PORT="${PORT:-3000}"

escape_systemd_env() {
  local val="$1"
  val="${val//\\/\\\\}"
  val="${val//\"/\\\"}"
  printf '"%s"' "$val"
}

echo "🌿 [1/5] تحديث حزم السيرفر وتثبيت الأدوات الأساسية..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg sqlite3 rsync util-linux

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 22 ]]; then
  echo "🌿 [2/5] تثبيت Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "🌿 [3/5] إنشاء مستخدم النظام المعزول ($SERVICE_USER) وتأمين مجلد قاعدة البيانات..."
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

mkdir -p "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"

if [[ ! -f "$DATA_DIR/.jwt_secret" ]]; then
  (
    umask 077
    node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))" > "$DATA_DIR/.jwt_secret"
  )
fi
JWT_SECRET_VAL="${JWT_SECRET:-$(cat "$DATA_DIR/.jwt_secret")}"

if [[ "$SRC_DIR" != "$APP_DIR" ]]; then
  rsync -a --delete --exclude 'node_modules' --exclude 'data' "$SRC_DIR/" "$APP_DIR/"
fi

echo "🌿 [4/5] تثبيت الحزم وبناء واجهة الإنتاج..."
cd "$APP_DIR"
npm ci --include=dev --no-fund --loglevel=error
npm run build
npm prune --omit=dev

BIND_HOST_VAL="${HOST:-0.0.0.0}"
TRUST_PROXY_VAL="0"
PUBLIC_ORIGIN_VAL="${PUBLIC_BASE_URL:-}"
if [[ -n "$DOMAIN" ]]; then
  BIND_HOST_VAL="127.0.0.1"
  TRUST_PROXY_VAL="1"
  if [[ -z "$PUBLIC_ORIGIN_VAL" ]]; then
    PUBLIC_ORIGIN_VAL="https://$DOMAIN"
  fi
fi

(
  umask 077
  {
    printf 'NODE_ENV=production\n'
    printf 'HOST=%s\n' "$(escape_systemd_env "$BIND_HOST_VAL")"
    printf 'PORT=%s\n' "$(escape_systemd_env "$PORT")"
    printf 'DB_PATH=%s\n' "$(escape_systemd_env "$DATA_DIR/elhelb-boards.db")"
    printf 'JWT_SECRET=%s\n' "$(escape_systemd_env "$JWT_SECRET_VAL")"
    printf 'TRUST_PROXY=%s\n' "$(escape_systemd_env "$TRUST_PROXY_VAL")"
    printf 'PUBLIC_BASE_URL=%s\n' "$(escape_systemd_env "$PUBLIC_ORIGIN_VAL")"
    printf 'ADMIN_INIT_PASSWORD=%s\n' "$(escape_systemd_env "${ADMIN_INIT_PASSWORD:-}")"
  } > "$DATA_DIR/.env.runtime"
)

chown -R root:"$SERVICE_USER" "$APP_DIR"
chmod -R u+rwX,g+rX,o-rwx "$APP_DIR"
chown -R "$SERVICE_USER":"$SERVICE_USER" "$DATA_DIR" "$BACKUP_DIR"
chmod 700 "$DATA_DIR" "$BACKUP_DIR"
chmod 600 "$DATA_DIR/.jwt_secret" "$DATA_DIR/.env.runtime"

echo "🌿 [5/5] تفعيل خدمة النظام المحمية (systemd) بمستخدم محدود الصلاحيات ($SERVICE_USER)..."
if command -v pm2 >/dev/null 2>&1; then
  pm2 delete elhelb-boards >/dev/null 2>&1 || true
fi

cat >/etc/systemd/system/elhelb-boards.service <<SVCEOF
[Unit]
Description=ELHELB GROUP Official Boards & RBAC Platform
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$DATA_DIR/.env.runtime
ExecStart=$(command -v node) --no-warnings $APP_DIR/server/index.js
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
SVCEOF
chmod 644 /etc/systemd/system/elhelb-boards.service

systemctl daemon-reload
systemctl enable elhelb-boards.service
systemctl restart elhelb-boards.service

# نسخ احتياطي يومي تلقائي الساعة 3 فجراً بصلاحية المستخدم المعزول داخل مجلده المحمي
cat >/etc/cron.d/elhelb-boards-backup <<EOF
0 3 * * * $SERVICE_USER flock -n /opt/elhelb-backups/.backup.lock sh -c 'test -f /opt/elhelb-data/elhelb-boards.db && sqlite3 /opt/elhelb-data/elhelb-boards.db ".backup /opt/elhelb-backups/daily-\$(date +\\%F).db" && find /opt/elhelb-backups -maxdepth 1 -type f -name "daily-*.db" -mtime +30 -delete'
EOF
chmod 644 /etc/cron.d/elhelb-boards-backup

if [[ -n "$DOMAIN" ]]; then
  echo "🔒 إعداد شهادة HTTPS التلقائية للدومين ($DOMAIN) عبر Caddy..."
  if ! command -v caddy >/dev/null 2>&1; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    chmod 644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    chmod 644 /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy
  fi
  cat >/etc/caddy/Caddyfile <<CADDYEOF
$DOMAIN {
    reverse_proxy 127.0.0.1:$PORT
}
CADDYEOF
  chmod 644 /etc/caddy/Caddyfile
  systemctl enable caddy
  systemctl restart caddy
  echo "✅ اكتمل التشغيل بنجاح على: https://$DOMAIN"
else
  SERVER_IP="$(hostname -I | awk '{print $1}')"
  echo "✅ اكتمل التشغيل بنجاح على: http://$SERVER_IP:$PORT"
fi

echo "📂 مسار قاعدة البيانات الدائم: $DATA_DIR/elhelb-boards.db"
echo "💾 مسار النسخ الاحتياطية اليومية: $BACKUP_DIR/"
echo "🔍 لمتابعة حالة الخدمة: sudo systemctl status elhelb-boards"
