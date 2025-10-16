import { Color, Vector3 } from 'three';
import type { TrackOptions } from './types';

export const COLORS = {
    bgDeep: new Color(0x0a0324),
    neonMagenta: new Color(0xff2bd6),
    neonCyan: new Color(0x53d7ff),
    deepBlue: new Color(0x0b1a5f),
    violet: new Color(0xc33dff)
};

export const CAMERA = {
    fov: 80,
    near: 0.1,
    far: 20000,
    chaseDistance: 4.8,
    chaseHeight: 1.5,
    shakeMax: 0.02,
    // Additional camera tuning for Mario Kart-style presentation
    lookAheadDistance: 6.0,
    downPitchDeg: 12
};

export const PHYSICS = {
    baseSpeed: 210, // km/h visualized in HUD (convert to m/s inside)
    maxSpeed: 360,
    boostMultiplier: 1.8,
    // Manual boost resource
    boostDurationSec: 3.0, // full-to-empty hold duration
    boostRegenPerSec: 0.25, // refills in ~4s when not boosting and not holding
    trackBoosterMultiplier: 1.3,
    trackBoosterDuration: 10, // seconds
    boosterLateralRatio: 0.35, // fraction of track width allowed to pick up booster (center lane)
    lateralMax: 1.6,
    lateralAccel: 9.0,
    lateralDamping: 8.0,
    pitchMax: 0.2,
    pitchAccel: 1.8,
    pitchDamping: 3.0,
    flowFillSpeed: 0.12,
    flowDrainSpeed: 0.5,
    highSpeedThreshold: 170
};

export const RENDER = {
    targetFPS: 60,
    maxPixelRatio: 1.75
};

export const POST = {
    bloomStrength: 1.2,
    bloomRadius: 0.4,
    bloomThreshold: 0.2,
    motionBlurSamples: 8,
    // Optional additional antialiasing for crisp rails/edges
    enableSMAA: true
};

export const LAPS_TOTAL = 3;

export const TRACK_SOURCE = 'procedural' as const; // 'procedural' | 'custom'
export const TRACK_SEED = 1337;
export const TRACK_OPTS: Readonly<TrackOptions> = {
    seed: TRACK_SEED,
    controlPointCount: 72,
    samples: 2400,
    width: 24,
    lengthMeters: 8000,
    radiusMin: 500,
    radiusMax: 1600,
    elevationAmplitude: 320,
    maxCurvature: 0.003,
    maxGrade: 0.16,
    bankMaxDeg: 36,
    markerSpacing: 50,
    // New tunables for smoothing/quality
    controlPointSmoothPasses: 2,
    minChord: 40,
    // radians; max angular change between rail segments before subdivision
    railMaxAngle: 0.08
};

export const STARFIELD_MIN_RADIUS = 6000;

// Booster visual/spacing
export const BOOSTER_SPACING_METERS = 600;
export const BOOSTER_COLOR = 0xfff066;

export const CUSTOM_TRACK_POINTS: Vector3[] = [];


