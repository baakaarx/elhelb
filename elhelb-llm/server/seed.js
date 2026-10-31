const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { get, run } = require('./db');
const { ingestDocument, ingestDataset, getDecryptedDatasets } = require('./vaultService');
const { parseTabularData } = require('./dataAnalytics');
const { encryptField } = require('./secureFields');
const { hashMobileKey } = require('./mobileKey');

const COMPANY_DATA_DIR = path.join(__dirname, '..', 'company-data');

function inferCategoryFromFilename(name) {
  const lower = name.toLowerCase();
  if (lower.includes('clinic') || lower.includes('crop') || lower.includes('عياد')) return 'agri_clinic';
  if (lower.includes('product') || lower.includes('catalog') || lower.includes('منتج')) return 'products';
  if (lower.includes('herbicide') || lower.includes('nutrition') || lower.includes('مبيد') || lower.includes('تغذ')) return 'products';
  if (lower.includes('sale') || lower.includes('مبيعات')) return 'sales';
  if (lower.includes('inv') || lower.includes('مخزن')) return 'inventory';
  // Unknown company files are private-by-default, never silently published as general knowledge.
  return 'private';
}

function syncCompanyDataFolder() {
  if (!fs.existsSync(COMPANY_DATA_DIR)) return;

  const entries = fs
    .readdirSync(COMPANY_DATA_DIR)
    .filter((f) => /\.(md|txt|csv|tsv|json)$/i.test(f))
    .sort();

  for (const filename of entries) {
    const fullPath = path.join(COMPANY_DATA_DIR, filename);
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) continue;

    const ext = path.extname(filename).toLowerCase();
    const rawContent = fs.readFileSync(fullPath, 'utf8').trim();
    if (!rawContent) continue;

    const category = inferCategoryFromFilename(filename);

    if (ext === '.csv' || ext === '.tsv' || ext === '.json') {
      const existingDataset = getDecryptedDatasets().find((dataset) => dataset.filename === filename);
      const latestRows = parseTabularData(rawContent);
      const isUnchanged = existingDataset && JSON.stringify(existingDataset.rows) === JSON.stringify(latestRows);
      if (!isUnchanged) {
        if (existingDataset) {
          run('DELETE FROM datasets WHERE filename = ?', [filename]);
          run("DELETE FROM documents WHERE filename = ? AND source_type = 'dataset_index'", [filename]);
        }
        const cleanTitle = filename
          .replace(/^\d+[-_]?/, '')
          .replace(/\.(csv|tsv|json)$/i, '')
          .replace(/[-_]+/g, ' ');
        ingestDataset({
          name: cleanTitle === 'elhelb products catalog'
            ? 'كتالوج مستحضرات ومبيدات مجموعة الهلب'
            : cleanTitle === 'elhelb crop programs'
              ? 'برامج توصيات العيادة الزراعية للمحاصيل'
              : cleanTitle,
          category,
          description: `بيانات مستوردة تلقائياً من مجلد company-data (${filename})`,
          filename,
          rawData: rawContent,
          isPublic: ['general', 'products', 'agri_clinic'].includes(category),
        });
      } else if (['general', 'products', 'agri_clinic'].includes(category) && !existingDataset.isPublic) {
        run('UPDATE datasets SET is_public = 1 WHERE id = ?', [existingDataset.id]);
        run("UPDATE documents SET is_public = 1 WHERE source_type = 'dataset_index' AND filename = ?", [filename]);
      }
    } else {
      const contentHash = crypto.createHash('sha256').update(rawContent, 'utf8').digest('hex');
      const existingDocument = get('SELECT id, sha256_hash FROM documents WHERE filename = ? AND source_type = ?', [filename, 'company_data_folder']);
      const isUnchanged = existingDocument && existingDocument.sha256_hash === contentHash;
      if (!isUnchanged) {
        if (existingDocument) run('DELETE FROM documents WHERE id = ?', [existingDocument.id]);
        const firstHeading = rawContent
          .split('\n')
          .find((l) => l.trim().startsWith('#'))
          ?.replace(/^#+\s*/, '')
          .trim();
        ingestDocument({
          title: firstHeading || filename,
          category,
          sourceType: 'company_data_folder',
          filename,
          content: rawContent,
          isPublic: ['general', 'products', 'agri_clinic'].includes(category),
        });
      }
    }
  }
}

function seedIfNeeded() {
  const existingProfile = get('SELECT id FROM model_profile WHERE id = 1');
  if (!existingProfile) {
    run(
      `INSERT INTO model_profile (
        id, model_name, display_name, base_model, vision_model, system_prompt, temperature, context_length
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'elhelb-ai-v1',
        'المساعد الذكي لمجموعة الهلب (ELHELB GROUP)',
        'qwen2.5:7b',
        'llama3.2-vision',
        'أنت المساعد الذكي الرسمي لمجموعة الهلب للكيماويات الزراعية والمبيدات (ELHELB GROUP — تأسست عام 1993). ساعد العملاء والمزارعين بأسلوب مصري مهذب ومتفاعل، واعتمد على بيانات الشركة والعيادة الزراعية والصور المرفقة. لا تخترع منتجات أو جرعات، واسأل سؤالاً توضيحياً واحداً عند نقص المعلومات.',
        0.15,
        8192,
      ]
    );

    const generatedMobileKey = 'elhelb_live_' + crypto.randomBytes(16).toString('hex');
    run(
      `INSERT INTO security_settings (
        id, provider, ollama_url, local_openai_url, airgap_lock, dlp_mode, mask_phones, require_mobile_key, mobile_api_key
      ) VALUES (1, 'auto', 'http://127.0.0.1:11434', 'http://127.0.0.1:8080/v1', 1, 'mask', 1, 0, ?)`,
      [hashMobileKey(generatedMobileKey)]
    );

    const examples = [
      {
        instruction: 'عندي إصابة بالحفار في أرض بطاطس، أنصحه بإيه من منتجات مجموعة الهلب وبمعدل كام؟',
        input_context: 'العيادة الزراعية ELHELB Agri-Clinic',
        output_response:
          '🌱 **توصية العيادة الزراعية لمجموعة الهلب لمكافحة الحفار في البطاطس:**\n- **المستحضر الموصى به:** مبيد **بيريبان 48% EC (`Pyriban 48% EC`)** (المادة الفعالة: كلوربيريفوس).\n- **معدل وطريقة الاستخدام:** **1 لتر للفدان** يجهز كطعم سام ويوضع **سرسبة بين الخطوط بعد الري وعند الغروب** لضمان أعلى كفاءة في القضاء على الحفار وحماية الدرنات.',
        category: 'agri_clinic',
        is_public: 1,
      },
      {
        instruction: 'كلمني عن مجموعة الهلب وتاريخها وإزاي أتواصل معاكم',
        input_context: 'الهوية الرسمية للشركة',
        output_response:
          '**مجموعة الهلب (ELHELB GROUP)** تأسست عام **1993** على يد **م. عبد الرحمن السماحي**، وهي رائدة إقليمياً وعالمياً في صناعة المبيدات والكيماويات الزراعية وتغذية المحاصيل وخدمات التصنيع للغير (**Toll Manufacturing**) تحت شعار *«علامة ترسم البسمة وقت الحصاد»*، وتصدّر لأكثر من **22 دولة حول العالم**.\n\n📞 **قنوات التواصل الرسمية:**\n- **المكتب الإقليمي:** 34 شارع جامعة الدول العربية — الجيزة، مصر\n- **داخل مصر:** `201011112221` | **التصدير وخارج مصر:** `201094460002`\n- **الموقع الرسمي:** `https://elhelbgroup.com/`',
        category: 'general',
        is_public: 1,
      },
    ];

    for (const ex of examples) {
      run(
        `INSERT INTO training_examples (instruction, input_context, output_response, category, is_public)
         VALUES (?, ?, ?, ?, ?)`,
        [
          encryptField(ex.instruction),
          encryptField(ex.input_context),
          encryptField(ex.output_response),
          ex.category,
          ex.is_public ? 1 : 0,
        ]
      );
    }
  }

  // مزامنة تلقائية لأي ملفات جديدة يتم وضعها داخل مجلد company-data/
  syncCompanyDataFolder();
}

module.exports = {
  seedIfNeeded,
  syncCompanyDataFolder,
  inferCategoryFromFilename,
};
