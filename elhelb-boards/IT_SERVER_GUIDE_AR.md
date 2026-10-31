# 🛠️ دليل رفع وتشغيل المنصة على السيرفر — خاص بقسم تكنولوجيا المعلومات (IT)
**مجموعة الهلب للصناعات الكيماوية والزراعية (ELHELB GROUP)**

تحتوي هذه الحزمة على النسخة الإنتاجية المؤمَّنة الكاملة من منصة **ELHELB BOARDS** (الواجهة الأمامية مبنية مسبقاً في `public/` + خادم Node.js 22 + قاعدة بيانات SQLite WAL مدمجة في Node 22 بدون أي تبعيات C++ خارجية).

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
- توليد مفتاح تشفير جلسات فريد 384-bit (`JWT_SECRET`) خاص بالسيرفر وحفظه بصلاحية `0600` في `/opt/elhelb-data/.jwt_secret`.
- عزل قاعدة البيانات في مسار دائم مستقل بصلاحية `0700`: **`/opt/elhelb-data/elhelb-boards.db`**.
- تفعيل `TRUST_PROXY=1` تلقائياً فقط عند تشغيل Caddy HTTPS لمنع تزوير عناوين الـ IP.
- أخذ نسخة احتياطية يومية تلقائية الساعة 3:00 صباحاً محمية بـ `flock` في: **`/opt/elhelb-backups/`**.
- أوامر الفحص والمتابعة لقسم الـ IT:
  - فحص الجاهزية الأمنية الذاتي: `npm test`
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
- يولّد الحاوية تلقائياً مفتاح `JWT_SECRET` فريد داخل Volume البيانات (`/data/.jwt_secret`) عند أول إقلاع، ويرفض خادم الإنتاج العمل بدون مفتاح تشفير صالح.
- يعمل النظام على المنفذ **`3000`** (`http://SERVER_IP:3000`) ويحفظ قاعدة البيانات بشكل دائم داخل Docker Volume باسم **`elhelb_boards_data`**.

---

## الخيار 3: سيرفر Windows Server (داخلي أو سحابي) 🪟

1. ثبّت **Node.js 22 LTS (64-bit)** من الموقع الرسمي: `https://nodejs.org/`.
2. فك ضغط الملف واضغط مرتين على:
   **`start-windows-server.bat`**
3. سيقوم الملف تلقائياً بتثبيت الحزم لأول مرة، وتوليد مفتاح `JWT_SECRET` الفريد في `data\.jwt_secret`، وتشغيل المنصة على `http://SERVER_IP:3000` مع حفظ قاعدة البيانات في `data\elhelb-boards.db`.

---

## 🔒 متغيرات البيئة الاختيارية والجدار الناري (Firewall)
- راجع ملف `.env.example` للاطلاع على كافة المتغيرات المدعومة (`PORT`, `DB_PATH`, `JWT_SECRET`, `ADMIN_INIT_PASSWORD`, `TRUST_PROXY`).
- في حالة التشغيل المباشر بدون دومين: افتح المنفذ **`3000/TCP`** فقط.
- في حالة تفعيل الدومين وشهادة SSL عبر Caddy أو Nginx: افتح المنفذين **`80/TCP`** و **`443/TCP`** (واضبط `TRUST_PROXY=1` وأغلق المنفذ `3000` خارجياً).
- الحساب السيادي لرئيس مجلس الإدارة (`admin`) مهيأ مسبقاً ومشفر (`bcrypt` cost 12) لتسليمه لإدارة المجموعة فور رفع السيرفر.
