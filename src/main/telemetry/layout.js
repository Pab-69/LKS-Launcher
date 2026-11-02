'use strict';

/**
 * Assetto Corsa shared memory layout (Kunos SDK, structs packed on 4 bytes):
 *   Local\acpmf_physics   SPageFilePhysics  (updated every physics step)
 *   Local\acpmf_graphics  SPageFileGraphic  (session, lap times, position)
 *   Local\acpmf_static    SPageFileStatic   (car, track, limits)
 * Only the fields the launcher uses are listed. wchar_t = 2 bytes (Windows).
 */

const PHYSICS = {
  packetId: ['i32', 0],
  gas: ['f32', 4],
  brake: ['f32', 8],
  fuel: ['f32', 12],
  gear: ['i32', 16], // 0 = R, 1 = N, 2 = 1st…
  rpms: ['i32', 20],
  steerAngle: ['f32', 24],
  speedKmh: ['f32', 28],
  velocity: ['f32', 32, 3],
  accG: ['f32', 44, 3],
  wheelSlip: ['f32', 56, 4],
  wheelsPressure: ['f32', 88, 4],
  tyreCoreTemperature: ['f32', 152, 4],
  heading: ['f32', 208],
  numberOfTyresOut: ['i32', 244],
  pitLimiterOn: ['i32', 248],
  brakeTemp: ['f32', 348, 4],
  clutch: ['f32', 364],
  localVelocity: ['f32', 568, 3],
};
const PHYSICS_SIZE = 580;

const GRAPHICS = {
  packetId: ['i32', 0],
  status: ['i32', 4], // 0 off, 1 replay, 2 live, 3 pause
  session: ['i32', 8], // -1 unknown, 0 practice, 1 qualify, 2 race, 3 hotlap, 4 time attack, 5 drift, 6 drag
  completedLaps: ['i32', 132],
  position: ['i32', 136],
  iCurrentTime: ['i32', 140],
  iLastTime: ['i32', 144],
  iBestTime: ['i32', 148],
  isInPit: ['i32', 160],
  currentSectorIndex: ['i32', 164],
  lastSectorTime: ['i32', 168],
  normalizedCarPosition: ['f32', 248],
  carCoordinates: ['f32', 252, 3],
  isInPitLane: ['i32', 276],
};
const GRAPHICS_SIZE = 300;

const STATIC = {
  smVersion: ['wstr', 0, 15],
  acVersion: ['wstr', 30, 15],
  numCars: ['i32', 64],
  carModel: ['wstr', 68, 33],
  track: ['wstr', 134, 33],
  playerName: ['wstr', 200, 33],
  playerSurname: ['wstr', 266, 33],
  playerNick: ['wstr', 332, 33],
  sectorCount: ['i32', 400],
  maxRpm: ['i32', 412],
  maxFuel: ['f32', 416],
  trackSPlineLength: ['f32', 520],
  trackConfiguration: ['wstr', 524, 33],
};
const STATIC_SIZE = 600;

function readField(buf, [type, offset, count]) {
  if (offset + 4 > buf.length) return type === 'wstr' ? '' : count ? [] : 0;
  if (type === 'wstr') {
    const raw = buf.subarray(offset, Math.min(buf.length, offset + count * 2)).toString('utf16le');
    const end = raw.indexOf('\0');
    return end === -1 ? raw : raw.slice(0, end);
  }
  const read = (o) => (type === 'f32' ? buf.readFloatLE(o) : buf.readInt32LE(o));
  if (!count) return read(offset);
  const out = [];
  for (let i = 0; i < count; i++) out.push(read(offset + i * 4));
  return out;
}

function parse(layout, buf) {
  const out = {};
  for (const [name, def] of Object.entries(layout)) out[name] = readField(buf, def);
  return out;
}

/** Inverse of parse (used by the simulator and the tests). */
function encode(layout, size, values) {
  const buf = Buffer.alloc(size);
  for (const [name, [type, offset, count]] of Object.entries(layout)) {
    const v = values[name];
    if (v === undefined) continue;
    if (type === 'wstr') {
      buf.write(String(v).slice(0, count - 1), offset, 'utf16le');
      continue;
    }
    const write = (o, x) => (type === 'f32' ? buf.writeFloatLE(Number(x) || 0, o) : buf.writeInt32LE(Math.trunc(Number(x) || 0), o));
    if (count) v.forEach((x, i) => write(offset + i * 4, x));
    else write(offset, v);
  }
  return buf;
}

const parsePhysics = (b) => parse(PHYSICS, b);
const parseGraphics = (b) => parse(GRAPHICS, b);
const parseStatic = (b) => parse(STATIC, b);

/**
 * Drift angle in degrees, from the car's local velocity (x = sideways,
 * z = forward). Falls back to world velocity + heading if the local vector
 * looks wrong (other game versions).
 */
function driftAngle(p) {
  return Math.abs(slipAngle(p));
}

/** Signed version of driftAngle: the sign tells which way the car slides. */
function slipAngle(p) {
  const speed = p.speedKmh / 3.6;
  if (speed < 3) return 0;
  const [lx, , lz] = p.localVelocity || [0, 0, 0];
  const local = Math.hypot(lx, lz);
  if (local > 0 && Math.abs(local - speed) / speed < 0.2) {
    return (Math.atan2(lx, lz) * 180) / Math.PI;
  }
  const [vx, , vz] = p.velocity || [0, 0, 0];
  const course = Math.atan2(vx, vz);
  let a = (((course - p.heading) * 180) / Math.PI) % 360;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  if (a > 90) return 180 - a;
  if (a < -90) return -180 - a;
  return a;
}

module.exports = { PHYSICS, GRAPHICS, STATIC, PHYSICS_SIZE, GRAPHICS_SIZE, STATIC_SIZE, parsePhysics, parseGraphics, parseStatic, encode, driftAngle, slipAngle };
