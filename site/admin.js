/* Page admin du site : soirées et actus, publiées par le serveur du groupe dans le manifeste. */
(function () {
  'use strict';
  var L = window.LKS;
  var h = L.h;
  var root = document.getElementById('admin');
  var API = L.SERVER + '/admin/api';
  var KEY = 'lks-admin';

  function session() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) || 'null');
    } catch (e) {
      return null;
    }
  }
  function setSession(s) {
    try {
      if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
      else sessionStorage.removeItem(KEY);
    } catch (e) {
      /* navigation privée : la connexion dure le temps de la page */
    }
    current = s;
  }
  var current = session();

  function call(method, path, body) {
    return fetch(API + path, {
      method: method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, current ? { Authorization: 'Bearer ' + current.token } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401 && current) {
          setSession(null);
          showLogin(data.message);
        }
        if (!res.ok) throw new Error(data.message || 'Erreur ' + res.status);
        return data;
      });
    });
  }

  function page() {
    L.clear(root);
    var s = h('section');
    root.appendChild(s);
    return s;
  }

  function message(el, text, ok) {
    el.textContent = text || '';
    el.className = 'status' + (ok ? ' ok' : text ? ' bad' : '');
  }

  // ------------------------------------------------------------ connexion
  function showLogin(why) {
    document.getElementById('logout').hidden = true;
    var s = page();
    var name = h('input', { autocomplete: 'username', required: true });
    var pass = h('input', { type: 'password', autocomplete: 'current-password', required: true });
    var msg = h('p.status');
    message(msg, why || '');
    s.appendChild(h('h2', 'Admin'));
    s.appendChild(h('form.card.login', {
      onsubmit: function (e) {
        e.preventDefault();
        message(msg, 'Connexion…');
        call('POST', '/login', { name: name.value, password: pass.value }).then(function (r) {
          setSession(r);
          showAdmin();
        }).catch(function (err) { message(msg, err.message); });
      },
    }, h('label', 'Nom', name), h('label', 'Mot de passe', pass), h('button.btn.btn-primary', { type: 'submit' }, 'Se connecter'), msg));
    s.appendChild(h('p.muted.small', 'Les comptes admin se créent sur le serveur : ./lks.sh add-admin <nom>.'));
  }

  // ------------------------------------------------------------ soirées et actus
  function toLocal(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function eventForm(g, ev, done) {
    ev = ev || {};
    var tracks = [['', '— libre —']];
    (g.tracks || []).forEach(function (t) {
      var layouts = t.layouts && t.layouts.length ? t.layouts : [{ id: '' }];
      layouts.forEach(function (l) { tracks.push([t.id + '|' + (l.id || ''), L.trackName(g, t.id, l.id)]); });
    });
    var title = h('input', { value: ev.title || 'Soirée LKS', required: true, maxlength: 80 });
    var next = new Date(Date.now() + 86400000);
    next.setHours(21, 0, 0, 0);
    var date = h('input', { type: 'datetime-local', value: toLocal(ev.date || next.toISOString()), required: true });
    var duration = h('input', { type: 'number', min: 15, max: 720, value: ev.durationMinutes || 120 });
    var track = h('select', tracks.map(function (o) { return h('option', { value: o[0], selected: o[0] === (ev.track ? ev.track + '|' + (ev.layout || '') : '') }, o[1]); }));
    var server = h('select', [h('option', { value: '' }, '— aucun —')].concat((g.servers || []).map(function (s) { return h('option', { value: s.value, selected: s.value === ev.server }, s.name); })));
    var size = h('select', [[0, 'Non'], [4, 'Oui : top 4'], [8, 'Oui : top 8'], [16, 'Oui : top 16']].map(function (o) { return h('option', { value: o[0], selected: ((ev.battle && ev.battle.size) || 0) === o[0] }, o[1]); }));
    var mode = h('select', [['normal', 'Normal'], ['debutant', 'Débutant'], ['pro', 'Compétition']].map(function (o) { return h('option', { value: o[0], selected: ((ev.battle && ev.battle.mode) || 'normal') === o[0] }, o[1]); }));
    var cars = (g.cars || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (c) {
      return h('label.check', h('input', { type: 'checkbox', value: c.id, checked: (ev.cars || []).indexOf(c.id) >= 0 }), c.name);
    });
    var description = h('textarea', { rows: 2, maxlength: 600, placeholder: 'règles, voitures imposées…' }, ev.description || '');
    var msg = h('p.status');
    var id = ev.id || 'e' + Date.now().toString(36);
    return h('form.card', {
      onsubmit: function (e) {
        e.preventDefault();
        var tl = track.value.split('|');
        var body = {
          title: title.value,
          date: new Date(date.value).toISOString(),
          durationMinutes: Number(duration.value) || 120,
          track: tl[0] || '',
          layout: tl[1] || '',
          server: server.value,
          cars: cars.map(function (l) { return l.firstChild; }).filter(function (i) { return i.checked; }).map(function (i) { return i.value; }),
          battle: Number(size.value) ? { size: Number(size.value), mode: mode.value } : null,
          description: description.value,
        };
        if (body.battle && !body.track) return message(msg, 'Pour une battle, choisis le circuit.');
        message(msg, 'Publication…');
        call('PUT', '/events/' + encodeURIComponent(id), body).then(function () {
          message(msg, 'Publié : les launchers le reçoivent dans les 5 minutes.', true);
          done();
        }).catch(function (err) { message(msg, err.message); });
      },
    },
    h('div.grid2', h('label', 'Titre', title), h('label', 'Date et heure', date), h('label', 'Durée (min)', duration), h('label', 'Serveur', server), h('label', 'Circuit', track), h('label', 'Battle de la soirée', h('div.row', size, mode))),
    cars.length ? h('div', h('span.label', 'Voitures imposées'), h('div.cars', cars)) : null,
    h('label', 'Description', description),
    h('div.row', h('button.btn.btn-primary', { type: 'submit' }, ev.id ? 'Enregistrer' : 'Publier la soirée'), msg));
  }

  function showAdmin() {
    document.getElementById('logout').hidden = false;
    var s = page();
    s.appendChild(h('h2', 'Admin'));
    s.appendChild(h('p.muted', 'Connecté : ' + current.name + '. Ce que tu publies ici arrive dans tous les launchers (et sur Discord pour les nouvelles soirées et actus).'));
    var box = h('div', h('p.status', 'Chargement…'));
    s.appendChild(box);
    function reload() {
      return fetch(API + '/public', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(render).catch(function (err) {
        L.clear(box).appendChild(h('p.status.bad', err.message));
      });
    }
    function render(g) {
      L.clear(box);
      // soirées
      var evs = h('div');
      box.appendChild(h('h3.sub', 'Soirées'));
      box.appendChild(evs);
      var editing = h('div');
      evs.appendChild(h('button.btn', { onclick: function () { L.clear(editing).appendChild(eventForm(g, null, reload)); } }, '+ Nouvelle soirée'));
      evs.appendChild(editing);
      var now = Date.now();
      (g.events || []).forEach(function (ev) {
        var past = Date.parse(ev.date) + (Number(ev.durationMinutes) || 120) * 60000 < now;
        var slot = h('div');
        evs.appendChild(h('article.card.event-admin', { class: past ? 'card event-admin past' : 'card event-admin' },
          h('div.row',
            h('div', h('strong', ev.title), h('div.muted', L.dateFr(ev.date) + (ev.track ? ' · ' + L.trackName(g, ev.track, ev.layout) : '') + (ev.battle ? ' · battle top ' + ev.battle.size : ''))),
            h('div.actions',
              h('button.btn.small', { onclick: function () { L.clear(slot).appendChild(eventForm(g, ev, reload)); } }, 'Modifier'),
              h('button.btn.small.danger', {
                onclick: function () {
                  if (!confirm('Retirer « ' + ev.title + ' » ?')) return;
                  call('DELETE', '/events/' + encodeURIComponent(ev.id)).then(reload).catch(function (err) { alert(err.message); });
                },
              }, 'Retirer'))),
          slot));
      });
      if (!(g.events || []).length) evs.appendChild(h('p.muted', 'Aucune soirée prévue.'));

      // actus
      box.appendChild(h('h3.sub', 'Actus'));
      var nt = h('input', { required: true, maxlength: 120, placeholder: 'Titre' });
      var nb = h('textarea', { rows: 4, maxlength: 4000, placeholder: 'Texte' });
      var nd = h('input', { type: 'checkbox', checked: true });
      var nmsg = h('p.status');
      box.appendChild(h('form.card', {
        onsubmit: function (e) {
          e.preventDefault();
          message(nmsg, 'Publication…');
          call('POST', '/news', { title: nt.value, body: nb.value, discord: nd.checked }).then(function () {
            message(nmsg, 'Actu publiée.', true);
            reload();
          }).catch(function (err) { message(nmsg, err.message); });
        },
      }, h('label', 'Nouvelle actu', nt), nb, h('label.check', nd, 'Annoncer aussi sur Discord'), h('div.row', h('button.btn.btn-primary', { type: 'submit' }, 'Publier l’actu'), nmsg)));
      (g.news || []).forEach(function (n) {
        box.appendChild(h('article.card.news-admin',
          h('div.row', h('div', h('strong', n.title), h('div.muted', L.dateFr(n.date))),
            h('button.btn.small.danger', {
              onclick: function () {
                if (!confirm('Retirer l’actu « ' + n.title + ' » ?')) return;
                call('DELETE', '/news?date=' + encodeURIComponent(n.date)).then(reload).catch(function (err) { alert(err.message); });
              },
            }, 'Retirer')),
          n.body ? h('p', n.body) : null));
      });
    }
    reload();
  }

  document.getElementById('logout').addEventListener('click', function (e) {
    e.preventDefault();
    call('POST', '/logout').catch(function () {}).then(function () {
      setSession(null);
      showLogin('Déconnecté.');
    });
  });

  if (!L.SERVER) {
    var s = page();
    s.appendChild(h('h2', 'Admin'));
    s.appendChild(h('p.status', 'Le serveur du groupe n’est pas configuré : installe-le (dossier server du launcher) puis reconstruis le site.'));
    return;
  }
  if (current) call('GET', '/me').then(showAdmin).catch(function (err) { if (!current) return; showLogin(err.message); });
  else showLogin();
})();
