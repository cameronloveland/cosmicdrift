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
    chaseDistance: 5.5,
    chaseHeight: 3.0,
    shakeMax: 0.02,
    // Additional camera tuning for Mario Kart-style presentation
    lookAheadDistance: 8.0,
    downPitchDeg: 12
};

export const PHYSICS = {
    baseSpeed: 210, // km/h visualized in HUD (convert to m/s inside)
    maxSpeed: 360,
    boostMultiplier: 1.8,
    // Manual boost resource
    boostDurationSec: 3.0, // full-to-empty hold duration
    boostRegenPerSec: 0.25, // refills in ~4s when not boosting and not holding
    lateralMax: 1.6,
    lateralAccel: 16.0,
    lateralDamping: 13.0,
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
    samples: 6000, // 2400 is the original
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
    controlPointSmoothPasses: 10,
    minChord: 60,
    // radians; max angular change between rail segments before subdivision
    railMaxAngle: 0.05
};

export const STARFIELD_MIN_RADIUS = 6000;

export const CUSTOM_TRACK_POINTS: Vector3[] = [];

// Tunnel configuration
export const TUNNEL = {
    countMin: 2,
    countMax: 3,
    lengthMin: 400, // meters
    lengthMax: 600, // meters
    radius: 16, // slightly larger than track width for enclosure feel
    segmentCount: 64, // geometry detail per tunnel section
    radialSegments: 16, // tube cross-section detail
    centerBoostMultiplier: 1.5, // max speed boost when perfectly centered
    centerThreshold: 0.7, // lateral alignment ratio needed for boost (0-1)
    boostAccumulationSpeed: 0.8, // how fast boost builds when centered
    boostDecaySpeed: 1.5, // how fast boost decays when off-center
    fovBoost: 8, // FOV increase when in tunnel
    minSpacing: 800, // minimum meters between tunnel starts
    // Neon gradient colors for tunnel
    colorStart: new Color(0x53d7ff), // cyan
    colorEnd: new Color(0xff2bd6), // magenta
    glowIntensity: 1.2,
    ringSpacing: 25 // meters between decorative rings
};

// Boost pad configuration
export const BOOST_PAD = {
    spacing: 600, // meters between boost pads
    lengthMeters: 40, // length of each boost pad zone
    boostMultiplier: 1.6, // speed multiplier when on pad (more noticeable)
    boostDuration: 2.5, // seconds boost effect lasts after leaving pad
    boostDecaySpeed: 1.2, // how fast boost decays after leaving pad
    thickness: 0.2, // visual height above track
    // Neon colors for boost pads
    colorStart: new Color(0xffff00), // yellow
    colorEnd: new Color(0xff8800), // orange
    pulseSpeed: 2.0, // animation pulse frequency
    glowIntensity: 1.5,
    // Rocket tail effect
    tailLength: 4.0, // length of rocket tail
    tailIntensity: 1.2, // brightness of tail effect
    tailParticleCount: 20 // number of particles in tail
};

// Wormhole tunnel configuration
export const WORMHOLE = {
    dotsPerMeter: 8.0, // dot density along tunnel length (increased for more flow)
    dotsPerRing: 16, // dots around circumference at each position (reduced)
    dotSize: 0.18, // radius of each dot sphere
    radiusMin: 8, // minimum distance from tunnel center axis
    radiusMax: 15, // maximum distance from tunnel center axis (varying depths)
    spiralTwist: 0.12, // radians of rotation per meter along tunnel
    randomness: 0.4, // position randomness factor (0-1)
    hueSpeed: 0.2, // hue rotation speed (cyan/pink cycle)
    saturation: 1.0, // HSL saturation (full saturation for vibrant colors)
    lightness: 0.5, // HSL lightness (reduced for less white, harder colors)
    opacity: 0.85, // dot transparency (increased for visibility)
    glowIntensity: 1.3 // brightness multiplier (reduced to avoid white glow)
};



