import { TerrainType, TerrainStats, UnitClass, UnitStats } from './types.js';

export const TERRAIN_STATS: Record<TerrainType, TerrainStats> = {
  grass: { name: 'Field', defenseBonus: 0, movementCost: 1, attackPenalty: 0 },
  forest: { name: 'Forest', defenseBonus: 2, movementCost: 2, attackPenalty: 0 },
  urban: { name: 'City', defenseBonus: 4, movementCost: 1, attackPenalty: -2 },
  trench: { name: 'Trench', defenseBonus: 5, movementCost: 2, attackPenalty: 0 },
  swamp: { name: 'Swamp', defenseBonus: -1, movementCost: 3, attackPenalty: -2 },
  water: { name: 'Water', defenseBonus: -2, movementCost: 99, attackPenalty: -4 },
  road: { name: 'Road', defenseBonus: -1, movementCost: 0.5, attackPenalty: 0 },
  rail: { name: 'Rail', defenseBonus: -1, movementCost: 0.45, attackPenalty: 0 },
  mountain: { name: 'Mountain', defenseBonus: 3, movementCost: 4, attackPenalty: 0 }, // + range handled in logic
};

export const UNIT_STATS: Record<UnitClass, UnitStats> = {
  infantry: { class: 'infantry', name: 'Infantry', cost: 15, maxHp: 100, damage: 15, range: 2, speed: 1, vision: 4, profile: 'soft', armor: 0 },
  marine: { class: 'marine', name: 'Marines', cost: 110, maxHp: 260, damage: 36, range: 3, speed: 1.25, vision: 5, profile: 'soft', armor: 1 },
  rocket: { class: 'rocket', name: 'Rocket Infantry', cost: 25, maxHp: 80, damage: 60, range: 3, speed: 1, vision: 4, profile: 'soft', armor: 0 },
  ifv: { class: 'ifv', name: 'IFV', cost: 35, maxHp: 200, damage: 25, range: 3, speed: 2, vision: 5, profile: 'armor', armor: 1 },
  tank: { class: 'tank', name: 'Tank', cost: 70, maxHp: 400, damage: 45, range: 4, speed: 1.5, vision: 4, profile: 'armor', armor: 3 },
  artillery: { class: 'artillery', name: 'Artillery', cost: 75, maxHp: 80, damage: 80, range: 12, speed: 0.5, vision: 2, profile: 'support', armor: 0 },
  aa: { class: 'aa', name: 'Anti-Air', cost: 45, maxHp: 120, damage: 30, range: 6, speed: 1, vision: 6, profile: 'support', armor: 1 },
  recon: { class: 'recon', name: 'Recon Drone', cost: 25, maxHp: 40, damage: 5, range: 1, speed: 4, vision: 12, profile: 'drone', armor: 0 },
  engineer: { class: 'engineer', name: 'Engineer', cost: 40, maxHp: 120, damage: 10, range: 1, speed: 1, vision: 3, profile: 'soft', armor: 0 },
  bunker: { class: 'bunker', name: 'Bunker', cost: 100, maxHp: 600, damage: 40, range: 5, speed: 0, vision: 6, profile: 'structure', armor: 2 },
  hq: { class: 'hq', name: 'Command Post', cost: 0, maxHp: 1500, damage: 0, range: 0, speed: 0, vision: 5, profile: 'structure', armor: 4 },
  factory: { class: 'factory', name: 'Factory', cost: 120, maxHp: 800, damage: 0, range: 0, speed: 0, vision: 4, profile: 'structure', armor: 2 },
  supply_truck: { class: 'supply_truck', name: 'Supply Truck', cost: 50, maxHp: 80, damage: 0, range: 0, speed: 1.5, vision: 4, profile: 'support', armor: 0 },
  fob: { class: 'fob', name: 'Forward Base', cost: 150, maxHp: 500, damage: 0, range: 0, speed: 0, vision: 6, profile: 'structure', armor: 2 },
};

export const MAP_WIDTH = 200;
export const MAP_HEIGHT = 200;
export const TICK_RATE_MS = 250;
export const SUPPLY_RADIUS = 20;
export const SUPPLY_PENALTY = 0.5; // 50% damage reduction if out of supply
export const FACTORY_INCOME = 1.25; // Supplies per tick per factory
export const BUILDABLE_UNITS: UnitClass[] = ['supply_truck', 'infantry', 'marine', 'rocket', 'engineer', 'ifv', 'aa', 'tank', 'artillery', 'recon'];
export const FOB_COST = 150;
export const BUNKER_COST = 100;
export const SPAWN_COOLDOWN_MS = 240;
export const MOVE_RANGE_MULTIPLIER = 3;
export const FORMATION_SPACING = 2;
export const ROAD_MOVE_BONUS = 2;
export const ROUGH_MOVE_PENALTY = 1;
export const FACTORY_CAPTURE_SUPPLY_BONUS = 120;
export const SUPPRESSION_TICKS = 8;
export const SUPPRESSED_DAMAGE_MULTIPLIER = 0.65;
export const MORALE_MAX = 100;
export const MORALE_RECOVERY_PER_TICK = 2.5;
export const SUPPRESSION_DECAY_PER_TICK = 5;
export const SUPPRESSION_THRESHOLD = 55;
export const SUPPRESSION_DAMAGE_FACTOR = 0.75;
export const SUPPORT_SUPPRESSION_BONUS = 28;
export const FRONTLINE_CLAIM_REACH = 6;
export const LOGISTICS_ANCHOR_REACH = 18;
export const DEPOT_COST = 80;
export const ROADWORK_COST = 20;
export const TRENCH_COST = 30;
export const VISIBILITY_TERRITORY_RADIUS = 2;
export const AI_DOCTRINE_INTERVAL_TICKS = 80;
export const SPATIAL_BUCKET_SIZE = 8;
export const COMBINED_ARMS_RADIUS = 6;
export const COMBINED_ARMS_DAMAGE_BONUS = 0.09;
export const COMBINED_ARMS_DEFENSE_BONUS = 0.06;
export const ENTRENCHMENT_MAX = 5;
export const ENTRENCHMENT_DAMAGE_REDUCTION = 0.055;
export const FACTORY_CAPTURE_TICKS = 32;
export const FACTORY_CAPTURE_RADIUS = 4;
export const FIELD_REPAIR_INTERVAL_TICKS = 4;
export const FIELD_REPAIR_AMOUNT = 4;
export const FIELD_REPAIR_SAFE_TICKS = 16;
export const ROAD_SUPPLY_BONUS = 6;
export const RAIL_SUPPLY_BONUS = 10;

export const DAMAGE_MULTIPLIERS: Partial<Record<UnitClass, Partial<Record<UnitClass, number>>>> = {
  infantry: { engineer: 1.15, rocket: 1.1, marine: 0.8, recon: 0.55, tank: 0.45, ifv: 0.65, bunker: 0.45, hq: 0.35, factory: 0.5, fob: 0.5 },
  marine: { infantry: 1.35, rocket: 1.2, engineer: 1.35, recon: 1.4, supply_truck: 1.15, artillery: 1.25, bunker: 0.65, tank: 0.55, ifv: 0.75, hq: 0.55, factory: 0.7, fob: 0.75 },
  rocket: { tank: 1.8, ifv: 1.5, bunker: 1.25, hq: 0.75, factory: 0.85, recon: 0.35, infantry: 0.7, marine: 0.65 },
  ifv: { infantry: 1.35, marine: 1.15, rocket: 1.25, engineer: 1.25, recon: 1.4, tank: 0.65, bunker: 0.55 },
  tank: { infantry: 1.15, marine: 1.0, rocket: 1.05, ifv: 1.3, tank: 1.0, bunker: 0.85, hq: 0.85, factory: 1.0, fob: 1.0 },
  artillery: { infantry: 1.5, marine: 1.25, rocket: 1.4, engineer: 1.4, bunker: 1.2, factory: 1.15, hq: 0.85, tank: 0.7, recon: 0.6 },
  aa: { recon: 3.0, artillery: 0.8, infantry: 0.75, marine: 0.65, tank: 0.45, ifv: 0.65 },
  recon: { infantry: 0.45, rocket: 0.45, engineer: 0.6, supply_truck: 0.75 },
  bunker: { infantry: 1.4, marine: 1.15, rocket: 1.25, engineer: 1.4, recon: 1.2, tank: 0.65 },
};
