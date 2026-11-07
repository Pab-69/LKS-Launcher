'use strict';

const http = require('http');

/** In-memory fake of the GitHub releases API + download CDN. */
function startMockGithub() {
  const state = { release: null, assets: [], nextId: 1, downloads: 0 };
  const server = http.createServer((req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`;
    const url = new URL(req.url, base);
    const p = url.pathname;
    const json = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    const readBody = () => new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => resolve(Buffer.concat(chunks)));
    });
    if (req.method === 'GET' && p === '/user') return json(200, { login: 'pab' });
    // a member's token (read only): GitHub answers, but without the right to write
    const readOnly = /readonly/.test(req.headers.authorization || '');
    if (req.method === 'GET' && p === '/repos/o/r') return json(200, { full_name: 'o/r', private: false, html_url: 'x', permissions: { push: !readOnly, pull: true } });
    if (req.method === 'GET' && p === '/repos/o/r/releases/tags/content') return state.release ? json(200, state.release) : json(404, { message: 'Not Found' });
    if (req.method === 'POST' && p === '/repos/o/r/releases') {
      state.release = { id: 1, tag_name: 'content', upload_url: `${base}/upload/releases/1/assets{?name,label}` };
      return json(201, state.release);
    }
    if (req.method === 'GET' && p === '/repos/o/r/releases/1/assets') {
      const page = Number(url.searchParams.get('page') || 1);
      const per = Number(url.searchParams.get('per_page') || 30);
      return json(200, state.assets.slice((page - 1) * per, page * per).map(({ data, ...a }) => a));
    }
    let m;
    if (req.method === 'DELETE' && (m = p.match(/^\/repos\/o\/r\/releases\/assets\/(\d+)$/))) {
      state.assets = state.assets.filter((a) => a.id !== Number(m[1]));
      return json(204);
    }
    if (req.method === 'POST' && p === '/upload/releases/1/assets') {
      return readBody().then((data) => {
        const name = url.searchParams.get('name');
        if (state.assets.some((a) => a.name === name)) return json(422, { message: 'already_exists' });
        if (Number(req.headers['content-length']) !== data.length) return json(400, { message: 'bad length' });
        const id = state.nextId++;
        const asset = { id, name, size: data.length, url: `${base}/api-asset/${id}`, browser_download_url: `${base}/dl/content/${encodeURIComponent(name)}`, data };
        state.assets.push(asset);
        const { data: _d, ...pub } = asset;
        json(201, pub);
      });
    }
    if (req.method === 'GET' && (m = p.match(/^\/api-asset\/(\d+)$/))) {
      const a = state.assets.find((x) => x.id === Number(m[1]));
      if (!a) return json(404, {});
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return res.end(a.data);
    }
    if (req.method === 'GET' && (m = p.match(/^\/dl\/content\/(.+)$/))) {
      const a = state.assets.find((x) => x.name === decodeURIComponent(m[1]));
      if (!a) return json(404, {});
      state.downloads++;
      const range = req.headers.range && req.headers.range.match(/bytes=(\d+)-/);
      if (range) {
        const start = Number(range[1]);
        res.writeHead(206, { 'Content-Length': a.data.length - start, 'Content-Range': `bytes ${start}-${a.data.length - 1}/${a.data.length}` });
        return res.end(a.data.subarray(start));
      }
      res.writeHead(200, { 'Content-Length': a.data.length });
      return res.end(a.data);
    }
    json(404, { message: `no route ${req.method} ${p}` });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, base: `http://127.0.0.1:${server.address().port}` })));
}

module.exports = { startMockGithub };
