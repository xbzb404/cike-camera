/* 原生壳（Android WebView）适配层。用浏览器打开时整段空转，不影响网页版。 */
(function () {
  var A = window.WMCAndroid;
  if (!A) return;
  window.__WMC_NATIVE__ = true;
  document.documentElement.classList.add('wmc-native');

  // 资源全部内置在 APK 里，Service Worker 只会带来旧缓存
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function (rs) {
        rs.forEach(function (r) { r.unregister().catch(function () {}); });
      }).catch(function () {});
    }
  } catch (e) {}

  // WebView 没有多窗口支持，target=_blank 点了会没反应：改成当前页跳转
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el !== document.body) {
      if (el.tagName === 'A' && el.getAttribute('target') === '_blank') {
        e.preventDefault();
        var href = el.getAttribute('href');
        if (href) location.href = href;
        return;
      }
      el = el.parentNode;
    }
  }, true);
})();
