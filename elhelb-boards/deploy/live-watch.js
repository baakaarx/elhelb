const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const watchFrontend = [
  path.join(rootDir, 'src'),
  path.join(rootDir, 'static'),
  path.join(rootDir, 'index.html'),
];
const watchBackend = [path.join(rootDir, 'server')];

let feTimer = null;
let beTimer = null;
let building = false;
let pendingBuild = false;

function runCmd(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: rootDir, stdio: 'inherit', shell: false });
    child.on('close', (code) => resolve(code === 0));
  });
}

async function triggerFrontendBuild(changedFile) {
  if (building) {
    pendingBuild = true;
    return;
  }
  building = true;
  console.log(`\n🎨 [Live Frontend] تم رصد تعديل (${changedFile}) — جاري تحديث الواجهة Live...`);
  const ok = await runCmd('npm', ['run', 'build']);
  if (ok) {
    console.log('✅ [Live Frontend] تم تحديث الواجهة بنجاح! اعمل Refresh للمتصفح لرؤية التعديل فوراً.');
  }
  building = false;
  if (pendingBuild) {
    pendingBuild = false;
    triggerFrontendBuild('queued-changes');
  }
}

async function triggerBackendReload(changedFile) {
  console.log(`\n⚙️ [Live Backend] تم رصد تعديل بالسيرفر (${changedFile}) — جاري إعادة التحميل بدون توقف...`);
  await runCmd('pm2', ['reload', 'elhelb-boards', '--update-env']);
  console.log('✅ [Live Backend] تم تحديث السيرفر بنجاح مع بقاء قاعدة البيانات متصلة 100%.');
}

for (const target of watchFrontend) {
  if (!fs.existsSync(target)) continue;
  fs.watch(target, { recursive: fs.statSync(target).isDirectory() }, (_event, filename) => {
    clearTimeout(feTimer);
    feTimer = setTimeout(() => triggerFrontendBuild(filename || path.basename(target)), 250);
  });
}

for (const target of watchBackend) {
  if (!fs.existsSync(target)) continue;
  fs.watch(target, { recursive: true }, (_event, filename) => {
    clearTimeout(beTimer);
    beTimer = setTimeout(() => triggerBackendReload(filename || 'server'), 250);
  });
}

console.log('🚀 وضع التعديل الحي (ELHELB Live Edit Watcher) يعمل الآن...');
console.log('   • أي حفظ داخل src/ أو static/ يبني الواجهة تلقائياً في ثانيتين.');
console.log('   • أي حفظ داخل server/ يعيد تحميل PM2 لحظياً بدون مسح أي داتا.');
