'use strict';

/**
 * Live dashboard for a phone or a second screen on the same Wi-Fi:
 * http://<this PC>:8095 (read-only, local network only, off by default).
 */

const http = require('http');

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>LKS — Tableau de bord</title>
<style>
:root{--bg:#050405;--p:#0e0b0d;--l:#261e22;--t:#ece5da;--t2:#a89c94;--a:#e01b3a;--ok:#3fcf86}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--t);font:600 16px system-ui,Segoe UI,sans-serif}
.g{display:grid;gap:10px;padding:12px;grid-template-columns:1fr 1fr;max-width:900px;margin:auto}
.c{background:var(--p);border:1px solid var(--l);padding:12px}.k{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--t2)}
.big{font-size:64px;line-height:1;font-variant-numeric:tabular-nums}.mid{font-size:34px;font-variant-numeric:tabular-nums}
.full{grid-column:1/-1}.bar{height:14px;background:#1a1317;margin-top:6px}.bar i{display:block;height:100%}
.rpm i{background:linear-gradient(90deg,var(--ok),#e3a33a,var(--a))}.gas i{background:var(--ok)}.brk i{background:var(--a)}
.tyres{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}.tyres div{background:#1a1317;padding:8px;text-align:center;font-variant-numeric:tabular-nums}
.pos{color:var(--ok)}.neg{color:var(--a)}#off{text-align:center;color:var(--t2);padding:40px}
</style></head><body><div id="off">En attente du jeu…</div><div class="g" id="d" hidden>
<div class="c"><div class="k">Vitesse</div><div class="big" id="speed">0</div></div>
<div class="c"><div class="k">Rapport</div><div class="big" id="gear">N</div></div>
<div class="c full"><div class="k">Régime</div><div class="bar rpm"><i id="rpm"></i></div></div>
<div class="c"><div class="k">Gaz</div><div class="bar gas"><i id="gas"></i></div><div class="k" style="margin-top:10px">Frein</div><div class="bar brk"><i id="brk"></i></div></div>
<div class="c"><div class="k">Angle</div><div class="mid" id="angle">0°</div><div class="k">Clips <span id="clips">—</span></div></div>
<div class="c"><div class="k">Tour</div><div class="mid" id="lap">0:00.000</div><div class="k">Meilleur <span id="best">—</span></div></div>
<div class="c"><div class="k">Écart</div><div class="mid" id="delta">—</div><div class="k">Dernier <span id="last">—</span></div></div>
<div class="c full"><div class="k">Pneus (°C)</div><div class="tyres" id="tyres"></div></div>
</div><script>
const $=(i)=>document.getElementById(i);const fmt=(ms)=>ms>0?Math.floor(ms/60000)+':'+((ms%60000)/1000).toFixed(3).padStart(6,'0'):'—';
const es=new EventSource('live');es.onmessage=(e)=>{const s=JSON.parse(e.data);const on=s&&s.status===2;$('off').hidden=on;$('d').hidden=!on;if(!on)return;
$('speed').textContent=Math.round(s.speed);$('gear').textContent=s.gear;$('rpm').style.width=(s.maxRpm?Math.min(100,s.rpm/s.maxRpm*100):0)+'%';
$('gas').style.width=s.gas*100+'%';$('brk').style.width=s.brake*100+'%';$('angle').textContent=Math.round(s.angle)+'°';$('clips').textContent=s.clips&&s.clips.total?s.clips.hit+' / '+s.clips.total:'—';
$('lap').textContent=fmt(s.lapMs);$('best').textContent=fmt(s.bestMs);$('last').textContent=fmt(s.lastMs);
const d=$('delta');if(s.delta==null){d.textContent='—';d.className='mid'}else{d.textContent=(s.delta>0?'+':'')+(s.delta/1000).toFixed(2);d.className='mid '+(s.delta<=0?'pos':'neg')}
$('tyres').innerHTML=(s.tyreTemps||[]).map(t=>'<div>'+Math.round(t)+'</div>').join('')};
</script></body></html>`;

// Overlay for streaming the group's evenings (OBS: Source navigateur, 1920×1080, fond transparent).
const OBS = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>LKS — Stream</title>
<style>
:root{--p:rgba(10,8,9,.86);--l:rgba(255,255,255,.12);--t:#f3ede4;--t2:#b9aea5;--a:#e01b3a;--ok:#3fcf86;--warn:#f0a020}
*{box-sizing:border-box}html,body{margin:0;background:transparent;color:var(--t);font:700 22px 'Barlow Condensed',system-ui,Segoe UI,sans-serif;overflow:hidden}
.box{position:fixed;background:var(--p);border:1px solid var(--l);border-left:4px solid var(--a);padding:14px 18px;min-width:280px}
.k{font-size:14px;letter-spacing:.22em;text-transform:uppercase;color:var(--t2)}.big{font-size:64px;line-height:1;font-variant-numeric:tabular-nums}
.row{display:flex;gap:22px;align-items:flex-end}.ok{color:var(--ok)}.bad{color:var(--a)}.warn{color:var(--warn)}
#live{left:32px;bottom:32px}#battle{left:50%;top:28px;transform:translateX(-50%);text-align:center}#score{right:32px;bottom:32px;max-width:520px}
#draw{right:32px;top:28px;max-width:440px;font-size:19px}.m{display:flex;justify-content:space-between;gap:14px;padding:3px 0;border-bottom:1px solid var(--l)}
.m:last-child{border:0}.w{color:var(--ok)}[hidden]{display:none!important}
</style></head><body>
<div class="box" id="battle" hidden><div class="k">Battle</div><div id="bt" style="font-size:34px"></div><div class="k" id="bs"></div></div>
<div class="box" id="live" hidden><div class="k" id="who">En piste</div><div class="row"><div><div class="big" id="ang">0°</div><div class="k">angle</div></div><div><div class="big" id="spd">0</div><div class="k">km/h</div></div><div><div class="big" id="gap">—</div><div class="k" id="gapk">écart</div></div></div><div class="k" id="clips"></div></div>
<div class="box" id="score" hidden><div class="k">Dernière note</div><div class="row"><div class="big" id="sc"></div><div id="sd" class="k"></div></div><div id="sclips" style="font-size:18px;margin-top:6px"></div></div>
<div class="box" id="draw" hidden><div class="k" id="dn"></div><div id="dm"></div></div>
<script>
const $=(i)=>document.getElementById(i);const esc=(s)=>String(s==null?'':s).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function tick(){let d;try{d=await (await fetch('obs.json',{cache:'no-store'})).json()}catch{return}
const l=d.live;$('live').hidden=!l;if(l){$('who').textContent=d.driver||'En piste';$('ang').textContent=Math.round(l.angle)+'°';$('spd').textContent=Math.round(l.speed);
const o=(d.others||[])[0];$('gap').textContent=o&&o.gap!=null?o.gap+' m':'—';$('gapk').textContent=o?'écart '+o.name:'écart';$('clips').textContent=l.clips&&l.clips.total?'Clips '+l.clips.hit+' / '+l.clips.total:''}
const b=d.battle;$('battle').hidden=!b;if(b){$('bt').innerHTML=esc(d.driver)+' <span class="k">vs</span> '+esc(b.name);$('bs').textContent='Run '+b.run+' / 2 · '+(b.role==='lead'?esc(d.driver)+' devant':esc(b.name)+' devant')+(b.phase==='done'?' · terminée':'')}
const s=d.score;$('score').hidden=!s;if(s){$('sc').textContent=(s.score||0)+'/100';$('sd').innerHTML=esc(s.kind==='tandem'?'chase de '+s.driver:s.driver)+(s.record?' · <span class="ok">record</span>':'');
$('sclips').innerHTML=(s.clips||[]).map(c=>'<span class="'+(c.hit?'ok':'bad')+'">'+(c.hit?'✓':'✗')+' '+esc(c.name)+(c.cover!=null?' '+c.cover+'%':'')+'</span>').join(' &nbsp; ')}
const r=d.round;$('draw').hidden=!r;if(r){$('dn').textContent=r.name;$('dm').innerHTML=r.lines.map(m=>'<div class="m"><span class="'+(m.win===0?'w':'')+'">'+esc(m.a)+'</span><span class="k">'+esc(m.label)+'</span><span class="'+(m.win===1?'w':'')+'">'+esc(m.b)+'</span></div>').join('')}}
setInterval(tick,500);tick();
</script></body></html>`;

class DashServer {
  constructor({ getLive, getObs }) {
    this.getLive = getLive;
    this.getObs = getObs || (() => null);
    this.server = null;
    this.clients = new Set();
    this.timer = null;
  }

  get running() {
    return Boolean(this.server);
  }

  start(port = 8095, host = '0.0.0.0') {
    if (this.server) return Promise.resolve(this.server.address().port);
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (req.method !== 'GET') {
          res.writeHead(405).end();
          return;
        }
        if (req.url === '/' || req.url === '/index.html') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(PAGE);
          return;
        }
        if (req.url === '/obs') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(OBS);
          return;
        }
        if (req.url === '/obs.json') {
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(this.getObs() || {}));
          return;
        }
        if (req.url === '/live') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          res.write(`data: ${JSON.stringify(this.getLive() || null)}\n\n`);
          this.clients.add(res);
          req.on('close', () => this.clients.delete(res));
          return;
        }
        res.writeHead(404).end();
      });
      server.on('error', reject);
      server.listen(port, host, () => {
        this.server = server;
        this.timer = setInterval(() => this.broadcast(), 100);
        resolve(server.address().port);
      });
    });
  }

  broadcast() {
    if (!this.clients.size) return;
    const msg = `data: ${JSON.stringify(this.getLive() || null)}\n\n`;
    for (const c of this.clients) c.write(msg);
  }

  stop() {
    clearInterval(this.timer);
    for (const c of this.clients) c.end();
    this.clients.clear();
    if (this.server) this.server.close();
    this.server = null;
  }
}

module.exports = { DashServer };
