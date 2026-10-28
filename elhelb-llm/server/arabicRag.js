/**
 * محرك الهلب المحلي للفهرسة الدلالية والاسترجاع الهجين (100% Offline Arabic + English Vector & BM25 Engine)
 * يعمل محلياً بالكامل بدون إرسال أي حرف إلى خوادم خارجية (Zero External Embeddings API)
 */

const VECTOR_DIM = 512;

const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

const STOP_WORDS = new Set([
  'في', 'من', 'علي', 'على', 'الي', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'ذلك', 'تلك',
  'التي', 'الذي', 'الذين', 'ما', 'ماذا', 'هو', 'هي', 'هم', 'نحن', 'انا', 'انت',
  'ان', 'أن', 'إن', 'كان', 'كانت', 'يكون', 'تكون', 'قد', 'تم', 'يتم', 'كل', 'بعض',
  'او', 'أو', 'ثم', 'بل', 'لا', 'لم', 'لن', 'لو', 'اذا', 'إذا', 'حيث', 'بين', 'عند',
  'هل', 'كيف', 'متي', 'متى', 'اين', 'أين', 'لماذا', 'كم', 'اي', 'أي',
  // عامية مصرية شائعة في الأسئلة
  'عاوز', 'عايز', 'عاوزه', 'عايزه', 'ايه', 'إيه', 'ازاي', 'إزاي', 'امتي', 'امتى',
  'فين', 'ليه', 'بتاع', 'بتاعت', 'بتوع', 'اللي', 'الي', 'ده', 'دي', 'دول', 'كده',
  'بس', 'يعني', 'ممكن', 'ينفع', 'اعرف', 'قولي', 'قلي', 'وضح', 'اشرح', 'بخصوص',
  // English stop words
  'the', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'and',
  'or', 'with', 'by', 'from', 'as', 'what', 'how', 'when', 'where', 'who', 'can',
]);

// مجموعات المترادفات (تربط العامية المصرية بالفصحى الإدارية والمالية)
const SYNONYM_GROUPS = [
  ['راتب', 'رواتب', 'مرتب', 'مرتبات', 'اجر', 'اجور', 'قبض', 'مستحقات', 'بدل', 'بدلات', 'salary', 'payroll'],
  ['اجازه', 'اجازات', 'عطله', 'عطلات', 'غياب', 'عارضه', 'سنويه', 'مرضيه', 'راحه', 'leave', 'vacation'],
  ['حضور', 'انصراف', 'تاخير', 'تأخير', 'مواعيد', 'دوام', 'بصمه', 'ساعات', 'شيفت', 'استئذان'],
  ['جزاء', 'جزاءات', 'عقوبه', 'خصم', 'انذار', 'لفت', 'مخالفه', 'تحقيق'],
  ['خصم', 'تخفيض', 'عموله', 'عمولات', 'بونص', 'حافز', 'حوافز', 'نسبه', 'تسعير', 'اسعار', 'سعر', 'شريحه'],
  ['عميل', 'عملاء', 'تعاقد', 'عقد', 'عقود', 'صفقه', 'مبيعات', 'تحصيل', 'ائتمان', 'دفعه', 'تقسيط'],
  ['مورد', 'موردين', 'مشتريات', 'توريد', 'توريدات', 'امر', 'شراء', 'مناقصه', 'عروض', 'مخزن', 'مخازن'],
  ['تامين', 'طبي', 'صحي', 'علاج', 'مستشفي', 'عياده', 'ادويه', 'اسره'],
  ['توسع', 'فرع', 'فروع', 'استثمار', 'ميزانيه', 'استحواذ', 'خطه', 'استراتيجيه', 'ارباح', 'تمويل'],
  ['امان', 'امن', 'سريه', 'تشفير', 'باسورد', 'صلاحيه', 'صلاحيات', 'تسريب', 'بيانات', 'نسخ'],
  ['ترقيه', 'تقييم', 'اداء', 'تدريب', 'اختبار', 'تعيين', 'استقاله', 'مكافاه', 'نهايه'],
  ['مبيد', 'مبيدات', 'مكافحه', 'افه', 'افات', 'حشري', 'فطري', 'حشائش', 'اكاروس', 'عنكبوت', 'نيماتودا', 'حفار', 'ندوه', 'رش'],
  ['محصول', 'محاصيل', 'بطاطس', 'طماطم', 'موالح', 'عنب', 'قمح', 'قطن', 'مانجو', 'فراوله', 'سماد', 'اسمده', 'مغذيات', 'فدان'],
  ['تصدير', 'دول', 'عالمي', 'اقليمي', 'عنوان', 'تليفون', 'تواصل', 'مؤسس', 'تاسست', 'جيزه'],
];

const TOKEN_TO_CONCEPT = new Map();
SYNONYM_GROUPS.forEach((group, idx) => {
  const conceptId = `__concept_${idx}__`;
  for (const rawWord of group) {
    const norm = normalizeArabic(rawWord);
    TOKEN_TO_CONCEPT.set(norm, conceptId);
    TOKEN_TO_CONCEPT.set(stemArabicToken(norm), conceptId);
  }
});

function normalizeArabic(input) {
  if (!input) return '';
  let s = String(input).toLowerCase();
  // تحويل الأرقام الهندية إلى أرقام عربية قياسية
  s = s.replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC_DIGITS.indexOf(d)));
  // إزالة التشكيل والتطويل
  s = s.replace(ARABIC_DIACRITICS, '').replace(/\u0640/g, '');
  // توحيد الهمزات والتاء المربوطة والألف المقصورة
  s = s
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
  // إبقاء الحروف العربية والإنجليزية والأرقام والنسب
  s = s.replace(/[^\u0621-\u064Aa-z0-9%\s.]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
}

function stemArabicToken(word) {
  if (!word || word.length <= 3) return word;
  // لا نمس الأرقام أو الكلمات الإنجليزية القصيرة
  if (/^[a-z0-9.%]+$/.test(word)) return word;

  let w = word;
  const prefixes = ['وال', 'بال', 'كال', 'فال', 'لل', 'ال'];
  for (const pre of prefixes) {
    if (w.startsWith(pre) && w.length - pre.length >= 3) {
      w = w.slice(pre.length);
      break;
    }
  }
  if (w.startsWith('و') && w.length >= 5) {
    w = w.slice(1);
  }

  const suffixes = ['ات', 'ون', 'ين', 'ان', 'هم', 'هن', 'كم', 'نا', 'ها', 'يه', 'تي', 'ته', 'ه', 'ي'];
  for (const suf of suffixes) {
    if (w.endsWith(suf) && w.length - suf.length >= 3) {
      w = w.slice(0, -suf.length);
      break;
    }
  }
  return w;
}

function tokenize(text) {
  const norm = normalizeArabic(text);
  if (!norm) return { rawTokens: [], stems: [], concepts: [] };

  const rawTokens = norm
    .split(' ')
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));

  const stems = [];
  const concepts = new Set();

  for (const tok of rawTokens) {
    const stem = stemArabicToken(tok);
    if (stem && !STOP_WORDS.has(stem)) {
      stems.push(stem);
    }
    const c1 = TOKEN_TO_CONCEPT.get(tok);
    const c2 = TOKEN_TO_CONCEPT.get(stem);
    if (c1) concepts.add(c1);
    if (c2) concepts.add(c2);
  }

  return {
    rawTokens,
    stems,
    concepts: Array.from(concepts),
  };
}

function hashFeature(str, seed = 0x811c9dc5) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function addWeightedFeature(vec, feature, weight) {
  const h1 = hashFeature(feature, 0x811c9dc5);
  const h2 = hashFeature(feature, 0x9e3779b9);
  const idx = h1 % VECTOR_DIM;
  const sign = (h2 & 1) === 0 ? 1 : -1;
  vec[idx] += sign * weight;
}

/**
 * توليد متجه كثيف (512 بُعداً) مطبّع L2 محلياً بالكامل
 */
function computeLocalEmbedding(text) {
  const vec = new Float32Array(VECTOR_DIM);
  const { rawTokens, stems, concepts } = tokenize(text);

  for (let i = 0; i < stems.length; i++) {
    const stem = stems[i];
    addWeightedFeature(vec, `s:${stem}`, 2.5);
    if (i + 1 < stems.length) {
      addWeightedFeature(vec, `bi:${stem}_${stems[i + 1]}`, 1.8);
    }
  }

  for (const tok of rawTokens) {
    addWeightedFeature(vec, `w:${tok}`, 1.6);
    const gramWord = stemArabicToken(tok);
    if (gramWord.length >= 3) {
      const padded = `<${gramWord}>`;
      for (let n = 3; n <= 4; n++) {
        for (let i = 0; i + n <= padded.length; i++) {
          addWeightedFeature(vec, `c${n}:${padded.slice(i, i + n)}`, 0.55);
        }
      }
    }
  }

  for (const concept of concepts) {
    addWeightedFeature(vec, `syn:${concept}`, 2.1);
  }

  // L2 Normalization
  let normSq = 0;
  for (let i = 0; i < VECTOR_DIM; i++) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq);
  if (norm > 1e-8) {
    for (let i = 0; i < VECTOR_DIM; i++) {
      vec[i] /= norm;
    }
  }
  return vec;
}

function serializeVector(float32Vec) {
  return Buffer.from(float32Vec.buffer, float32Vec.byteOffset, float32Vec.byteLength).toString('base64');
}

function deserializeVector(base64Str) {
  const buf = Buffer.from(base64Str, 'base64');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(ab);
}

function cosineSimilarity(vecA, vecB) {
  let dot = 0;
  const len = Math.min(vecA.length, vecB.length);
  for (let i = 0; i < len; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}

/**
 * تقسيم المستندات الذكي إلى مقاطع متداخلة مع الحفاظ على العناوين الفرعية
 */
function chunkDocument(content, docTitle = '', options = {}) {
  const maxChars = options.maxChars || 560;
  const overlapChars = options.overlapChars || 90;

  const clean = String(content || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];

  const blocks = clean.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const chunks = [];
  let currentHeading = docTitle || 'قسم عام';
  let buffer = '';

  const flushBuffer = () => {
    const trimmed = buffer.trim();
    if (!trimmed) return;
    chunks.push({
      sectionTitle: currentHeading,
      text: trimmed,
    });
  };

  for (const block of blocks) {
    const firstLine = block.split('\n')[0].trim();
    if (/^(?:#{1,4}\s+|(?:\d+[-.)]|أولاً|ثانياً|ثالثاً|رابعاً|خامساً|البند)\s+)/.test(firstLine) && firstLine.length < 110) {
      currentHeading = firstLine.replace(/^#{1,4}\s+/, '').trim();
    }

    if ((buffer + '\n\n' + block).trim().length <= maxChars) {
      buffer = buffer ? `${buffer}\n\n${block}` : block;
    } else {
      if (buffer) {
        flushBuffer();
        const linesOfBuf = buffer.split('\n');
        const lastLine = linesOfBuf[linesOfBuf.length - 1] || '';
        const tail = lastLine.length <= overlapChars ? lastLine : '';
        buffer = '';
        if (block.length <= maxChars) {
          buffer = tail ? `${tail}\n${block}`.trim() : block;
        }
      }
      if (!buffer && block.length > maxChars) {
        // تقسيم الفقرة الطويلة على حدود الأسطر والجمل الكاملة دون قطع أي كلمة
        const sentences = block.split(/\n+|(?<=[.؟!])\s+/).filter(Boolean);
        let sub = '';
        for (const sent of sentences) {
          if ((sub + '\n' + sent).trim().length <= maxChars) {
            sub = sub ? `${sub}\n${sent}` : sent;
          } else {
            if (sub) {
              chunks.push({ sectionTitle: currentHeading, text: sub.trim() });
            }
            sub = sent.trim();
          }
        }
        if (sub.trim()) {
          buffer = sub.trim();
        }
      } else if (!buffer) {
        buffer = block;
      }
    }
  }

  if (buffer.trim()) {
    flushBuffer();
  }

  return chunks.map((ch, index) => {
    const searchable = `${docTitle} — ${ch.sectionTitle}\n${ch.text}`;
    const vec = computeLocalEmbedding(searchable);
    const { stems, concepts } = tokenize(searchable);
    return {
      chunkIndex: index,
      sectionTitle: ch.sectionTitle,
      text: ch.text,
      embeddingBase64: serializeVector(vec),
      tokenMetaJson: JSON.stringify({
        stems: Array.from(new Set(stems)).slice(0, 80),
        concepts,
      }),
    };
  });
}

/**
 * البحث الهجين على المتجهات المسموحة + رصد الوثائق المحجوبة أمنياً قبل فك التشفير!
 */
function searchIndex(query, indexedChunks, canAccessFn, topK = 4) {
  const queryVec = computeLocalEmbedding(query);
  const { stems: qStems, concepts: qConcepts } = tokenize(query);
  const qStemSet = new Set(qStems);
  const qConceptSet = new Set(qConcepts);

  // حساب IDF مبسط على مستوى المقاطع
  const N = Math.max(indexedChunks.length, 1);
  const df = new Map();
  for (const ch of indexedChunks) {
    const meta = ch._parsedMeta || JSON.parse(ch.token_meta_json || '{"stems":[],"concepts":[]}');
    ch._parsedMeta = meta;
    for (const s of meta.stems) {
      df.set(s, (df.get(s) || 0) + 1);
    }
  }

  const authorizedScored = [];
  const blockedMatches = [];

  for (const ch of indexedChunks) {
    const chunkVec = ch._parsedVec || deserializeVector(ch.embedding_base64);
    ch._parsedVec = chunkVec;

    const cosine = Math.max(0, cosineSimilarity(queryVec, chunkVec));
    const meta = ch._parsedMeta;

    let lexicalScore = 0;
    let maxPossibleLexical = 0.001;
    for (const qs of qStemSet) {
      const idf = Math.log(1 + (N - (df.get(qs) || 0) + 0.5) / ((df.get(qs) || 0) + 0.5));
      maxPossibleLexical += idf;
      if (meta.stems.includes(qs)) {
        lexicalScore += idf;
      }
    }
    const normalizedLexical = qStemSet.size > 0 ? Math.min(1, lexicalScore / maxPossibleLexical) : 0;

    let conceptOverlap = 0;
    if (qConceptSet.size > 0 && meta.concepts?.length) {
      let hits = 0;
      for (const c of meta.concepts) {
        if (qConceptSet.has(c)) hits++;
      }
      conceptOverlap = Math.min(1, hits / qConceptSet.size);
    }

    const hybridScore = cosine * 0.48 + normalizedLexical * 0.38 + conceptOverlap * 0.14;

    const hasSemanticSignal = normalizedLexical > 0 || conceptOverlap > 0 || cosine >= 0.34;
    if (!hasSemanticSignal || hybridScore < 0.2) continue;

    if (canAccessFn(ch)) {
      authorizedScored.push({
        chunk: ch,
        score: Number(hybridScore.toFixed(4)),
        cosine: Number(cosine.toFixed(4)),
        lexical: Number(normalizedLexical.toFixed(4)),
      });
    } else if (hybridScore >= 0.22) {
      blockedMatches.push({
        docId: ch.doc_id,
        docTitle: ch.doc_title,
        department: ch.department,
        classification: ch.classification,
        score: Number(hybridScore.toFixed(4)),
      });
    }
  }

  authorizedScored.sort((a, b) => b.score - a.score);

  // إزالة التكرار المفرط من نفس المقطع والتنويع الذكي
  const selected = authorizedScored.slice(0, topK);

  // تجميع الوثائق الفريدة التي تم حجبها أمنياً
  const uniqueBlockedDocs = new Map();
  for (const b of blockedMatches) {
    if (!uniqueBlockedDocs.has(b.docId) || uniqueBlockedDocs.get(b.docId).score < b.score) {
      uniqueBlockedDocs.set(b.docId, b);
    }
  }

  return {
    matches: selected,
    blockedDocs: Array.from(uniqueBlockedDocs.values()).sort((a, b) => b.score - a.score),
    queryAnalysis: {
      normalizedQuery: normalizeArabic(query),
      extractedTerms: qStems,
      detectedConcepts: qConcepts.length,
      vectorDimensions: VECTOR_DIM,
    },
  };
}

module.exports = {
  VECTOR_DIM,
  normalizeArabic,
  stemArabicToken,
  tokenize,
  computeLocalEmbedding,
  chunkDocument,
  searchIndex,
};
