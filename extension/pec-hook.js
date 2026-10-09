(() => {
  if (window.__INQUERITO_PEC_HOOK__) return;
  window.__INQUERITO_PEC_HOOK__ = true;
  window.__INQUERITO_PEC_RESPONSES__ = window.__INQUERITO_PEC_RESPONSES__ || [];
  const push = (url, value) => {
    try {
      const u = String(url || '');
      if (!u || !value || typeof value !== 'object') return;
      const list = window.__INQUERITO_PEC_RESPONSES__;
      list.push({ url: u, json: value, at: Date.now() });
      if (list.length > 120) list.splice(0, list.length - 120);
      window.postMessage({ source:'inquerito-pec-hook', action:'json', payload:{url:u, json:value} }, '*');
    } catch (_) {}
  };
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
      const ct = response.headers.get('content-type') || '';
      if (/json/i.test(ct)) {
        response.clone().json().then(data => push(url, data)).catch(() => {});
      }
    } catch (_) {}
    return response;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    this.__inqueritoUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function(...args) {
    this.addEventListener('load', function() {
      try {
        const ct = this.getResponseHeader('content-type') || '';
        if (/json/i.test(ct) && this.responseText) {
          const data = JSON.parse(this.responseText);
          push(this.__inqueritoUrl || '', data);
        }
      } catch (_) {}
    });
    return originalSend.apply(this, args);
  };
  window.postMessage({ source:'inquerito-pec-hook', action:'ready' }, '*');
})();
