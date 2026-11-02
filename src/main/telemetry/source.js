'use strict';

/**
 * Reads Assetto Corsa's shared memory on Windows (Local\acpmf_*), through
 * kernel32 via koffi (prebuilt FFI, nothing to compile). Read-only.
 */

const { PHYSICS_SIZE, GRAPHICS_SIZE, STATIC_SIZE } = require('./layout');

const FILE_MAP_READ = 0x0004;
const PAGES = { physics: ['Local\\acpmf_physics', PHYSICS_SIZE], graphics: ['Local\\acpmf_graphics', GRAPHICS_SIZE], static: ['Local\\acpmf_static', STATIC_SIZE] };

class SharedMemorySource {
  constructor() {
    this.api = null;
    this.maps = null;
    this.nextTry = 0;
  }

  load() {
    if (this.api) return this.api;
    const koffi = require('koffi');
    const k32 = koffi.load('kernel32.dll');
    this.koffi = koffi;
    this.api = {
      open: k32.func('void *OpenFileMappingW(uint32_t access, bool inherit, str16 name)'),
      map: k32.func('void *MapViewOfFile(void *handle, uint32_t access, uint32_t high, uint32_t low, size_t bytes)'),
      unmap: k32.func('bool UnmapViewOfFile(void *addr)'),
      close: k32.func('bool CloseHandle(void *handle)'),
    };
    return this.api;
  }

  /** Try to attach to the game's memory (at most every 2 s). */
  attach() {
    if (this.maps) return true;
    if (process.platform !== 'win32') return false;
    if (Date.now() < this.nextTry) return false;
    this.nextTry = Date.now() + 2000;
    if (this.error) return false;
    let api;
    try {
      api = this.load();
    } catch (err) {
      this.error = err; // native module missing: telemetry stays off, the launcher keeps working
      return false;
    }
    const maps = {};
    for (const [key, [name, size]] of Object.entries(PAGES)) {
      const handle = api.open(FILE_MAP_READ, false, name);
      if (!handle) {
        this.release(maps);
        return false;
      }
      const ptr = api.map(handle, FILE_MAP_READ, 0, 0, size);
      if (!ptr) {
        api.close(handle);
        this.release(maps);
        return false;
      }
      maps[key] = { handle, ptr, size };
    }
    this.maps = maps;
    return true;
  }

  copy(m) {
    const k = this.koffi;
    if (typeof k.view === 'function') return Buffer.from(new Uint8Array(k.view(m.ptr, m.size)));
    return Buffer.from(k.decode(m.ptr, 'uint8_t', m.size));
  }

  /** { physics, graphics, static } buffers, or null when the game isn't running. */
  read() {
    if (!this.attach()) return null;
    try {
      return { physics: this.copy(this.maps.physics), graphics: this.copy(this.maps.graphics), static: this.copy(this.maps.static) };
    } catch {
      this.detach();
      return null;
    }
  }

  release(maps) {
    for (const m of Object.values(maps)) {
      try {
        this.api.unmap(m.ptr);
        this.api.close(m.handle);
      } catch {
        /* ignore */
      }
    }
  }

  /** Called when the game closes, so a new session is picked up cleanly. */
  detach() {
    if (this.maps) this.release(this.maps);
    this.maps = null;
    this.nextTry = 0;
  }
}

/** Same interface, fed by the simulator (tests and demo only). */
class SimulatedSource {
  constructor(sim) {
    this.sim = sim;
  }

  read() {
    return this.sim.step(16);
  }

  detach() {}
}

module.exports = { SharedMemorySource, SimulatedSource };
