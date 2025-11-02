import type { RacePosition, RaceResults, RaceState } from './types';
import type { ShipState } from './types';

export class RaceManager {
    private raceState: RaceState = 'NOT_STARTED';
    private raceStartTime = 0;
    private racers: Map<string, RacePosition> = new Map();
    private finishedRacers: RacePosition[] = [];
    private playerId = 'player';
    private npcIds: string[] = [];

    constructor() {
        this.racers.set(this.playerId, {
            racerId: this.playerId,
            position: 1,
            lapCurrent: 0,
            lapTotal: 3,
            finished: false
        });
    }

    public addNPC(racerId: string) {
        this.npcIds.push(racerId);
        this.racers.set(racerId, {
            racerId,
            position: 1,
            lapCurrent: 0,
            lapTotal: 3,
            finished: false
        });
    }

    public startRace() {
        this.raceState = 'COUNTDOWN';
        this.raceStartTime = 0; // Will be set when countdown ends
    }

    public startRacing() {
        this.raceState = 'RACING';
        this.raceStartTime = performance.now() / 1000;
    }

    public finishRace() {
        this.raceState = 'FINISHED';
    }

    public getRaceState(): RaceState {
        return this.raceState;
    }

    public updatePlayerState(playerState: ShipState) {
        const currentRacer = this.racers.get(this.playerId);
        if (currentRacer) {
            currentRacer.lapCurrent = playerState.lapCurrent;
            currentRacer.t = playerState.t;
            currentRacer.finished = playerState.lapCurrent >= playerState.lapTotal;

            if (currentRacer.finished && !currentRacer.finishTime) {
                currentRacer.finishTime = this.getRaceTime();
            }
        }
    }

    public updateNPCState(racerId: string, npcState: ShipState) {
        const currentRacer = this.racers.get(racerId);
        if (currentRacer) {
            currentRacer.lapCurrent = npcState.lapCurrent;
            currentRacer.t = npcState.t;
            currentRacer.finished = npcState.lapCurrent >= npcState.lapTotal;

            if (currentRacer.finished && !currentRacer.finishTime) {
                currentRacer.finishTime = this.getRaceTime();
            }
        }
    }

    /**
     * Calculate total progress through the race.
     * This combines lap number and track position into a continuous value.
     * Handles negative t values (before start line) and t wrapping (0-1).
     * 
     * Based on racing game best practices: combine checkpoint progress (lap) 
     * with distance-to-next-checkpoint (t) into single comparable metric.
     */
    private calculateTotalProgress(racer: RacePosition): number {
        const lapCurrent = racer.lapCurrent || 0;
        let t = racer.t ?? 0;

        // Handle negative t (before start line) - clamp to 0
        // All racers before start are treated as at the start line for comparison
        if (t < 0) {
            t = 0;
        }

        // Normalize t to [0, 1) range (handle wrap-around beyond 1)
        t = t % 1;
        if (t < 0) {
            t += 1;
        }

        // Total progress = lap number + progress within lap
        // This creates a continuous value that never wraps
        // Example: lap 2, t=0.5 = totalProgress 2.5
        //         lap 1, t=0.8 = totalProgress 1.8  
        // Higher totalProgress = ahead in race
        return lapCurrent + t;
    }

    public calculatePositions(): RacePosition[] {
        const allRacers = Array.from(this.racers.values());

        // Safety check: ensure we have racers to calculate
        if (allRacers.length === 0) {
            return [];
        }

        // Sort by total progress through the race (racing game standard approach)
        allRacers.sort((a, b) => {
            // Ensure both racers have valid data
            if (!a || !b) return 0;

            const progressA = this.calculateTotalProgress(a);
            const progressB = this.calculateTotalProgress(b);

            // Higher progress = ahead (sort descending)
            // If finished, they're ahead of non-finished
            if (a.finished !== b.finished) {
                return a.finished ? -1 : 1; // Finished racers first
            }

            // Compare total progress (higher = ahead)
            const diff = progressB - progressA;

            // If very close (within floating point error), maintain stability
            if (Math.abs(diff) < 0.0001) {
                return 0; // Maintain order
            }

            return diff;
        });

        // Assign positions (1 = first place, 2 = second, etc.)
        // Ensure position is always a valid number
        allRacers.forEach((racer, index) => {
            if (racer) {
                racer.position = Math.max(1, index + 1);
            }
        });

        return allRacers;
    }

    public getPlayerPosition(): number {
        const playerRacer = this.racers.get(this.playerId);
        return playerRacer?.position || 1;
    }

    public getRaceTime(): number {
        if (this.raceState === 'NOT_STARTED' || this.raceState === 'COUNTDOWN') {
            return 0;
        }
        return (performance.now() / 1000) - this.raceStartTime;
    }

    public isRaceComplete(): boolean {
        const allRacers = Array.from(this.racers.values());
        return allRacers.every(racer => racer.finished);
    }

    public getRaceResults(): RaceResults {
        const positions = this.calculatePositions();
        // Find player position from the calculated positions array
        const playerRacer = positions.find(r => r.racerId === this.playerId);
        // Ensure position is always a valid number (never undefined)
        const playerPosition = (playerRacer?.position && !isNaN(playerRacer.position))
            ? Math.floor(playerRacer.position)
            : 1;

        return {
            positions,
            raceTime: this.getRaceTime(),
            playerPosition
        };
    }

    public reset() {
        this.raceState = 'NOT_STARTED';
        this.raceStartTime = 0;
        this.finishedRacers = [];

        // Reset all racers
        this.racers.forEach(racer => {
            racer.lapCurrent = 0;
            racer.position = 1;
            racer.finished = false;
            racer.finishTime = undefined;
        });
    }
}

