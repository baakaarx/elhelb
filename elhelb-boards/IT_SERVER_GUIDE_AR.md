# 🛠️ دليل رفع وتشغيل المنصة على السيرفر — خاص بقسم تكنولوجيا المعلومات (IT)
**مجموعة الهلب للصناعات الكيماوية والزراعية (ELHELB GROUP)**

تحتوي هذه الحزمة على النسخة الإنتاجية الكاملة من منصة **ELHELB BOARDS** (الواجهة الأمامية مبنية مسبقاً في `public/` + خادم Node.js 22 + قاعدة بيانات SQLite WAL مدمجة في Node 22 بدون أي تبعيات C++ خارجية).

---

## الخيار 1: سيرفر Linux (Ubuntu 22.04 / 24.04 أو Debian) — **موصى به** 🚀

1. ارفع ملف `elhelb-boards-server.zip` إلى السيرفر وفك ضغطه:
   ```bash
   sudo apt-get update && sudo apt-get install -y unzip
   unzip elhelb-boards-server.zip -d elhelb-boards
   cd elhelb-boards
   ```
2. شغّل سكريبت التثبيت الآلي بأمر واحد:
   - **للتشغيل عبر IP السيرفر (`http://SERVER_IP:3000`):**
     ```bash
     sudo bash setup-from-zip.sh
     ```
   - **أو للتشغيل على دومين رسمي بشهادة `HTTPS` تلقائية (بعد توجيه `A Record` لـ IP السيرفر):**
     ```bash
     sudo DOMAIN=boards.elhelbgroup.com bash setup-from-zip.sh
     ```

### ماذا يجهّز السكريبت تلقائياً؟
- تثبيت **Node.js 22 LTS** ومدير العمليات **PM2** مع إعادة التشغيل التلقائي عند إعادة إقلاع السيرفر (`systemd`).
- عزل قاعدة البيانات في مسار دائم مستقل: **`/opt/elhelb-data/elhelb-boards.db`**.
- أخذ نسخة احتياطية يومية تلقائية الساعة 3:00 صباحاً في: **`/opt/elhelb-backups/`**.
- أوامر المتابعة لقسم الـ IT:
  - حالة الخدمة: `pm2 status`
  - السجلات الحية: `pm2 logs elhelb-boards`
  - إعادة التشغيل بدون توقف: `pm2 reload elhelb-boards`

---

## الخيار 2: التشغيل عبر Docker / Docker Compose 🐳

إذا كان السيرفر يعمل بـ Docker:
```bash
unzip elhelb-boards-server.zip -d elhelb-boards
cd elhelb-boards
docker compose up -d --build
```
- يعمل النظام على المنفذ **`3000`** (`http://SERVER_IP:3000`).
- تُحفظ قاعدة البيانات بشكل دائم داخل Docker Volume باسم **`elhelb_boards_data`**.

---

## الخيار 3: سيرفر Windows Server (داخلي أو سحابي) 🪟

1. ثبّت **Node.js 22 LTS (64-bit)** من الموقع الرسمي: `https://nodejs.org/`.
2. فك ضغط الملف واضغط مرتين على:
   **`start-windows-server.bat`**
3. سيقوم الملف تلقائياً بتثبيت الحزم لأول مرة وتشغيل المنصة على `http://SERVER_IP:3000` مع حفظ قاعدة البيانات في `data\elhelb-boards.db`.
   *(لتشغيله كخدمة خلفية دائمة على Windows، يمكن تشغيل `npm install -g pm2` ثم `pm2 start server/index.js --name elhelb-boards --node-args="--no-warnings"`).*

---

## 🔒 ملاحظات الشبكة والجدار الناري (Firewall)
- في حالة التشغيل المباشر بدون دومين: افتح المنفذ **`3000/TCP`**.
- في حالة تفعيل الدومين وشهادة SSL عبر Caddy أو Nginx: افتح المنفذين **`80/TCP`** و **`443/TCP`**.
- الحساب السيادي لرئيس مجلس الإدارة مهيأ مسبقاً ومشفر (`bcrypt`) داخل النظام لاعتماد وتسكين مسؤولي الـ HR والـ IT ورؤساء الأقسام فور التشغيل.
