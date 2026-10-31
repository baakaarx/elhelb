#!/usr/bin/env bash
set -euo pipefail
umask 022

# ==============================================================================
# ELHELB GROUP — Ubuntu Server Installer (Git-based, non-root systemd service)
# ==============================================================================

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "❌ يرجى تشغيل السكريبت بصلاحيات المدير (sudo):"
  echo "   sudo bash deploy/install-server.sh"
  exit 1
fi

REPO_URL="${REPO_URL:-https://github.com/baakaarx/elhelb.git}"
REPO_CHECKOUT="/opt/elhelb-repo"
APP_DIR="/opt/elhelb-boards"
DATA_DIR="/opt/elhelb-data"
BACKUP_DIR="/opt/elhelb-backups"
SERVICE_USER="elhelb"
DOMAIN="${DOMAIN:-}"
PORT="${PORT:-3000}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg sqlite3 rsync util-linux

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

mkdir -p "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"

if [[ ! -d "$REPO_CHECKOUT/.git" ]]; then
  git clone "$REPO_URL" "$REPO_CHECKOUT"
else
  git -C "$REPO_CHECKOUT" fetch origin main
  git -C "$REPO_CHECKOUT" reset --hard origin/main
fi

rsync -a --delete --exclude 'node_modules' --exclude 'data' "$REPO_CHECKOUT/elhelb-boards/" "$APP_DIR/"
DOMAIN="$DOMAIN" PORT="$PORT" bash "$APP_DIR/setup-from-zip.sh"

cat >/usr/local/bin/elhelb-update <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
umask 022

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "❌ يرجى تشغيل التحديث بصلاحيات sudo: sudo elhelb-update"
  exit 1
fi

mkdir -p /run/lock
exec 9>/run/lock/elhelb-update.lock
if ! flock -n 9; then
  echo "⏳ توجد عملية تحديث جارية بالفعل."
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

if [[ -f "$DATA_DIR/elhelb-boards.db" ]]; then
  runuser -u elhelb -- sqlite3 "$DATA_DIR/elhelb-boards.db" ".backup '$BACKUP_DIR/pre-update-$(date +%Y%m%d-%H%M%S).db'" || true
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'pre-update-*.db' -mtime +14 -delete
fi

git -C "$REPO_CHECKOUT" reset --hard origin/main
rsync -a --delete --exclude 'node_modules' --exclude 'data' "$REPO_CHECKOUT/elhelb-boards/" "$APP_DIR/"
cd "$APP_DIR"
npm ci --include=dev --no-fund --loglevel=error
npm run build
npm prune --omit=dev
chown -R root:elhelb "$APP_DIR"
chmod -R u+rwX,g+rX,o-rwx "$APP_DIR"
systemctl restart elhelb-boards.service
echo "✅ تم التحديث وإعادة تشغيل الخدمة بنجاح!"
EOF
chmod 755 /usr/local/bin/elhelb-update
