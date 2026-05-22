import { create } from 'zustand';
import { Socket } from 'socket.io-client';
import { BattleEvent, BlockState, UnitState, TeamState, PlayerState, TerrainType } from './shared/types.js';
import { MAP_HEIGHT, MAP_WIDTH } from './shared/constants.js';

interface GameState {
  socket: Socket | null;
  setSocket: (socket: Socket) => void;
  blocks: Record<string, BlockState>;
  units: Record<string, UnitState>;
  teams: Record<string, TeamState>;
  playerDetails: PlayerState | null;
  tick: number;
  winner: string | null;
  explosions: { id: string, x: number, y: number, radius: number }[];
  combatHits: { id: string, fromX: number, fromY: number, toX: number, toY: number, team: string }[];
  battleEvents: BattleEvent[];
  supplyLines: { team: string, u1Id: string, u2Id: string, x1: number, y1: number, x2: number, y2: number }[];
  
  territory: Uint8Array;
  territoryVersion: number;
  terrainVersion: number;
  setTerritory: (t: Uint8Array) => void;
  applyTerritoryDiff: (diffs: [number, number][]) => void;
  applyTerrainPatch: (patch: { x: number, y: number, type: TerrainType }) => void;
  spawnCooldownEnd: number;
  setSpawnCooldownEnd: (time: number) => void;

  initGame: (state: any) => void;
  updateTick: (state: { units: Record<string, UnitState>, teams: Record<string, TeamState>, tick: number, winner?: string | null, enableAiRed?: boolean, enableAiBlue?: boolean, supplyLines?: { team: string, u1Id: string, u2Id: string, x1: number, y1: number, x2: number, y2: number }[] }) => void;
  applyStateDelta: (state: { units?: UnitState[], removedUnitIds?: string[], teams?: Record<string, TeamState>, tick?: number, winner?: string | null, enableAiRed?: boolean, enableAiBlue?: boolean, supplyLines?: { team: string, u1Id: string, u2Id: string, x1: number, y1: number, x2: number, y2: number }[] }) => void;
  updateUnit: (unit: any) => void;
  updateUnits: (units: UnitState[]) => void;
  removeUnits: (ids: string[]) => void;
  updatePlayerState: (p: PlayerState) => void;
  addExplosion: (x: number, y: number, radius: number) => void;
  removeExplosion: (id: string) => void;
  addCombatHit: (hit: { fromX: number, fromY: number, toX: number, toY: number, team: string }) => void;
  removeCombatHit: (id: string) => void;
  addBattleEvent: (event: BattleEvent) => void;
  
  enableAiRed?: boolean;
  enableAiBlue?: boolean;
  
  selectedUnitId: string | null;
  selectedUnitIds: string[];
  setSelectedUnit: (id: string | null) => void;
  setSelectedUnits: (ids: string[]) => void;
  selectedTypeToBuild: string | null;
  setSelectedTypeToBuild: (t: string | null) => void;
}

export const useGameStore = create<GameState>((set) => ({
  socket: null,
  setSocket: (socket) => set({ socket }),
  blocks: {},
  units: {},
  teams: {},
  playerDetails: null,
  tick: 0,
  winner: null,
  explosions: [],
  combatHits: [],
  battleEvents: [],
  supplyLines: [],
  
  territory: new Uint8Array(MAP_WIDTH * MAP_HEIGHT),
  territoryVersion: 0,
  terrainVersion: 0,
  setTerritory: (t) => set({ territory: t, territoryVersion: Date.now() }),
  applyTerritoryDiff: (diffs) => set((state) => {
      const newT = new Uint8Array(state.territory);
      diffs.forEach(([idx, val]) => {
          if (idx < 0 || idx >= newT.length) return;
          newT[idx] = val;
      });
      return { territory: newT, territoryVersion: state.territoryVersion + 1 };
  }),
  applyTerrainPatch: (patch) => set((state) => {
    const key = `${patch.x},${patch.y}`;
    const block = state.blocks[key];
    if (!block) return {};
    return {
      blocks: {
        ...state.blocks,
        [key]: { ...block, type: patch.type }
      },
      terrainVersion: state.terrainVersion + 1
    };
  }),
  spawnCooldownEnd: 0,
  setSpawnCooldownEnd: (time) => set({ spawnCooldownEnd: time }),

  initGame: (state) => set((prev) => ({ 
    blocks: state.blocks, 
    units: state.units,
    teams: state.teams,
    tick: state.tick,
    winner: state.winner,
    enableAiRed: state.enableAiRed,
    enableAiBlue: state.enableAiBlue,
    supplyLines: state.supplyLines || [],
    terrainVersion: prev.terrainVersion + 1,
    playerDetails: state.playerDetails !== undefined ? state.playerDetails : prev.playerDetails,
    explosions: [],
    combatHits: [],
    battleEvents: []
  })),
  
  updateTick: (state) => set((prev) => {
    // We completely replace units to catch dead ones natively
    const selectedUnitIds = prev.selectedUnitIds.filter(id => Boolean(state.units[id]));
    return {
      units: state.units,
      teams: state.teams,
      tick: state.tick,
      enableAiRed: state.enableAiRed !== undefined ? state.enableAiRed : prev.enableAiRed,
      enableAiBlue: state.enableAiBlue !== undefined ? state.enableAiBlue : prev.enableAiBlue,
      winner: state.winner !== undefined ? state.winner : prev.winner,
      supplyLines: state.supplyLines || prev.supplyLines,
      selectedUnitIds,
      selectedUnitId: selectedUnitIds[0] || null
    };
  }),

  applyStateDelta: (state) => set((prev) => {
    let units = prev.units;
    if ((state.units && state.units.length > 0) || (state.removedUnitIds && state.removedUnitIds.length > 0)) {
      units = { ...prev.units };
      state.units?.forEach(unit => {
        units[unit.id] = unit;
      });
      state.removedUnitIds?.forEach(id => {
        delete units[id];
      });
    }

    const selectedUnitIds = prev.selectedUnitIds.filter(id => Boolean(units[id]));

    return {
      units,
      teams: state.teams || prev.teams,
      tick: state.tick !== undefined ? state.tick : prev.tick,
      enableAiRed: state.enableAiRed !== undefined ? state.enableAiRed : prev.enableAiRed,
      enableAiBlue: state.enableAiBlue !== undefined ? state.enableAiBlue : prev.enableAiBlue,
      winner: state.winner !== undefined ? state.winner : prev.winner,
      supplyLines: state.supplyLines || prev.supplyLines,
      selectedUnitIds,
      selectedUnitId: selectedUnitIds[0] || null
    };
  }),
  
  updateUnit: (unitData) => set((state) => ({
    units: {
      ...state.units,
      [unitData.id]: {
        ...state.units[unitData.id],
        ...unitData
      }
    }
  })),

  updateUnits: (unitList) => set((state) => {
    if (unitList.length === 0) return {};
    const units = { ...state.units };
    unitList.forEach(unit => {
      units[unit.id] = unit;
    });
    return { units };
  }),

  removeUnits: (ids) => set((state) => {
    if (ids.length === 0) return {};
    const units = { ...state.units };
    ids.forEach(id => {
      delete units[id];
    });
    const selectedUnitIds = state.selectedUnitIds.filter(id => Boolean(units[id]));
    return {
      units,
      selectedUnitIds,
      selectedUnitId: selectedUnitIds[0] || null
    };
  }),

  updatePlayerState: (p) => set({ playerDetails: p }),

  addExplosion: (x, y, radius) => {
     const id = Math.random().toString(36);
     set((state) => ({ explosions: [...state.explosions, { id, x, y, radius }] }));
     setTimeout(() => {
        set((state) => ({ explosions: state.explosions.filter(e => e.id !== id) }));
     }, 800);
  },
  
  removeExplosion: (id) => set((state) => ({ explosions: state.explosions.filter(e => e.id !== id) })),

  addCombatHit: (hit) => {
     const id = Math.random().toString(36);
     set((state) => ({ combatHits: [...state.combatHits, { id, ...hit }] }));
     setTimeout(() => {
        set((state) => ({ combatHits: state.combatHits.filter(e => e.id !== id) }));
     }, 200); // Fast fading laser
  },
  
  removeCombatHit: (id) => set((state) => ({ combatHits: state.combatHits.filter(e => e.id !== id) })),

  addBattleEvent: (event) => set((state) => ({
    battleEvents: [event, ...state.battleEvents.filter(existing => existing.id !== event.id)].slice(0, 8)
  })),
  
  selectedUnitId: null,
  selectedUnitIds: [],
  setSelectedUnit: (id) => set({ selectedUnitId: id, selectedUnitIds: id ? [id] : [] }),
  setSelectedUnits: (ids) => set({ selectedUnitIds: ids, selectedUnitId: ids.length > 0 ? ids[0] : null }),
  selectedTypeToBuild: null,
  setSelectedTypeToBuild: (t) => set({ selectedTypeToBuild: t }),
}));
