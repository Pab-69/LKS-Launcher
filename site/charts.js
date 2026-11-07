/* Courbes et tracé d'un passage (canvas), au style du launcher. */
(function () {
  'use strict';
  var COL = { d: 0, t: 1, speed: 2, gas: 3, brake: 4, gear: 5, rpm: 6, steer: 7, angle: 8, x: 9, z: 10 };
  var RED = '#e01b3a', BONE = '#ece5da', GRID = '#261e22', TEXT = '#6c615c';

  function setup(canvas, height) {
    var w = canvas.parentElement ? canvas.parentElement.clientWidth : 300;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = height * dpr;
    canvas.style.width = '100%';
    canvas.style.height = height + 'px';
    var g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    return { g: g, w: w };
  }

  /** Une courbe : valeur selon la distance (0 → 1), survol = valeur + point sur la carte. */
  function chart(opts) {
    var wrap = window.LKS.h('div.chart', window.LKS.h('div.chart-head', window.LKS.h('span.label', opts.label), window.LKS.h('span.chart-value')));
    var canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    var rows = opts.rows;
    var get = opts.get;
    var yMin = opts.yMin, yMax = opts.yMax;
    var hover = null;
    function draw() {
      var s = setup(canvas, opts.height || 110);
      var g = s.g, w = s.w, H = opts.height || 110;
      var px = function (d) { return 4 + d * (w - 8); };
      var py = function (v) { return H - 6 - ((v - yMin) / (yMax - yMin || 1)) * (H - 12); };
      g.strokeStyle = GRID;
      g.lineWidth = 1;
      for (var k = 0; k <= 4; k++) { g.beginPath(); g.moveTo(0, 6 + k * (H - 12) / 4); g.lineTo(w, 6 + k * (H - 12) / 4); g.stroke(); }
      if (opts.zero) { g.strokeStyle = TEXT; g.beginPath(); g.moveTo(0, py(0)); g.lineTo(w, py(0)); g.stroke(); }
      g.strokeStyle = RED;
      g.lineWidth = 1.6;
      g.beginPath();
      rows.forEach(function (r, i) {
        var x = px(r[COL.d]), y = py(Math.max(yMin, Math.min(yMax, get(r))));
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      });
      g.stroke();
      if (hover !== null) {
        g.strokeStyle = BONE;
        g.beginPath(); g.moveTo(px(hover), 0); g.lineTo(px(hover), H); g.stroke();
      }
    }
    function at(d) {
      var best = rows[0];
      for (var i = 0; i < rows.length; i++) if (Math.abs(rows[i][COL.d] - d) < Math.abs(best[COL.d] - d)) best = rows[i];
      return best;
    }
    var api = {
      el: wrap,
      draw: draw,
      show: function (d) {
        hover = d;
        var r = d === null ? null : at(d);
        wrap.querySelector('.chart-value').textContent = r ? opts.format(get(r)) : '';
        draw();
      },
    };
    canvas.addEventListener('mousemove', function (e) {
      var b = canvas.getBoundingClientRect();
      var d = Math.max(0, Math.min(1, (e.clientX - b.left - 4) / (b.width - 8)));
      if (opts.onHover) opts.onHover(d);
    });
    canvas.addEventListener('mouseleave', function () { if (opts.onHover) opts.onHover(null); });
    return api;
  }

  /** Tracé vu du dessus, couleur selon l'angle ; clips du parcours ; point survolé. */
  function trackMap(rows, opts) {
    opts = opts || {};
    var canvas = document.createElement('canvas');
    canvas.className = 'map';
    var dot = null;
    function draw() {
      if (!rows.length) return;
      var H = opts.height || 360;
      var s = setup(canvas, H);
      var g = s.g, w = s.w;
      var xs = rows.map(function (r) { return r[COL.x]; }), zs = rows.map(function (r) { return r[COL.z]; });
      var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs), minZ = Math.min.apply(null, zs), maxZ = Math.max.apply(null, zs);
      var k = Math.min((w - 24) / (maxX - minX || 1), (H - 24) / (maxZ - minZ || 1));
      var ox = 12 + (w - 24 - (maxX - minX) * k) / 2, oz = 12 + (H - 24 - (maxZ - minZ) * k) / 2;
      var px = function (x) { return ox + (x - minX) * k; }, pz = function (z) { return oz + (z - minZ) * k; };
      g.lineWidth = 3;
      g.lineCap = 'round';
      for (var i = 1; i < rows.length; i++) {
        var a = Math.min(60, rows[i][COL.angle]) / 60;
        g.strokeStyle = 'rgba(' + Math.round(108 + a * 116) + ',' + Math.round(97 - a * 70) + ',' + Math.round(92 - a * 34) + ',1)';
        g.beginPath();
        g.moveTo(px(rows[i - 1][COL.x]), pz(rows[i - 1][COL.z]));
        g.lineTo(px(rows[i][COL.x]), pz(rows[i][COL.z]));
        g.stroke();
      }
      (opts.clips || []).forEach(function (c) {
        g.fillStyle = c.hit ? '#3fcf86' : '#6c615c';
        g.beginPath(); g.arc(px(c.x), pz(c.z), 4, 0, Math.PI * 2); g.fill();
      });
      if (dot !== null) {
        var best = rows[0];
        for (var j = 0; j < rows.length; j++) if (Math.abs(rows[j][COL.d] - dot) < Math.abs(best[COL.d] - dot)) best = rows[j];
        g.fillStyle = BONE;
        g.beginPath(); g.arc(px(best[COL.x]), pz(best[COL.z]), 5, 0, Math.PI * 2); g.fill();
      }
    }
    return { el: canvas, draw: draw, show: function (d) { dot = d; draw(); } };
  }

  window.LKSCharts = { COL: COL, chart: chart, trackMap: trackMap };
})();
