import { CatmullRomCurve3, PerspectiveCamera, Scene, Vector3, Object3D } from 'three';

export interface GameDeps {
    scene: Scene;
    camera: PerspectiveCamera;
}

export interface ShipState {
    t: number; // curve position [0..1]
    speedKmh: number;
    lateralOffset: number; // meters sideways
    pitch: number; // radians
    flow: number; // [0..1]
    boosting: boolean;
    lapCurrent: number;
    lapTotal: number;
    boostLevel: number; // 0..1 visual intensity of manual boost
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
};

export type TrackSample = {
    position: Vector3;
    tangent: Vector3;
    normal: Vector3;
    binormal: Vector3;
    bankRadians: number;
    up: Vector3;
};

export type TunnelSegment = {
    startT: number;
    endT: number;
    lengthMeters: number;
};

export type TunnelInfo = {
    inTunnel: boolean;
    progress: number; // 0..1 progress through current tunnel
    centerAlignment: number; // 0..1 how centered the ship is
};


