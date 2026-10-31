#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# ELHELB GROUP — One-Command Ubuntu Server Installer + Auto Live-Update Daemon
# Usage:
#   Basic (runs on http://SERVER_IP:3000):
#     sudo bash install-server.sh
#   With automatic HTTPS domain (e.g. boards.elhelbgroup.com):
#     sudo DOMAIN=boards.elhelbgroup.com bash install-server.sh
# ==============================================================================

REPO_URL="${REPO_URL:-https://github.com/baakaarx/elhelb.git}"
APP_ROOT="/opt/elhelb"
BOARD_DIR="/opt/elhelb/elhelb-boards"
DATA_DIR="/opt/elhelb-data"
BACKUP_DIR="/opt/elhelb-backups"
DOMAIN="${DOMAIN:-}"
PORT="${PORT:-3000}"

echo "🌿 [1/6] تحديث النظام وتثبيت المتطلبات الأساسية..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg sqlite3

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 22 ]]; then
  echo "🌿 [2/6] تثبيت Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

echo "🌿 [3/6] تجهيز مجلد البيانات الدائم والنسخ الاحتياطي (منفصل تماماً عن الكود)..."
mkdir -p "$DATA_DIR" "$BACKUP_DIR"

if [[ ! -f "$DATA_DIR/.jwt_secret" ]]; then
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))" > "$DATA_DIR/.jwt_secret"
  chmod 600 "$DATA_DIR/.jwt_secret"
fi
JWT_SECRET_VAL="$(cat "$DATA_DIR/.jwt_secret")"

echo "🌿 [4/6] سحب الكود وبناء الواجهة..."
if [[ ! -d "$APP_ROOT/.git" ]]; then
  git clone "$REPO_URL" "$APP_ROOT"
else
  git -C "$APP_ROOT" fetch origin main
  git -C "$APP_ROOT" reset --hard origin/main
fi

cd "$BOARD_DIR"
npm install --no-fund --loglevel=error
npm run build

echo "🌿 [5/6] تشغيل المنصة عبر PM2 مع حفظ تلقائي عند إعادة تشغيل السيرفر..."
DB_PATH="$DATA_DIR/elhelb-boards.db" JWT_SECRET="$JWT_SECRET_VAL" PORT="$PORT" \
  pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

# إنشاء أمر التحديث الفوري elhelb-update
cat >/usr/local/bin/elhelb-update <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
APP_ROOT="/opt/elhelb"
BOARD_DIR="/opt/elhelb/elhelb-boards"
DATA_DIR="/opt/elhelb-data"
BACKUP_DIR="/opt/elhelb-backups"

git -C "$APP_ROOT" fetch origin main --quiet
LOCAL_SHA="$(git -C "$APP_ROOT" rev-parse HEAD)"
REMOTE_SHA="$(git -C "$APP_ROOT" rev-parse origin/main)"

if [[ "${1:-}" != "--force" && "$LOCAL_SHA" == "$REMOTE_SHA" ]]; then
  exit 0
fi

echo "🔄 جاري تطبيق التحديث الجديد Live بدون المساس بقاعدة البيانات..."
if [[ -f "$DATA_DIR/elhelb-boards.db" ]]; then
  sqlite3 "$DATA_DIR/elhelb-boards.db" ".backup '$BACKUP_DIR/pre-update-$(date +%Y%m%d-%H%M%S).db'" || true
  ls -1t "$BACKUP_DIR"/pre-update-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f
fi

git -C "$APP_ROOT" reset --hard origin/main
cd "$BOARD_DIR"
npm install --no-fund --loglevel=error
npm run build
JWT_SECRET="$(cat "$DATA_DIR/.jwt_secret")" DB_PATH="$DATA_DIR/elhelb-boards.db" \
  pm2 reload elhelb-boards --update-env
echo "✅ تم التحديث Live بنجاح!"
EOF
chmod +x /usr/local/bin/elhelb-update

# تفعيل المزامنة التلقائية Live مع GitHub كل 45 ثانية + نسخ احتياطي يومي
cat >/etc/cron.d/elhelb-boards <<'EOF'
* * * * * root /usr/local/bin/elhelb-update >> /var/log/elhelb-autoupdate.log 2>&1
0 3 * * * root test -f /opt/elhelb-data/elhelb-boards.db && sqlite3 /opt/elhelb-data/elhelb-boards.db ".backup '/opt/elhelb-backups/daily-$(date +\%F).db'"
EOF
chmod 644 /etc/cron.d/elhelb-boards

if [[ -n "$DOMAIN" ]]; then
  echo "🌿 [6/6] إعداد شهادة HTTPS التلقائية للدومين ($DOMAIN) عبر Caddy..."
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
  echo "🎉 المنصة تعمل الآن رسمياً عبر: https://$DOMAIN"
else
  SERVER_IP="$(hostname -I | awk '{print $1}')"
  echo "🎉 المنصة تعمل الآن رسمياً عبر: http://$SERVER_IP:$PORT"
fi

echo "📂 مسار قاعدة البيانات الدائم المحمي: $DATA_DIR/elhelb-boards.db"
echo "⚡ أي تعديل يُدمج في GitHub (main) ينزل Live تلقائياً خلال أقل من دقيقة!"
