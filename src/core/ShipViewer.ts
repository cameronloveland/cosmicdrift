import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import { COLORS, PHYSICS } from './constants';
import type { Ship } from './Ship';

export class ShipViewer {
    private mount: HTMLElement;
    private ship: Ship | null = null;
    private renderer: THREE.WebGLRenderer | null = null;
    private scene: THREE.Scene | null = null;
    private camera: THREE.PerspectiveCamera | null = null;
    private controls: OrbitControls | null = null;
    private rafId: number | null = null;
    private onResizeBound: (() => void) | null = null;

    constructor(mount: HTMLElement, ship: Ship) {
        this.mount = mount;
        this.ship = ship;
    }

    start() {
        if (this.renderer) return;

        // Scene
        const scene = new THREE.Scene();
        // Set dark background similar to game background
        scene.background = new THREE.Color(0x050314);
        this.scene = scene;

        // Camera
        const rect = this.mount.getBoundingClientRect();
        // Ensure we have valid dimensions
        if (rect.width === 0 || rect.height === 0) {
            console.warn('ShipViewer: Mount element has zero dimensions, using fallback', rect);
        }
        const aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
        const camera = new THREE.PerspectiveCamera(65, aspect, 0.1, 2000);
        // Position camera to see the ship and grid centered at origin
        camera.position.set(2.5, 1.5, 3.0);
        camera.lookAt(0, PHYSICS.hoverHeight, 0); // Look at where ship will be
        this.camera = camera;

        // Renderer - keep alpha for transparency but use scene background for color
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
        // Use actual dimensions or fallback to window size if mount is hidden
        const width = rect.width > 0 ? rect.width : window.innerWidth;
        const height = rect.height > 0 ? rect.height : window.innerHeight;
        renderer.setSize(width, height);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.setClearColor(0x050314, 1); // Match scene background
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

        // Light teal glowing grid (similar to radio player style - thin teal grid)
        const gridSize = 10;
        const gridDivisions = 20; // Grid spacing similar to radio player (20px)
        const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x53d7ff, 0x53d7ff);
        gridHelper.position.y = 0.0001; // Slightly above ground plane to avoid z-fighting

        // Make grid visible and glowing like radio player
        const gridMaterial = gridHelper.material as THREE.LineBasicMaterial;
        if (gridMaterial) {
            gridMaterial.color.setHex(0x53d7ff); // Teal color #53d7ff matching radio player
            gridMaterial.transparent = true;
            gridMaterial.opacity = 0.6; // More visible for better glow effect
        }
        scene.add(gridHelper);

        // Dark ground circle for reference (below grid to not obscure it)
        const ground = new THREE.Mesh(
            new THREE.CircleGeometry(10, 64),
            new THREE.MeshBasicMaterial({ color: 0x0b1a5f, transparent: true, opacity: 0.3 })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.001; // Slightly below grid
        scene.add(ground);

        // Clone the actual ship geometry (exclude dynamic effects like rocket tail)
        if (this.ship) {
            const shipClone = this.cloneShipGeometry(this.ship);
            if (shipClone.children.length > 0) {
                scene.add(shipClone);
                console.log('ShipViewer: Ship cloned successfully with', shipClone.children.length, 'children');
            } else {
                console.warn('ShipViewer: Ship clone has no children. Original ship root has', this.ship.root.children.length, 'children');
            }
        } else {
            console.warn('ShipViewer: No ship provided');
        }

        // Controls
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = 1.0;
        controls.maxDistance = 8.0;
        controls.target.set(0, PHYSICS.hoverHeight, 0); // Target where ship is positioned
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
        // Trigger resize once to correct sizing if viewport was hidden during init
        requestAnimationFrame(() => {
            if (this.renderer && this.camera && this.onResizeBound) {
                this.onResizeBound();
            }
        });

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

    private cloneShipGeometry(ship: Ship): THREE.Group {
        // Create a new group for the cloned ship
        const cloneGroup = new THREE.Group();

        // Clone the ship's root geometry, excluding dynamic effects
        const shipRoot = ship.root;

        if (shipRoot.children.length === 0) {
            console.warn('ShipViewer: Ship root has no children');
            return cloneGroup;
        }

        shipRoot.children.forEach((child) => {
            // Skip rocket tail (dynamic effect) - check if it's a group with many cone meshes
            if (this.isRocketTail(child)) {
                return;
            }

            // Clone the child group/mesh
            const clonedChild = this.deepCloneObject3D(child);
            if (clonedChild) {
                cloneGroup.add(clonedChild);
            }
        });

        // Reset position and rotation for display
        cloneGroup.position.set(0, PHYSICS.hoverHeight, 0); // Position above ground
        cloneGroup.rotation.set(0, 0, 0);
        cloneGroup.scale.set(1, 1, 1);

        // Ensure visibility
        cloneGroup.visible = true;
        cloneGroup.traverse((obj) => {
            obj.visible = true;
        });

        return cloneGroup;
    }

    private isRocketTail(object: THREE.Object3D): boolean {
        // Rocket tail is a group with many cone geometries
        if (object instanceof THREE.Group) {
            // Check if it has many children that are cone meshes (rocket tail pattern)
            const coneCount = object.children.filter(child =>
                child instanceof THREE.Mesh &&
                child.geometry instanceof THREE.ConeGeometry
            ).length;
            // Rocket tail typically has many cone particles
            return coneCount > 5;
        }
        return false;
    }

    private deepCloneObject3D(object: THREE.Object3D): THREE.Object3D | null {
        if (object instanceof THREE.Mesh) {
            // Clone geometry
            const geometry = object.geometry.clone();

            // Clone material (create new instance to avoid conflicts)
            let material: THREE.Material | THREE.Material[];
            if (object.material instanceof THREE.Material) {
                material = object.material.clone();
            } else if (Array.isArray(object.material)) {
                material = object.material.map(m => m.clone());
            } else {
                material = object.material;
            }

            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.copy(object.position);
            mesh.rotation.copy(object.rotation);
            mesh.scale.copy(object.scale);
            return mesh;
        } else if (object instanceof THREE.Group) {
            const group = new THREE.Group();
            object.children.forEach(child => {
                const clonedChild = this.deepCloneObject3D(child);
                if (clonedChild) {
                    group.add(clonedChild);
                }
            });
            group.position.copy(object.position);
            group.rotation.copy(object.rotation);
            group.scale.copy(object.scale);
            return group;
        }

        return null;
    }
}


