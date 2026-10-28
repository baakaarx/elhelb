(function () {
  if (window.__ELHELB_AI_WIDGET_LOADED__) return;
  window.__ELHELB_AI_WIDGET_LOADED__ = true;

  var currentScript =
    document.currentScript ||
    document.querySelector('script[src*="widget.js"]');

  var scriptSrc = currentScript ? currentScript.src : window.location.href;
  var baseUrl = '';
  try {
    var fullUrl = new URL(scriptSrc, window.location.href).href;
    baseUrl = fullUrl.replace(/\/widget\.js(?:\?.*)?$/i, '').replace(/\/+$/, '');
  } catch (e) {
    baseUrl = window.location.origin;
  }

  if (currentScript && currentScript.getAttribute('data-server')) {
    baseUrl = currentScript.getAttribute('data-server').replace(/\/+$/, '');
  }

  var side = (currentScript && currentScript.getAttribute('data-position')) === 'left' ? 'left' : 'right';
  var greeting =
    (currentScript && currentScript.getAttribute('data-greeting')) ||
    'اسأل العيادة الزراعية والمساعد الذكي 🌱';

  function mountWidget() {
    var host = document.createElement('div');
    host.id = 'elhelb-ai-widget-host';
    document.body.appendChild(host);

    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    var style = document.createElement('style');
    style.textContent =
      ':host { all: initial; }' +
      '.elh-wrap {' +
      '  position: fixed;' +
      '  bottom: 22px;' +
      '  ' + side + ': 22px;' +
      '  z-index: 2147483000;' +
      '  font-family: "Cairo", "Segoe UI", Tahoma, Arial, sans-serif;' +
      '  direction: rtl;' +
      '}' +
      '.elh-launcher-row {' +
      '  display: flex;' +
      '  align-items: center;' +
      '  gap: 12px;' +
      '  flex-direction: ' + (side === 'right' ? 'row' : 'row-reverse') + ';' +
      '}' +
      '.elh-tooltip {' +
      '  background: #05080e;' +
      '  color: #f8fafc;' +
      '  border: 1px solid rgba(212, 169, 10, 0.65);' +
      '  padding: 9px 15px;' +
      '  border-radius: 999px;' +
      '  font-size: 13.5px;' +
      '  font-weight: 700;' +
      '  white-space: nowrap;' +
      '  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);' +
      '  cursor: pointer;' +
      '  display: flex;' +
      '  align-items: center;' +
      '  gap: 8px;' +
      '  transition: transform 0.2s ease, opacity 0.2s ease;' +
      '}' +
      '.elh-tooltip:hover { transform: translateY(-2px); }' +
      '.elh-tooltip.hidden { display: none; }' +
      '.elh-dot {' +
      '  width: 8px;' +
      '  height: 8px;' +
      '  border-radius: 50%;' +
      '  background: #22c55e;' +
      '  box-shadow: 0 0 8px #22c55e;' +
      '}' +
      '.elh-btn {' +
      '  width: 64px;' +
      '  height: 64px;' +
      '  border-radius: 50%;' +
      '  border: 2px solid #d4a90a;' +
      '  background: radial-gradient(circle at 50% 38%, rgba(0, 159, 227, 0.28), #04060b 74%);' +
      '  box-shadow: 0 12px 32px rgba(4, 6, 11, 0.45), 0 0 0 0 rgba(212, 169, 10, 0.45);' +
      '  cursor: pointer;' +
      '  padding: 9px;' +
      '  display: flex;' +
      '  align-items: center;' +
      '  justify-content: center;' +
      '  transition: transform 0.2s ease, box-shadow 0.2s ease;' +
      '  animation: elhPulse 2.8s infinite;' +
      '}' +
      '.elh-btn:hover { transform: scale(1.06); }' +
      '.elh-btn img { width: 100%; height: 100%; object-fit: contain; pointer-events: none; }' +
      '@keyframes elhPulse {' +
      '  0% { box-shadow: 0 12px 32px rgba(4, 6, 11, 0.45), 0 0 0 0 rgba(212, 169, 10, 0.5); }' +
      '  70% { box-shadow: 0 12px 32px rgba(4, 6, 11, 0.45), 0 0 0 14px rgba(212, 169, 10, 0); }' +
      '  100% { box-shadow: 0 12px 32px rgba(4, 6, 11, 0.45), 0 0 0 0 rgba(212, 169, 10, 0); }' +
      '}' +
      '.elh-panel {' +
      '  position: fixed;' +
      '  bottom: 98px;' +
      '  ' + side + ': 22px;' +
      '  width: 410px;' +
      '  height: min(640px, calc(100vh - 120px));' +
      '  background: #ffffff;' +
      '  border-radius: 22px;' +
      '  border: 1.5px solid rgba(212, 169, 10, 0.55);' +
      '  box-shadow: 0 24px 64px rgba(4, 6, 11, 0.38);' +
      '  overflow: hidden;' +
      '  opacity: 0;' +
      '  pointer-events: none;' +
      '  transform: translateY(18px) scale(0.97);' +
      '  transition: opacity 0.22s ease, transform 0.22s ease;' +
      '}' +
      '.elh-panel.open {' +
      '  opacity: 1;' +
      '  pointer-events: auto;' +
      '  transform: translateY(0) scale(1);' +
      '}' +
      '.elh-iframe {' +
      '  width: 100%;' +
      '  height: 100%;' +
      '  border: none;' +
      '  display: block;' +
      '  background: #f6f8fb;' +
      '}' +
      '@media (max-width: 520px) {' +
      '  .elh-tooltip { font-size: 12px; padding: 7px 12px; }' +
      '  .elh-panel {' +
      '    inset: 0;' +
      '    bottom: 0;' +
      '    right: 0;' +
      '    left: 0;' +
      '    width: 100%;' +
      '    height: 100%;' +
      '    border-radius: 0;' +
      '    border: none;' +
      '  }' +
      '}';

    var wrap = document.createElement('div');
    wrap.className = 'elh-wrap';

    var panel = document.createElement('div');
    panel.className = 'elh-panel';

    var iframeLoaded = false;
    var iframe = document.createElement('iframe');
    iframe.className = 'elh-iframe';
    iframe.title = 'المساعد الذكي لمجموعة الهلب — ELHELB GROUP AI';
    iframe.setAttribute('allow', 'microphone; clipboard-read; clipboard-write');

    panel.appendChild(iframe);

    var launcherRow = document.createElement('div');
    launcherRow.className = 'elh-launcher-row';

    var tooltip = document.createElement('div');
    tooltip.className = 'elh-tooltip';
    tooltip.innerHTML = '<span class="elh-dot"></span><span>' + greeting + '</span>';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'elh-btn';
    btn.setAttribute('aria-label', 'افتح المساعد الذكي لمجموعة الهلب');
    btn.innerHTML = '<img src="' + baseUrl + '/logo.png" alt="ELHELB AI" />';

    var isOpen = false;
    function toggleOpen(forceState) {
      isOpen = typeof forceState === 'boolean' ? forceState : !isOpen;
      if (isOpen && !iframeLoaded) {
        iframe.src = baseUrl + '/?embed=1';
        iframeLoaded = true;
      }
      if (isOpen) {
        panel.classList.add('open');
        tooltip.classList.add('hidden');
      } else {
        panel.classList.remove('open');
      }
    }

    btn.addEventListener('click', function () {
      toggleOpen();
    });

    tooltip.addEventListener('click', function () {
      toggleOpen(true);
    });

    window.addEventListener('message', function (ev) {
      if (ev && ev.data && ev.data.type === 'ELHELB_WIDGET_CLOSE') {
        toggleOpen(false);
      }
    });

    launcherRow.appendChild(tooltip);
    launcherRow.appendChild(btn);

    wrap.appendChild(panel);
    wrap.appendChild(launcherRow);

    root.appendChild(style);
    root.appendChild(wrap);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountWidget);
  } else {
    mountWidget();
  }
})();
