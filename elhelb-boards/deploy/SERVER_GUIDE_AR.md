# دليل تشغيل المنصة على السيرفر الخاص + التعديل الحي (Live Edit) — مجموعة الهلب

## أولاً: تشغيل المشروع على سيرفر Ubuntu جديد بأمر واحد فقط 🚀

بمجرد استلام السيرفر (Ubuntu 22.04 أو 24.04) والدخول عليه بـ `SSH`:

### أ) للتشغيل الفوري عبر IP السيرفر (`http://SERVER_IP:3000`):
```bash
curl -fsSL https://raw.githubusercontent.com/baakaarx/elhelb/main/elhelb-boards/deploy/install-server.sh | sudo bash
```

### ب) للتشغيل مباشرة على دومين رسمي بشهادة `HTTPS` مجانية تلقائية (مثل `boards.elhelbgroup.com`):
1. اربط سجل `A Record` للدومين بـ IP السيرفر.
2. شغّل هذا الأمر الواحد:
```bash
curl -fsSL https://raw.githubusercontent.com/baakaarx/elhelb/main/elhelb-boards/deploy/install-server.sh | sudo DOMAIN=boards.elhelbgroup.com bash
```

### ماذا يفعل هذا الأمر تلقائياً؟
- يثبّت `Node.js 22` + `PM2` + `Caddy HTTPS`.
- يفصل قاعدة بيانات الشركة في مجلد محمي مستقل: **`/opt/elhelb-data/elhelb-boards.db`** (خارج مجلد الكود تماماً حتى لا تُمسح أبداً عند أي تحديث للكود!).
- ينشئ نسخاً احتياطية يومية تلقائية في **`/opt/elhelb-backups/`**.
- يشغّل الموقع تلقائياً حتى لو أُعيد تشغيل السيرفر الكهربائياً.

---

## ثانياً: كيف تعدّل على المشروع Live بعد رفعه على السيرفر؟ ⚡

لديك **طريقتان احترافيتان** للتعديل الحي (Live) بدون إيقاف الموقع وبدون مسح أي موظف أو كارت:

### الطريقة 1: التعديل التلقائي عبر GitHub / Arena (الأسهل!)
المثبّت يفعّل خدمة مزامنة ذكية (`/usr/local/bin/elhelb-update`) تفحص فرع `main` على GitHub كل دقيقة:
1. اطلب أي تعديل هنا في **Arena** (أو عدّل من جهازك وارفع على `main`) ثم ادمج الـ **PR**.
2. السيرفر يلتقط التعديل **تلقائياً**، يأخذ نسخة احتياطية فورية من الداتا، يبني الواجهة الجديدة، ويعمل `pm2 reload` بدون لحظة توقف واحدة وبدون المساس بـ `/opt/elhelb-data/elhelb-boards.db`!
- *(وللتحديث الفوري في نفس الثانية من داخل السيرفر شغّل أمر: `elhelb-update`)*.

### الطريقة 2: التعديل المباشر Live عبر برنامج VS Code على السيرفر نفسه
1. افتح **VS Code** على جهازك وثبّت إضافة **Remote - SSH**.
2. اتصل بالسيرفر (`ssh root@SERVER_IP`) وافتح المجلد `/opt/elhelb/elhelb-boards`.
3. شغّل في التيرمينال أمر المراقبة الحية المدمج:
   ```bash
   npm run live
   ```
4. الآن أي ملف تعدله وتحفظه (`Ctrl + S`):
   - في `src/` (الواجهة والتصميم): يُعاد بناؤه Live في **ثانيتين** فقط.
   - في `server/` (الباك إند): يُعاد تحميل `PM2` لحظياً مع بقاء الداتا كما هي 100%.

---

## ثالثاً: التشغيل بـ Docker (اختياري)
إذا كنت تفضّل Docker على أي سيرفر أو سحابة (Railway / Coolify / VPS):
```bash
cd elhelb-boards
docker compose up -d --build
```
*(يحفظ الداتا بشكل دائم داخل Volume محمي اسمه `elhelb_boards_data`)*.
