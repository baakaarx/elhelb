#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# ELHELB GROUP — المثبّت المباشر من ملف الضغط (خاص بقسم الـ IT)
# الاستخدام:
#   1) تشغيل على IP السيرفر مباشرة (http://SERVER_IP:3000):
#        sudo bash setup-from-zip.sh
#   2) تشغيل على دومين رسمي بشهادة HTTPS مجانية تلقائية:
#        sudo DOMAIN=boards.elhelbgroup.com bash setup-from-zip.sh
# ==============================================================================

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="/opt/elhelb-boards"
DATA_DIR="/opt/elhelb-data"
BACKUP_DIR="/opt/elhelb-backups"
DOMAIN="${DOMAIN:-}"
PORT="${PORT:-3000}"

echo "🌿 [1/5] تحديث حزم السيرفر وتثبيت الأدوات الأساسية..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg sqlite3 rsync

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 22 ]]; then
  echo "🌿 [2/5] تثبيت Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

echo "🌿 [3/5] إعداد مجلد قاعدة البيانات الدائم والنسخ الاحتياطي..."
mkdir -p "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"

if [[ ! -f "$DATA_DIR/.jwt_secret" ]]; then
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))" > "$DATA_DIR/.jwt_secret"
  chmod 600 "$DATA_DIR/.jwt_secret"
fi
JWT_SECRET_VAL="$(cat "$DATA_DIR/.jwt_secret")"

if [[ "$SRC_DIR" != "$APP_DIR" ]]; then
  rsync -a --delete --exclude 'node_modules' --exclude 'data' "$SRC_DIR/" "$APP_DIR/"
fi

echo "🌿 [4/5] تثبيت الحزم وبناء واجهة الإنتاج..."
cd "$APP_DIR"
npm ci --include=dev --no-fund --loglevel=error
npm run build
npm prune --omit=dev

echo "🌿 [5/5] تشغيل المنصة عبر PM2 وتفعيل التشغيل التلقائي عند إعادة الإقلاع..."
DB_PATH="$DATA_DIR/elhelb-boards.db" JWT_SECRET="$JWT_SECRET_VAL" PORT="$PORT" \
  pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

# نسخ احتياطي يومي تلقائي الساعة 3 فجراً مع الاحتفاظ بآخر 30 نسخة
cat >/etc/cron.d/elhelb-boards-backup <<'EOF'
0 3 * * * root test -f /opt/elhelb-data/elhelb-boards.db && sqlite3 /opt/elhelb-data/elhelb-boards.db ".backup '/opt/elhelb-backups/daily-$(date +\%F).db'" && ls -1t /opt/elhelb-backups/daily-*.db 2>/dev/null | tail -n +31 | xargs -r rm -f
EOF
chmod 644 /etc/cron.d/elhelb-boards-backup

if [[ -n "$DOMAIN" ]]; then
  echo "🔒 إعداد شهادة HTTPS التلقائية للدومين ($DOMAIN) عبر Caddy..."
  if ! command -v caddy >/dev/null 2>&1; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y && apt-get install -y caddy
  fi
  cat >/etc/caddy/Caddyfile <<CADDYEOF
$DOMAIN {
    reverse_proxy 127.0.0.1:$PORT
}
CADDYEOF
  systemctl enable caddy
  systemctl restart caddy
  echo "✅ اكتمل التشغيل بنجاح على: https://$DOMAIN"
else
  SERVER_IP="$(hostname -I | awk '{print $1}')"
  echo "✅ اكتمل التشغيل بنجاح على: http://$SERVER_IP:$PORT"
fi

echo "📂 مسار قاعدة البيانات الدائم: $DATA_DIR/elhelb-boards.db"
echo "💾 مسار النسخ الاحتياطية اليومية: $BACKUP_DIR/"
