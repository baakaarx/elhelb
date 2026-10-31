const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
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

function runCmd(cmd, args, { quiet = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: rootDir,
      stdio: quiet ? 'ignore' : 'inherit',
      shell: false,
    });
    child.on('error', () => resolve(false));
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
  const ok = await runCmd(npmBin, ['run', 'build']);
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
  console.log(`\n⚙️ [Live Backend] تم رصد تعديل بالسيرفر (${changedFile}) — جاري إعادة التحميل بدون مسح أي داتا...`);
  if (process.platform === 'linux' && (await runCmd('systemctl', ['is-active', '--quiet', 'elhelb-boards.service'], { quiet: true }))) {
    const ok = await runCmd('systemctl', ['restart', 'elhelb-boards.service']);
    if (ok) {
      console.log('✅ [Live Backend] تمت إعادة تشغيل خدمة systemd بنجاح مع بقاء قاعدة البيانات محفوظة 100%.');
      return;
    }
  }
  const pm2Ok = await runCmd(process.platform === 'win32' ? 'pm2.cmd' : 'pm2', ['reload', 'elhelb-boards', '--update-env']);
  if (pm2Ok) {
    console.log('✅ [Live Backend] تم تحديث السيرفر عبر PM2 بنجاح مع بقاء قاعدة البيانات متصلة 100%.');
  } else {
    console.log('ℹ️ [Live Backend] أعد تشغيل عملية السيرفر يدوياً أو عبر sudo systemctl restart elhelb-boards لتطبيق تعديل السيرفر.');
  }
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
console.log('   • أي حفظ داخل server/ يعيد تحميل systemd أو PM2 لحظياً بدون مسح أي داتا.');
