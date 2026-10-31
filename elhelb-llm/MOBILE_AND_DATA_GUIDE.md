# دليل إضافة بيانات الشركة وربط تطبيق الموبايل — ELHELB GROUP AI

بما أن واجهة الموقع العامة مفتوحة للجمهور كـ **شات بوت فقط** (بدون أي تبويبات إدارية ظاهرة للناس)، يمكنك التحكم في البيانات وربط تطبيق الموبايل كالتالي:

---

## 1️⃣ كيفية إضافة أو تعديل بيانات ومنتجات الشركة بسهولة
ضع أي ملفات نصية (`.md` أو `.txt`) أو جداول بيانات (`.csv` أو `.tsv` أو `.json`) داخل المجلد:
```
elhelb-llm/company-data/
```
عند تشغيل السيرفر، يفهرس الملفات الموجودة في المجلد. الملفات المصنفة `general` و`products` و`agri_clinic` والمضافة ضمن بيانات المستودع المعتمدة تكون متاحة للشات العام؛ أما `sales` و`inventory` وأي ملفات تشغيلية أخرى فتبقى خاصة.

**كل إضافة إدارية جديدة خاصة افتراضياً.** لا تجعلها متاحة للزوار إلا بعد مراجعة محتواها وإرسال `"isPublic": true` صراحةً. تُشفّر المستندات والجداول ومحادثات المستخدمين والبيانات التدريبية في SQLite باستخدام `AES-256-GCM`، مع سياسة حذف افتراضية للمحادثات والسجلات بعد 30 يوماً. استخدم `ELHELB_VAULT_KEY` و`ELHELB_ADMIN_KEY` كأسرار بيئة مستقلة عن ملف قاعدة البيانات، ولا تضعهما في المستودع.

مثال لإضافة مستند خاص (الافتراضي):
```bash
curl -X POST http://YOUR_SERVER:4000/api/v1/data/ingest \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $ELHELB_ADMIN_KEY" \
  -d '{"type":"document","title":"مستند داخلي","category":"sales","content":"تفاصيل داخلية..."}'
```

لنشر مستند مراجَع للعملاء، أضف `"isPublic": true` بعد التحقق من عدم احتوائه على بيانات داخلية أو شخصية. ينطبق الخيار نفسه على `type: "dataset"`. أمثلة التدريب لا تُستخدم في الشات العام إلا إذا أُنشئت صراحةً مع `is_public: true`.

**مهم للنشر:** SQLite على Vercel يُخزّن حالياً في `/tmp`، وهو تخزين مؤقت وغير مشترك بين المثيلات. لا تعتمد عليه لحفظ الإضافات الإدارية أو السجلات بصورة دائمة؛ يلزم ربط قاعدة بيانات/تخزين دائم قبل استخدامه إنتاجياً. Docker Compose يربط مجلد `./data` كتخزين محلي مستمر.

---

## 2️⃣ ربط الشات بوت وتحليل الصور داخل تطبيق الموبايل (Mobile App)

حد رفع الصورة **8 ميجابايت** وبحد أقصى **25 ميجابكسل**. محددا المعدل الحاليان (60 طلب شات و12 طلب صورة بالدقيقة) يستخدمان مخزن ذاكرة محلياً لكل مثيل؛ يلزم مخزن مشترك على مستوى البنية التحتية عند التوسع لعدة مثيلات.

### أ) كود Flutter (Dart) — إرسال سؤال أو صورة كاميرا
```dart
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;

Future<String> askElhelbBot(String message, {File? imageFile, required String userSessionId}) async {
  final uri = Uri.parse('https://YOUR_DOMAIN/api/v1/chat');
  final req = http.MultipartRequest('POST', uri)
    ..fields['message'] = message
    ..fields['sessionId'] = userSessionId; // UUID v4 عشوائي خاص بالمستخدم؛ احتفظ به كسِر لاستعادة سجله

  if (imageFile != null) {
    req.files.add(await http.MultipartFile.fromPath('image', imageFile.path));
  }

  final streamed = await req.send();
  final body = await streamed.stream.bytesToString();
  final data = jsonDecode(body);
  return data['reply'] ?? '';
}
```

### ب) كود React Native / Expo
```javascript
export async function askElhelbBot(message, imageAsset, userSessionId) {
  const form = new FormData();
  form.append('message', message);
  form.append('sessionId', userSessionId);

  if (imageAsset) {
    form.append('image', {
      uri: imageAsset.uri,
      name: 'photo.jpg',
      type: 'image/jpeg',
    });
  }

  const res = await fetch('https://YOUR_DOMAIN/api/v1/chat', {
    method: 'POST',
    body: form,
  });
  const data = await res.json();
  return data.reply;
}
```

### ج) مسار متوافق مع مكتبات OpenAI SDK القياسية
- المسار: `POST /v1/chat/completions`
- الموديل: `elhelb-ai-v1`
- يدعم رسائل النصوص والصور (`image_url` بصيغة Base64 Data URL).

---

## 3️⃣ ملفات الشعار الرسمية الجاهزة للتطبيق
- أيقونة تطبيق الموبايل (`1024×1024`): `elhelb-llm/static/elhelb-ai-app-logo.png`
- الشعار الرسمي المفرغ الشفاف: `elhelb-llm/static/logo.png`
