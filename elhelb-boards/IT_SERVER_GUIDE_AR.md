# 🛠️ دليل رفع وتشغيل المنصة على السيرفر — خاص بقسم تكنولوجيا المعلومات (IT)
**مجموعة الهلب للصناعات الكيماوية والزراعية (ELHELB GROUP)**

تحتوي هذه الحزمة على النسخة الإنتاجية المؤمَّنة الكاملة من منصة **ELHELB BOARDS** (الواجهة الأمامية مبنية مسبقاً في `public/` + خادم Node.js 22 + قاعدة بيانات SQLite WAL مدمجة في Node 22 بدون أي تبعيات C++ خارجية).

---

## الخيار 1: سيرفر Linux (Ubuntu 22.04 / 24.04 أو Debian) — **موصى به** 🚀

1. ارفع ملف `elhelb-boards-server.zip` إلى السيرفر وفك ضغطه (يُستخرج تلقائياً داخل مجلد `elhelb-boards/`):
   ```bash
   sudo apt-get update && sudo apt-get install -y unzip
   unzip -q elhelb-boards-server.zip
   cd elhelb-boards
   ```
2. شغّل سكريبت التثبيت الآلي بأمر واحد:
   - **للتشغيل على دومين رسمي بشهادة `HTTPS` عامة تلقائية (بعد توجيه `A Record` لـ IP السيرفر):**
     ```bash
     sudo DOMAIN=boards.elhelbgroup.com bash setup-from-zip.sh
     ```
   - **أو للتشغيل عبر IP السيرفر مباشرةً بتشفير `HTTPS` داخلي (`https://SERVER_IP`):**
     ```bash
     sudo bash setup-from-zip.sh
     ```
   - *(اختياري)* يمكنك تمرير كلمة مرور مبدئية مخصصة لحساب `admin` عند أول تثبيت:
     ```bash
     sudo ADMIN_INIT_PASSWORD='YourStrongPassword#2026' DOMAIN=boards.elhelbgroup.com bash setup-from-zip.sh
     ```
     وإذا لم تمررها، سيقوم السكريبت بتوليد كلمة مرور عشوائية قوية فريدة لهذا السيرفر فقط وعرضها على الشاشة مرة واحدة وحفظها بصلاحية `0600` في `/opt/elhelb-data/.admin_init_password`.

### ماذا يجهّز السكريبت تلقائياً؟
- تثبيت **Node.js 22 LTS** وبناء الواجهة بمستخدم محدود الصلاحيات (`elhelb` مع `--ignore-scripts`)، ثم قفل ملفات الكود للقراءة فقط وتفعيل خدمة **`systemd`** محمية (`NoNewPrivileges=true` و `ProtectSystem=full`).
- ربط تطبيق Node داخلياً بـ `127.0.0.1:3000` فقط وتأمين الاتصال الخارجي عبر **Caddy HTTPS** (`443/TCP`) حتى لا تمر بيانات الدخول بدون تشفير أبداً.
- توليد مفاتيح تشفير مستقلة 384-bit (`JWT_SECRET` و `SETTINGS_ENCRYPTION_KEY`) بصلاحية `0600` داخل `/opt/elhelb-data/`.
- عزل قاعدة البيانات في **`/opt/elhelb-data/elhelb-boards.db`** وأخذ نسخة احتياطية يومية تلقائية الساعة 3:00 صباحاً داخل **`/opt/elhelb-backups/`**.

---

## الخيار 2: التشغيل عبر Docker / Docker Compose 🐳

```bash
unzip -q elhelb-boards-server.zip
cd elhelb-boards
docker compose up -d --build
```
- يعمل التطبيق داخل الحاوية بمستخدم محدود الصلاحيات (**`USER node`**) مع `--ignore-scripts`.
- يرتبط افتراضياً بـ **`127.0.0.1:3000`** ليُمرَّر خلف بوابة HTTPS (Nginx / Caddy)، ويولّد تلقائياً `JWT_SECRET` وكلمة مرور `admin` المبدئية في Docker Volume (`/data/.admin_init_password` — تظهر في `docker logs elhelb-boards` عند أول إقلاع).

---

## الخيار 3: سيرفر Windows Server 🪟

1. ثبّت **Node.js 22 LTS (64-bit)** من `https://nodejs.org/`.
2. شغّل **`start-windows-server.bat`**؛ سيولّد تلقائياً `data\.jwt_secret` و `data\.admin_init_password` ويربط الخدمة محلياً بـ `127.0.0.1:3000` لربطها خلف IIS / Caddy بشهادة HTTPS.

---

## 🔒 النشر السحابي (Vercel / Render / Railway)
عند النشر على منصة سحابية، أضف المتغيرات السرية التالية في إعدادات البيئة (Environment Variables):
- **`JWT_SECRET`**: مفتاح عشوائي لا يقل عن 32 حرفاً (مستقل تماماً عن مفاتيح التخزين).
- **`ADMIN_INIT_PASSWORD`**: كلمة المرور الأولية لحساب `admin` (10 أحرف فأكثر).
- **`ADMIN_RESET_PASSWORD`** *(اختياري للطوارئ فقط)*: إذا أردت إعادة تعيين كلمة مرور `admin` على قاعدة بيانات قائمة، أضفه وأعد التشغيل ثم احذفه بعد الدخول.
- **`TRUST_PROXY`**: القيمة `1`.
