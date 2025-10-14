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
}

export interface TrackSystem {
    curve: CatmullRomCurve3;
    length: number;
    getPointAtT(t: number, target: Vector3): Vector3;
    getFrenetFrame(t: number, normal: Vector3, binormal: Vector3, tangent: Vector3): void;
    root: Object3D;
}


