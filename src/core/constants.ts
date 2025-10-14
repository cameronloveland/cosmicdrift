import { Color } from 'three';

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
    far: 2000,
    chaseDistance: 7,
    chaseHeight: 2.2,
    shakeMax: 0.02
};

export const PHYSICS = {
    baseSpeed: 70, // km/h visualized in HUD (convert to m/s inside)
    maxSpeed: 260,
    boostMultiplier: 1.5,
    lateralMax: 1.6,
    lateralAccel: 6.0,
    lateralDamping: 4.5,
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
    motionBlurSamples: 8
};


