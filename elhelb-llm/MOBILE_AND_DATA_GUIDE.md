# دليل إضافة بيانات الشركة وربط تطبيق الموبايل — ELHELB GROUP AI

بما أن واجهة الموقع العامة مفتوحة للجمهور كـ **شات بوت فقط** (بدون أي تبويبات إدارية ظاهرة للناس)، يمكنك التحكم في البيانات وربط تطبيق الموبايل كالتالي:

---

## 1️⃣ كيفية إضافة أو تعديل بيانات ومنتجات الشركة بسهولة
ضع أي ملفات نصية (`.md` أو `.txt`) أو جداول بيانات (`.csv` أو `.tsv` أو `.json`) داخل المجلد:
```
elhelb-llm/company-data/
```
عند تشغيل السيرفر، سيقوم تلقائياً بقراءة أي ملفات جديدة وتشفيرها بتقنية `AES-256-GCM` وفهرستها للرد الفوري على أسئلة الجمهور والموبايل.

كما يمكن الإضافة برمجياً عن بُعد عبر إرسال مفتاح الإدارة السري الموجود على السيرفر في `elhelb-llm/data/.admin.key`:
```bash
curl -X POST http://YOUR_SERVER:4000/api/v1/data/ingest \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: $(cat elhelb-llm/data/.admin.key)" \
  -d '{"type":"document","title":"مستحضر جديد","content":"تفاصيل ومعدلات استخدام المستحضر..."}'
```

---

## 2️⃣ ربط الشات بوت وتحليل الصور داخل تطبيق الموبايل (Mobile App)

### أ) كود Flutter (Dart) — إرسال سؤال أو صورة كاميرا
```dart
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;

Future<String> askElhelbBot(String message, {File? imageFile, required String userSessionId}) async {
  final uri = Uri.parse('https://YOUR_DOMAIN/api/v1/chat');
  final req = http.MultipartRequest('POST', uri)
    ..fields['message'] = message
    ..fields['sessionId'] = userSessionId; // UUID خاص بكل مستخدم في التطبيق

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
