/* Pilotes : catégories (attribuées selon les notes), profil avec records, runs et battles. */
(function () {
  'use strict';
  var L = window.LKS;
  var h = L.h;
  var box = document.getElementById('pilotes');
  var KIND = { drift: 'Drift', tandem: 'Tandem', time: 'Chrono' };
  var ORDER = ['pro', 'amateur', 'debutant'];
  // seuils par catégorie (le serveur les envoie aussi : up / down)
  var UP = { debutant: 80, amateur: 80 }, DOWN = { amateur: 50, pro: 50 };
  function day(iso) { return new Date(iso).toLocaleDateString('fr-FR'); }
  window.LKSBattleCard = battleCard; // aussi utilisé par la page des classements
  if (!box) return;

  function fmtMs(ms) {
    if (!ms) return '—';
    var m = Math.floor(ms / 60000);
    var s = ((ms % 60000) / 1000).toFixed(3);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  L.group().then(function (g) {
    var db = L.db(g);
    return L.categories(g).then(function (catOf) {
      var show = function () {
        var name = new URLSearchParams(location.hash.slice(1)).get('p');
        if (name) profile(g, db, catOf, name);
        else list(catOf);
        window.scrollTo(0, 0);
      };
      window.addEventListener('hashchange', show);
      show();
    });
  }).catch(function (err) {
    L.clear(box).appendChild(h('p.status', err.message));
  });

  function list(catOf) {
    L.clear(box);
    box.appendChild(h('h2', 'Pilotes'));
    box.appendChild(h('p.muted', 'Chaque pilote a une catégorie selon toutes ses runs : la moyenne de ses 20 dernières dans la notation de sa catégorie, les 0 compris (au moins 10 runs). ' + UP.debutant + ' ou plus : catégorie au-dessus ; moins de ' + DOWN.pro + ' : catégorie en dessous. Il faut être régulier pour rester en haut.'));
    var search = h('input', { type: 'search', placeholder: 'Chercher un pilote', 'aria-label': 'Chercher un pilote' });
    box.appendChild(h('div.filters', search));
    var cols = h('div.cat-columns');
    box.appendChild(cols);
    var draw = function () {
      L.clear(cols);
      var q = search.value.trim().toLowerCase();
      ORDER.forEach(function (c) {
        var pilots = catOf.all.filter(function (p) { return (p.category || 'debutant') === c && (!q || String(p.name).toLowerCase().indexOf(q) >= 0); })
          .sort(function (a, b) { return (Number(b.avg) || 0) - (Number(a.avg) || 0); });
        cols.appendChild(h('div.card.cat-col',
          h('h3', L.catBadge(c), ' ', h('span.muted.small', pilots.length + ' pilote' + (pilots.length > 1 ? 's' : ''))),
          pilots.length ? h('div.pilot-list', pilots.map(function (p) {
            return h('a.pilot', { href: '#p=' + encodeURIComponent(p.name) }, h('span', p.name), h('span.muted.small', p.avg !== null && p.avg !== undefined ? 'moy. ' + Number(p.avg).toFixed(1) : ''));
          })) : h('p.muted.small', 'Personne pour le moment.')));
      });
    };
    search.addEventListener('input', draw);
    draw();
    if (!catOf.all.length) box.appendChild(h('p.status', 'Les catégories apparaissent après les premières runs notées.'));
  }

  function profile(g, db, catOf, name) {
    var info = catOf(name);
    var c = info.category || 'debutant';
    L.clear(box);
    box.appendChild(h('p', h('a.small', { href: '#' }, '← Tous les pilotes')));
    var next = c === 'pro' ? null : c === 'amateur' ? 'Pro' : 'Amateur';
    box.appendChild(h('div.detail-head',
      h('div', h('h2', name, ' ', L.catBadge(c)),
        h('p.muted', info.runs ? 'Moyenne de ses ' + info.runs + ' dernières runs (les 0 comptent) : ' + Number(info.avg).toFixed(1) + (next ? ' · ' + (info.up != null ? info.up : UP[c]) + ' pour passer ' + next : '') + (c !== 'debutant' ? ' · sous ' + (info.down != null ? info.down : DOWN[c]) + ' : redescend' : '') : 'Pas encore assez de runs notées : catégorie Débutant.')),
      info.avg !== null && info.avg !== undefined ? h('div.detail-score', Number(info.avg).toFixed(1)) : null));
    var records = h('div.card', h('h3', 'Records'), h('p.status', 'Chargement…'));
    var runs = h('div.card', h('h3', 'Dernières runs'), h('p.status', 'Chargement…'));
    var battles = h('div.card', h('h3', 'Battles'), h('p.status', 'Chargement…'));
    box.appendChild(h('div.detail-layout', h('div.detail-left', records, battles), h('div.detail-right', runs)));
    var enc = encodeURIComponent(name);

    db('lks_laps', 'select=id,car,track,layout,kind,rules,lap_ms,score,meta,created_at&driver=eq.' + enc + '&kind=in.(drift,tandem)&order=created_at.desc&limit=200').then(function (list) {
      list = (list || []).filter(function (r) { return r.kind === 'time' || r.rules.indexOf('@') < 0; });
      var best = {};
      list.forEach(function (r) {
        var k = r.track + '|' + r.layout + '|' + r.kind;
        var better = !best[k] || (r.kind === 'time' ? r.lap_ms < best[k].lap_ms : Number(r.score) > Number(best[k].score));
        if (better) best[k] = r;
      });
      var rows = Object.keys(best).map(function (k) { return best[k]; }).sort(function (a, b) { return L.trackName(g, a.track, a.layout).localeCompare(L.trackName(g, b.track, b.layout)); });
      L.clear(records).appendChild(h('h3', 'Records'));
      if (!rows.length) return records.appendChild(h('p.muted', 'Aucun record pour le moment.'));
      records.appendChild(h('div.board-wrap', h('table.board',
        h('thead', h('tr', h('th', 'Circuit'), h('th', 'Type'), h('th', 'Voiture'), h('th.num', 'Note / temps'), h('th.col-date', 'Date'))),
        h('tbody', rows.map(function (r) {
          return h('tr.clickable', { onclick: function () { location.href = 'passage.html?id=' + r.id; } },
            h('td', h('a', { href: 'passage.html?id=' + r.id }, L.trackName(g, r.track, r.layout))), h('td', KIND[r.kind] || r.kind), h('td', L.carName(g, r.car)),
            h('td.num', r.kind === 'time' ? fmtMs(r.lap_ms) : Number(r.score).toFixed(1)), h('td.muted.col-date', day(r.created_at)));
        })))));
    }).catch(function (err) { L.clear(records).appendChild(h('p.status', 'Records : ' + err.message)); });

    db('lks_runs_list', 'select=car,track,layout,kind,score,detail,created_at&driver=eq.' + enc + '&order=created_at.desc&limit=30').then(function (list) {
      L.clear(runs).appendChild(h('h3', 'Dernières runs'));
      if (!(list || []).length) return runs.appendChild(h('p.muted', 'Aucune run récente.'));
      runs.appendChild(h('div.board-wrap', h('table.board',
        h('thead', h('tr', h('th', 'Circuit'), h('th', 'Type'), h('th.num', 'Note'), h('th.col-date', 'Date'))),
        h('tbody', list.map(function (r) {
          var dt = r.detail || {};
          return h('tr', h('td', L.trackName(g, r.track, r.layout), dt.zeroed ? h('div.small.bad', 'run à 0 : ' + dt.zeroed) : null), h('td', KIND[r.kind] || r.kind),
            h('td.num', Number(r.score).toFixed(1)), h('td.muted.col-date', day(r.created_at)));
        })))));
    }).catch(function (err) { L.clear(runs).appendChild(h('p.status', 'Runs : ' + err.message)); });

    db('lks_laps', 'select=track,layout,meta,created_at&kind=eq.battle&driver=ilike.*' + encodeURIComponent(name.replace(/[*,()]/g, '')) + '*&order=created_at.desc&limit=40').then(function (list) {
      L.clear(battles).appendChild(h('h3', 'Battles'));
      var seen = {};
      list = (list || []).filter(function (r) {
        var b = r.meta && r.meta.battle;
        if (!b || !b.result || seen[b.id]) return false;
        seen[b.id] = true;
        return (b.result.drivers || []).some(function (d) { return String(d.name).toLowerCase() === name.toLowerCase(); });
      });
      if (!list.length) return battles.appendChild(h('p.muted', 'Aucune battle pour le moment.'));
      battles.appendChild(h('div.battle-list', list.map(function (r) { return battleCard(g, r, name); })));
    }).catch(function (err) { L.clear(battles).appendChild(h('p.status', 'Battles : ' + err.message)); });
  }

  function battleCard(g, r, me) {
    var res = r.meta.battle.result;
    var ds = res.drivers || [];
    var won = res.winner && me && String(res.winner).toLowerCase() === me.toLowerCase();
    return h('div.battle' + (res.omt ? '.omt' : won ? '.won' : me ? '.lost' : ''),
      h('div.battle-head', h('strong', ds.map(function (d) { return d.name; }).join(' vs ')), h('span.muted.small', L.trackName(g, r.track, r.layout) + ' · ' + day(r.meta.battle.date || r.created_at))),
      h('div.battle-scores', ds.map(function (d) {
        return h('div' + (res.winner === d.name ? '.win' : ''), h('span', d.name), h('strong', Number(d.total).toFixed(1)), h('span.muted.small', 'lead ' + d.lead + ' · chase ' + d.chase));
      })),
      h('p.small', res.omt ? 'One more time (écart ' + res.diff + ')' : 'Victoire de ' + res.winner + ' (écart ' + res.diff + ')'));
  }

})();
