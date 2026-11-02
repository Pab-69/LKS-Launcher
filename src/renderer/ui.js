// Small DOM helpers shared by every view.

export const api = window.lks;

/** h('div.class#id', { attrs, on: {click} }, ...children) */
export function h(tag, attrs, ...children) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(name || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k === 'style' && typeof v === 'object') for (const [prop, val] of Object.entries(v)) prop.startsWith('--') ? el.style.setProperty(prop, val) : (el.style[prop] = val);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' && (name === 'textarea' || name === 'input')) el.value = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function svg(pathD, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  if (cls) s.setAttribute('class', cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', pathD);
  s.append(p);
  return s;
}

export const ICONS = {
  download: 'M12 3v12m0 0l-5-5m5 5l5-5M4 17v3h16v-3',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  play: 'M7 4v16l13-8z',
  check: 'M4 12l5 5L20 6',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm10 17l-5-5',
  folder: 'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  upload: 'M12 21V9m0 0l-5 5m5-5l5 5M4 7V4h16v3',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13',
  shield: 'M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7z',
  x: 'M6 6l12 12M18 6L6 18',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
};

export function icon(name) {
  return svg(ICONS[name] || '');
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

/** Image URL of a local content file ("car/<id>/skins/x/preview.jpg") */
export function localImg(rel) {
  if (!rel) return '';
  return `lks-img://${rel.split('/').map(encodeURIComponent).join('/')}`;
}

export function img(src, cls, fallbackText) {
  if (!src) return h('div.placeholder', fallbackText || 'LKS');
  const el = h('img', { src, class: cls || '', loading: 'lazy', alt: '' });
  el.addEventListener('error', () => el.replaceWith(h('div.placeholder', fallbackText || 'LKS')));
  return el;
}

export function bytes(n) {
  if (!n) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

export function lapTime(ms) {
  if (!ms || ms <= 0) return '—';
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}

export function dateFr(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function toast(text, kind = 'info', ms = 4500) {
  const el = h(`div.toast.${kind}`, text);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

export async function guard(fn, okText) {
  try {
    const r = await fn();
    if (okText) toast(okText, 'success');
    return r;
  } catch (err) {
    toast(err.message || String(err), 'error', 7000);
    return undefined;
  }
}

/** Opens a modal; returns { close, body } */
export function modal({ title, body, foot, small, onClose }) {
  const root = document.getElementById('modal-root');
  const close = () => {
    root.innerHTML = '';
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  const box = h(
    `div.modal${small ? '.small' : ''}`,
    h('div.modal-head', h('h2', title), h('button.btn.btn-ghost.btn-sm', { on: { click: close }, 'aria-label': 'Fermer' }, icon('x'))),
    h('div.modal-body', body),
    foot ? h('div.modal-foot', foot) : null,
  );
  root.innerHTML = '';
  root.append(box);
  root.onclick = (e) => {
    if (e.target === root) close();
  };
  return { close, box };
}

export function confirmBox(title, text, okLabel = 'Confirmer') {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title,
      small: true,
      body: h('p', { style: { margin: 0, color: 'var(--text-2)' } }, text),
      foot: [
        h('button.btn.btn-ghost', { on: { click: () => m.close() } }, 'Annuler'),
        h('button.btn.btn-primary', { on: { click: () => { done = true; m.close(); resolve(true); } } }, okLabel),
      ],
      onClose: () => {
        if (!done) resolve(false);
      },
    });
  });
}

export function toggle(label, checked, onChange, hint) {
  const input = h('input', { type: 'checkbox', checked: Boolean(checked), on: { change: (e) => onChange(e.target.checked) } });
  return h('label.toggle', h('div', h('div', label), hint ? h('div.hint', hint) : null), input, h('span.knob'));
}

export function range(label, { min, max, step = 1, value, format = (v) => v, onInput }) {
  const out = h('output', format(value));
  const input = h('input', {
    type: 'range',
    min,
    max,
    step,
    value,
    on: {
      input: (e) => {
        const v = Number(e.target.value);
        out.textContent = format(v);
        onInput(v);
      },
    },
  });
  return h('div.range', h('div.range-head', h('span.label', label), out), input);
}

export function seg(options, value, onChange) {
  const wrap = h('div.seg');
  for (const [v, label] of options) {
    const b = h('button', { class: v === value ? 'on' : '', on: { click: () => {
      wrap.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      onChange(v);
    } } }, label);
    wrap.append(b);
  }
  return wrap;
}

export function select(options, value, onChange, cls = '') {
  const s = h('select.input', { class: cls, on: { change: (e) => onChange(e.target.value) } });
  for (const [v, label] of options) s.append(h('option', { value: v, selected: v === value }, label));
  return s;
}

export function field(label, control, hint) {
  return h('div.field', h('label', label), control, hint ? h('div.hint', hint) : null);
}

export const STATUS_LABEL = {
  ok: ['À jour', 'ok'],
  update: ['Mise à jour', 'warn'],
  missing: ['Non installé', 'bad'],
  unknown: ['Vérification…', 'info'],
  noac: ['AC non configuré', 'bad'],
};

export const NATIONS = [
  ['FRA', 'France'], ['BEL', 'Belgique'], ['CHE', 'Suisse'], ['LUX', 'Luxembourg'], ['CAN', 'Canada'],
  ['ITA', 'Italie'], ['ESP', 'Espagne'], ['PRT', 'Portugal'], ['DEU', 'Allemagne'], ['GBR', 'Royaume-Uni'],
  ['NLD', 'Pays-Bas'], ['USA', 'États-Unis'], ['MAR', 'Maroc'], ['DZA', 'Algérie'], ['TUN', 'Tunisie'],
  ['SEN', 'Sénégal'], ['CIV', "Côte d'Ivoire"], ['POL', 'Pologne'], ['JPN', 'Japon'], ['BRA', 'Brésil'],
];
