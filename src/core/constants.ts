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
    cameraYawDamping: 6.0,  // Faster follow for snappier feel
    cameraYawScale: 0.25,   // Camera only rotates 25% as much as ship
    shipYawFromInput: 0.65  // How much ship rotates based on turning (radians)
};

export const PHYSICS = {
    baseSpeed: 236, // km/h visualized in HUD (convert to m/s inside) - reduced 25% from 315
    maxSpeed: 405, // reduced 25% from 540 to maintain proportional relationship
    boostMultiplier: 1.8,
    // Manual boost resource
    boostDurationSec: 3.0, // full-to-empty hold duration
    boostRegenPerSec: 0.25, // refills in ~4s when not boosting and not holding
    boostDrainThreshold: 0.01, // minimum boost level before considered drained
    boostMinActivation: 0.0625, // minimum boost level to activate (1 segment = 1/16)
    boostRechargeDelaySec: 1.5, // delay before boost starts recharging after release
    lateralMax: 1.6,
    lateralAccel: 16.0,
    lateralDamping: 13.0,
    pitchMax: 0.2,
    pitchAccel: 1.8,
    pitchDamping: 3.0,
    flowFillSpeed: 0.12,
    flowDrainSpeed: 0.5,
    highSpeedThreshold: 191, // reduced 25% from 255 to maintain proportional relationship
    hoverHeight: 0.3 // Height above track surface in meters
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

// Camera director tuning for attract mode
export const ATTRACT_CAMERA = {
    blendDurationSec: 2.2, // Slow, cinematic transitions
    cutMinSec: 5,
    cutMaxSec: 9,
    // Standard chase offsets
    standard: { height: 3.6, back: 12.0 },
    // Helicopter follow ranges
    heli: { heightBase: 18, heightSway: 2, backBase: 20, backSway: 2, rightSway: 2, lookAheadMeters: 16 },
    // Trackside offsets
    trackside: { aheadT: 0.06, side: 10, up: 4, lookBack: 6 },
    // User zoom via mouse wheel
    zoom: { min: 0.6, max: 2.0, step: 0.1 }
} as const;

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
    dotsPerMeter: 5.0, // dot density along tunnel length
    dotsPerRing: 12, // dots around circumference at each position
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
    maxCount: 80, // Increased for better coverage across all areas
    spawnRateMin: 0.03, // More frequent spawning for better visibility
    spawnRateMax: 0.12, // More frequent spawning for better visibility
    lifetimeMin: 4.0, // Minimum star lifetime in seconds (longer trails)
    lifetimeMax: 8.0, // Maximum star lifetime in seconds (longer trails)
    speedMin: 60, // Minimum speed (units per second) - slightly slower for better visibility
    speedMax: 120, // Maximum speed (units per second) - slightly slower for better visibility
    starfieldRadius: 1500, // Increased radius for better depth perception
    trailLength: 150, // Length of particle trail (longer for more drama)
    trailParticleCount: 50, // Particles per trail (more dramatic trails)
    starSize: 4.0, // Size of star core (slightly smaller for better performance)
    trailColors: [
        new Color(0x00ffff), // Pure cyan
        new Color(0xff1493), // Deep pink
        new Color(0x00bfff), // Deep sky blue (cyan variant)
        new Color(0xff69b4)  // Hot pink
    ]
};

// Start line welding sparks configuration
export const START_LINE_SPARKS = {
    maxParticles: 1500, // Maximum number of active particles (enhanced for dense effect)
    spawnRate: 200.0, // Particles per second (very high rate for many sparks)
    gravity: 15.0, // Downward acceleration
    initialVelocityMin: -2.0, // Minimum initial downward velocity
    initialVelocityMax: -6.0, // Maximum initial downward velocity
    lateralSpread: 0.8, // Random spread perpendicular to fall direction (wider spread)
    particleSizeMin: 0.15, // Minimum particle size (larger for visibility)
    particleSizeMax: 0.3, // Maximum particle size (larger for visibility)
    lifetimeMin: 1.5, // Minimum particle lifetime in seconds (longer to see bounces)
    lifetimeMax: 3.0, // Maximum particle lifetime in seconds
    colors: [
        new Color(0x53d7ff), // Cyan
        new Color(0xff2bd6), // Magenta
        new Color(0x00ffff), // Pure cyan
        new Color(0xff1493)  // Deep pink
    ],
    opacityBase: 2.5, // Base opacity for intense glow (much brighter)
    fadeOutRatio: 0.2, // Start fading out at 20% of lifetime remaining (longer visible)
    bounceDamping: 0.6, // Velocity retained after bounce (60% energy)
    maxBounces: 3, // Maximum number of bounces before particle becomes static
    trackSurfaceOffset: 0.5 // Distance above track surface to consider "on track"
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

// Focus refill configuration
export const FOCUS_REFILL = {
    duration: 1.5, // seconds for refill animation
    pinkGlowColor: new Color(0xff2bd6), // pink/magenta glow color
    minFlowRequired: 0.95 // minimum flow needed to trigger (nearly full)
};

// Attract mode camera tuning
export const CAMERA_DIRECTOR = {
    blendTimeSec: 0.8,
    standard: { back: 12, up: 3.6 },
    heli: { back: 22, up: 18, swayAmp: 2.0, swaySpeed: 0.8 },
    trackside: { aheadMeters: 480, side: 10, up: 4, lookBack: 6 },
    cutMinSec: 5,
    cutMaxSec: 9
};

// Drift system configuration
export const DRIFT = {
    flowRefillRate: 0.18, // flow per second while drifting
    trailColor: new Color(0xff2bd6), // pink/magenta
    trailFadeTime: 2.0, // seconds for trail segments to fade out
    trailSegmentLength: 2.0, // meters between trail segments
    trailMaxSegments: 100, // maximum trail segments
    trailGlowIntensity: 1.5, // glow intensity multiplier
    // Ribbon trail (flat on track)
    ribbonWidthRatio: 0.18, // base width ~ ship width (ratio of track width)
    ribbonMinWidthFactor: 0.55, // thinnest fraction when turning hard
    ribbonTurnSpeedForMin: 8.0, // lateral m/s for minimum width
    ribbonWidthScale: 0.02, // global scale to reduce ribbon to a fine line
    // Spark particles (pink) emitted along drift ribbon near ship
    sparkMaxCount: 400,
    sparkSpawnRate: 140, // particles per second while drifting
    sparkLifetime: 0.35, // seconds
    sparkSize: 0.06, // world units
    sparkUpwardSpeed: 1.6, // base upward velocity (m/s)
    sparkLateralSpeed: 1.2, // across-track binormal jitter (m/s)
    sparkForwardSpeed: 0.6 // along-track forward push (m/s)
};

// NPC lane preference tuning
export const NPC = {
    laneSwayAmplitude: 1.2, // meters: gentle side sway around preferred lane
    laneSwaySpeed: 0.5, // multiplier for sway progression speed
    laneJitterRange: 0.6, // meters: random variation around preferred lane
    laneStickiness: 0.7, // how strongly NPCs return toward their preferred lane
    // Lane change cadence
    laneChangeIntervalMinSec: 4.5,
    laneChangeIntervalMaxSec: 9.0,
    // Drafting (align to target ahead)
    draftEngageDistanceMeters: 60,
    draftAlignTolerance: 2.2, // meters lateral
    // Evasion (avoid pursuer behind)
    evasiveDistanceMetersBehind: 45,
    evasiveShiftMeters: 3.0,
    evasiveCooldownSec: 3.5
};

// Blackhole growth configuration
export const BLACKHOLE = {
    coreRadiusInitial: 480,
    coreRadiusMax: 3000, // Maximum core radius (should engulf track)
    eventHorizonOffset: 20, // Event horizon is core + offset
    growthDuration: 180, // seconds to reach max size (3 minutes)
    growthEasing: 0.3, // easing factor for smooth growth (0-1, lower = smoother)
    // Accretion disk scaling
    diskInnerRadiusBase: 600,
    diskOuterRadiusBase: 1000,
    diskRadiusMultiplierMax: 5.0, // Disk can grow 5x base size
    // Particle system scaling
    particleSpawnRadiusBase: 700,
    particleSpawnRadiusRange: 300,
    particleMinRadius: 480,
    // Inside detection
    insideDetectionMargin: 0, // No margin - check against actual core radius
    // Effect transitions
    effectTransitionDuration: 1.5, // seconds for effects to lerp in/out
    // Time dilation
    timeDilationMin: 0.6, // Minimum time scale (0.6x = 60% speed, less dramatic slow motion)
    timeDilationSmoothness: 0.5, // How smoothly time dilates (lower = smoother)
    // Blackhole consumption and fade
    consumptionFadeDuration: 5.0, // seconds for blackhole and effects to fade away after consuming track
    trackEngulfedCheckInterval: 0.5 // seconds between checks if track is fully engulfed
};


// Drafting (slipstream) configuration
export const DRAFTING = {
    minDistance: 3.5, // must be right behind the lead ship
    maxDistance: 14, // disengage quickly when too far
    coneDeg: 20, // tighter cone directly behind
    alignmentMinDot: 0.98, // nearly identical heading required
    lockTime: 0.25, // seconds to maintain conditions before drafting starts
    dropoutGrace: 0.1, // faster drop when conditions fail
    flowRefillRate: 0.20, // focus(flow) per second while drafting (0..1 scale)
    speedLerp: 6.0, // how quickly we match the lead speed
    matchMaxDelta: 2.0, // km/h extra above lead to avoid rubber-banding artifacts
    showCone: false // visual: show forward cone; particles are always enabled
};



