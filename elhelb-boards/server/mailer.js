const nodemailer = require('nodemailer');
const { getSetting, run, all } = require('./db');

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getGmailConfig() {
  const gmailUser = String(
    process.env.GMAIL_USER || getSetting('gmail_user', '')
  ).trim();
  const rawAppPassword = String(
    process.env.GMAIL_APP_PASSWORD || getSetting('gmail_app_password', '')
  );
  // Google displays App Passwords in 4x4 blocks with spaces — strip all whitespace automatically
  const gmailAppPassword = rawAppPassword.replace(/\s+/g, '');
  const senderName = String(
    getSetting('gmail_sender_name', 'منصة مجموعة الهلب — ELHELB GROUP')
  ).trim();
  const adminNotifyEmail = String(
    process.env.GMAIL_NOTIFY_EMAIL || getSetting('gmail_admin_cc', '')
  )
    .trim()
    .toLowerCase();
  const enabled = getSetting('gmail_enabled', '1') !== '0';

  return {
    gmailUser,
    gmailAppPassword,
    senderName: senderName || 'ELHELB GROUP',
    adminNotifyEmail,
    enabled,
    configured: Boolean(gmailUser && gmailAppPassword),
  };
}

function isDeliverableEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return false;
  if (clean.endsWith('@example.com')) return false;
  return true;
}

function buildArabicEmailHtml({
  heading,
  badgeText,
  badgeColor = '#15803d',
  bodyLines = [],
  otpCode = '',
  details = [],
  footerNote = 'رسالة رسمية صادرة من المنصة الرقمية الموحدة لمجموعة الهلب (ELHELB GROUP — Manufacturers of Pesticides & Agrochemicals).',
}) {
  const badgeHtml = badgeText
    ? `<div style="display:inline-block;background:${escapeHtml(
        badgeColor
      )};color:#ffffff;padding:4px 12px;border-radius:99px;font-size:12px;font-weight:700;margin-bottom:12px;">${escapeHtml(
        badgeText
      )}</div>`
    : '';

  const paragraphsHtml = bodyLines
    .map(
      (line) =>
        `<p style="margin:0 0 10px;font-size:14.5px;line-height:1.8;color:#334155;">${escapeHtml(
          line
        )}</p>`
    )
    .join('');

  const otpHtml = otpCode
    ? `<div style="margin:20px 0;padding:18px 16px;text-align:center;background:#f0fdf4;border:2px dashed #16a34a;border-radius:12px;">
         <div style="font-size:12px;font-weight:700;color:#166534;margin-bottom:6px;">كود تأكيد البريد الإلكتروني (صالح لمدة 10 دقائق)</div>
         <div dir="ltr" style="font-size:32px;font-weight:900;letter-spacing:9px;color:#071e14;font-family:'Courier New',monospace;">${escapeHtml(
           otpCode
         )}</div>
       </div>`
    : '';

  const detailsHtml =
    details.length > 0
      ? `<table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
          ${details
            .map(
              ([label, val]) => `
            <tr>
              <td style="padding:9px 14px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#071e14;font-size:13px;width:36%;">${escapeHtml(
                label
              )}</td>
              <td style="padding:9px 14px;border-bottom:1px solid #e2e8f0;color:#1e293b;font-size:13.5px;">${escapeHtml(
                val
              )}</td>
            </tr>`
            )
            .join('')}
        </table>`
      : '';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:24px 12px;background:#eef5f0;font-family:'Segoe UI',Tahoma,Arial,sans-serif;direction:rtl;text-align:right;">
  <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #cbd5e1;box-shadow:0 4px 14px rgba(7,30,20,0.08);">
    <div style="background:linear-gradient(135deg,#071e14 0%,#0f3a25 100%);padding:22px 24px;border-bottom:4px solid #d4a90a;">
      <div style="color:#fde68a;font-size:12px;font-weight:700;letter-spacing:1.2px;">ELHELB GROUP • SINCE 1993</div>
      <div style="color:#ffffff;font-size:19px;font-weight:800;margin-top:3px;">مجموعة الهلب — المنصة الرقمية لإدارة القطاعات والأقسام</div>
    </div>
    <div style="padding:24px;">
      ${badgeHtml}
      <h2 style="margin:0 0 12px;font-size:18px;color:#071e14;">${escapeHtml(heading)}</h2>
      ${paragraphsHtml}
      ${otpHtml}
      ${detailsHtml}
    </div>
    <div style="background:#f8fafc;padding:14px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;line-height:1.6;">
      ${escapeHtml(footerNote)}
    </div>
  </div>
</body>
</html>`;
}

function logEmailAttempt({ toEmail, subject, eventType, status, errorMessage = '' }) {
  try {
    run(
      `INSERT INTO email_logs (to_email, subject, event_type, status, error_message)
       VALUES (?, ?, ?, ?, ?)`,
      [
        String(toEmail || '').slice(0, 240),
        String(subject || '').slice(0, 240),
        String(eventType || 'notification').slice(0, 60),
        status,
        String(errorMessage || '').slice(0, 500),
      ]
    );
  } catch (_) {}
}

function createGmailTransport(cfg) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: cfg.gmailUser,
      pass: cfg.gmailAppPassword,
    },
    connectionTimeout: 7000,
    greetingTimeout: 6000,
    socketTimeout: 9000,
  });
}

async function sendElhelbEmail({
  to = [],
  ccAdmin = false,
  subject,
  heading,
  badgeText = '',
  badgeColor = '#0a6fa8',
  bodyLines = [],
  details = [],
  eventType = 'notification',
}) {
  const cfg = getGmailConfig();
  const rawList = Array.isArray(to) ? [...to] : [to];
  if (ccAdmin && cfg.adminNotifyEmail) {
    rawList.push(cfg.adminNotifyEmail);
  }

  const recipients = [
    ...new Set(
      rawList
        .map((e) => String(e || '').trim().toLowerCase())
        .filter(isDeliverableEmail)
    ),
  ];

  if (recipients.length === 0) {
    return { sent: false, reason: 'NO_RECIPIENTS' };
  }

  const toHeader = recipients.join(', ');

  if (!cfg.enabled || !cfg.configured) {
    logEmailAttempt({
      toEmail: toHeader,
      subject,
      eventType,
      status: 'SKIPPED_NOT_CONFIGURED',
      errorMessage: !cfg.enabled
        ? 'الإرسال عبر Gmail متوقف مؤقتاً من الإعدادات'
        : 'لم يتم إدخال بريد Gmail وكلمة مرور التطبيقات بعد',
    });
    return { sent: false, reason: 'NOT_CONFIGURED' };
  }

  const html = buildArabicEmailHtml({
    heading: heading || subject,
    badgeText,
    badgeColor,
    bodyLines,
    details,
  });

  try {
    const transporter = createGmailTransport(cfg);
    const info = await transporter.sendMail({
      from: `"${cfg.senderName.replace(/"/g, '')}" <${cfg.gmailUser}>`,
      to: toHeader,
      subject,
      html,
    });

    logEmailAttempt({
      toEmail: toHeader,
      subject,
      eventType,
      status: 'SENT',
    });

    return { sent: true, messageId: info.messageId };
  } catch (err) {
    logEmailAttempt({
      toEmail: toHeader,
      subject,
      eventType,
      status: 'FAILED',
      errorMessage: err.message || 'SMTP Error',
    });
    return { sent: false, reason: 'SMTP_ERROR', error: err.message };
  }
}

async function sendTestGmail(targetEmail) {
  const cfg = getGmailConfig();
  if (!cfg.configured) {
    const err = new Error('يرجى حفظ بريد Gmail وكلمة مرور التطبيقات (App Password) أولاً قبل إرسال الرسالة التجريبية');
    err.statusCode = 400;
    throw err;
  }
  const cleanTarget = String(targetEmail || cfg.adminNotifyEmail || cfg.gmailUser)
    .trim()
    .toLowerCase();
  if (!isDeliverableEmail(cleanTarget)) {
    const err = new Error('يرجى إدخال بريد إلكتروني صحيح لإرسال الرسالة التجريبية إليه');
    err.statusCode = 400;
    throw err;
  }

  const html = buildArabicEmailHtml({
    heading: 'تم ربط إشعارات Gmail بنجاح مع منصة مجموعة الهلب ✅',
    badgeText: 'رسالة اختبار الربط',
    badgeColor: '#059669',
    bodyLines: [
      'مرحباً بك! هذه رسالة اختبار حية تؤكد أن موقع مجموعة الهلب (ELHELB GROUP) متصل بحساب Gmail بنجاح وجاهز لإرسال الإشعارات الفورية.',
      'سيقوم النظام تلقائياً بإرسال إشعارات بريدية عند تسجيل الموظفين الجدد واختيار أقسامهم، وعند ضمهم للأقسام، وعند طلبات الصلاحيات وإسناد المهام.',
    ],
    details: [
      ['حساب الإرسال المربوط', cfg.gmailUser],
      ['المستلم التجريبي', cleanTarget],
      ['حالة الاتصال بـ Gmail SMTP', 'متصل ومؤمّن بنجاح (SSL 465)'],
    ],
  });

  try {
    const transporter = createGmailTransport(cfg);
    const info = await transporter.sendMail({
      from: `"${cfg.senderName.replace(/"/g, '')}" <${cfg.gmailUser}>`,
      to: cleanTarget,
      subject: '✅ نجاح ربط إشعارات Gmail — منصة مجموعة الهلب ELHELB GROUP',
      html,
    });
    logEmailAttempt({
      toEmail: cleanTarget,
      subject: 'رسالة اختبار ربط إشعارات Gmail',
      eventType: 'test_email',
      status: 'SENT',
    });
    return { ok: true, to: cleanTarget, messageId: info.messageId };
  } catch (smtpErr) {
    logEmailAttempt({
      toEmail: cleanTarget,
      subject: 'رسالة اختبار ربط إشعارات Gmail',
      eventType: 'test_email',
      status: 'FAILED',
      errorMessage: smtpErr.message,
    });
    const friendly = new Error(
      `تعذر الإرسال عبر Gmail: تأكد من تفعيل التحقق بخطوتين واستخدام (كلمة مرور التطبيقات - 16 حرفاً) وليس كلمة مرور الإيميل العادية. التفاصيل: ${smtpErr.message}`
    );
    friendly.statusCode = 400;
    throw friendly;
  }
}

async function sendEmailVerificationCode({ toEmail, fullName, code }) {
  const cfg = getGmailConfig();
  const cleanEmail = String(toEmail || '').trim().toLowerCase();
  if (!isDeliverableEmail(cleanEmail)) {
    return { sent: false, reason: 'INVALID_EMAIL' };
  }

  const subject = `🔐 كود تأكيد بريدك الإلكتروني (${code}) — مجموعة الهلب ELHELB GROUP`;

  if (!cfg.enabled || !cfg.configured) {
    logEmailAttempt({
      toEmail: cleanEmail,
      subject: 'كود تأكيد البريد الإلكتروني للتسجيل',
      eventType: 'email_verification',
      status: 'SKIPPED_NOT_CONFIGURED',
      errorMessage: 'لم يتم تفعيل إعدادات البريد Gmail من لوحة الإدارة بعد',
    });
    return { sent: false, reason: 'NOT_CONFIGURED' };
  }

  const html = buildArabicEmailHtml({
    heading: `أهلاً بك ${fullName || ''} في منصة مجموعة الهلب`,
    badgeText: 'تأكيد البريد الإلكتروني',
    badgeColor: '#15803d',
    bodyLines: [
      'أدخل كود التحقق التالي في شاشة التسجيل لتأكيد ملكية بريدك الإلكتروني والمتابعة لإنشاء اسم المستخدم وكلمة المرور واختيار قسمك:',
    ],
    otpCode: String(code),
    details: [
      ['البريد الإلكتروني', cleanEmail],
      ['صلاحية الكود', '10 دقائق من وقت الإرسال'],
    ],
  });

  try {
    const transporter = createGmailTransport(cfg);
    const info = await transporter.sendMail({
      from: `"${cfg.senderName.replace(/"/g, '')}" <${cfg.gmailUser}>`,
      to: cleanEmail,
      subject,
      html,
    });
    logEmailAttempt({
      toEmail: cleanEmail,
      subject: 'كود تأكيد البريد الإلكتروني للتسجيل',
      eventType: 'email_verification',
      status: 'SENT',
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    logEmailAttempt({
      toEmail: cleanEmail,
      subject: 'كود تأكيد البريد الإلكتروني للتسجيل',
      eventType: 'email_verification',
      status: 'FAILED',
      errorMessage: err.message || 'SMTP Error',
    });
    return { sent: false, reason: 'SMTP_ERROR', error: err.message };
  }
}

async function verifyGmailCredentials({ gmailUser, gmailAppPassword }) {
  const cleanUser = String(gmailUser || '').trim().toLowerCase();
  const cleanPass = String(gmailAppPassword || '').replace(/\s+/g, '');

  if (!isDeliverableEmail(cleanUser)) {
    const err = new Error('يرجى إدخال عنوان بريد Gmail صحيح');
    err.statusCode = 400;
    throw err;
  }
  if (cleanPass.length < 16) {
    const err = new Error(
      'كود تطبيقات جوجل (App Password) يجب أن يتكون من 16 حرفاً من صفحة كلمات مرور تطبيقات جوجل (وليس باسورد الإيميل العادي)'
    );
    err.statusCode = 400;
    throw err;
  }

  if (process.env.ELHELB_TEST_MODE === '1') {
    return { cleanUser, cleanPass };
  }

  try {
    const transporter = createGmailTransport({
      gmailUser: cleanUser,
      gmailAppPassword: cleanPass,
    });
    await transporter.verify();
    return { cleanUser, cleanPass };
  } catch (smtpErr) {
    const err = new Error(
      `رفض Google الاتصال بهذا الكود — تأكد أنك استخرجت (كلمة مرور التطبيقات - 16 حرفاً) من رابط حساب Google بعد تفعيل التحقق بخطوتين، وليس باسورد الإيميل العادي.`
    );
    err.statusCode = 400;
    throw err;
  }
}

function getRecentEmailLogs(limit = 50) {
  return all(`SELECT * FROM email_logs ORDER BY id DESC LIMIT ?`, [Number(limit)]);
}

module.exports = {
  getGmailConfig,
  isDeliverableEmail,
  verifyGmailCredentials,
  sendElhelbEmail,
  sendEmailVerificationCode,
  sendTestGmail,
  getRecentEmailLogs,
};
