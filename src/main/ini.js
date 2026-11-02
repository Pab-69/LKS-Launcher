'use strict';

/**
 * Minimal INI helpers matching the format Assetto Corsa uses
 * (UPPERCASE sections and keys, no quoting).
 */

function stringify(sections) {
  const out = [];
  for (const [name, values] of Object.entries(sections)) {
    if (values == null) continue;
    out.push(`[${name}]`);
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) continue;
      out.push(`${key}=${formatValue(value)}`);
    }
    out.push('');
  }
  return out.join('\r\n');
}

function formatValue(value) {
  if (value === null) return '';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '0';
  return String(value).replace(/[\r\n]+/g, ' ');
}

function parse(text) {
  const result = {};
  let current = null;
  for (const rawLine of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    // comments start a line or follow whitespace ("KEY=1 ; note"), values like "CARS=a;b" are kept
    const line = rawLine.replace(/(^|\s)[;#].*$/, '').trim();
    if (!line) continue;
    const section = line.match(/^\[(.+)\]$/);
    if (section) {
      current = section[1].trim();
      result[current] = result[current] || {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1 || !current) continue;
    result[current][line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return result;
}

module.exports = { stringify, parse };
