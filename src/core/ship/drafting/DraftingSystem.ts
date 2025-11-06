import * as THREE from 'three';
import { DRAFTING, PHYSICS } from '../../constants';
import { Track } from '../../Track';
import { Ship } from '../Ship';
import { NPCShip } from '../../NPCShip';
import { DraftingParticles } from './DraftingParticles';
import { DraftingVectorLines } from './DraftingVectorLines';

export class DraftingSystem {
    private active = false;
    private lockTimer = 0;
    private failTimer = 0;
    private leadSpeedKmh = 0;
    private shield: THREE.Mesh | null = null;
    private particles: DraftingParticles | null = null;
    private vectorLines: DraftingVectorLines | null = null;

    private tmp = {
        playerPos: new THREE.Vector3(),
        playerForward: new THREE.Vector3(),
        leadPos: new THREE.Vector3(),
        leadForward: new THREE.Vector3(),
        v: new THREE.Vector3(),
        up: new THREE.Vector3(),
        right: new THREE.Vector3(),
        tangent: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        binormal: new THREE.Vector3()
    };

    private ensureShield(ship: Ship) {
        if (this.shield || !DRAFTING.showCone) return;
        // Draft cone: apex near nose, base forward down track
        const height = 2.0; // local units before ship scaling
        const baseRadius = 0.9;
        const geo = new THREE.CylinderGeometry(baseRadius, 0, height, 32, 1, true);
        const mat = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(0x3bd1ff),
            emissive: new THREE.Color(0x3bd1ff),
            emissiveIntensity: 1.0,
            metalness: 0.0,
            roughness: 0.25,
            transparent: true,
            opacity: 0.22,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: true,
            side: THREE.DoubleSide
        });
        this.shield = new THREE.Mesh(geo, mat);
        // Align cylinder Y axis to +Z so base (larger radius) points forward
        this.shield.rotation.x = Math.PI / 2;
        // Place so apex (0 radius end) sits just ahead of nose (~z=0.9 before scale)
        // Apex is at -height/2 along local Z after rotation
        const apexTargetZ = 0.9;
        this.shield.position.set(0, 0, apexTargetZ + height * 0.5);
        this.shield.visible = false;
        ship.root.add(this.shield);
    }

    private setShieldVisible(v: boolean) {
        if (this.shield) this.shield.visible = v && DRAFTING.showCone;
    }

    private ensureParticles(ship: Ship) {
        if (this.particles) return;
        this.particles = new DraftingParticles(ship as any);
        ship.root.add(this.particles.root);
    }

    private ensureVectorLines(ship: Ship) {
        if (this.vectorLines) return;
        this.vectorLines = new DraftingVectorLines(ship as any, { count: 7, points: 26 });
        ship.root.add(this.vectorLines.root);
    }

    public isActive(): boolean {
        return this.active;
    }

    public update(dt: number, track: Track, player: Ship, npcs: NPCShip[]) {
        this.ensureShield(player);
        this.ensureParticles(player);
        this.ensureVectorLines(player);

        // Find best lead candidate
        const cosCone = Math.cos(THREE.MathUtils.degToRad(DRAFTING.coneDeg));
        let bestLead: NPCShip | null = null;
        let bestDist = Infinity;

        // Player frame (world pos + actual forward from ship orientation)
        track.getShipWorldPosition(player.state.t, player.state.lateralOffset, this.tmp.playerPos);
        this.tmp.playerForward.set(0, 0, 1).applyQuaternion(player.root.quaternion).normalize();

        for (const npc of npcs) {
            // Lead frame (world pos + actual forward)
            track.getShipWorldPosition(npc.state.t, npc.state.lateralOffset, this.tmp.leadPos);
            this.tmp.leadForward.set(0, 0, 1).applyQuaternion(npc.root.quaternion).normalize();

            // Vector from lead to player
            this.tmp.v.subVectors(this.tmp.playerPos, this.tmp.leadPos);
            const dist = this.tmp.v.length();
            if (dist < DRAFTING.minDistance || dist > DRAFTING.maxDistance) continue;

            const dirLeadToPlayer = this.tmp.v.normalize();
            const behindDot = dirLeadToPlayer.dot(this.tmp.leadForward.clone().negate());
            const aligned = this.tmp.playerForward.dot(this.tmp.leadForward) >= DRAFTING.alignmentMinDot;
            const inCone = behindDot >= cosCone;
            if (inCone && aligned) {
                if (dist < bestDist) {
                    bestDist = dist;
                    bestLead = npc;
                }
            }
        }

        const conditionsOk = !!bestLead;
        if (conditionsOk) {
            this.lockTimer += dt;
            this.failTimer = 0;
        } else {
            this.failTimer += dt;
            this.lockTimer = 0;
        }

        // Activate after lock, deactivate after grace
        if (!this.active && this.lockTimer >= DRAFTING.lockTime) {
            this.active = true;
        }
        if (this.active && !conditionsOk && this.failTimer >= DRAFTING.dropoutGrace) {
            this.active = false;
        }

        // Effects when active
        if (this.active && bestLead) {
            // Store lead speed for matching and inform ship for target speed calc
            this.leadSpeedKmh = bestLead.state.speedKmh;
            player.setDraftingActive(true, this.leadSpeedKmh);

            // Focus(flow) recharge
            player.state.flow = THREE.MathUtils.clamp(
                player.state.flow + DRAFTING.flowRefillRate * dt,
                0,
                1
            );
        }

        // Visuals
        this.setShieldVisible(this.active);
        if (this.particles) this.particles.setVisible(this.active);
        if (this.vectorLines) this.vectorLines.setVisible(this.active);
        if (this.shield && this.active) {
            // Subtle emissive pulse while active
            const mat = this.shield.material as THREE.MeshPhysicalMaterial;
            const t = player.getNow ? (player.getNow() % 1000) : 0; // Ship has getNow(); NPC differs
            const pulse = 0.85 + Math.sin(t * 2.0) * 0.15;
            mat.emissiveIntensity = pulse;
            mat.opacity = 0.22 + (pulse - 0.85) * 0.4;
        }
        if (this.particles) this.particles.update(dt);
        if (this.vectorLines) this.vectorLines.update(dt);
    }
}




