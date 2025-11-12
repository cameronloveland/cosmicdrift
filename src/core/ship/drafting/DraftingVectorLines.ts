import * as THREE from 'three';
import { COLORS } from '../../constants';

type Draftable = { root: THREE.Group; };

export class DraftingVectorLines {
    public root = new THREE.Group();

    private lines: THREE.Line[] = [];
    private positions: Float32Array[] = [];
    private counts: number[] = [];
    private phases: number[] = [];
    private speeds: number[] = [];
    private laterals: number[] = [];

    private tmpVec = new THREE.Vector3();

    constructor(private ship: Draftable, opts?: { count?: number; points?: number; length?: number; height?: number; color?: number; alpha?: number; }) {
        const count = opts?.count ?? 18;
        const points = opts?.points ?? 24;
        const alpha = opts?.alpha ?? 0.5;
        const pairCount = Math.floor(count / 2);
        const hasCenter = (count % 2) === 1;
        const maxLateral = 0.42; // half width spread (local X)

        // Build symmetric pairs from center outward
        for (let i = 0; i < pairCount; i++) {
            const t = (i + 1) / (pairCount + 1); // 0..1 across half-width, avoid extreme edges
            const lat = maxLateral * t;
            const phase = Math.random() * Math.PI * 2;
            const speed = 0.9 + Math.random() * 0.5;
            const halfIndex = Math.ceil(pairCount / 2);
            const pairColor = (i < halfIndex) ? COLORS.neonCyan.getHex() : COLORS.neonMagenta.getHex();

            // +X line
            const geom = new THREE.BufferGeometry();
            const arr = new Float32Array(points * 3);
            geom.setAttribute('position', new THREE.BufferAttribute(arr, 3));

            const mat = new THREE.LineBasicMaterial({
                color: pairColor,
                transparent: true,
                opacity: alpha,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });

            const line = new THREE.Line(geom, mat);
            // Place slightly above hull to avoid z-fighting
            line.position.set(0, 0.02, 0);
            this.root.add(line);
            this.lines.push(line);
            this.positions.push(arr);
            this.counts.push(points);
            this.phases.push(phase);
            this.speeds.push(speed);
            this.laterals.push(+lat);

            // -X mirrored line shares phase/speed for symmetry
            const geom2 = new THREE.BufferGeometry();
            const arr2 = new Float32Array(points * 3);
            geom2.setAttribute('position', new THREE.BufferAttribute(arr2, 3));
            const mat2 = mat.clone();
            const line2 = new THREE.Line(geom2, mat2);
            line2.position.set(0, 0.02, 0);
            this.root.add(line2);
            this.lines.push(line2);
            this.positions.push(arr2);
            this.counts.push(points);
            this.phases.push(phase);
            this.speeds.push(speed);
            this.laterals.push(-lat);
        }

        // Optional center line
        if (hasCenter) {
            const geom = new THREE.BufferGeometry();
            const arr = new Float32Array(points * 3);
            geom.setAttribute('position', new THREE.BufferAttribute(arr, 3));

            const mat = new THREE.LineBasicMaterial({
                color: COLORS.neonCyan.getHex(),
                transparent: true,
                opacity: alpha,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });

            const line = new THREE.Line(geom, mat);
            line.position.set(0, 0.02, 0);
            this.root.add(line);
            this.lines.push(line);
            this.positions.push(arr);
            this.counts.push(points);
            this.phases.push(Math.random() * Math.PI * 2);
            this.speeds.push(0.9 + Math.random() * 0.5);
            this.laterals.push(0);
        }

        this.root.visible = false;
    }

    setVisible(v: boolean) {
        this.root.visible = v;
    }

    update(dt: number) {
        if (!this.root.visible) return;
        const length = 3.2; // shorter trail so it stays closer to the ship
        const height = 0.2; // reduced arc height for lower profile
        const startZ = 0.2; // start near nose

        for (let i = 0; i < this.lines.length; i++) {
            const geom = this.lines[i].geometry as THREE.BufferGeometry;
            const arr = this.positions[i];
            const n = this.counts[i];
            const phase = this.phases[i] += this.speeds[i] * dt * 2.2;
            const lateral = this.laterals[i];

            for (let p = 0; p < n; p++) {
                const t = p / (n - 1); // 0..1 along line
                // Flow offset animates the path moving nose -> tail (decreasing Z)
                const flow = (phase * 0.12) % 1;
                const s = Math.min(1, t + flow);
                const z = startZ - s * length;
                const y = Math.sin(Math.PI * s) * height;
                // Symmetric lateral narrowing toward tail, no asymmetric jitter
                const x = lateral * (1.0 - s * 0.8);

                const idx = p * 3;
                arr[idx + 0] = x;
                arr[idx + 1] = y;
                arr[idx + 2] = z;
            }
            (geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
            geom.computeBoundingSphere();
        }
    }
}


