const { normalizeArabic, tokenize } = require('./arabicRag');

function parseCsvLine(line, delimiter = ',') {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseTabularData(rawInput) {
  if (Array.isArray(rawInput)) {
    return rawInput.filter((r) => r && typeof r === 'object');
  }

  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.rows)) return parsed.rows;
      if (Array.isArray(parsed.data)) return parsed.data;
    } catch {
      // نكمل كـ CSV
    }
  }

  const lines = trimmed
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const first = lines[0];
  const delimiter = first.includes('\t')
    ? '\t'
    : first.split(';').length > first.split(',').length
      ? ';'
      : ',';

  const headers = parseCsvLine(first, delimiter).map((h, i) => h || `col_${i + 1}`);
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i], delimiter);
    if (values.every((v) => !v)) continue;
    const obj = {};
    headers.forEach((h, idx) => {
      const rawVal = values[idx] ?? '';
      const cleanNum = rawVal.replace(/,/g, '').replace(/\s*(?:جنيه|ج\.م|EGP|%)\s*$/i, '');
      if (cleanNum !== '' && /^-?\d+(?:\.\d+)?$/.test(cleanNum)) {
        obj[h] = Number(cleanNum);
      } else {
        obj[h] = rawVal;
      }
    });
    rows.push(obj);
  }

  return rows;
}

function profileDataset(name, rows) {
  if (!rows || rows.length === 0) {
    return { columns: [], summaryText: '', stats: {} };
  }

  const colNames = Object.keys(rows[0]);
  const columns = colNames.map((col) => {
    const numericVals = rows
      .map((r) => r[col])
      .filter((v) => typeof v === 'number' && !Number.isNaN(v));
    const isNumeric = numericVals.length >= Math.ceil(rows.length * 0.6);

    if (isNumeric && numericVals.length > 0) {
      const sum = numericVals.reduce((a, b) => a + b, 0);
      const avg = sum / numericVals.length;
      const min = Math.min(...numericVals);
      const max = Math.max(...numericVals);
      return {
        name: col,
        type: 'number',
        sum: Number(sum.toFixed(2)),
        avg: Number(avg.toFixed(2)),
        min,
        max,
      };
    }

    const distinct = Array.from(new Set(rows.map((r) => String(r[col] ?? '')).filter(Boolean)));
    return {
      name: col,
      type: 'text',
      distinctCount: distinct.length,
      samples: distinct.slice(0, 6),
    };
  });

  const numCols = columns.filter((c) => c.type === 'number');
  const textCols = columns.filter((c) => c.type === 'text');

  const summaryLines = [`# ملخص بيانات جدول: ${name} (إجمالي ${rows.length} سجل)`];
  for (const nc of numCols) {
    summaryLines.push(
      `- إجمالي «${nc.name}»: ${nc.sum.toLocaleString('en-US')} | المتوسط: ${nc.avg.toLocaleString('en-US')} | الأعلى: ${nc.max.toLocaleString('en-US')} | الأقل: ${nc.min.toLocaleString('en-US')}`
    );
  }

  // تجميع حسب أول عمود نصي رئيسي (مثل الفرع أو الصنف أو القسم)
  if (textCols.length > 0 && numCols.length > 0) {
    const groupCol = textCols[0].name;
    const metricCol = numCols[0].name;
    const grouped = new Map();
    for (const r of rows) {
      const key = String(r[groupCol] || 'غير محدد');
      const val = typeof r[metricCol] === 'number' ? r[metricCol] : 0;
      grouped.set(key, (grouped.get(key) || 0) + val);
    }
    const sorted = Array.from(grouped.entries()).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 1 && sorted.length <= 12) {
      summaryLines.push(
        `- الترتيب حسب «${groupCol}» من حيث «${metricCol}»: ` +
          sorted.map(([k, v]) => `${k} (${Number(v.toFixed(2)).toLocaleString('en-US')})`).join(' ، ')
      );
    }
  }

  // إضافة السجلات نفسها كنص قابل للبحث الدقيق بالاسم والسعر
  summaryLines.push('\n# تفاصيل السجلات:');
  for (const r of rows.slice(0, 60)) {
    const pairs = colNames.map((c) => `${c}: ${r[c]}`).join(' | ');
    summaryLines.push(`- ${pairs}`);
  }

  return {
    columns,
    summaryText: summaryLines.join('\n'),
  };
}

/**
 * تحليل ذكي مباشر على جداول بيانات الشركة للإجابة على أسئلة التحليل والمبيعات والمخزون والأسعار
 */
function analyzeDatasetsForQuery(query, decryptedDatasets = []) {
  if (!decryptedDatasets.length) return null;

  const normQ = normalizeArabic(query);
  const { stems: qStems } = tokenize(query);
  const asksAnalysis =
    /(?:حلل|تحليل|اجمالي|إجمالي|مجموع|متوسط|اعلي|أعلى|اقل|أقل|ترتيب|مقارنه|مقارنة|مبيعات|ارباح|أرباح|مخزن|مخزون|رصيد|نواقص|فرع|فروع|سعر|اسعار|أسعار|جدول|احصائيات)/i.test(
      query
    );

  const insights = [];
  const matchedRecords = [];

  for (const ds of decryptedDatasets) {
    const dsNorm = normalizeArabic(`${ds.name} ${ds.description || ''} ${ds.columns.map((c) => c.name).join(' ')}`);
    let relevance = 0;
    for (const st of qStems) {
      if (st.length >= 3 && dsNorm.includes(st)) relevance += 2;
    }

    // فحص تطابق سجلات بعينها (مثل البحث عن صنف أو فرع أو منتج معين في الجدول أو الفاتورة!)
    for (const row of ds.rows) {
      const rowStr = normalizeArabic(Object.values(row).join(' '));
      let rowHits = 0;
      for (const st of qStems) {
        if (st.length >= 3 && rowStr.includes(st)) rowHits++;
      }
      if (rowHits >= 1 && (rowHits >= 2 || qStems.length <= 2)) {
        matchedRecords.push({
          datasetName: ds.name,
          row,
          hits: rowHits,
        });
      }
    }

    if (!asksAnalysis && relevance === 0 && matchedRecords.length === 0) continue;

    const numCols = ds.columns.filter((c) => c.type === 'number');
    const textCols = ds.columns.filter((c) => c.type === 'text');

    // رصد نواقص المخزون تلقائياً إن وجد عمود رصيد وحد طلب
    const stockCol = numCols.find((c) => /رصيد|كميه|كمية|stock|qty/i.test(c.name));
    const minOrderCol = numCols.find((c) => /حد|ادني|أدنى|طلب|reorder|min/i.test(c.name));
    let lowStockItems = [];
    if (stockCol && minOrderCol) {
      lowStockItems = ds.rows.filter(
        (r) =>
          typeof r[stockCol.name] === 'number' &&
          typeof r[minOrderCol.name] === 'number' &&
          r[stockCol.name] <= r[minOrderCol.name]
      );
    }

    // أعلى عنصر في أول مقياس رقمي
    let topBreakdown = [];
    if (textCols.length > 0 && numCols.length > 0) {
      const gCol = textCols[0].name;
      const mCol =
        numCols.find((c) => qStems.some((s) => normalizeArabic(c.name).includes(s)))?.name ||
        numCols[0].name;
      const map = new Map();
      for (const r of ds.rows) {
        const k = String(r[gCol] || 'أخرى');
        map.set(k, (map.get(k) || 0) + (Number(r[mCol]) || 0));
      }
      topBreakdown = Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([label, value]) => ({ label, metric: mCol, value: Number(value.toFixed(2)) }));
    }

    if (relevance > 0 || asksAnalysis) {
      insights.push({
        datasetId: ds.id,
        datasetName: ds.name,
        rowCount: ds.rows.length,
        metrics: numCols.slice(0, 4),
        topBreakdown,
        lowStockItems: lowStockItems.slice(0, 6),
        relevance: relevance + (lowStockItems.length > 0 && /مخزن|رصيد|نواقص|توريد/.test(query) ? 4 : 0),
      });
    }
  }

  insights.sort((a, b) => b.relevance - a.relevance);
  matchedRecords.sort((a, b) => b.hits - a.hits);

  if (insights.length === 0 && matchedRecords.length === 0) return null;

  return {
    insights: insights.slice(0, 2),
    matchedRecords: matchedRecords.slice(0, 6),
  };
}

module.exports = {
  parseTabularData,
  profileDataset,
  analyzeDatasetsForQuery,
};
