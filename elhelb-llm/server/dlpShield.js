/**
 * درع منع تسريب البيانات الحساسة (DLP & PII Redaction Shield)
 * يكتشف ويحجب الأرقام القومية، الحسابات البنكية، البطاقات، كلمات المرور، ومفاتيح الـ API
 */

const RULES = [
  {
    id: 'api_secret',
    label: 'مفتاح API أو رمز سري',
    severity: 'critical',
    regex: /\b(?:sk-[a-zA-Z0-9_-]{16,}|ghp_[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|Bearer\s+[A-Za-z0-9._-]{24,})\b/g,
    replacement: '[🔒 مفتاح سري محجوب]',
    alwaysActive: true,
  },
  {
    id: 'inline_password',
    label: 'كلمة مرور صريحة',
    severity: 'critical',
    regex: /(?:كلمة\s*المرور|كلمه\s*السر|الباسورد|password|passcode)\s*[:=]\s*[^\s،,]+/gi,
    replacement: '[🔒 كلمة مرور محجوبة]',
    alwaysActive: true,
  },
  {
    id: 'egypt_iban',
    label: 'رقم حساب بنكي دولي (IBAN)',
    severity: 'high',
    regex: /\bEG\d{2}[0-9A-Z]{20,27}\b/gi,
    replacement: '[🔒 حساب IBAN محمي]',
    alwaysActive: true,
  },
  {
    id: 'egypt_national_id',
    label: 'الرقم القومي المصري (14 رقم)',
    severity: 'high',
    regex: /\b[23]\d{13}\b/g,
    replacement: '[🔒 رقم قومي مشفر]',
    alwaysActive: true,
  },
  {
    id: 'bank_card',
    label: 'رقم بطاقة بنكية',
    severity: 'high',
    regex: /\b(?:\d{4}[-\s]){3}\d{4}\b|\b(?:4\d{15}|5[1-5]\d{14})\b/g,
    replacement: '[🔒 بطاقة بنكية محمية]',
    alwaysActive: true,
  },
  {
    id: 'egypt_phone',
    label: 'رقم هاتف محمول مصري',
    severity: 'medium',
    regex: /\b01[0125]\d{8}\b/g,
    replacement: '[🔒 رقم هاتف محمي]',
    alwaysActive: false,
  },
];

function inspectAndSanitize(text, options = {}) {
  const mode = options.mode || 'mask'; // 'mask' | 'warn' | 'block' | 'off'
  const maskPhones = Boolean(options.maskPhones);

  if (!text || mode === 'off') {
    return {
      sanitizedText: String(text || ''),
      findings: [],
      blocked: false,
    };
  }

  let current = String(text);
  const findings = [];

  for (const rule of RULES) {
    if (!rule.alwaysActive && rule.id === 'egypt_phone' && !maskPhones) {
      continue;
    }
    const matches = current.match(rule.regex);
    if (matches && matches.length > 0) {
      findings.push({
        id: rule.id,
        label: rule.label,
        severity: rule.severity,
        count: matches.length,
      });
      if (mode === 'mask') {
        current = current.replace(rule.regex, rule.replacement);
      }
    }
  }

  return {
    sanitizedText: current,
    findings,
    blocked: mode === 'block' && findings.length > 0,
  };
}

module.exports = {
  inspectAndSanitize,
};
