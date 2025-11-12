import { CatmullRomCurve3, PerspectiveCamera, Scene, Vector3, Object3D } from 'three';

export interface GameDeps {
    scene: Scene;
    camera: PerspectiveCamera;
}

export interface ShipState {
    t: number; // curve position [0..1]
    speedKmh: number;
    lateralOffset: number; // meters sideways
    verticalOffset: number; // meters up/down relative to hover height
    pitch: number; // radians
    flow: number; // [0..1]
    boosting: boolean;
    lapCurrent: number;
    lapTotal: number;
    boostLevel: number; // 0..1 visual intensity of manual boost
    inTunnel: boolean;
    tunnelCenterBoost: number; // multiplier from tunnel center alignment
    lastLapTime?: number; // seconds for the last completed lap
    lapTimes?: number[]; // array of all lap times
    onBoostPadEntry: boolean; // true when just entered a boost pad (resets after check)
    isDrifting: boolean; // true when drifting (turning + boosting)
    driftDuration: number; // accumulated drift time in seconds
    driftLength: number; // accumulated drift distance in meters
}

export interface TrackSystem {
    curve: CatmullRomCurve3;
    length: number;
    getPointAtT(t: number, target: Vector3): Vector3;
    getFrenetFrame(t: number, normal: Vector3, binormal: Vector3, tangent: Vector3): void;
    root: Object3D;
}


export type TrackOptions = {
    seed: number;
    controlPointCount: number;
    samples: number; // geometry resolution
    width: number; // meters
    lengthMeters: number;
    radiusMin: number; // inner radius of course envelope
    radiusMax: number; // outer radius of course envelope
    elevationAmplitude: number; // max vertical variation
    maxCurvature: number; // rad/m clamp for turns (heuristic)
    maxGrade: number; // rise/run clamp
    bankMaxDeg: number;
    markerSpacing: number; // meters between markers
    // NEW: smoothing/quality controls
    controlPointSmoothPasses: number; // Chaikin passes for controls
    minChord: number; // minimum distance between control points
    railMaxAngle: number; // max radians between rail segments before subdivision
    // Curvature-aware relax pass
    curvatureLimit?: number; // meters^-1 maximum allowed curvature (approx)
    curvatureRelaxIters?: number; // iterations of relax pass
    // Self-repel to avoid pinched corners (minimum separation between non-adjacent samples)
    minClearanceMeters?: number; // desired minimum spacing between distant segments
    selfRepelIters?: number; // iterations of repulsion pass
    // Minimum turn radius and neighbor skip in meters
    minTurnRadiusMeters?: number;
    repelNeighborSkipMeters?: number;
    // Curvature jerk smoothing (limit change of curvature along arc length)
    curvatureJerkLimit?: number; // max allowed delta-kappa per meter
    jerkRelaxIters?: number;
    // Debug
    debugFrames?: boolean;
    // Enable section profiles
    enableFrameProfiles?: boolean;
};

export type TrackSample = {
    position: Vector3;
    tangent: Vector3;
    normal: Vector3;
    binormal: Vector3;
    bankRadians: number;
    up: Vector3;
};

export type TunnelType = 'rings' | 'wormhole';

export type TunnelSegment = {
    startT: number;
    endT: number;
    lengthMeters: number;
    tunnelType: TunnelType;
};

export type TunnelInfo = {
    inTunnel: boolean;
    progress: number; // 0..1 progress through current tunnel
    centerAlignment: number; // 0..1 how centered the ship is
};

export type BoostPadSegment = {
    t: number; // position on track [0..1]
    lengthT: number; // length in t units
};

export type BoostPadInfo = {
    onPad: boolean; // currently driving over a boost pad
    boostActive: boolean; // boost effect is currently active (includes duration after leaving pad)
    boostTimer: number; // remaining boost duration in seconds
};

export type RampSegment = {
    t: number; // position on track [0..1]
    lengthT: number; // length in t units
};

export type RampInfo = {
    onRamp: boolean; // currently in a ramp trigger zone
};

// Frame profile system
export type ScalarProfileFn = (localT: number, globalT: number) => number;
export type VectorProfileFn = (localT: number, globalT: number) => Vector3;

export type FrameProfileSection = {
    startT: number; // inclusive
    endT: number;   // inclusive (wrap supported)
    // Additional roll (bank) in degrees along the section
    rollDeg?: number | ScalarProfileFn;
    // Additional twist (deg) around tangent, applied after roll
    twistDeg?: number | ScalarProfileFn;
    // Bias the up vector toward a target direction in world space
    upBias?: Vector3 | VectorProfileFn;
    // Edge feather as fraction of section length (0..0.5)
    feather?: number;
};

export type RacePosition = {
    racerId: string;
    position: number;
    lapCurrent: number;
    lapTotal: number;
    finished: boolean;
    finishTime?: number;
    t?: number; // Track position [0..1]
};

export type RaceState = 'NOT_STARTED' | 'COUNTDOWN' | 'RACING' | 'FINISHED';

export type RaceResults = {
    positions: RacePosition[];
    raceTime: number;
    playerPosition: number;
};


