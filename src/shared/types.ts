export type Team = 'BLUE' | 'RED' | 'NEUTRAL';

export type TerrainType = 'grass' | 'forest' | 'urban' | 'trench' | 'swamp' | 'water' | 'road' | 'rail' | 'mountain';

export type UnitClass = 'infantry' | 'marine' | 'ifv' | 'tank' | 'artillery' | 'aa' | 'recon' | 'engineer' | 'hq' | 'factory' | 'supply_truck' | 'fob' | 'rocket' | 'bunker';

export type UnitOrderType = 'hold' | 'attack_move' | 'retreat' | 'patrol' | 'entrench';

export type DamageProfile = 'soft' | 'armor' | 'structure' | 'support' | 'drone';

export interface UnitOrder {
  type: UnitOrderType;
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
}

export interface TerrainStats {
  defenseBonus: number;
  movementCost: number;
  attackPenalty: number;
  name: string;
}

export interface UnitStats {
  class: UnitClass;
  name: string;
  cost: number;
  maxHp: number;
  damage: number;
  range: number;
  speed: number;   // tiles per tick
  vision: number;
  profile?: DamageProfile;
  armor?: number;
}

export interface BlockState {
  type: TerrainType;
  ownerId: string | null;
  team: Team;
}

export interface UnitState {
  id: string;
  type: UnitClass;
  team: Team;
  ownerId: string;
  x: number;
  y: number;
  targetX?: number | null;
  targetY?: number | null;
  targetUnitId?: string | null;
  hp: number;
  suppressed: boolean;
  suppressedUntil?: number;
  lastAttackTick: number;
  lastCombatTick?: number;
  lastMoveTick: number;
  order?: UnitOrder | null;
  supplied?: boolean;
  spottedBy?: Team[];
  rallyX?: number;
  rallyY?: number;
  captureTeam?: Team | null;
  captureProgress?: number;
  entrenchment?: number;
  combinedArms?: number;
  kills?: number;
  rank?: number;
  morale?: number;
  suppression?: number;
}

export type BattleEventType = 'deployment' | 'contact' | 'under_attack' | 'suppressed' | 'destroyed' | 'rank_up' | 'objective' | 'system';

export interface BattleEvent {
  id: string;
  type: BattleEventType;
  team: Team;
  message: string;
  x?: number;
  y?: number;
  tick: number;
  priority: number;
}

export interface PlayerState {
  id: string;
  team: Team;
  influence: number;
  isHost?: boolean;
}

export interface TeamState {
  supplies: number;
  score: number;
  stats?: {
    kills: number;
    deployed: number;
    pixelsPainted?: number;
    factories?: number;
    frontline?: number;
    suppliedUnits?: number;
    spottedEnemies?: number;
    activePlayers?: number;
    queueSize?: number;
    combinedArmsUnits?: number;
    entrenchedUnits?: number;
    repairingUnits?: number;
    contestedFactories?: number;
  };
}

export interface GameStateData {
  blocks: Record<string, BlockState>;
  units: Record<string, UnitState>;
  players: Record<string, PlayerState>;
  teams: Record<Team, TeamState>;
  tick: number;
  winner: Team | null;
  enableAiRed?: boolean;
  enableAiBlue?: boolean;
}
