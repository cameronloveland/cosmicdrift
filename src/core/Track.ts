import * as THREE from 'three';
import { Line2 } from 'three-stdlib';
import { LineMaterial } from 'three-stdlib';
import { LineGeometry } from 'three-stdlib';
import { COLORS } from './constants';

function makeControlPoints(): THREE.Vector3[] {
    // Create a long loop with gentle elevation changes
    const pts = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(60, 2, -80),
        new THREE.Vector3(140, 0, -160),
        new THREE.Vector3(200, -1, -60),
        new THREE.Vector3(240, 1, 60),
        new THREE.Vector3(160, 3, 160),
        new THREE.Vector3(40, 0, 220),
        new THREE.Vector3(-80, -2, 160),
        new THREE.Vector3(-160, 0, 40),
        new THREE.Vector3(-140, 2, -100),
        new THREE.Vector3(-60, 0, -180)
    ];
    return pts;
}

export class Track {
    public root = new THREE.Group();
    public curve: THREE.CatmullRomCurve3;
    public length: number;
    private railMaterials: LineMaterial[] = [];

    constructor() {
        const controls = makeControlPoints();
        this.curve = new THREE.CatmullRomCurve3(controls, true, 'catmullrom', 0.15);
        this.length = this.curve.getLength();

        // Flat ribbon track that follows the curve
        const trackWidth = 8.0;
        const segments = 800;
        const positions: number[] = [];
        const normals: number[] = [];
        const uvs: number[] = [];
        const indices: number[] = [];
        const normal = new THREE.Vector3();
        const binormal = new THREE.Vector3();
        const tangent = new THREE.Vector3();

        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const center = this.curve.getPointAt(t);
            this.getStableFrame(t, normal, binormal, tangent);

            // Use computed right vector as across-track direction
            const half = trackWidth * 0.5;
            const left = new THREE.Vector3().copy(center).addScaledVector(binormal, -half);
            const right = new THREE.Vector3().copy(center).addScaledVector(binormal, half);

            positions.push(left.x, left.y, left.z);
            positions.push(right.x, right.y, right.z);

            // Up vector from forward x right
            const up = new THREE.Vector3().copy(tangent).cross(binormal).normalize();
            normals.push(up.x, up.y, up.z);
            normals.push(up.x, up.y, up.z);

            // UVs for simple strip texture scrolling
            uvs.push(0, t * 50);
            uvs.push(1, t * 50);
        }

        for (let i = 0; i < segments; i++) {
            const a = i * 2;
            const b = a + 1;
            const c = a + 2;
            const d = a + 3;
            indices.push(a, b, d, a, d, c);
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geom.setIndex(indices);

        const mat = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(0x0e1130),
            roughness: 0.35,
            metalness: 0.05,
            transparent: true,
            opacity: 0.98,
            emissive: COLORS.deepBlue.clone().multiplyScalar(0.25),
            envMapIntensity: 0.4
        });
        const ribbon = new THREE.Mesh(geom, mat);
        ribbon.receiveShadow = false;
        this.root.add(ribbon);

        // Neon rails at edges (cyan right, magenta left)
        const railOffset = trackWidth * 0.5 + 0.1;
        this.addFlatRail(railOffset, COLORS.neonCyan, 3.0);
        this.addFlatRail(-railOffset, COLORS.neonMagenta, 3.0);

        // Decorative arches above the track
        const rings = new THREE.Group();
        const ringRadius = 1.2 * trackWidth * 0.5;
        const ringGeom = new THREE.TorusGeometry(ringRadius, 0.05, 8, 48);
        const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.violet, toneMapped: false });
        for (let i = 0; i < 24; i++) {
            const t = i / 24;
            const pos = this.curve.getPointAt(t);
            const up = new THREE.Vector3(0, 1, 0);
            const ring = new THREE.Mesh(ringGeom, ringMat);
            ring.position.copy(pos).addScaledVector(up, 1.5);
            rings.add(ring);
        }
        this.root.add(rings);
    }

    private addRail(sideOffset: number, color: THREE.Color, width: number) {
        const samples = 600;
        const positions: number[] = [];
        const normal = new THREE.Vector3();
        const binormal = new THREE.Vector3();
        const tangent = new THREE.Vector3();
        for (let i = 0; i <= samples; i++) {
            const t = i / samples;
            const pos = this.curve.getPointAt(t);
            this.getStableFrame(t, normal, binormal, tangent);
            const offset = new THREE.Vector3().copy(binormal).multiplyScalar(sideOffset);
            pos.add(offset);
            positions.push(pos.x, pos.y, pos.z);
        }
        const geom = new LineGeometry();
        geom.setPositions(positions);
        const mat = new LineMaterial({ color: color.getHex(), linewidth: width, worldUnits: true });
        mat.resolution.set(window.innerWidth, window.innerHeight);
        this.railMaterials.push(mat);
        const line = new Line2(geom, mat);
        line.computeLineDistances();
        // LineMaterial doesn't declare toneMapped; suppress with any and set false for neon
        (line.material as any).toneMapped = false;
        this.root.add(line);
    }

    // Alias to maintain API clarity for flat track rails
    private addFlatRail(sideOffset: number, color: THREE.Color, width: number) {
        this.addRail(sideOffset, color, width);
    }

    public updateResolution(width: number, height: number) {
        for (const m of this.railMaterials) m.resolution.set(width, height);
    }

    public getPointAtT(t: number, target: THREE.Vector3): THREE.Vector3 {
        return this.curve.getPointAt(t, target);
    }

    public getFrenetFrame(t: number, normal: THREE.Vector3, binormal: THREE.Vector3, tangent: THREE.Vector3) {
        const u = THREE.MathUtils.clamp(t, 0, 1);
        tangent.copy(this.curve.getTangentAt(u)).normalize();
        const arbitrary = Math.abs(tangent.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        normal.copy(arbitrary).cross(tangent).normalize();
        binormal.copy(tangent).cross(normal).normalize();
    }

    // Stable world-up based frame to reduce twisting
    private getStableFrame(t: number, normal: THREE.Vector3, binormal: THREE.Vector3, tangent: THREE.Vector3) {
        const u = THREE.MathUtils.clamp(t, 0, 1);
        tangent.copy(this.curve.getTangentAt(u)).normalize();
        const worldUp = new THREE.Vector3(0, 1, 0);
        // right
        binormal.copy(worldUp).cross(tangent).normalize();
        // up
        normal.copy(tangent).cross(binormal).normalize();
    }
}


