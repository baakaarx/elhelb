# دليل إضافة الشات بوت في موقع الشركة الأساسي (`https://elhelbgroup.com/`)

بما أن موقع **`https://elhelbgroup.com/`** يعمل على **WordPress**، فقد جهزنا في المشروع ملف **`/widget.js`** لتركيبه بسطر كود واحد فقط بدون تعديل أي كود معقد في الموقع الأساسي.

---

## الخطوة 1: تشغيل سيرفر الشات بوت على دومين فرعي للشركة
ارفع مجلد `elhelb-llm` على سيرفر الشركة (VPS أو Cloud) واربطه بدومين فرعي رسمي مزود بشهادة SSL (`HTTPS` مهمة جداً لعمل المايكروفون الصوتي)، مثلاً:
`https://ai.elhelbgroup.com`

وشغّله بالأوامر:
```bash
cd elhelb-llm
npm install
npm run build
PORT=4000 npm start
```

---

## الخطوة 2: إضافة سطر واحد في لوحة تحكم ووردبريس (`elhelbgroup.com/wp-admin`)

### الطريقة الأولى: زر الشات العائم في جميع صفحات الموقع (موصى بها)
1. ادخل إلى لوحة تحكم ووردبريس لموقع `elhelbgroup.com`.
2. افتح إضافة **WPCode – Insert Headers and Footers** (أو قسم **Footer Scripts** في إعدادات القالب / عنصر HTML في الفوتر عبر Elementor).
3. الصق السطر الواحد التالي في خانة **Footer**:
```html
<script src="https://ai.elhelbgroup.com/widget.js" defer></script>
```
*(إذا أردت ظهور الأيقونة في يسار الشاشة بدلاً من اليمين أضف `data-position="left"`)*:
```html
<script src="https://ai.elhelbgroup.com/widget.js" data-position="left" defer></script>
```
4. اضغط **Save** — ستظهر أيقونة **ELHELB GROUP** الذهبية العائمة فوراً لكل زوار الموقع على الكمبيوتر والموبايل مع دعم كامل للتحدث بالصوت وتحليل صور المحاصيل والعبوات!

---

### الطريقة الثانية (اختيارية): تضمين الشات داخل صفحة كاملة مثل صفحة «العيادة الزراعية»
أضف بلوك **Custom HTML** داخل الصفحة في ووردبريس أو Elementor وضع فيه:
```html
<iframe
  src="https://ai.elhelbgroup.com/"
  allow="microphone; clipboard-read; clipboard-write"
  style="width:100%; height:82vh; min-height:620px; border:none; border-radius:20px; box-shadow:0 12px 36px rgba(0,0,0,0.12);"
  title="المساعد الذكي لمجموعة الهلب">
</iframe>
```
