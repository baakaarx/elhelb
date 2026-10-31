@echo off
setlocal EnableExtensions
chcp 65001 >nul
title ELHELB GROUP — Boards Server (Production)
cd /d "%~dp0"

echo ========================================================
echo   ELHELB GROUP — منصة ادارة المهام واللوحات الرسمية
echo ========================================================

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] يرجى تثبيت Node.js 22 LTS اولا من https://nodejs.org/
  pause
  exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0])>=22?0:1)" >nul 2>nul
if errorlevel 1 (
  echo [ERROR] اصدار Node.js الحالي قديم — يرجى تثبيت Node.js 22 LTS او احدث من https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/3] جاري تثبيت حزم السيرفر لاول مرة...
  call npm ci --omit=dev --no-fund --loglevel=error
  if errorlevel 1 (
    echo [ERROR] تعذر تثبيت حزم السيرفر — تحقق من اتصال الانترنت وحاول مرة اخرى.
    pause
    exit /b 1
  )
)

if not exist "public\index.html" (
  echo [BUILD] جاري بناء واجهة المنصة...
  call npm ci --include=dev --no-fund --loglevel=error
  call npm run build
  call npm prune --omit=dev
)

if not exist "data" mkdir "data"

if "%JWT_SECRET%"=="" if not exist "data\.jwt_secret" (
  echo [2/3] جاري توليد مفتاح تشفير الجلسات الفريد للسيرفر...
  node -e "require('fs').writeFileSync('data\\.jwt_secret', require('crypto').randomBytes(48).toString('hex'), { mode: 0o600 })"
)

if "%JWT_SECRET%"=="" (
  set /p JWT_SECRET=<"data\.jwt_secret"
)

set NODE_ENV=production
if "%HOST%"=="" set HOST=0.0.0.0
if "%PORT%"=="" set PORT=3000
if "%TRUST_PROXY%"=="" set TRUST_PROXY=0
if "%DB_PATH%"=="" set DB_PATH=%~dp0data\elhelb-boards.db

echo [3/3] جاري تشغيل السيرفر على المنفذ %PORT% ...
echo [DB]  مسار قاعدة البيانات الدائم: %DB_PATH%
node --no-warnings server/index.js
pause
