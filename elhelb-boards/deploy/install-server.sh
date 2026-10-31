#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# ELHELB GROUP — Ubuntu Server Installer (Git-based with manual locked updater)
# Usage:
#   Basic (runs on http://SERVER_IP:3000):
#     sudo bash install-server.sh
#   With automatic HTTPS domain (e.g. boards.elhelbgroup.com):
#     sudo DOMAIN=boards.elhelbgroup.com bash install-server.sh
# ==============================================================================

REPO_URL="${REPO_URL:-https://github.com/baakaarx/elhelb.git}"
REPO_CHECKOUT="/opt/elhelb-repo"
APP_DIR="/opt/elhelb-boards"
DATA_DIR="/opt/elhelb-data"
BACKUP_DIR="/opt/elhelb-backups"
DOMAIN="${DOMAIN:-}"
PORT="${PORT:-3000}"

echo "🌿 [1/6] تحديث النظام وتثبيت المتطلبات الأساسية..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg sqlite3 rsync util-linux

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 22 ]]; then
  echo "🌿 [2/6] تثبيت Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

echo "🌿 [3/6] تجهيز مجلد البيانات الدائم والنسخ الاحتياطي (منفصل تماماً عن الكود)..."
mkdir -p "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"
chmod 700 "$DATA_DIR" "$BACKUP_DIR"

if [[ ! -f "$DATA_DIR/.jwt_secret" ]]; then
  umask 077
  node -e "process.stdout.write(require('crypto').randomBytes(48).toString('hex'))" > "$DATA_DIR/.jwt_secret"
  chmod 600 "$DATA_DIR/.jwt_secret"
fi
JWT_SECRET_VAL="${JWT_SECRET:-$(cat "$DATA_DIR/.jwt_secret")}"

echo "🌿 [4/6] سحب الكود وبناء الواجهة في المسار الموحد ($APP_DIR)..."
if [[ ! -d "$REPO_CHECKOUT/.git" ]]; then
  git clone "$REPO_URL" "$REPO_CHECKOUT"
else
  git -C "$REPO_CHECKOUT" fetch origin main
  git -C "$REPO_CHECKOUT" reset --hard origin/main
fi

rsync -a --delete --exclude 'node_modules' --exclude 'data' "$REPO_CHECKOUT/elhelb-boards/" "$APP_DIR/"
cd "$APP_DIR"
npm ci --include=dev --no-fund --loglevel=error
npm run build
npm prune --omit=dev

TRUST_PROXY_VAL="0"
if [[ -n "$DOMAIN" ]]; then
  TRUST_PROXY_VAL="1"
fi

echo "🌿 [5/6] تشغيل المنصة عبر PM2 مع حفظ تلقائي عند إعادة تشغيل السيرفر..."
DB_PATH="$DATA_DIR/elhelb-boards.db" \
JWT_SECRET="$JWT_SECRET_VAL" \
PORT="$PORT" \
TRUST_PROXY="$TRUST_PROXY_VAL" \
ADMIN_INIT_PASSWORD="${ADMIN_INIT_PASSWORD:-}" \
  pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

# إنشاء أمر التحديث اليدوي الآمن elhelb-update محمي بـ flock (بدون cron root تلقائي)
cat >/usr/local/bin/elhelb-update <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

exec 9>/var/lock/elhelb-update.lock
if ! flock -n 9; then
  echo "⏳ توجد عملية تحديث جارية بالفعل — تم تخطي التشغيل المتكرر."
  exit 0
fi

REPO_CHECKOUT="/opt/elhelb-repo"
APP_DIR="/opt/elhelb-boards"
DATA_DIR="/opt/elhelb-data"
BACKUP_DIR="/opt/elhelb-backups"

git -C "$REPO_CHECKOUT" fetch origin main --quiet
LOCAL_SHA="$(git -C "$REPO_CHECKOUT" rev-parse HEAD)"
REMOTE_SHA="$(git -C "$REPO_CHECKOUT" rev-parse origin/main)"

if [[ "${1:-}" != "--force" && "$LOCAL_SHA" == "$REMOTE_SHA" ]]; then
  echo "✅ السيرفر يعمل بالفعل على أحدث نسخة ($LOCAL_SHA)."
  exit 0
fi

echo "🔄 جاري أخذ نسخة احتياطية وتطبيق التحديث الجديد بدون المساس بقاعدة البيانات..."
if [[ -f "$DATA_DIR/elhelb-boards.db" ]]; then
  sqlite3 "$DATA_DIR/elhelb-boards.db" ".backup '$BACKUP_DIR/pre-update-$(date +%Y%m%d-%H%M%S).db'" || true
  ls -1t "$BACKUP_DIR"/pre-update-*.db 2>/dev/null | tail -n +15 | xargs -r rm -f
fi

git -C "$REPO_CHECKOUT" reset --hard origin/main
rsync -a --delete --exclude 'node_modules' --exclude 'data' "$REPO_CHECKOUT/elhelb-boards/" "$APP_DIR/"
cd "$APP_DIR"
npm ci --include=dev --no-fund --loglevel=error
npm run build
npm prune --omit=dev
JWT_SECRET="$(cat "$DATA_DIR/.jwt_secret")" DB_PATH="$DATA_DIR/elhelb-boards.db" \
  pm2 reload elhelb-boards --update-env
echo "✅ تم التحديث بنجاح!"
EOF
chmod +x /usr/local/bin/elhelb-update

# نسخ احتياطي يومي فقط الساعة 3 فجراً (بدون سحب كود تلقائي بصلاحية root)
cat >/etc/cron.d/elhelb-boards-backup <<'EOF'
0 3 * * * root flock -n /var/lock/elhelb-backup.lock sh -c 'test -f /opt/elhelb-data/elhelb-boards.db && sqlite3 /opt/elhelb-data/elhelb-boards.db ".backup /opt/elhelb-backups/daily-$(date +\%F).db" && ls -1t /opt/elhelb-backups/daily-*.db 2>/dev/null | tail -n +31 | xargs -r rm -f'
EOF
chmod 644 /etc/cron.d/elhelb-boards-backup

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
echo "🔄 لتحديث الكود يدوياً في أي وقت مع أخذ نسخة احتياطية تلقائية شغّل: sudo elhelb-update"
