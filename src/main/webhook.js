'use strict';

/**
 * Posts to the group's Discord channels through webhooks set by the admins
 * (Publication → Discord):
 *   news    — events, records, battles, proposals (manifest.discord.webhook)
 *   reports — crash reports sent to the admins (manifest.discord.reportWebhook)
 * A webhook URL lets anyone who has it post in that channel: the admins can
 * regenerate it in Discord at any time.
 */

const HOOK = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d{5,25}\/[\w-]{20,120}$/;

class Webhooks {
  constructor({ fetchImpl, getConfig, now = () => Date.now() }) {
    this.fetch = fetchImpl;
    this.getConfig = getConfig; // () => manifest.discord
    this.now = now;
    this.last = 0;
    this.queue = Promise.resolve();
  }

  url(channel) {
    const cfg = this.getConfig() || {};
    const u = channel === 'reports' ? cfg.reportWebhook : cfg.webhook;
    return typeof u === 'string' && HOOK.test(u) ? u : null;
  }

  configured(channel) {
    return Boolean(this.url(channel));
  }

  /** Post a message (and optionally a text file). Never throws for news posts. */
  post(channel, content, file) {
    const url = this.url(channel);
    if (!url) return Promise.resolve(false);
    const run = async () => {
      // Discord allows a few posts per second per webhook: keep 1.5 s between ours
      const wait = this.last + 1500 - this.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = this.now();
      const payload = { username: 'LKS Launcher', content: String(content).slice(0, 1900), allowed_mentions: { parse: [] } };
      let res;
      if (file) {
        const form = new FormData();
        form.append('payload_json', JSON.stringify(payload));
        form.append('files[0]', new Blob([file.content], { type: file.type || 'text/plain' }), file.name);
        res = await this.fetch(`${url}?wait=true`, { method: 'POST', body: form });
      } else res = await this.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error(`Discord a refusé le message (${res.status})`);
      return true;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
}

module.exports = { Webhooks, HOOK };
