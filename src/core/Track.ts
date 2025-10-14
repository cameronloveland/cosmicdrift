import * as THREE from 'three';
import { Line2 } from 'three-stdlib';
import { LineMaterial } from 'three-stdlib';
import { LineGeometry } from 'three-stdlib';
import { COLORS } from './constants';

function makeControlPoints(): THREE.Vector3[] {
    const pts = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(15, 3, -40),
        new THREE.Vector3(35, -2, -90),
        new THREE.Vector3(0, -1, -140),
        new THREE.Vector3(-40, 2, -190),
        new THREE.Vector3(-5, 5, -240),
        new THREE.Vector3(30, 0, -290),
        new THREE.Vector3(0, -3, -340)
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
        this.curve = new THREE.CatmullRomCurve3(controls, false, 'catmullrom', 0.15);
        this.length = this.curve.getLength();

        // Tube surface
        const tubularSegments = 800;
        const radius = 2.2;
        const radialSegments = 16;
        const closed = false;
        const tube = new THREE.TubeGeometry(this.curve, tubularSegments, radius, radialSegments, closed);
        const mat = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(0x0f122a),
            roughness: 0.2,
            metalness: 0.1,
            transparent: true,
            opacity: 0.95,
            transmission: 0.4,
            emissive: COLORS.deepBlue.clone().multiplyScalar(0.2),
            envMapIntensity: 0.5
        });
        const mesh = new THREE.Mesh(tube, mat);
        mesh.receiveShadow = false;
        this.root.add(mesh);

        // Neon rails
        const railOffset = radius + 0.15;
        this.addRail(railOffset, COLORS.neonCyan, 3.0);
        this.addRail(-railOffset, COLORS.neonMagenta, 3.0);

        // Ring lights
        const rings = new THREE.Group();
        const ringGeom = new THREE.TorusGeometry(radius + 0.4, 0.05, 8, 48);
        const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.violet, toneMapped: false });
        for (let i = 0; i < 30; i++) {
            const t = i / 30;
            const pos = this.curve.getPointAt(t);
            const tangent = this.curve.getTangentAt(t);
            const q = new THREE.Quaternion();
            q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), tangent);
            const ring = new THREE.Mesh(ringGeom, ringMat);
            ring.position.copy(pos);
            ring.quaternion.copy(q);
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
            this.getFrenetFrame(t, normal, binormal, tangent);
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
}


