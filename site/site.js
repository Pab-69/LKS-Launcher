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

  window.LKS = { SERVER: SERVER, h: h, clear: clear, dateFr: dateFr, getJson: getJson, group: group, trackName: trackName, carName: carName };

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
