// iOS Safari's bottom address bar floats over the page, and 100dvh still counts the part
// behind it, so the tab bar and the end of forms (their Save buttons) were hidden under it.
// The visual viewport is only what can be seen, so the app is sized to that instead.
(function () {
  var viewport = window.visualViewport;
  if (!viewport) return;
  function update() {
    // Pinch-zooming shrinks the visual viewport too; the app shouldn't shrink with it
    if (viewport.scale > 1.01) return;
    // Down to where the visible area ends: if Safari has scrolled the page (say for the
    // keyboard), the part above it still counts
    var height = viewport.height + Math.max(0, viewport.offsetTop);
    document.documentElement.style.setProperty('--visible-height', Math.round(height) + 'px');
  }
  update();
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);

  // ?viewport-debug shows what the browser reports, to see how much its bars cover on a phone
  if (location.search.indexOf('viewport-debug') === -1) return;
  var probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:1px;visibility:hidden;' +
    'padding-bottom:env(safe-area-inset-bottom)';
  var box = document.createElement('pre');
  box.style.cssText = 'position:fixed;top:60px;left:8px;z-index:99999;margin:0;padding:8px;' +
    'background:rgba(0,0,0,.85);color:#fff;font:12px/1.4 monospace;pointer-events:none';
  document.body.appendChild(probe);
  document.body.appendChild(box);
  function heightOf(unit) {
    probe.style.height = '100' + unit;
    return Math.round(probe.getBoundingClientRect().height);
  }
  function show() {
    probe.style.height = '0';
    var safe = Math.round(probe.getBoundingClientRect().height);
    box.textContent = [
      'innerHeight ' + window.innerHeight,
      'visual ' + Math.round(viewport.height) + ' top ' + Math.round(viewport.offsetTop) + ' scale ' + viewport.scale,
      'dvh ' + heightOf('dvh') + ' svh ' + heightOf('svh') + ' lvh ' + heightOf('lvh'),
      'safe bottom ' + safe,
      'app ' + Math.round(document.getElementById('root').getBoundingClientRect().height),
    ].join('\n');
  }
  show();
  viewport.addEventListener('resize', show);
  viewport.addEventListener('scroll', show);
})();
