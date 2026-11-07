/* Détail d'un passage : note détaillée, clips et zones, courbes, tracé. */
(function () {
  'use strict';
  var L = window.LKS;
  var h = L.h;
  var K = window.LKSCharts;
  var COL = K.COL;
  var box = document.getElementById('passage');
  var id = Number(new URLSearchParams(location.search).get('id'));
  var MODE = { debutant: 'Débutant', normal: 'Amateur', pro: 'Pro' };
  var KIND = { drift: 'Drift', tandem: 'Tandem', time: 'Chrono' };

  function fmtMs(ms) {
    if (!ms) return '—';
    var m = Math.floor(ms / 60000);
    var s = ((ms % 60000) / 1000).toFixed(3);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function part(label, value, max) {
    var v = Number(value) || 0;
    return h('div.part', h('span.label', label), h('div.part-bar', h('i', { style: 'width:' + Math.max(0, Math.min(100, (v / max) * 100)) + '%' })), h('strong', (Math.round(v * 10) / 10) + ' / ' + max));
  }

  if (!id) {
    L.clear(box).appendChild(h('p.status', 'Passage introuvable.'));
    return;
  }
  L.group().then(function (g) {
    var db = L.db(g);
    return db('lks_laps', 'select=id,driver,car,track,layout,kind,rules,lap_ms,score,samples,meta,created_at&id=eq.' + id).then(function (list) {
      var r = (list || [])[0];
      if (!r) throw new Error('Ce passage n’est plus sur le serveur (seuls les meilleurs sont gardés).');
      return Promise.all([L.unpack(r.samples), L.categories(g)]).then(function (res) { render(g, r, res[0].samples || [], res[1]); });
    });
  }).catch(function (err) {
    L.clear(box).appendChild(h('p.status', err.message));
  });

  function render(g, r, rows, catOf) {
    var meta = r.meta || {};
    var d = meta.drift || {};
    var t = meta.tandem || null;
    var cat = catOf(r.driver).category;
    document.title = r.driver + ' — ' + L.trackName(g, r.track, r.layout) + ' — Lowkey Syndicate';
    L.clear(box);
    box.appendChild(h('p', h('a.small', { href: 'classement.html#track=' + encodeURIComponent(r.track) + '&layout=' + encodeURIComponent(r.layout || '') }, '← Classement')));
    box.appendChild(h('div.detail-head',
      h('div',
        h('h2', r.driver, ' ', L.catBadge(cat)),
        h('p.muted', L.trackName(g, r.track, r.layout) + ' · ' + L.carName(g, r.car) + ' · ' + (KIND[r.kind] || r.kind) + (r.kind !== 'time' ? ' · notation ' + (MODE[meta.mode] || 'Amateur') : '') + ' · ' + L.dateFr(r.created_at, { day: 'numeric', month: 'long', year: 'numeric' }))),
      h('div.detail-score', r.kind === 'time' ? fmtMs(r.lap_ms) : String(Number(r.score).toFixed(1)))));

    // note détaillée
    var parts = h('div.card.parts');
    if (r.kind === 'tandem' && t) {
      parts.appendChild(h('h3', 'Chase derrière ' + ((meta.lead && meta.lead.name) || '?')));
      parts.appendChild(part('Proximité', t.proximity, 35));
      parts.appendChild(part('Angle copié', t.angleMatch, 25));
      parts.appendChild(part('Ligne du leader', t.line, 20));
      parts.appendChild(part('Drift', t.drift, 20));
      if (t.avgGap !== undefined) parts.appendChild(h('p.muted', 'Écart moyen ' + t.avgGap + ' m'));
    } else if (r.kind === 'drift') {
      var W = d.weights || { angle: 35, speed: 30, line: 35 };
      parts.appendChild(h('h3', 'Note'));
      parts.appendChild(part('Angle', d.angle, W.angle));
      parts.appendChild(part('Vitesse', d.speed, W.speed));
      parts.appendChild(part('Ligne et clips', d.line, W.line));
      if (d.penalty) parts.appendChild(h('p', h('span.warn', 'Pénalités −' + d.penalty)));
      if (d.zeroed) parts.appendChild(h('p', h('span.bad', 'Run à 0 : ' + d.zeroed)));
      var stats = [];
      if (d.avgAngle !== undefined) stats.push('angle moyen ' + Math.round(d.avgAngle) + '°');
      if (d.maxAngle !== undefined) stats.push('max ' + Math.round(d.maxAngle) + '°');
      if (d.avgSpeed !== undefined) stats.push('vitesse moyenne ' + Math.round(d.avgSpeed) + ' km/h');
      if (stats.length) parts.appendChild(h('p.muted', stats.join(' · ')));
    } else {
      parts.appendChild(h('h3', 'Tour chrono'));
      parts.appendChild(h('p', 'Vitesse max ' + Math.round(meta.topSpeed || 0) + ' km/h'));
    }
    var clipsBox = null;
    var clips = d.clips || [];
    if (clips.length) {
      var zones = {};
      (d.zones || []).forEach(function (z) { zones[z.name] = z; });
      clipsBox = h('div.card',
        h('h3', 'Clips et zones'),
        h('div.board-wrap', h('table.board.clips',
          h('thead', h('tr', h('th', 'Clip'), h('th', 'Touché'), h('th.num', 'Couverture'), h('th.num', 'Zone'))),
          h('tbody', clips.map(function (c) {
            var z = zones[c.name];
            return h('tr', h('td', c.name), h('td', c.hit ? h('span.ok', 'oui') : h('span.bad', 'non')), h('td.num', c.cover !== undefined ? c.cover + ' %' : '—'), h('td.num', z ? String(z.score) : '—'));
          })))),
        (d.penalties || []).length ? h('p.muted', 'Pénalités : ' + d.penalties.map(function (p) { return p.label + (p.zero ? ' (run à 0)' : ' (−' + p.points + ')') + ' à ' + Math.round((p.d || 0) * 100) + ' %'; }).join(' · ')) : null);
    }

    var layout = h('div.detail-layout');
    var left = h('div.detail-left', parts, clipsBox);
    var right = h('div.detail-right');
    layout.appendChild(left);
    layout.appendChild(right);
    box.appendChild(layout);

    if (!rows.length) {
      right.appendChild(h('p.status', 'Pas de courbes pour ce passage.'));
      return;
    }
    rows = rows.filter(function (x) { return Array.isArray(x) && x.length > COL.z; });
    var map = K.trackMap(rows, { height: 360 });
    var charts = [];
    var hover = function (dd) { map.show(dd); charts.forEach(function (c) { c.show(dd); }); };
    var maxSpeed = Math.max.apply(null, [20].concat(rows.map(function (x) { return x[COL.speed]; })));
    var maxAngle = Math.max.apply(null, [10].concat(rows.map(function (x) { return Math.min(90, x[COL.angle]); })));
    var steerMax = Math.max.apply(null, [0.1].concat(rows.map(function (x) { return Math.abs(x[COL.steer] || 0); })));
    var defs = [
      { label: 'Angle', get: function (x) { return Math.min(90, x[COL.angle]); }, yMin: 0, yMax: Math.ceil(maxAngle / 10) * 10, height: 120, format: function (v) { return Math.round(v) + '°'; } },
      { label: 'Vitesse', get: function (x) { return x[COL.speed]; }, yMin: 0, yMax: Math.ceil(maxSpeed / 20) * 20, height: 110, format: function (v) { return Math.round(v) + ' km/h'; } },
      { label: 'Gaz', get: function (x) { return x[COL.gas]; }, yMin: 0, yMax: 1, height: 60, format: function (v) { return Math.round(v * 100) + ' %'; } },
      { label: 'Frein', get: function (x) { return x[COL.brake]; }, yMin: 0, yMax: 1, height: 60, format: function (v) { return Math.round(v * 100) + ' %'; } },
      { label: 'Volant', get: function (x) { return x[COL.steer] || 0; }, yMin: -steerMax, yMax: steerMax, zero: true, height: 70, format: function (v) { return (v > 0 ? '+' : '') + v.toFixed(2); } },
      { label: 'Rapport', get: function (x) { return (x[COL.gear] || 1) - 1; }, yMin: 0, yMax: 7, height: 50, format: function (v) { return String(Math.round(v)); } },
    ];
    right.appendChild(h('div.card.map-card', h('h3', 'Tracé'), map.el, h('p.muted.small', 'Plus le trait est rouge, plus l’angle est grand. Survole une courbe : le point s’affiche ici.')));
    var curves = h('div.card.curves', h('h3', 'Courbes'));
    defs.forEach(function (def) {
      def.rows = rows;
      def.onHover = hover;
      var c = K.chart(def);
      charts.push(c);
      curves.appendChild(c.el);
    });
    box.appendChild(curves);
    var redraw = function () { map.draw(); charts.forEach(function (c) { c.draw(); }); };
    redraw();
    window.addEventListener('resize', redraw);
  }
})();
