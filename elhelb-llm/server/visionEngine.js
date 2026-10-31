const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const araPkg = require('@tesseract.js-data/ara');
const engPkg = require('@tesseract.js-data/eng');
const { DATA_DIR } = require('./dataDir');

const TESS_DIR = path.join(DATA_DIR, 'tessdata');

let ocrWorkerPromise = null;
let activeVisionJobs = 0;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 25_000_000;
const MAX_OCR_EDGE = 1800;
const MAX_OCR_PIXELS = 2_500_000;
const MAX_CONCURRENT_VISION_JOBS = 1;

function getOcrResizeDimensions(width, height) {
  const w = Math.max(1, Math.floor(Number(width) || 1));
  const h = Math.max(1, Math.floor(Number(height) || 1));
  const scale = Math.min(
    1,
    MAX_OCR_EDGE / Math.max(w, h),
    Math.sqrt(MAX_OCR_PIXELS / (w * h))
  );
  return {
    width: Math.max(1, Math.floor(w * scale)),
    height: Math.max(1, Math.floor(h * scale)),
  };
}

function ensureLocalTessdata() {
  fs.mkdirSync(TESS_DIR, { recursive: true });
  const pairs = [
    { pkgDir: path.dirname(araPkg.langPath), file: 'ara.traineddata.gz' },
    { pkgDir: path.dirname(engPkg.langPath), file: 'eng.traineddata.gz' },
  ];
  for (const { pkgDir, file } of pairs) {
    const dest = path.join(TESS_DIR, file);
    if (!fs.existsSync(dest)) {
      const bestInt = path.join(pkgDir, '4.0.0_best_int', file);
      const fallback = path.join(pkgDir, '4.0.0', file);
      const src = fs.existsSync(bestInt) ? bestInt : fallback;
      fs.copyFileSync(src, dest);
    }
  }
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      ensureLocalTessdata();
      const worker = await createWorker(['ara', 'eng'], 1, {
        langPath: TESS_DIR,
        cachePath: TESS_DIR,
        gzip: true,
      });
      return worker;
    })().catch((err) => {
      ocrWorkerPromise = null;
      throw err;
    });
  }
  return ocrWorkerPromise;
}

function parseImageInputToBuffer(imageInput) {
  if (!imageInput) return null;
  if (Buffer.isBuffer(imageInput)) {
    if (imageInput.length > MAX_IMAGE_BYTES) throw new Error('حجم الصورة يتجاوز الحد المسموح (8 ميجابايت).');
    return imageInput;
  }
  const str = String(imageInput).trim();
  if (str.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 128) {
    throw new Error('حجم الصورة يتجاوز الحد المسموح (8 ميجابايت).');
  }
  const match = str.match(/^data:image\/(?:png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
  const base64Data = match ? match[1] : str;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Data) || base64Data.length % 4 === 1) {
    throw new Error('صيغة الصورة أو ترميز Base64 غير صالح.');
  }
  const buffer = Buffer.from(base64Data, 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new Error('حجم الصورة فارغ أو يتجاوز الحد المسموح (8 ميجابايت).');
  }
  return buffer;
}

/**
 * تحليل طيفي وبصري لألوان البكسلات لرصد صور النباتات وأمراض الأوراق الزراعية (ندوة / تبقعات / اصفرار / بياض دقيقي)
 */
async function analyzePlantPathologyPixels(rawBuffer) {
  const { data, info } = await sharp(rawBuffer, { limitInputPixels: MAX_IMAGE_PIXELS })
    .rotate()
    .resize({ width: 160, height: 160, fit: 'inside' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const totalPixels = info.width * info.height;
  if (!totalPixels) {
    return { isPlantPhoto: false };
  }

  let greenLeafPixels = 0;
  let darkNecroticPixels = 0;
  let yellowChloroticPixels = 0;
  let whitePowderyCandidatePixels = 0;
  let orangeRustPixels = 0;
  let neutralWhitePaperPixels = 0;

  // مصفوفة مبسطة لتحديد هل البقع الداكنة أو البيضاء تجاور نسيجاً نباتياً أخضر
  const pixelClass = new Uint8Array(totalPixels); // 1=green, 2=necrotic/brown, 3=yellow, 4=brightWhite

  for (let i = 0, p = 0; i < data.length; i += 3, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const maxC = Math.max(r, g, b);
    const minC = Math.min(r, g, b);
    const delta = maxC - minC;
    const sat = maxC === 0 ? 0 : delta / maxC;
    const lum = r * 0.299 + g * 0.587 + b * 0.114;

    // خلفية ورقية بيضاء (مستند / فاتورة)
    if (lum > 215 && sat < 0.08) {
      neutralWhitePaperPixels++;
    }

    // 1) نسيج ورقي أخضر طبيعي
    if (g > r * 1.08 && g > b * 1.14 && g >= 45 && sat >= 0.14) {
      greenLeafPixels++;
      pixelClass[p] = 1;
      continue;
    }

    // 2) اصفرار / شحوب أوراق (Chlorosis / Spider mites)
    if (r >= 135 && g >= 120 && b < g * 0.72 && r <= g * 1.32 && sat >= 0.22) {
      yellowChloroticPixels++;
      pixelClass[p] = 3;
      continue;
    }

    // إشارة صدأ برتقالية داخل النسيج؛ تُقبل فقط إذا جاورت ورقة خضراء لاحقاً.
    if (r >= 125 && g >= 55 && g <= r * 0.82 && b <= g * 0.78 && sat >= 0.35) {
      orangeRustPixels++;
      pixelClass[p] = 5;
      continue;
    }

    // النسيج البني/الداكن يُحتسب كآفة فقط إذا كان ملاصقاً لورقة، لا كخلفية تربة.
    if (lum >= 24 && lum <= 105 && r >= b * 1.08 && g <= r * 0.88 && !(r < 35 && g < 35 && b < 35 && sat < 0.08)) {
      darkNecroticPixels++;
      pixelClass[p] = 2;
      continue;
    }

    // 4) بقع بيضاء رمادية قد تكون بياضاً دقيقياً إذا أحاطت بها الأوراق الخضراء
    if (lum >= 185 && lum <= 245 && sat < 0.14) {
      whitePowderyCandidatePixels++;
      pixelClass[p] = 4;
    }
  }

  const greenPct = Number(((greenLeafPixels / totalPixels) * 100).toFixed(1));
  const paperPct = Number(((neutralWhitePaperPixels / totalPixels) * 100).toFixed(1));
  const rawNecroticPct = Number(((darkNecroticPixels / totalPixels) * 100).toFixed(1));
  const yellowPct = Number(((yellowChloroticPixels / totalPixels) * 100).toFixed(1));

  // حساب البقع النخرية والبيضاء الواقعة فعلياً بجوار النسيج النباتي الأخضر (وليس خلفية بعيدة)
  let lesionNearGreen = 0;
  let powderyNearGreen = 0;
  let rustNearGreen = 0;
  const w = info.width;
  const h = info.height;
  const radius = 2;

  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      const idx = y * w + x;
      const cls = pixelClass[idx];
      if (cls !== 2 && cls !== 4 && cls !== 5) continue;

      const greenSides = [
        pixelClass[(y - radius) * w + x], pixelClass[(y + radius) * w + x],
        pixelClass[y * w + (x - radius)], pixelClass[y * w + (x + radius)],
      ].filter((value) => value === 1).length;
      // عزل حد الورقة عن التربة: البقعة يجب أن تكون محاطة بالنسيج الأخضر من عدة جهات.
      if (greenSides >= 3) {
        if (cls === 2) lesionNearGreen++;
        if (cls === 4) powderyNearGreen++;
        if (cls === 5) rustNearGreen++;
      }
    }
  }

  const leafLesionPct = Number(((lesionNearGreen / totalPixels) * 100).toFixed(1));
  const leafPowderyPct = Number(((powderyNearGreen / totalPixels) * 100).toFixed(1));
  const rustPct = Number(((rustNearGreen / totalPixels) * 100).toFixed(1));
  const isPlantPhoto = greenPct >= 12 && paperPct < 65;
  const scores = {
    leafLesions: Math.min(1, leafLesionPct / 3),
    powdery: Math.min(1, leafPowderyPct / 6),
    chlorosis: Math.min(1, yellowPct / 18),
    rustLike: Math.min(1, rustPct / 2.5),
  };

  let plantCondition = 'healthy_or_general_plant';
  let symptomLabel = 'نبات / أوراق خضراء؛ لا تكفي الإشارات اللونية وحدها لتأكيد المرض';
  let suspectedIssue = null;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (isPlantPhoto && ranked[0][1] >= 0.22) {
    const lead = ranked[0][0];
    if (lead === 'leafLesions' && leafLesionPct >= 1.2) {
      plantCondition = 'blight_or_leaf_spot'; suspectedIssue = 'leaf_lesions';
      symptomLabel = 'اشتباه بقع نخرية داخل نسيج الورقة؛ لا يمكن التمييز بين الندوة والتبقع من اللون فقط';
    } else if (lead === 'powdery' && leafPowderyPct >= 1.8) {
      plantCondition = 'powdery_mildew'; suspectedIssue = 'powdery'; symptomLabel = 'إشارة لبقع فاتحة قرب نسيج أخضر؛ يلزم فحص طبقة الورقة';
    } else if (lead === 'chlorosis' && yellowPct >= 5) {
      plantCondition = 'chlorosis_or_mites'; suspectedIssue = 'chlorosis_mites'; symptomLabel = 'اصفرار/شحوب ورقي؛ قد يرتبط بأكاروس أو تغذية أو إجهاد';
    } else if (lead === 'rustLike' && rustPct >= 0.7) {
      plantCondition = 'rust_like'; suspectedIssue = 'rust'; symptomLabel = 'إشارة لونية برتقالية/صدئية؛ يلزم التحقق من بثرات الصدأ';
    }
  }

  return { isPlantPhoto, greenPct, leafLesionPct, rawNecroticPct, yellowPct, leafPowderyPct, rustPct, scores, plantCondition, symptomLabel, suspectedIssue };
}

/**
 * تنقية نتائج الـ OCR واستبعاد الرموز العشوائية التي قد يقرؤها المحرك خطأً من عروق الأوراق والخلفيات الطبيعية
 */
function cleanAndValidateOcrText(rawOcrText = '', ocrConfidence = 0, isPlantPhoto = false) {
  const knownBrandPattern =
    /(?:ELHELB|Capitol|Pyriban|Helban|Gold|Laveda|Nemaprobe|HelbStar|Prince|Sulphur|Diver|Tiger|Malatox|Cord|Best|INV-|ELH-|الهلب|كابيتول|بيريبان|هلبان|جولد|لافيدا|انادول|أنادول|تازولين|رولكس|دودجو|مبيد|فاتورة)/i;

  const hasKnownKeyword = knownBrandPattern.test(rawOcrText);

  const validLines = [];
  for (const rawLine of String(rawOcrText || '').split('\n')) {
    const line = rawLine.trim();
    if (line.length < 3) continue;

    const lettersAndDigits = (line.match(/[A-Za-z0-9\u0621-\u064A]/g) || []).length;
    const ratio = lettersAndDigits / line.length;
    const realWords = line.match(/[A-Za-z]{4,}|[\u0621-\u064A]{3,}/g) || [];

    if (knownBrandPattern.test(line)) {
      validLines.push(line);
    } else if (!isPlantPhoto && ratio >= 0.62 && realWords.length >= 1 && ocrConfidence >= 55) {
      validLines.push(line);
    } else if (isPlantPhoto && ratio >= 0.78 && realWords.length >= 2 && ocrConfidence >= 72) {
      validLines.push(line);
    }
  }

  const cleanText = validLines.join('\n').trim();
  const isGenuineText =
    hasKnownKeyword ||
    (!isPlantPhoto && ocrConfidence >= 58 && validLines.length >= 1 && cleanText.length >= 12) ||
    (isPlantPhoto && ocrConfidence >= 75 && validLines.length >= 2);

  return {
    text: isGenuineText ? cleanText : '',
    hasReadableText: Boolean(isGenuineText && cleanText.length >= 5),
  };
}

function extractStructuredSignalsFromText(text, plantAnalysis) {
  const clean = String(text || '').trim();
  const percentages = Array.from(new Set(clean.match(/\b\d{1,3}(?:\.\d+)?\s*%/g) || []));
  const amounts = Array.from(
    new Set(
      (
        clean.match(
          /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d{3,8}(?:\.\d+)?\s*(?:جنيه|ج\.م|EGP|USD|ريال)?\b/gi
        ) || []
      )
        .map((m) => m.trim())
        .filter((m) => !/^202\d$/.test(m))
    )
  ).slice(0, 10);

  const dates = Array.from(
    new Set(clean.match(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b|\b\d{1,2}[-/]\d{1,2}[-/]20\d{2}\b/g) || [])
  );

  const refCodes = Array.from(
    new Set(clean.match(/\b(?:INV|PO|ORD|SKU|ELH)[-\s#]*\d{2,8}\b|#\s*\d{3,8}/gi) || [])
  );

  let docType = 'صورة فوتوغرافية عامة';
  if (plantAnalysis?.isPlantPhoto && !clean) {
    docType = plantAnalysis.symptomLabel;
  } else if (/Capitol|Pyriban|Helban|Gold|Laveda|Nemaprobe|ELH-|مبيد|عبوة|مستحضر/i.test(clean)) {
    docType = 'صورة عبوة / استفسار مستحضر زراعي';
  } else if (/فاتور|invoice|عرض سعر|quotation|اجمالي|إجمالي|total|ضريب|خصم|discount/i.test(clean)) {
    docType = 'فاتورة مبيعات / عرض سعر';
  } else if (clean.length >= 20) {
    docType = 'مستند نصي مصوّر';
  }

  return {
    docType,
    percentages,
    amounts,
    dates,
    refCodes,
  };
}

/**
 * تحليل الصورة محلياً بالكامل (فحص أمراض النباتات والأوراق + قراءة العبوات والمستندات OCR بدون إنترنت)
 */
async function analyzeImageBufferInternal(input) {
  const rawBuffer = parseImageInputToBuffer(input);
  if (!rawBuffer || rawBuffer.length < 32) {
    throw new Error('ملف الصورة غير صالح أو فارغ.');
  }

  const image = sharp(rawBuffer, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate();
  let meta;
  try {
    meta = await image.metadata();
  } catch (error) {
    if (/exceeds pixel limit/i.test(String(error?.message || ''))) {
      throw new Error('أبعاد الصورة تتجاوز الحد المسموح (25 ميجابكسل).');
    }
    throw error;
  }
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);
  if (!['jpeg', 'png', 'webp'].includes(meta.format) || !width || !height || width * height > MAX_IMAGE_PIXELS) {
    throw new Error('الصورة غير مدعومة أو أبعادها تتجاوز الحد المسموح (25 ميجابكسل).');
  }
  const stats = await image.stats();

  const rMean = stats.channels?.[0]?.mean || 128;
  const gMean = stats.channels?.[1]?.mean || 128;
  const bMean = stats.channels?.[2]?.mean || 128;
  const brightness = Math.round(rMean * 0.299 + gMean * 0.587 + bMean * 0.114);
  const avgStdDev = Math.round(
    ((stats.channels?.[0]?.stdev || 0) +
      (stats.channels?.[1]?.stdev || 0) +
      (stats.channels?.[2]?.stdev || 0)) /
      Math.min(3, stats.channels?.length || 1)
  );

  // 1) التحليل الزراعي الطيفي للأوراق والإصابات النباتية
  const plantAnalysis = await analyzePlantPathologyPixels(rawBuffer);

  // 2) مصغّر خفيف للعرض في الشات
  const thumbBuf = await sharp(rawBuffer, { limitInputPixels: MAX_IMAGE_PIXELS })
    .rotate()
    .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 76 })
    .toBuffer();
  const thumbnailDataUrl = `data:image/jpeg;base64,${thumbBuf.toString('base64')}`;

  // 3) نسخة محسنة لـ Ollama Vision (إن وُجد محلياً)
  const visionNormalizedBuf = await sharp(rawBuffer, { limitInputPixels: MAX_IMAGE_PIXELS })
    .rotate()
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 86 })
    .toBuffer();

  // 4) تشغيل OCR وتنقيته بصرامة لاستبعاد التشويش من صور الأشجار والأوراق
  let rawOcrText = '';
  let ocrConfidence = 0;
  try {
    const ocrDimensions = getOcrResizeDimensions(width, height);
    let ocrPipeline = sharp(rawBuffer, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate();
    if (ocrDimensions.width !== width || ocrDimensions.height !== height) {
      ocrPipeline = ocrPipeline.resize({
        width: ocrDimensions.width,
        height: ocrDimensions.height,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }
    const ocrReadyPng = await ocrPipeline.grayscale().normalize().sharpen().png().toBuffer();

    const worker = await getOcrWorker();
    const { data } = await worker.recognize(ocrReadyPng);
    rawOcrText = String(data?.text || '');
    ocrConfidence = Math.round(data?.confidence || 0);
  } catch {
    rawOcrText = '';
    ocrConfidence = 0;
  }

  const validatedOcr = cleanAndValidateOcrText(rawOcrText, ocrConfidence, plantAnalysis.isPlantPhoto);
  const signals = extractStructuredSignalsFromText(validatedOcr.text, plantAnalysis);

  return {
    thumbnailDataUrl,
    ollamaBase64: visionNormalizedBuf.toString('base64'),
    plantAnalysis,
    imageMeta: {
      format: (meta.format || 'image').toUpperCase(),
      width,
      height,
      sizeKb: Math.round(rawBuffer.length / 1024),
      brightness,
      contrast: avgStdDev,
      dominantColor: stats.dominant || { r: Math.round(rMean), g: Math.round(gMean), b: Math.round(bMean) },
      lightingQuality:
        brightness < 55
          ? 'إضاءة منخفضة'
          : brightness > 235 && avgStdDev < 18
            ? 'سطوع مرتفع'
            : 'إضاءة واضحة للتحليل',
      sceneHint: signals.docType,
    },
    ocr: {
      text: validatedOcr.text,
      confidence: validatedOcr.hasReadableText ? ocrConfidence : 0,
      hasReadableText: validatedOcr.hasReadableText,
    },
    signals,
  };
}

async function analyzeImageBuffer(input) {
  if (activeVisionJobs >= MAX_CONCURRENT_VISION_JOBS) {
    const err = new Error('محلل الصور مشغول الآن؛ انتظر لحظات ثم أعد المحاولة.');
    err.status = 429;
    throw err;
  }
  activeVisionJobs += 1;
  try {
    return await analyzeImageBufferInternal(input);
  } finally {
    activeVisionJobs -= 1;
  }
}

module.exports = {
  analyzeImageBuffer,
  analyzePlantPathologyPixels,
  getOcrResizeDimensions,
};
