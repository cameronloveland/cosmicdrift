import * as THREE from 'three';
import { DRAFTING } from '../../constants';

export class DraftingFlowLines {
    public root = new THREE.Group();
    private lines: THREE.Mesh[] = [];
    private materials: THREE.MeshBasicMaterial[] = [];
    private time = 0;

    constructor() {
        // Retro neon streamlines fan pointing forward (within cone)
        const count = 28;
        const length = 3.2; // local units before player scale
        const radius = 0.02;
        const coneRad = THREE.MathUtils.degToRad(DRAFTING.coneDeg);

        for (let i = 0; i < count; i++) {
            // Distribute yaw within cone, with slight vertical pitch variance
            const u = i / (count - 1);
            const yaw = THREE.MathUtils.lerp(-coneRad, coneRad, u);
            const pitch = (Math.random() - 0.5) * 0.12; // subtle up/down spread

            const geo = new THREE.CylinderGeometry(radius, radius, length, 6, 1, true);
            const mat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(0x53d7ff),
                transparent: true,
                opacity: 0.7,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
                toneMapped: false
            });

            const line = new THREE.Mesh(geo, mat);
            // Cylinder axis is Y; rotate to point along +Z then apply yaw/pitch
            line.rotation.x = Math.PI / 2;
            // place so the near end starts at ship nose (apex ~0.9), center offset by length/2
            line.position.set(0, 0, 0.9 + length * 0.5);
            // Apply yaw (around up) and pitch (around right)
            const q = new THREE.Quaternion()
                .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw))
                .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
            line.quaternion.premultiply(q);

            this.root.add(line);
            this.lines.push(line);
            this.materials.push(mat);
        }
        this.root.visible = false;
    }

    setVisible(v: boolean) {
        this.root.visible = v;
    }

    update(dt: number, now: number) {
        this.time += dt;
        // Neon pulse and subtle lateral shimmer per line for retro vibe
        for (let i = 0; i < this.lines.length; i++) {
            const line = this.lines[i];
            const mat = this.materials[i];
            const phase = (i * 0.37) + now * 2.2;
            const pulse = 0.55 + 0.35 * Math.sin(phase);
            mat.opacity = 0.18 + 0.6 * pulse;

            // Slight oscillation to simulate airflow shimmer
            const wiggle = 0.02 * Math.sin(phase * 1.3);
            line.position.x = wiggle;
        }
    }
}


