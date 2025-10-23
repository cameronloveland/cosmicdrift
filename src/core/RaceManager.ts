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
            currentRacer.finished = npcState.lapCurrent >= npcState.lapTotal;

            if (currentRacer.finished && !currentRacer.finishTime) {
                currentRacer.finishTime = this.getRaceTime();
            }
        }
    }

    public calculatePositions(): RacePosition[] {
        const allRacers = Array.from(this.racers.values());

        // Sort by lap progress, then by track position within same lap
        allRacers.sort((a, b) => {
            // First by lap (higher is better)
            if (a.lapCurrent !== b.lapCurrent) {
                return b.lapCurrent - a.lapCurrent;
            }

            // Then by track position (lower t is better for same lap)
            // This is a simplified calculation - in a real implementation
            // you'd need to track actual track positions
            return 0; // For now, maintain current order
        });

        // Assign positions
        allRacers.forEach((racer, index) => {
            racer.position = index + 1;
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
        const playerPosition = this.getPlayerPosition();

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

