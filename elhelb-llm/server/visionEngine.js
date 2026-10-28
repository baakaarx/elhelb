const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const araPkg = require('@tesseract.js-data/ara');
const engPkg = require('@tesseract.js-data/eng');
const { DATA_DIR } = require('./dataDir');

const TESS_DIR = path.join(DATA_DIR, 'tessdata');

let ocrWorkerPromise = null;

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
  if (Buffer.isBuffer(imageInput)) return imageInput;
  const str = String(imageInput).trim();
  const match = str.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  const base64Data = match ? match[1] : str;
  return Buffer.from(base64Data, 'base64');
}

/**
 * تحليل طيفي وبصري لألوان البكسلات لرصد صور النباتات وأمراض الأوراق الزراعية (ندوة / تبقعات / اصفرار / بياض دقيقي)
 */
async function analyzePlantPathologyPixels(rawBuffer) {
  const { data, info } = await sharp(rawBuffer)
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

    // 3) بقع نخرية بنية داكنة أو سوداء (ندوة متأخرة / مبكرة / لفحة / عفن)
    if (lum >= 14 && lum <= 105 && r >= b * 1.05 && g <= r * 1.08 && !(r < 35 && g < 35 && b < 35 && sat < 0.06)) {
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
  const w = info.width;
  const h = info.height;
  const radius = 6;

  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      const idx = y * w + x;
      const cls = pixelClass[idx];
      if (cls !== 2 && cls !== 4) continue;

      const hasGreenNeighbor =
        pixelClass[(y - radius) * w + x] === 1 ||
        pixelClass[(y + radius) * w + x] === 1 ||
        pixelClass[y * w + (x - radius)] === 1 ||
        pixelClass[y * w + (x + radius)] === 1;

      if (hasGreenNeighbor) {
        if (cls === 2) lesionNearGreen++;
        if (cls === 4) powderyNearGreen++;
      }
    }
  }

  const leafLesionPct = Number(((lesionNearGreen / totalPixels) * 100).toFixed(1));
  const leafPowderyPct = Number(((powderyNearGreen / totalPixels) * 100).toFixed(1));

  const isPlantPhoto = greenPct >= 16 && paperPct < 55;

  let plantCondition = 'healthy_or_general_plant';
  let symptomLabel = 'نبات / أوراق خضراء';
  let suspectedIssue = null;

  if (isPlantPhoto) {
    if (leafLesionPct >= 1.2 || (rawNecroticPct >= 5 && greenPct >= 22)) {
      plantCondition = 'blight_or_leaf_spot';
      symptomLabel = 'أوراق نباتية يظهر عليها بقع نخرية داكنة / لفحة (اشتباه ندوة مبكرة أو متأخرة)';
      suspectedIssue = 'blight';
    } else if (yellowPct >= 7) {
      plantCondition = 'chlorosis_or_mites';
      symptomLabel = 'أوراق نباتية يظهر عليها اصفرار وشحوب (اشتباه أكاروس / عنكبوت أحمر أو إجهاد ونقص عناصر)';
      suspectedIssue = 'chlorosis_mites';
    } else if (leafPowderyPct >= 3.5 && paperPct < 20) {
      plantCondition = 'powdery_mildew';
      symptomLabel = 'أوراق نباتية يظهر عليها مظهر بقع بيضاء سطحية (اشتباه بياض دقيقي أو ذبابة بيضاء)';
      suspectedIssue = 'powdery';
    }
  }

  return {
    isPlantPhoto,
    greenPct,
    leafLesionPct,
    rawNecroticPct,
    yellowPct,
    leafPowderyPct,
    plantCondition,
    symptomLabel,
    suspectedIssue,
  };
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
async function analyzeImageBuffer(input) {
  const rawBuffer = parseImageInputToBuffer(input);
  if (!rawBuffer || rawBuffer.length < 32) {
    throw new Error('ملف الصورة غير صالح أو فارغ.');
  }

  const image = sharp(rawBuffer).rotate();
  const meta = await image.metadata();
  const stats = await image.stats();

  const width = meta.width || 0;
  const height = meta.height || 0;
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
  const thumbBuf = await sharp(rawBuffer)
    .rotate()
    .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 76 })
    .toBuffer();
  const thumbnailDataUrl = `data:image/jpeg;base64,${thumbBuf.toString('base64')}`;

  // 3) نسخة محسنة لـ Ollama Vision (إن وُجد محلياً)
  const visionNormalizedBuf = await sharp(rawBuffer)
    .rotate()
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 86 })
    .toBuffer();

  // 4) تشغيل OCR وتنقيته بصرامة لاستبعاد التشويش من صور الأشجار والأوراق
  let rawOcrText = '';
  let ocrConfidence = 0;
  try {
    const targetOcrWidth = width > 0 && width < 1000 ? Math.min(1600, width * 2) : undefined;
    let ocrPipeline = sharp(rawBuffer).rotate();
    if (targetOcrWidth) {
      ocrPipeline = ocrPipeline.resize({ width: targetOcrWidth, withoutEnlargement: false });
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

module.exports = {
  analyzeImageBuffer,
};
