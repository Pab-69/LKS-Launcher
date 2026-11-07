/* Site LKS : outils communs + soirées et actus en direct (serveur du groupe). */
(function () {
  'use strict';

  var SERVER = (window.LKS_SERVER || '').replace(/\/$/, '');

  /** Petit constructeur d'éléments : h('div.cls', { attr }, enfants…). Le texte est toujours échappé. */
  function h(tag, attrs) {
    var parts = tag.split('.');
    var el = document.createElement(parts[0] || 'div');
    if (parts.length > 1) el.className = parts.slice(1).join(' ');
    var kids = Array.prototype.slice.call(arguments, 2);
    if (attrs && (typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs))) {
      kids.unshift(attrs);
      attrs = null;
    }
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden') el[k] = Boolean(v);
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    (function add(list) {
      list.forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        if (Array.isArray(c)) add(c);
        else el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
      });
    })(kids);
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  var dateFr = function (iso, opts) {
    return new Date(iso).toLocaleString('fr-FR', opts || { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  };

  function getJson(url, headers) {
    return fetch(url, { headers: headers || {} }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (e) {
          data = null;
        }
        if (!res.ok) throw new Error((data && data.message) || 'Erreur ' + res.status);
        return data;
      });
    });
  }

  var publicCache = null;
  /** Données publiques du groupe (soirées, actus, voitures, circuits, championnats, adresse du classement). */
  function group() {
    if (!SERVER) return Promise.reject(new Error('Le serveur du groupe n’est pas configuré'));
    if (!publicCache) publicCache = getJson(SERVER + '/admin/api/public');
    return publicCache;
  }

  function trackName(g, id, layout) {
    var t = (g.tracks || []).filter(function (x) { return x.id === id; })[0];
    if (!t) return id || '';
    var l = (t.layouts || []).filter(function (x) { return x.id === (layout || ''); })[0];
    if (!l || !l.name || (t.layouts || []).length < 2) return t.name;
    return l.name.toLowerCase().indexOf(String(t.name).toLowerCase()) === 0 ? l.name : t.name + ' — ' + l.name;
  }

  function carName(g, id) {
    var c = (g.cars || []).filter(function (x) { return x.id === id; })[0];
    return c ? c.name : id;
  }

  /** Lecture du serveur du groupe (PostgREST, clé publique, lecture seule). */
  function db(g) {
    if (!g.leaderboard) throw new Error('Le classement n’est pas encore activé par les admins');
    var api = g.leaderboard.url.replace(/\/$/, '') + '/rest/v1/';
    var key = { apikey: g.leaderboard.anonKey, Authorization: 'Bearer ' + g.leaderboard.anonKey };
    return function (table, q) { return getJson(api + table + '?' + q, key); };
  }

  var CATEGORY = { debutant: 'Débutant', amateur: 'Amateur', pro: 'Pro' };
  var catCache = null;
  /** Catégorie de chaque pilote : fonction nom -> { category, avg, runs } (Débutant par défaut). */
  function categories(g) {
    if (!catCache) {
      catCache = db(g)('lks_categories_list', 'select=name,category,avg,runs,updated_at').then(function (list) {
        var map = {};
        (list || []).forEach(function (r) { map[String(r.name).trim().toLowerCase()] = r; });
        var of = function (name) { return map[String(name || '').trim().toLowerCase()] || { name: name, category: 'debutant', avg: null, runs: 0 }; };
        of.all = list || [];
        return of;
      }).catch(function () {
        var of = function (name) { return { name: name, category: 'debutant', avg: null, runs: 0 }; };
        of.all = [];
        return of;
      });
    }
    return catCache;
  }
  function catBadge(category) {
    return h('span.cat.cat-' + (CATEGORY[category] ? category : 'debutant'), CATEGORY[category] || 'Débutant');
  }

  /** Courbes d'un passage : base64 → gzip → JSON (même format que le launcher). */
  function unpack(b64) {
    if (!b64) return Promise.resolve({ samples: [] });
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('Navigateur trop ancien pour afficher les courbes'));
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text().then(function (text) {
      var data = JSON.parse(text);
      return Array.isArray(data) ? { samples: data } : { samples: data.s || [] };
    });
  }

  window.LKS = { SERVER: SERVER, h: h, clear: clear, dateFr: dateFr, getJson: getJson, group: group, trackName: trackName, carName: carName, db: db, CATEGORY: CATEGORY, categories: categories, catBadge: catBadge, unpack: unpack };

  // ------------------------------------------------------------ page d'accueil
  var soirees = document.getElementById('soirees');
  if (!soirees || !SERVER) return;
  group().then(function (g) {
    var now = Date.now();
    var upcoming = (g.events || []).filter(function (e) {
      return Date.parse(e.date) + (Number(e.durationMinutes) || 120) * 60000 > now;
    });
    var list = soirees.querySelector('.event-list');
    if (upcoming.length) {
      upcoming.slice(0, 6).forEach(function (e) {
        var live = Date.parse(e.date) <= now;
        list.appendChild(h('article.event',
          h('time', live ? 'En ce moment' : dateFr(e.date)),
          h('h3', e.title),
          e.track ? h('p.event-track', trackName(g, e.track, e.layout)) : null,
          (e.cars || []).length ? h('p.event-cars', e.cars.map(function (c) { return carName(g, c); }).join(' · ')) : null,
          e.battle ? h('p.event-battle', 'Battle : top ' + e.battle.size) : null,
          e.description ? h('p', e.description) : null));
      });
      soirees.hidden = false;
      document.querySelectorAll('a[href="#soirees"][data-live]').forEach(function (a) { a.hidden = false; });
    }
    var news = document.querySelector('[data-news]');
    if (news && (g.news || []).length) {
      clear(news).appendChild(h('h2', 'Actus'));
      g.news.slice(0, 4).forEach(function (n) {
        news.appendChild(h('article', h('time', dateFr(n.date, { day: 'numeric', month: 'long', year: 'numeric' })), h('h3', n.title), h('p', n.body)));
      });
      news.hidden = false;
      document.querySelectorAll('a[href="#actus"][data-live]').forEach(function (a) { a.hidden = false; });
    }
  }).catch(function () {
    /* le site reste lisible avec les actus de la dernière construction */
  });
})();
