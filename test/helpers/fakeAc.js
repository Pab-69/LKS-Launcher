'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

/** Creates a minimal Assetto Corsa install. */
function makeFakeAc(root, { cars = {}, tracks = {} } = {}) {
  write(path.join(root, 'acs.exe'), 'fake');
  fs.mkdirSync(path.join(root, 'content', 'cars'), { recursive: true });
  fs.mkdirSync(path.join(root, 'content', 'tracks'), { recursive: true });
  write(path.join(root, 'content', 'weather', '3_clear', 'weather.ini'), '[LAUNCHER]\nNAME=Clear\n');
  write(path.join(root, 'content', 'weather', '7_heavy_clouds', 'weather.ini'), '[LAUNCHER]\nNAME=Heavy clouds\n');
  for (const [id, opts] of Object.entries(cars)) addCar(root, id, opts);
  for (const [id, opts] of Object.entries(tracks)) addTrack(root, id, opts);
  return root;
}

function addCar(root, id, { name = id, brand = 'LKS', skins = ['00_black', '01_white'], size = 300000 } = {}) {
  const dir = path.join(root, 'content', 'cars', id);
  // ui_car.json with BOM, raw tab and trailing comma, like many real mods
  write(path.join(dir, 'ui', 'ui_car.json'), `﻿{"name": "${name}",\t"brand": "${brand}", "class": "street", "tags": ["drift",], "specs": {"bhp": "300bhp", "weight": "1200kg"},}`);
  write(path.join(dir, 'data.acd'), crypto.randomBytes(size));
  write(path.join(dir, `${id}.kn5`), Buffer.alloc(size, 7));
  for (const s of skins) {
    write(path.join(dir, 'skins', s, 'preview.jpg'), crypto.randomBytes(2000));
    write(path.join(dir, 'skins', s, 'ui_skin.json'), JSON.stringify({ skinname: s.toUpperCase() }));
  }
  return dir;
}

function addTrack(root, id, { name = id, layouts = ['gp', 'short'], size = 200000 } = {}) {
  const dir = path.join(root, 'content', 'tracks', id);
  write(path.join(dir, `${id}.kn5`), crypto.randomBytes(size));
  for (const l of layouts) {
    write(path.join(dir, 'ui', l, 'ui_track.json'), JSON.stringify({ name: `${name} ${l.toUpperCase()}`, country: 'France', length: '3200m', pitboxes: '12' }));
    write(path.join(dir, 'ui', l, 'preview.png'), crypto.randomBytes(1000));
    write(path.join(dir, l, 'data', 'surfaces.ini'), '[SURFACE_0]\nKEY=ROAD\n');
  }
  return dir;
}

module.exports = { makeFakeAc, addCar, addTrack, write };
