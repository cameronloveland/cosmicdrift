import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import { COLORS } from './constants';

export class ShipViewer {
    private mount: HTMLElement;
    private renderer: THREE.WebGLRenderer | null = null;
    private scene: THREE.Scene | null = null;
    private camera: THREE.PerspectiveCamera | null = null;
    private controls: OrbitControls | null = null;
    private rafId: number | null = null;
    private onResizeBound: (() => void) | null = null;

    constructor(mount: HTMLElement) {
        this.mount = mount;
    }

    start() {
        if (this.renderer) return;

        // Scene
        const scene = new THREE.Scene();
        scene.background = null;
        this.scene = scene;

        // Camera
        const rect = this.mount.getBoundingClientRect();
        const aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
        const camera = new THREE.PerspectiveCamera(65, aspect, 0.1, 2000);
        camera.position.set(2.8, 1.6, 3.6);
        this.camera = camera;

        // Renderer
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
        renderer.setSize(rect.width, rect.height);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.mount.innerHTML = '';
        this.mount.appendChild(renderer.domElement);
        this.renderer = renderer;

        // Lights + simple rim
        const hemi = new THREE.HemisphereLight(0x6e5cd6, 0x0a082a, 0.9);
        scene.add(hemi);
        const dir = new THREE.DirectionalLight(0xffffff, 0.7);
        dir.position.set(5, 6, 4);
        dir.castShadow = false;
        scene.add(dir);

        // Ground circle for reference
        const grid = new THREE.Mesh(
            new THREE.CircleGeometry(6, 64),
            new THREE.MeshBasicMaterial({ color: 0x0b1a5f, transparent: true, opacity: 0.25 })
        );
        grid.rotation.x = -Math.PI / 2;
        scene.add(grid);

        // Ship display model (matches in-game look)
        scene.add(this.createDisplayShip());

        // Controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = 2;
        controls.maxDistance = 12;
        controls.target.set(0, 0.4, 0);
        controls.update();
        this.controls = controls;

        // Resize handling
        this.onResizeBound = () => {
            if (!this.renderer || !this.camera) return;
            const r = this.mount.getBoundingClientRect();
            this.camera.aspect = Math.max(1, r.width) / Math.max(1, r.height);
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(r.width, r.height);
        };
        window.addEventListener('resize', this.onResizeBound);

        // Animate
        const animate = () => {
            this.rafId = requestAnimationFrame(animate);
            if (this.controls) this.controls.update();
            if (this.renderer && this.scene && this.camera) {
                this.renderer.render(this.scene, this.camera);
            }
        };
        this.rafId = requestAnimationFrame(animate);
    }

    stop() {
        if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
        if (this.controls) { this.controls.dispose(); this.controls = null; }
        if (this.renderer) { this.renderer.dispose(); this.renderer.domElement.remove(); this.renderer = null; }
        this.scene = null;
        this.camera = null;
        if (this.onResizeBound) { window.removeEventListener('resize', this.onResizeBound); this.onResizeBound = null; }
    }

    dispose() { this.stop(); }

    private createDisplayShip(): THREE.Group {
        const group = new THREE.Group();
        const geo = new THREE.ConeGeometry(0.45, 1.2, 16);
        const bodyMat = new THREE.MeshStandardMaterial({
            color: COLORS.neonCyan,
            metalness: 0.3,
            roughness: 0.2,
            emissive: COLORS.neonCyan.clone().multiplyScalar(0.8)
        });
        const body = new THREE.Mesh(geo, bodyMat);
        body.rotation.x = Math.PI / 2;
        group.add(body);

        const glow = new THREE.Mesh(
            new THREE.SphereGeometry(0.25, 16, 16),
            new THREE.MeshBasicMaterial({ color: COLORS.neonCyan, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
        );
        glow.position.set(0, -0.15, -0.3);
        group.add(glow);

        return group;
    }
}


