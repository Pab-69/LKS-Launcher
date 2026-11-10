// Éditeur de parcours précis (admins) : carte zoomable avec les bords de la route,
// clips point ou zone qu'on déplace à la souris, ligne à suivre qu'on ajuste à la main.
//
//   const map = courseMap({ state, onChange, height });
//   state = { clips, line, trace, road, section, tool, brush, selected }
//
// Coordonnées du jeu (x, z) en mètres ; z vers le bas de l'écran comme les cartes du jeu.

import { h } from '../ui.js';

export const CLIP_COLORS = { inner: '#e3a33a', outer: '#9fb4d8' };

const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/** Ligne rééchantillonnée tous les `step` mètres (pour des points réguliers à déplacer). */
export function resampleLine(pts, step = 2) {
  if (!pts || pts.length < 2) return pts ? pts.map((p) => [p[0], p[1]]) : [];
  const out = [[pts[0][0], pts[0][1]]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const seg = dist(ax, az, bx, bz);
    if (!(seg > 0)) continue;
    let t = step - acc;
    while (t <= seg) {
      out.push([ax + ((bx - ax) * t) / seg, az + ((bz - az) * t) / seg]);
      t += step;
    }
    acc = seg - (t - step);
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1][0], out[out.length - 1][1], last[0], last[1]) > 0.3) out.push([last[0], last[1]]);
  return out.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]);
}

/** Lissage doux (moyenne pondérée, extrémités fixes). */
export function smoothLine(pts, passes = 2) {
  let cur = pts.map((p) => [p[0], p[1]]);
  for (let k = 0; k < passes; k++) {
    cur = cur.map((p, i) => (i === 0 || i === cur.length - 1 ? p : [(cur[i - 1][0] + 2 * p[0] + cur[i + 1][0]) / 4, (cur[i - 1][1] + 2 * p[1] + cur[i + 1][1]) / 4]));
  }
  return cur.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]);
}

/** Point le plus proche sur une polyligne : { x, z, d, i, tx, tz } (tx, tz : direction). */
function nearestOn(pts, x, z) {
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const vx = bx - ax;
    const vz = bz - az;
    const l2 = vx * vx + vz * vz || 1e-9;
    const k = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2));
    const px = ax + vx * k;
    const pz = az + vz * k;
    const d = dist(px, pz, x, z);
    if (!best || d < best.d) {
      const l = Math.sqrt(l2);
      best = { x: px, z: pz, d, i, tx: vx / l, tz: vz / l };
    }
  }
  return best;
}

/** Bord de route le plus proche (pour coller un clip au vibreur ou au mur). */
export function snapToEdge(road, x, z) {
  if (!road) return null;
  // exact limits of the track (official analysis) first, else the AI line's edges
  const lines = Array.isArray(road.limits) && road.limits.length ? road.limits : [road.left, road.right];
  let best = null;
  for (const l of lines) {
    const n = l && l.length > 1 ? nearestOn(l, x, z) : null;
    if (n && (!best || n.d < best.d)) best = n;
  }
  return best;
}

/** Direction de la route près d'un point (pour poser une zone dans le bon sens). */
export function roadDirection(state, x, z) {
  const ref = (state.road && state.road.line) || state.line || null;
  const n = ref && ref.length > 1 ? nearestOn(ref, x, z) : null;
  return n ? [n.tx, n.tz] : [1, 0];
}

/** Centre d'une zone = milieu de son tracé (le jugement et la mesure en jeu s'en servent). */
export function zoneCentre(c) {
  if (!Array.isArray(c.path) || c.path.length < 2) return;
  let len = 0;
  for (let i = 1; i < c.path.length; i++) len += dist(c.path[i - 1][0], c.path[i - 1][1], c.path[i][0], c.path[i][1]);
  let acc = 0;
  for (let i = 1; i < c.path.length; i++) {
    const seg = dist(c.path[i - 1][0], c.path[i - 1][1], c.path[i][0], c.path[i][1]);
    if (acc + seg >= len / 2) {
      const k = seg ? (len / 2 - acc) / seg : 0;
      c.x = Math.round((c.path[i - 1][0] + (c.path[i][0] - c.path[i - 1][0]) * k) * 10) / 10;
      c.z = Math.round((c.path[i - 1][1] + (c.path[i][1] - c.path[i - 1][1]) * k) * 10) / 10;
      return;
    }
    acc += seg;
  }
}

export function courseMap({ state, onChange, height = 560 }) {
  const canvas = h('canvas.map.course-canvas', { tabindex: 0 });
  const info = h('div.course-readout');
  const wrap = h('div.course-canvas-wrap', canvas, info);
  let base = null; // vue d'ensemble (tout le circuit)
  let view = { zoom: 1, panX: 0, panY: 0 };
  let W = 0;
  let drag = null; // { kind: 'pan' | 'clip' | 'zonept' | 'line', ... }
  let hover = null;
  const undo = [];

  const fit = () => {
    const all = [];
    if (state.road && state.road.left) all.push(...state.road.left, ...state.road.right);
    if (state.line) all.push(...state.line);
    if (state.trace) all.push(...state.trace);
    for (const c of state.clips) all.push([c.x, c.z]);
    if (!all.length) return null;
    const xs = all.map((p) => p[0]);
    const zs = all.map((p) => p[1]);
    const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    const k = Math.min((W - 24) / (maxX - minX || 1), (height - 24) / (maxZ - minZ || 1));
    return { minX, minZ, k, ox: 12 + (W - 24 - (maxX - minX) * k) / 2, oz: 12 + (height - 24 - (maxZ - minZ) * k) / 2 };
  };
  const scale = () => (base ? base.k * view.zoom : 1); // pixels par mètre
  const toScreen = (x, z) => [(base.ox + (x - base.minX) * base.k) * view.zoom + view.panX, (base.oz + (z - base.minZ) * base.k) * view.zoom + view.panY];
  const toWorld = (sx, sy) => [base.minX + ((sx - view.panX) / view.zoom - base.ox) / base.k, base.minZ + ((sy - view.panY) / view.zoom - base.oz) / base.k];

  function draw() {
    W = canvas.parentElement ? canvas.parentElement.clientWidth : 600;
    if (!base) base = fit();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = height * dpr;
    canvas.style.height = `${height}px`;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    g.fillStyle = '#0a080a';
    g.fillRect(0, 0, W, height);
    if (!base) return;
    const k = scale();
    const path = (pts) => {
      g.beginPath();
      pts.forEach(([x, z], j) => {
        const [sx, sy] = toScreen(x, z);
        if (j) g.lineTo(sx, sy);
        else g.moveTo(sx, sy);
      });
    };
    // la route : surface entre les deux bords
    if (state.road && state.road.left && state.road.right) {
      g.fillStyle = 'rgba(236,229,218,0.06)';
      path([...state.road.left, ...state.road.right.slice().reverse()]);
      g.closePath();
      g.fill();
      if (!state.road.limits) {
        g.strokeStyle = 'rgba(236,229,218,0.35)';
        g.lineWidth = 1;
        path(state.road.left);
        g.stroke();
        path(state.road.right);
        g.stroke();
      }
    }
    // limites exactes de la piste (contour de la surface valide, relevé sur le circuit)
    if (state.road && Array.isArray(state.road.limits)) {
      g.strokeStyle = 'rgba(255,170,60,0.85)';
      g.lineWidth = Math.max(1, Math.min(2.5, k * 0.12));
      for (const l of state.road.limits) {
        path(l);
        g.stroke();
      }
    }
    // le passage choisi (référence)
    if (state.trace && state.trace.length) {
      g.strokeStyle = 'rgba(224,27,58,0.7)';
      g.lineWidth = 1.5;
      path(state.trace);
      g.stroke();
    }
    // la ligne à suivre
    if (state.line && state.line.length > 1) {
      g.strokeStyle = state.tool === 'line' ? 'rgba(63,207,134,0.9)' : 'rgba(236,229,218,0.55)';
      g.lineWidth = state.tool === 'line' ? 2.5 : 2;
      path(state.line);
      g.stroke();
      if (state.tool === 'line' && k > 4) {
        g.fillStyle = '#3fcf86';
        for (const [x, z] of state.line) {
          const [sx, sy] = toScreen(x, z);
          g.fillRect(sx - 1.5, sy - 1.5, 3, 3);
        }
      }
      if (state.tool === 'line' && hover && hover.line) {
        const [sx, sy] = toScreen(hover.line[0], hover.line[1]);
        g.strokeStyle = 'rgba(63,207,134,0.5)';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(sx, sy, Math.max(4, state.brush * k), 0, Math.PI * 2);
        g.stroke();
      }
    }
    // clips, à leur vraie taille
    state.clips.forEach((c, i) => {
      const color = CLIP_COLORS[c.kind] || CLIP_COLORS.inner;
      const sel = state.selected === i;
      g.strokeStyle = color;
      g.fillStyle = color;
      if (Array.isArray(c.path) && c.path.length > 1) {
        g.globalAlpha = sel ? 0.7 : 0.45;
        g.lineWidth = Math.max(3, (c.r || 1.5) * 2 * k);
        g.lineCap = 'round';
        g.lineJoin = 'round';
        path(c.path);
        g.stroke();
        g.globalAlpha = 1;
        g.lineWidth = sel ? 2 : 1;
        path(c.path);
        g.stroke();
        if (state.tool === 'clips') {
          for (const [x, z] of c.path) {
            const [sx, sy] = toScreen(x, z);
            g.fillStyle = sel ? '#fff' : color;
            g.fillRect(sx - 4, sy - 4, 8, 8);
          }
        }
      } else {
        const [sx, sy] = toScreen(c.x, c.z);
        g.globalAlpha = 0.18;
        g.beginPath();
        g.arc(sx, sy, Math.max(4, (c.r || 3) * k), 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
        g.lineWidth = sel ? 2.5 : 1.5;
        g.stroke();
        g.fillStyle = sel ? '#fff' : color;
        g.beginPath();
        g.arc(sx, sy, 3.5, 0, Math.PI * 2);
        g.fill();
      }
      const [lx, ly] = toScreen(c.x, c.z);
      g.fillStyle = sel ? '#fff' : color;
      g.font = '700 12px Barlow Condensed, sans-serif';
      g.fillText(String(i + 1), lx + Math.max(7, (c.r || 3) * k) + 3, ly + 4);
    });
    // départ et arrivée de la partie notée
    for (const [line, color] of [[state.staging, '#ece5da'], [state.start, '#3fd17f'], [state.finish, '#e01b3a']]) {
      if (!Array.isArray(line) || line.length !== 2) continue;
      g.strokeStyle = color;
      g.lineWidth = 3;
      path(line);
      g.stroke();
    }
    // échelle
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500];
    const m = steps.find((s) => s * k >= 60) || 500;
    g.strokeStyle = '#ece5da';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(14, height - 16);
    g.lineTo(14 + m * k, height - 16);
    g.stroke();
    g.fillStyle = '#ece5da';
    g.font = '600 11px Barlow, sans-serif';
    g.fillText(`${m} m`, 18 + m * k, height - 12);
  }

  const pos = (e) => {
    const b = canvas.getBoundingClientRect();
    return [e.clientX - b.left, e.clientY - b.top];
  };
  const readout = (wx, wz) => {
    const parts = [`x ${wx.toFixed(2)} · z ${wz.toFixed(2)}`];
    if (state.road) {
      const e = snapToEdge(state.road, wx, wz);
      if (e) parts.push(`bord à ${e.d.toFixed(2)} m`);
    }
    if (state.line && state.line.length > 1) {
      const n = nearestOn(state.line, wx, wz);
      if (n) parts.push(`ligne à ${n.d.toFixed(2)} m`);
    }
    info.textContent = parts.join('  ·  ');
  };
  // ce qu'il y a sous le pointeur (en pixels)
  function pick(sx, sy) {
    if (state.tool === 'clips') {
      for (let i = state.clips.length - 1; i >= 0; i--) {
        const c = state.clips[i];
        if (Array.isArray(c.path) && c.path.length > 1) {
          for (let j = 0; j < c.path.length; j++) {
            const [px, py] = toScreen(c.path[j][0], c.path[j][1]);
            if (Math.hypot(px - sx, py - sy) <= 8) return { kind: 'zonept', i, j };
          }
          const [wx, wz] = toWorld(sx, sy);
          const n = nearestOn(c.path, wx, wz);
          if (n && n.d * scale() <= Math.max(8, (c.r || 1.5) * scale())) return { kind: 'zone', i };
        } else {
          const [px, py] = toScreen(c.x, c.z);
          if (Math.hypot(px - sx, py - sy) <= Math.max(9, (c.r || 3) * scale())) return { kind: 'clip', i };
        }
      }
    } else if (state.tool === 'line' && state.line && state.line.length > 1) {
      let best = -1;
      let bd = Infinity;
      state.line.forEach(([x, z], j) => {
        const [px, py] = toScreen(x, z);
        const d = Math.hypot(px - sx, py - sy);
        if (d < bd) {
          bd = d;
          best = j;
        }
      });
      if (best >= 0 && bd <= 14) return { kind: 'line', j: best };
    }
    return null;
  }

  canvas.addEventListener('wheel', (e) => {
    if (!base) return;
    e.preventDefault();
    const [sx, sy] = pos(e);
    const [wx, wz] = toWorld(sx, sy);
    view.zoom = Math.max(1, Math.min(400, view.zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
    if (view.zoom === 1) view = { zoom: 1, panX: 0, panY: 0 };
    else {
      // le point sous la souris reste sous la souris
      const [nx, ny] = toScreen(wx, wz);
      view.panX += sx - nx;
      view.panY += sy - ny;
    }
    draw();
  }, { passive: false });

  canvas.addEventListener('mousedown', (e) => {
    if (!base) return;
    const [sx, sy] = pos(e);
    const [wx, wz] = toWorld(sx, sy);
    const hit = e.button === 0 ? pick(sx, sy) : null;
    if (hit && (hit.kind === 'clip' || hit.kind === 'zone' || hit.kind === 'zonept')) {
      state.selected = hit.i;
      const c = state.clips[hit.i];
      drag = { ...hit, startW: [wx, wz], orig: { x: c.x, z: c.z, path: c.path ? c.path.map((p) => [...p]) : null } };
      onChange('select');
    } else if (hit && hit.kind === 'line') {
      undo.push(state.line.map((p) => [...p]));
      if (undo.length > 40) undo.shift();
      drag = { kind: 'line', j: hit.j, startW: [wx, wz], orig: state.line.map((p) => [...p]) };
    } else drag = { kind: 'pan', sx, sy, panX: view.panX, panY: view.panY, moved: false, w: [wx, wz] };
    canvas.focus();
    draw();
  });

  const onMove = (e) => {
    if (!canvas.isConnected) {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      return;
    }
    if (!base) return;
    const [sx, sy] = pos(e);
    const [wx, wz] = toWorld(sx, sy);
    if (!drag) {
      if (sx < 0 || sy < 0 || sx > W || sy > height) return;
      readout(wx, wz);
      if (state.tool === 'line' && state.line && state.line.length > 1) {
        const n = nearestOn(state.line, wx, wz);
        hover = n && n.d * scale() < 14 ? { line: [n.x, n.z] } : null;
        canvas.style.cursor = hover ? 'grab' : 'default';
        draw();
      } else canvas.style.cursor = pick(sx, sy) ? 'move' : 'crosshair';
      return;
    }
    readout(wx, wz);
    if (drag.kind === 'pan') {
      if (Math.hypot(sx - drag.sx, sy - drag.sy) > 4) drag.moved = true;
      if (view.zoom > 1) {
        view.panX = drag.panX + (sx - drag.sx);
        view.panY = drag.panY + (sy - drag.sy);
        draw();
      }
      return;
    }
    let dx = wx - drag.startW[0];
    let dz = wz - drag.startW[1];
    const c = state.clips[drag.i];
    if (drag.kind === 'clip' || drag.kind === 'zonept') {
      // Maj : coller au bord de la route (le vibreur, le mur)
      const ox = drag.kind === 'clip' ? drag.orig.x : drag.orig.path[drag.j][0];
      const oz = drag.kind === 'clip' ? drag.orig.z : drag.orig.path[drag.j][1];
      if (e.shiftKey && state.road) {
        const s = snapToEdge(state.road, ox + dx, oz + dz);
        if (s) {
          dx = s.x - ox;
          dz = s.z - oz;
        }
      }
      const nx = Math.round((ox + dx) * 100) / 100;
      const nz = Math.round((oz + dz) * 100) / 100;
      if (drag.kind === 'clip') Object.assign(c, { x: nx, z: nz });
      else {
        c.path[drag.j] = [nx, nz];
        zoneCentre(c);
      }
    } else if (drag.kind === 'zone') {
      c.path = drag.orig.path.map(([x, z]) => [Math.round((x + dx) * 100) / 100, Math.round((z + dz) * 100) / 100]);
      zoneCentre(c);
    } else if (drag.kind === 'line') {
      // pinceau : les points autour suivent, de moins en moins loin du centre
      const [cx, cz] = drag.orig[drag.j];
      const R = Math.max(0.5, state.brush);
      state.line = drag.orig.map(([x, z]) => {
        const d = dist(x, z, cx, cz);
        if (d > R * 2) return [x, z];
        const w = Math.exp(-((d / R) ** 2) * 1.5);
        return [Math.round((x + dx * w) * 100) / 100, Math.round((z + dz * w) * 100) / 100];
      });
    }
    onChange('move');
    draw();
  };

  const onUp = () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.kind === 'pan' && !d.moved && state.tool === 'clips') {
      onChange('add', { x: Math.round(d.w[0] * 100) / 100, z: Math.round(d.w[1] * 100) / 100 });
      return;
    }
    if (d.kind !== 'pan') onChange('done');
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  canvas.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.tool === 'clips' && state.selected !== null) {
      e.preventDefault();
      onChange('delete');
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && state.tool === 'line' && undo.length) {
      e.preventDefault();
      state.line = undo.pop();
      draw();
    }
  });

  canvas.addEventListener('dblclick', () => {
    view = { zoom: 1, panX: 0, panY: 0 };
    draw();
  });

  return {
    el: wrap,
    draw,
    refit() {
      base = null;
      view = { zoom: 1, panX: 0, panY: 0 };
      draw();
    },
    /** Zoom sur un point (un clip choisi dans la liste). */
    focus(x, z, metres = 40) {
      if (!base) draw();
      if (!base) return;
      view.zoom = Math.max(1, Math.min(400, Math.min(W, height) / (metres * base.k)));
      const [sx, sy] = toScreen(x, z);
      view.panX += W / 2 - sx;
      view.panY += height / 2 - sy;
      draw();
    },
    undo() {
      if (!undo.length) return false;
      state.line = undo.pop();
      draw();
      return true;
    },
    pushUndo() {
      if (state.line) undo.push(state.line.map((p) => [...p]));
    },
  };
}
