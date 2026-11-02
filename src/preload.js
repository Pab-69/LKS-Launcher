'use strict';

const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

const EVENTS = [
  'sync:changed',
  'sync:progress',
  'sync:verify',
  'content:changed',
  'game:state',
  'toast',
  'settings:changed',
  'updater:status',
  'window:state',
  'admin:log',
  'admin:progress',
  'admin:busy',
  'admin:hashed',
  'csp:progress',
  'csp:changed',
];

contextBridge.exposeInMainWorld('lks', {
  call,
  on(event, fn) {
    if (!EVENTS.includes(event)) throw new Error(`Évènement inconnu : ${event}`);
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
