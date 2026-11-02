'use strict';

/**
 * Fake Assetto Corsa: drives a car around an oval and produces the same
 * shared-memory buffers as the game. Used by the tests and the demo
 * (LKS_TELEMETRY_SIM=1), never by players.
 */

const { PHYSICS, GRAPHICS, STATIC, PHYSICS_SIZE, GRAPHICS_SIZE, STATIC_SIZE, encode } = require('./layout');

class Simulator {
  constructor({ lapMs = 62000, car = 'lks_bmw_m2', track = 'lks_touge_haruna', layout = 'downhill', driver = 'Pab', drift = true, seed = 1 } = {}) {
    Object.assign(this, { lapMs, car, track, layout, driver, drift });
    this.t = 0; // ms since start
    this.laps = 0;
    this.lastLap = 0;
    this.best = 0;
    this.rand = mulberry(seed);
  }

  /** Advance by dt ms and return the three buffers. */
  step(dt = 16) {
    this.t += dt;
    if (this.lapStart === undefined) {
      this.lapStart = 0;
      this.duration = this.lapMs;
    }
    if (this.t - this.lapStart >= this.duration) {
      this.lastLap = Math.round(this.duration);
      this.best = this.best ? Math.min(this.best, this.lastLap) : this.lastLap;
      this.laps++;
      this.lapStart += this.duration;
      this.duration = this.lapMs * (0.97 + this.rand() * 0.06);
    }
    const d = (this.t - this.lapStart) / this.duration;
    const a = d * Math.PI * 2;
    const corner = Math.abs(Math.sin(a * 2)); // 4 corners per lap
    const speed = 160 - corner * 80 + this.rand() * 4;
    const gear = speed > 140 ? 6 : speed > 110 ? 5 : speed > 85 ? 4 : 3;
    const angle = this.drift && corner > 0.6 ? 20 + corner * 25 : 2;
    const v = speed / 3.6;
    const rad = (angle * Math.PI) / 180;
    const physics = encode(PHYSICS, PHYSICS_SIZE, {
      packetId: Math.floor(this.t / dt),
      gas: corner > 0.7 ? 0.55 : 1,
      brake: corner > 0.5 && corner < 0.7 ? 0.8 : 0,
      fuel: 40,
      gear,
      rpms: 4000 + (speed % 40) * 100,
      steerAngle: Math.sin(a * 2) * 0.4,
      speedKmh: speed,
      velocity: [Math.sin(a) * v, 0, Math.cos(a) * v],
      heading: a,
      tyreCoreTemperature: [82, 83, 90, 91],
      wheelsPressure: [26.1, 26.2, 26.8, 26.9],
      numberOfTyresOut: 0,
      clutch: 1,
      localVelocity: [Math.sin(rad) * v, 0, Math.cos(rad) * v],
    });
    const graphics = encode(GRAPHICS, GRAPHICS_SIZE, {
      packetId: Math.floor(this.t / dt),
      status: 2,
      session: this.drift ? 5 : 0,
      completedLaps: this.laps,
      position: 1,
      iCurrentTime: Math.round(this.t - this.lapStart),
      iLastTime: this.lastLap,
      iBestTime: this.best,
      normalizedCarPosition: d,
      carCoordinates: [Math.cos(a) * 300 + Math.cos(a * 3) * 40, 0, Math.sin(a) * 180],
      isInPitLane: 0,
    });
    const stat = encode(STATIC, STATIC_SIZE, { smVersion: '1.7', acVersion: '1.16', carModel: this.car, track: this.track, trackConfiguration: this.layout, playerNick: this.driver, maxRpm: 8000, numCars: 1 });
    return { physics, graphics, static: stat };
  }
}

function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

module.exports = { Simulator };
