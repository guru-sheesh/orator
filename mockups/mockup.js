// Theme toggle (persists across mockup pages) + Lucide icon rendering.
(function () {
  var KEY = 'orator-mockup-theme';
  var theme = 'dark';
  try { theme = localStorage.getItem(KEY) || 'dark'; } catch (e) {}
  document.documentElement.dataset.theme = theme;

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.createElement('button');
    btn.className = 'theme-toggle';
    btn.type = 'button';
    function label() {
      btn.innerHTML = '<i data-lucide="' + (theme === 'dark' ? 'sun' : 'moon') + '"></i>' + (theme === 'dark' ? 'Light' : 'Dark') + ' mode';
      btn.setAttribute('aria-label', 'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' mode');
      if (window.lucide) lucide.createIcons();
    }
    btn.addEventListener('click', function () {
      theme = theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = theme;
      try { localStorage.setItem(KEY, theme); } catch (e) {}
      label();
    });
    // Deterministic placeholder waveforms: <div class="wave" data-bars="56" data-played=".4">
    document.querySelectorAll('.wave[data-bars], .level[data-bars]').forEach(function (el) {
      var n = +el.dataset.bars, played = +(el.dataset.played || 0), html = '';
      for (var i = 0; i < n; i++) {
        var h = 18 + Math.abs(Math.sin(i * 1.7) * 50 + Math.sin(i * .45) * 32);
        html += '<i class="' + (i / n < played ? 'played' : '') + '" style="height:' + Math.min(h, 100) + '%"></i>';
      }
      if (el.classList.contains('wave') && played) html += '<span class="head" style="left:' + played * 100 + '%"></span>';
      el.innerHTML = html;
    });
    document.body.appendChild(btn);
    label();
    if (window.lucide) lucide.createIcons();
  });
})();
