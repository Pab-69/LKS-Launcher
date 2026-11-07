/* Classements et championnats, lus sur le serveur du groupe (lecture seule, clé publique). */
(function () {
  'use strict';
  var L = window.LKS;
  var h = L.h;
  var $ = function (id) { return document.getElementById(id); };
  var status = $('board-status');

  function fmtMs(ms) {
    var m = Math.floor(ms / 60000);
    var s = ((ms % 60000) / 1000).toFixed(3);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  L.group().then(function (g) {
    if (!g.leaderboard) throw new Error('Le classement n’est pas encore activé par les admins');
    var api = g.leaderboard.url.replace(/\/$/, '') + '/rest/v1/';
    var key = { apikey: g.leaderboard.anonKey, Authorization: 'Bearer ' + g.leaderboard.anonKey };
    var rows = function (q) { return L.getJson(api + 'lks_laps?' + q, key); };
    var COLS = 'select=id,driver,car,track,layout,kind,rules,lap_ms,score,meta,created_at';
    var CAT_OF_MODE = { debutant: 'debutant', normal: 'amateur', pro: 'pro' };

    // ------------------------------------------------ classement d'un circuit
    var tracks = [];
    (g.tracks || []).forEach(function (t) {
      var layouts = t.layouts && t.layouts.length ? t.layouts : [{ id: '', name: '' }];
      layouts.forEach(function (l) { tracks.push({ track: t.id, layout: l.id || '', label: L.trackName(g, t.id, l.id) }); });
    });
    tracks.sort(function (a, b) { return a.label.localeCompare(b.label); });
    tracks.forEach(function (t, i) { $('f-track').appendChild(h('option', { value: String(i) }, t.label)); });
    (g.cars || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).forEach(function (c) { $('f-car').appendChild(h('option', { value: c.id }, c.name)); });
    var params = new URLSearchParams(location.hash.slice(1));
    var pre = tracks.findIndex(function (t) { return t.track === params.get('track') && t.layout === (params.get('layout') || ''); });
    if (pre >= 0) $('f-track').value = String(pre);

    function load() {
      var t = tracks[Number($('f-track').value)];
      var kind = $('f-kind').value;
      var mode = $('f-mode').value;
      var car = $('f-car').value;
      $('f-mode').disabled = kind === 'time';
      $('f-who').disabled = kind === 'time';
      var who = $('f-who').value;
      if (!t) {
        status.textContent = 'Aucun circuit publié pour le moment.';
        return;
      }
      status.textContent = 'Chargement…';
      $('board').hidden = true;
      var q = COLS + '&track=eq.' + encodeURIComponent(t.track) + '&layout=eq.' + encodeURIComponent(t.layout) + '&kind=eq.' + kind +
        (kind === 'time' ? '&rules=eq.&order=lap_ms.asc' : '&rules=like.*-' + mode + '&order=score.desc') + (car ? '&car=eq.' + encodeURIComponent(car) : '') + '&limit=500';
      loadBattles(t, mode);
      Promise.all([rows(q), L.categories(g)]).then(function (res) {
        var list = res[0];
        var catOf = res[1];
        // la version actuelle du parcours, une ligne par pilote (sa meilleure)
        list = (list || []).filter(function (r) { return kind === 'time' || r.rules.indexOf('@') < 0; });
        if (kind !== 'time') list = window.LKSRounds.latestVersion(list);
        list = window.LKSRounds.bestPerDriver(list);
        if (kind !== 'time' && who === 'cat') list = list.filter(function (r) { return catOf(r.driver).category === CAT_OF_MODE[mode]; });
        var body = L.clear($('board').querySelector('tbody'));
        $('board-col').textContent = kind === 'time' ? 'Temps' : 'Note';
        list.slice(0, 100).forEach(function (r, i) {
          body.appendChild(h('tr', { class: (i < 3 ? 'top' + (i + 1) + ' ' : '') + 'clickable', onclick: function (e) { if (e.target.tagName !== 'A') location.href = 'passage.html?id=' + r.id; } },
            h('td', String(i + 1)), h('td', h('a', { href: 'pilotes.html#p=' + encodeURIComponent(r.driver) }, r.driver), ' ', L.catBadge(catOf(r.driver).category)), h('td', L.carName(g, r.car)),
            h('td.num', kind === 'time' ? fmtMs(r.lap_ms) : Number(r.score).toFixed(1)),
            h('td.muted.col-date', new Date(r.created_at).toLocaleDateString('fr-FR'))));
        });
        $('board').hidden = !list.length;
        status.textContent = list.length ? (kind !== 'time' && who === 'cat' ? 'Pilotes ' + L.CATEGORY[CAT_OF_MODE[mode]] + ' seulement, notés comme leur catégorie. Clique une ligne pour voir le passage.' : 'Clique une ligne pour voir le passage et ses courbes.') : (kind !== 'time' && who === 'cat' ? 'Pas encore de pilote ' + L.CATEGORY[CAT_OF_MODE[mode]] + ' ici (choisis « Tous »).' : 'Pas encore de score ici.');
        history.replaceState(null, '', '#track=' + encodeURIComponent(t.track) + '&layout=' + encodeURIComponent(t.layout));
      }).catch(function (err) { status.textContent = err.message; });
    }
    function loadBattles(t, mode) {
      var listEl = L.clear($('battle-list'));
      $('battles-track').textContent = t.label + ' · notation ' + L.CATEGORY[CAT_OF_MODE[mode]];
      listEl.appendChild(h('p.status', 'Chargement…'));
      rows('select=track,layout,rules,meta,created_at&kind=eq.battle&track=eq.' + encodeURIComponent(t.track) + '&layout=eq.' + encodeURIComponent(t.layout) + '&order=created_at.desc&limit=60').then(function (list) {
        var seen = {};
        list = (list || []).filter(function (r) {
          var b = r.meta && r.meta.battle;
          if (!b || !b.result || (r.meta.mode || 'normal') !== mode || seen[b.id]) return false;
          seen[b.id] = true;
          return true;
        });
        L.clear(listEl);
        if (!list.length) return listEl.appendChild(h('p.status', 'Pas encore de battle ici.'));
        list.slice(0, 20).forEach(function (r) { listEl.appendChild(window.LKSBattleCard(g, r, null)); });
      }).catch(function (err) { L.clear(listEl).appendChild(h('p.status', err.message)); });
    }
    ['f-track', 'f-kind', 'f-mode', 'f-who', 'f-car'].forEach(function (id) { $(id).addEventListener('change', load); });
    load();

    // ------------------------------------------------ championnats (même calcul que le launcher)
    var C = window.LKSChamp;
    // catégorie de chaque pilote (Débutant tant qu'il n'a pas assez de runs notées)
    var cats = L.getJson(api + 'lks_categories_list?select=name,category', key).then(function (list) {
      var map = {};
      (list || []).forEach(function (r) { map[String(r.name).trim().toLowerCase()] = r.category; });
      return function (name) { return map[String(name || '').trim().toLowerCase()] || 'debutant'; };
    }).catch(function () { return null; });
    var champs = L.clear($('champs'));
    var all = (g.championships || []).filter(function (c) { return (c.rounds || []).length; });
    // saisons : la plus récente d'abord (celle dont une manche a commencé le plus tard)
    var latest = {};
    all.forEach(function (c) {
      var k = c.season || '';
      (c.rounds || []).forEach(function (r) { latest[k] = Math.max(latest[k] || 0, Date.parse(r.start) || 0); });
    });
    var seasons = Object.keys(latest).sort(function (a, b) { return latest[b] - latest[a]; });
    var pick = null;
    if (seasons.length > 1 || (seasons.length === 1 && seasons[0])) {
      pick = h('select', [h('option', { value: '*' }, 'Toutes les saisons')].concat(seasons.map(function (x) { return h('option', { value: x }, x || 'Sans saison'); })));
      pick.value = seasons[0];
      champs.parentNode.insertBefore(h('label.season-pick', 'Saison', pick), champs);
    }
    var boxes = [];
    var showSeason = function () {
      boxes.forEach(function (b) { b.el.hidden = pick && pick.value !== '*' && pick.value !== b.season; });
    };
    if (pick) pick.addEventListener('change', showSeason);
    var list = all;
    if (!list.length) champs.appendChild(h('p.status', 'Aucun championnat pour le moment.'));
    list.forEach(function (c) {
      var title = (c.season ? c.season + ' — ' : '') + c.name;
      var box = h('div.champ', h('h3', title), h('p.status', 'Calcul…'));
      champs.appendChild(box);
      boxes.push({ el: box, season: c.season || '' });
      showSeason();
      Promise.all((c.rounds || []).map(function (round) {
        if (C.roundStatus(round) === 'upcoming') return Promise.resolve(Object.assign({}, round, { status: 'upcoming', results: [] }));
        var base = '&track=eq.' + encodeURIComponent(round.track) + '&layout=eq.' + encodeURIComponent(round.layout || '') + '&rules=like.*' + encodeURIComponent('@' + round.id) + '&limit=500';
        var kind = round.kind === 'battle' ? 'drift' : round.kind;
        return Promise.all([
          rows(COLS + '&kind=eq.' + kind + '&order=score.desc' + base),
          round.kind === 'battle' ? rows(COLS + '&kind=eq.battle' + base) : Promise.resolve([]),
          round.category ? cats : Promise.resolve(null),
        ]).then(function (r) {
          return window.LKSRounds.roundFromRows(round, { entryRows: r[0] || [], battleRows: r[1] || [], decisions: g.judging || [], points: c.points, categoryOf: r[2] });
        });
      })).then(function (rounds) {
        var table = C.standings(c, rounds);
        L.clear(box).appendChild(h('h3', title));
        if (table.length) {
          box.appendChild(h('table.board',
            h('thead', h('tr', h('th', '#'), h('th', 'Pilote'), h('th.num', 'Points'), h('th.num', 'Victoires'), h('th.num', 'Podiums'))),
            h('tbody', table.map(function (row, i) {
              return h('tr', { class: i < 3 ? 'top' + (i + 1) : null }, h('td', String(i + 1)), h('td', row.name), h('td.num', String(row.points)), h('td.num', String(row.wins)), h('td.num', String(row.podiums)));
            }))));
        } else box.appendChild(h('p.status', 'Pas encore de points.'));
        var rl = h('div.rounds');
        rounds.forEach(function (r) {
          var label = { upcoming: 'à venir', live: 'en cours', done: 'terminée' }[r.status] || '';
          var top = (r.results || []).slice(0, 3).map(function (x) { return x.position + '. ' + x.name; }).join('  ');
          rl.appendChild(h('div.round', h('strong', r.name), h('span.muted', ' — ' + L.trackName(g, r.track, r.layout) + (r.category ? ' · ' + C.CATEGORY_LABEL[r.category] : '') + ' · ' + L.dateFr(r.start, { day: 'numeric', month: 'short' }) + ' · ' + label), top ? h('div', top) : null));
        });
        box.appendChild(rl);
      }).catch(function (err) { L.clear(box).appendChild(h('p.status', title + ' : ' + err.message)); });
    });
  }).catch(function (err) {
    status.textContent = err.message;
    L.clear($('champs'));
  });
})();
