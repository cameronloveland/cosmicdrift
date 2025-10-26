import { Color, Vector3 } from 'three';
import type { TrackOptions } from './types';

export const COLORS = {
    bgDeep: new Color(0x0a0324),
    neonMagenta: new Color(0xff2bd6),
    neonCyan: new Color(0x53d7ff),
    deepBlue: new Color(0x0b1a5f),
    violet: new Color(0xc33dff),
    neonYellow: new Color(0xffff00),
    neonPurple: new Color(0xc33dff),
    neonRed: new Color(0xff4444)
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
    downPitchDeg: 12,
    // Mario Kart-style camera behavior
    cameraYawDamping: 4.0,  // Heavy damping for subtle camera rotation
    cameraYawScale: 0.25,   // Camera only rotates 25% as much as ship
    shipYawFromInput: 0.4   // How much ship rotates based on turning (radians)
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
    minStartOffset: 200, // meters from start line before first boost pad
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

// Planet visual effects configuration
export const PLANET_EFFECTS = {
    // Effect enable/disable flags
    enableAtmospheric: false,
    enableAurora: false,
    enableRings: false,
    enableTendrils: false,

    // Saturn-like Ring System
    rings: {
        particleCount: 1500, // Higher density for more visible rings
        innerRadius: 1.2, // multiplier of planet radius - closer to planet
        outerRadius: 3.0, // multiplier of planet radius - extended rings
        ringThickness: 0.15, // Slightly thicker rings for better visibility
        particleSize: 1.2, // Larger debris particles for better visibility
        opacity: 1.0, // Maximum opacity for visibility
        rotationSpeed: 0.15, // Fast orbital rotation speed around planet
        wobbleAmount: 0.05, // Slight wobble for realism
        wobbleSpeed: 0.3,
        spinSpeed: 0.08, // Additional spin speed for debris fields
        // Sparkle and glow effects
        sparkleIntensity: 2.0, // Base intensity for sparkle effects
        sparkleVariation: 1.5, // Variation in sparkle intensity
        sparkleSpeed: 3.0, // Speed of sparkle flickering
        sparkleFrequency: 0.3, // How often sparkles occur (0-1)
        glowPulseSpeed: 2.5, // Speed of glow pulsing
        glowPulseIntensity: 0.8, // Intensity of glow pulsing
        colorVariation: 0.2, // Reduced for more consistent colors
        sizeVariation: 0.3, // Reduced for more consistent debris sizes
        // Ring colors - alternating pink and teal
        ringColors: [
            { color: 0xff2bd6, glowIntensity: 1.5 }, // Vibrant pink
            { color: 0x53d7ff, glowIntensity: 1.2 }, // Vibrant teal
            { color: 0xff2bd6, glowIntensity: 1.0 }, // Medium pink
            { color: 0x53d7ff, glowIntensity: 0.8 }, // Medium teal
        ],
        // Multiple ring bands with different densities and alternating colors
        ringBands: [
            { density: 1.0, radiusMin: 1.2, radiusMax: 1.8, colorIndex: 0 }, // Inner dense band - vibrant pink
            { density: 0.4, radiusMin: 1.8, radiusMax: 2.2, colorIndex: 1 }, // Gap - vibrant teal (more visible)
            { density: 0.9, radiusMin: 2.2, radiusMax: 2.6, colorIndex: 2 }, // Outer band - medium pink
            { density: 0.5, radiusMin: 2.6, radiusMax: 3.0, colorIndex: 3 }  // Sparse outer edge - medium teal (more visible)
        ]
    }
};

// Shooting stars configuration
export const SHOOTING_STARS = {
    maxCount: 80, // Maximum active shooting stars (much more for dramatic effect)
    spawnRateMin: 0.05, // Minimum seconds between spawns (very frequent)
    spawnRateMax: 0.15, // Maximum seconds between spawns (very frequent)
    lifetimeMin: 3.0, // Minimum star lifetime in seconds
    lifetimeMax: 6.0, // Maximum star lifetime in seconds
    speedMin: 80, // Minimum speed (units per second)
    speedMax: 150, // Maximum speed (units per second)
    starfieldRadius: 1200, // Spawn around the starfield outskirts in all directions
    trailLength: 120, // Length of particle trail (longer for more drama)
    trailParticleCount: 40, // Particles per trail (more dramatic trails)
    starSize: 5.0, // Size of star core (much larger for visibility)
    trailColors: [
        new Color(0x53d7ff), // Cyan
        new Color(0xff2bd6), // Magenta
        new Color(0xffffff)  // White
    ]
};

// Comets configuration
export const COMETS = {
    maxCount: 8, // Maximum active comets (more for continuous effect)
    spawnIntervalMin: 2, // Minimum seconds between comet spawns (very frequent)
    spawnIntervalMax: 5, // Maximum seconds between comet spawns (very frequent)
    headRadius: 8, // Comet head size (larger for visibility)
    tailLength: 200, // Tail length in units
    tailParticleCount: 150, // Particles in tail
    speedMin: 80, // Minimum comet speed
    speedMax: 150, // Maximum comet speed
    colors: [
        new Color(0xff2bd6), // Magenta comet
        new Color(0x53d7ff)  // Cyan comet
    ],
    // Predefined paths that pass near the track
    paths: [
        // Path 1: Arc from left to right, passing over track
        {
            start: new Vector3(-200, 100, -100),
            control1: new Vector3(-50, 150, 0),
            control2: new Vector3(50, 125, 0),
            end: new Vector3(200, 75, 100),
            duration: 8.0
        },
        // Path 2: Diagonal from back-left to front-right
        {
            start: new Vector3(-150, 50, -150),
            control1: new Vector3(0, 100, 0),
            control2: new Vector3(75, 75, 50),
            end: new Vector3(150, 40, 150),
            duration: 10.0
        },
        // Path 3: High arc passing over track center
        {
            start: new Vector3(-125, 25, -125),
            control1: new Vector3(0, 200, 0),
            control2: new Vector3(0, 175, 0),
            end: new Vector3(125, 25, 125),
            duration: 12.0
        },
        // Path 4: Low swoop under track
        {
            start: new Vector3(-175, 10, -75),
            control1: new Vector3(-25, 25, 0),
            control2: new Vector3(25, 40, 0),
            end: new Vector3(175, 15, 75),
            duration: 9.0
        }
    ]
};



