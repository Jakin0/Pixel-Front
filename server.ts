import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { BattleEvent, GameStateData, BlockState, UnitState, PlayerState, UnitClass, Team, UnitOrderType, BattleEventType } from './src/shared/types.js';
import {
  BUNKER_COST,
  COMBINED_ARMS_DAMAGE_BONUS,
  COMBINED_ARMS_DEFENSE_BONUS,
  COMBINED_ARMS_RADIUS,
  DAMAGE_MULTIPLIERS,
  DEPOT_COST,
  AI_DOCTRINE_INTERVAL_TICKS,
  ENTRENCHMENT_DAMAGE_REDUCTION,
  ENTRENCHMENT_MAX,
  FACTORY_CAPTURE_SUPPLY_BONUS,
  FACTORY_CAPTURE_RADIUS,
  FACTORY_CAPTURE_TICKS,
  FACTORY_INCOME,
  FIELD_REPAIR_AMOUNT,
  FIELD_REPAIR_INTERVAL_TICKS,
  FIELD_REPAIR_SAFE_TICKS,
  FORMATION_SPACING,
  FOB_COST,
  LOGISTICS_ANCHOR_REACH,
  MAP_HEIGHT,
  MAP_WIDTH,
  MORALE_MAX,
  MORALE_RECOVERY_PER_TICK,
  MOVE_RANGE_MULTIPLIER,
  FRONTLINE_CLAIM_REACH,
  ROAD_MOVE_BONUS,
  ROAD_SUPPLY_BONUS,
  ROADWORK_COST,
  ROUGH_MOVE_PENALTY,
  RAIL_SUPPLY_BONUS,
  SPAWN_COOLDOWN_MS,
  SPATIAL_BUCKET_SIZE,
  SUPPORT_SUPPRESSION_BONUS,
  SUPPRESSED_DAMAGE_MULTIPLIER,
  SUPPRESSION_DAMAGE_FACTOR,
  SUPPRESSION_DECAY_PER_TICK,
  SUPPRESSION_THRESHOLD,
  SUPPRESSION_TICKS,
  SUPPLY_PENALTY,
  SUPPLY_RADIUS,
  TERRAIN_STATS,
  TRENCH_COST,
  TICK_RATE_MS,
  UNIT_STATS,
  VISIBILITY_TERRITORY_RADIUS
} from './src/shared/constants.js';
import crypto from 'crypto';

dotenv.config();

const __dirname = process.cwd();

const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 3000);

const territory = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
let territoryChanges: [number, number][] = [];
const visibility: Record<Exclude<Team, 'NEUTRAL'>, Uint8Array> = {
  BLUE: new Uint8Array(MAP_WIDTH * MAP_HEIGHT),
  RED: new Uint8Array(MAP_WIDTH * MAP_HEIGHT)
};
const suppliedUnitIds: Record<Exclude<Team, 'NEUTRAL'>, Set<string>> = {
  BLUE: new Set(),
  RED: new Set()
};
let supplyNetworkLines: { team: Team, u1Id: string, u2Id: string, x1: number, y1: number, x2: number, y2: number }[] = [];
type SpatialIndex = Map<string, UnitState[]>;

function spatialKeyFor(x: number, y: number) {
  return `${Math.floor(x / SPATIAL_BUCKET_SIZE)},${Math.floor(y / SPATIAL_BUCKET_SIZE)}`;
}

function buildSpatialIndex(units?: UnitState[]) {
  const buckets: SpatialIndex = new Map();
  const source = units || Object.values(gameState.units);
  source.forEach(unit => {
    const key = spatialKeyFor(unit.x, unit.y);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(unit);
    else buckets.set(key, [unit]);
  });
  return buckets;
}

function nearbyUnits(index: SpatialIndex, x: number, y: number, radius: number) {
  const results: UnitState[] = [];
  const bucketRadius = Math.ceil(radius / SPATIAL_BUCKET_SIZE);
  const bx = Math.floor(x / SPATIAL_BUCKET_SIZE);
  const by = Math.floor(y / SPATIAL_BUCKET_SIZE);

  for (let oy = -bucketRadius; oy <= bucketRadius; oy++) {
    for (let ox = -bucketRadius; ox <= bucketRadius; ox++) {
      const bucket = index.get(`${bx + ox},${by + oy}`);
      if (!bucket) continue;
      bucket.forEach(unit => {
        if (distance(x, y, unit.x, unit.y) <= radius) results.push(unit);
      });
    }
  }

  return results;
}

function setTerritory(x: number, y: number, team: Team) {
  if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT || team === 'NEUTRAL') return;
  const idx = y * MAP_WIDTH + x;
  const val = team === 'BLUE' ? 1 : 2;
  if (territory[idx] !== val) {
      territory[idx] = val;
      territoryChanges.push([idx, val]);
  }
}

function clearTerritory(x: number, y: number) {
  if (!inBounds(x, y)) return;
  const idx = y * MAP_WIDTH + x;
  if (territory[idx] !== 0) {
      territory[idx] = 0;
      territoryChanges.push([idx, 0]);
  }
}

function inBounds(x: number, y: number) {
  return x >= 0 && y >= 0 && x < MAP_WIDTH && y < MAP_HEIGHT;
}

function territoryValueFor(team: Team) {
  return team === 'BLUE' ? 1 : team === 'RED' ? 2 : 0;
}

function enemyOf(team: Team): Team {
  return team === 'BLUE' ? 'RED' : team === 'RED' ? 'BLUE' : 'NEUTRAL';
}

function isCombatTeam(team: Team): team is Exclude<Team, 'NEUTRAL'> {
  return team === 'BLUE' || team === 'RED';
}

function deploymentCooldownMs(team: Team) {
  if (!isCombatTeam(team)) return SPAWN_COOLDOWN_MS;
  const connectedPlayers = Math.max(1, Object.keys(gameState.players).length);
  return Math.min(900, SPAWN_COOLDOWN_MS + Math.max(0, connectedPlayers - 1) * 90);
}

function canOperateBeyondSupply(type: UnitClass) {
  return type === 'recon' || type === 'marine';
}

function isSupplyIndependent(type: UnitClass) {
  return type === 'recon';
}

function supplyCombatMultiplier(unit: UnitState) {
  if (isSupplyIndependent(unit.type)) return 1;
  if (unit.supplied) return 1.15;
  if (unit.type === 'marine') return 0.8;
  return SUPPLY_PENALTY;
}

function maxHpFor(unit: UnitState) {
  return (UNIT_STATS[unit.type]?.maxHp || 100) * (1 + (unit.rank || 0) * 0.2);
}

function combinedArmsDamageMultiplier(unit: UnitState) {
  return 1 + Math.min(3, unit.combinedArms || 0) * COMBINED_ARMS_DAMAGE_BONUS;
}

function combinedArmsDefenseMultiplier(unit: UnitState) {
  return Math.max(0.78, 1 - Math.min(3, unit.combinedArms || 0) * COMBINED_ARMS_DEFENSE_BONUS);
}

function terrainAt(x: number, y: number) {
  return gameState.blocks[`${x},${y}`]?.type || 'grass';
}

function hasFriendlyTerritoryNear(team: Team, x: number, y: number, radius: number) {
  const val = territoryValueFor(team);
  const radiusSq = radius * radius;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radiusSq) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(nx, ny) && territory[ny * MAP_WIDTH + nx] === val) return true;
    }
  }

  return false;
}

function hasFriendlyLogisticsNear(team: Team, x: number, y: number, radius = LOGISTICS_ANCHOR_REACH) {
  return Object.values(gameState.units).some(u => {
    if (u.team !== team) return false;
    if (!['hq', 'factory', 'fob', 'supply_truck', 'bunker'].includes(u.type)) return false;
    return distance(u.x, u.y, x, y) <= radius + terrainLogisticsBonus(x, y);
  });
}

function canClaimPixel(team: Team, x: number, y: number) {
  if (team === 'NEUTRAL' || !inBounds(x, y) || terrainAt(x, y) === 'water') return false;
  const idx = y * MAP_WIDTH + x;
  if (territory[idx] === territoryValueFor(team)) return true;
  return hasFriendlyTerritoryNear(team, x, y, FRONTLINE_CLAIM_REACH) || hasFriendlyLogisticsNear(team, x, y);
}

function paintPixel(team: Team, x: number, y: number, ownerId = 'SYSTEM', force = false) {
  if (team === 'NEUTRAL' || !inBounds(x, y) || terrainAt(x, y) === 'water') return false;
  if (!force && !canClaimPixel(team, x, y)) return false;

  const idx = y * MAP_WIDTH + x;
  const val = territoryValueFor(team);
  if (territory[idx] === val) return false;

  territory[idx] = val;
  territoryChanges.push([idx, val]);
  const stats = gameState.teams[team].stats;
  if (stats) stats.pixelsPainted = (stats.pixelsPainted || 0) + 1;
  const owner = gameState.players[ownerId];
  if (owner) owner.influence = Math.min(100, owner.influence + 0.5);
  return true;
}

function paintTerritoryRadius(team: Team, x: number, y: number, radius: number, force = true) {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const radiusSq = radius * radius;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radiusSq) continue;
      paintPixel(team, cx + dx, cy + dy, 'SYSTEM', force);
    }
  }
}

function refreshLogisticsTerritory() {
  Object.values(gameState.units).forEach(u => {
    if (u.team !== 'BLUE' && u.team !== 'RED') return;

    if (u.type === 'hq') paintTerritoryRadius(u.team, u.x, u.y, 15, true);
    else if (u.type === 'factory') paintTerritoryRadius(u.team, u.x, u.y, 8, true);
    else if (u.type === 'fob') paintTerritoryRadius(u.team, u.x, u.y, 9, true);
    else if (u.type === 'bunker') paintTerritoryRadius(u.team, u.x, u.y, 4, true);
    else if (u.type === 'supply_truck' && hasFriendlyTerritoryNear(u.team, Math.floor(u.x), Math.floor(u.y), 4)) {
      paintTerritoryRadius(u.team, u.x, u.y, 6, true);
    } else if (u.type === 'infantry' || u.type === 'marine') {
      paintTerritoryRadius(u.team, u.x, u.y, u.type === 'marine' ? 2 : 1, false);
    } else if (u.type === 'engineer' || u.type === 'rocket') {
      paintTerritoryRadius(u.team, u.x, u.y, 1, false);
    }
  });
}

function isSupplyRoot(u: UnitState) {
  return u.type === 'hq' || u.type === 'factory' || u.type === 'fob';
}

function isSupplyRelay(u: UnitState) {
  return u.type === 'supply_truck' || u.type === 'bunker';
}

function terrainLogisticsBonus(x: number, y: number) {
  const terrain = terrainAt(Math.floor(x), Math.floor(y));
  if (terrain === 'rail') return RAIL_SUPPLY_BONUS;
  if (terrain === 'road') return ROAD_SUPPLY_BONUS;
  return 0;
}

function logisticsReachBetween(a: UnitState, b: UnitState) {
  const routeBonus = Math.max(
    terrainLogisticsBonus(a.x, a.y),
    terrainLogisticsBonus(b.x, b.y)
  );
  const truckBonus = a.type === 'supply_truck' || b.type === 'supply_truck' ? 3 : 0;
  return SUPPLY_RADIUS + routeBonus + truckBonus;
}

function logisticsReachFrom(node: UnitState) {
  return SUPPLY_RADIUS + terrainLogisticsBonus(node.x, node.y) + (node.type === 'supply_truck' ? 3 : 0);
}

function recomputeSupplyNetworks() {
  suppliedUnitIds.BLUE.clear();
  suppliedUnitIds.RED.clear();
  supplyNetworkLines = [];

  (['BLUE', 'RED'] as const).forEach(team => {
    const roots = Object.values(gameState.units).filter(u => u.team === team && isSupplyRoot(u));
    const relays = Object.values(gameState.units).filter(u => u.team === team && isSupplyRelay(u));
    const connected: UnitState[] = [...roots];
    const connectedRelayIds = new Set<string>();

    roots.forEach(root => suppliedUnitIds[team].add(root.id));

    let changed = true;
    while (changed) {
      changed = false;
      for (const relay of relays) {
        if (connectedRelayIds.has(relay.id)) continue;
        const anchor = connected.find(node => distance(node.x, node.y, relay.x, relay.y) <= logisticsReachBetween(node, relay));
        if (!anchor) continue;

        connectedRelayIds.add(relay.id);
        connected.push(relay);
        suppliedUnitIds[team].add(relay.id);
        supplyNetworkLines.push({
          team,
          u1Id: relay.id,
          u2Id: anchor.id,
          x1: relay.x,
          y1: relay.y,
          x2: anchor.x,
          y2: anchor.y
        });
        changed = true;
      }
    }

    Object.values(gameState.units).forEach(u => {
      if (u.team !== team || isSupplyIndependent(u.type)) return;
      if (connected.some(node => distance(node.x, node.y, u.x, u.y) <= logisticsReachFrom(node))) suppliedUnitIds[team].add(u.id);
    });
  });

  Object.values(gameState.units).forEach(u => {
    if (!isCombatTeam(u.team)) {
      u.supplied = true;
      return;
    }
    u.supplied = isSupplyIndependent(u.type) || suppliedUnitIds[u.team].has(u.id);
  });
}

function markVisibleCircle(team: Exclude<Team, 'NEUTRAL'>, cx: number, cy: number, radius: number) {
  const grid = visibility[team];
  const radiusSq = radius * radius;
  for (let y = Math.max(0, cy - radius); y <= Math.min(MAP_HEIGHT - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(MAP_WIDTH - 1, cx + radius); x++) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= radiusSq) {
        grid[y * MAP_WIDTH + x] = 1;
      }
    }
  }
}

function recomputeVisibility() {
  visibility.BLUE.fill(0);
  visibility.RED.fill(0);

  for (let i = 0; i < territory.length; i++) {
    if (territory[i] === 1) {
      const x = i % MAP_WIDTH;
      const y = Math.floor(i / MAP_WIDTH);
      markVisibleCircle('BLUE', x, y, VISIBILITY_TERRITORY_RADIUS);
    } else if (territory[i] === 2) {
      const x = i % MAP_WIDTH;
      const y = Math.floor(i / MAP_WIDTH);
      markVisibleCircle('RED', x, y, VISIBILITY_TERRITORY_RADIUS);
    }
  }

  Object.values(gameState.units).forEach(u => {
    if (!isCombatTeam(u.team)) return;
    const vision = UNIT_STATS[u.type]?.vision || 4;
    markVisibleCircle(u.team, Math.floor(u.x), Math.floor(u.y), vision);
  });

  Object.values(gameState.units).forEach(u => {
    const spottedBy: Team[] = [];
    if (isCombatTeam(u.team)) spottedBy.push(u.team);
    (['BLUE', 'RED'] as const).forEach(team => {
      if (u.team === team) return;
      const idx = Math.floor(u.y) * MAP_WIDTH + Math.floor(u.x);
      if (idx >= 0 && idx < territory.length && visibility[team][idx]) spottedBy.push(team);
    });
    u.spottedBy = spottedBy;
  });
}

function canTeamSeeUnit(team: Team, unit: UnitState) {
  if (!isCombatTeam(team)) return true;
  if (unit.team === team || unit.team === 'NEUTRAL') return true;
  const idx = Math.floor(unit.y) * MAP_WIDTH + Math.floor(unit.x);
  return idx >= 0 && idx < territory.length && visibility[team][idx] === 1;
}

function visibleUnitsFor(team: Team) {
  return gameState.units;
}

function buildPublicTickFor(team: Team) {
  return {
    units: gameState.units,
    teams: gameState.teams,
    tick: gameState.tick,
    winner: gameState.winner,
    enableAiRed: gameState.enableAiRed,
    enableAiBlue: gameState.enableAiBlue,
    supplyLines: supplyNetworkLines
  };
}

function emitGameTicks() {
  if (!io) return;
  Object.values(gameState.players).forEach(p => {
    io.to(p.id).emit('tick', buildPublicTickFor(p.team));
    io.to(p.id).emit('player_sync', p);
  });
}

function emitInitFor(socketId: string) {
  const p = gameState.players[socketId];
  if (!p || !io) return;
  io.to(socketId).emit('init', {
    blocks: gameState.blocks,
    units: visibleUnitsFor(p.team),
    teams: gameState.teams,
    tick: gameState.tick,
    winner: gameState.winner,
    playerDetails: p,
    enableAiRed: gameState.enableAiRed,
    enableAiBlue: gameState.enableAiBlue,
    supplyLines: supplyNetworkLines
  });
  io.to(socketId).emit('init_territory', Buffer.from(territory));
}

function emitUnitSpawned(unit: UnitState) {
  if (!io) return;
  syncedUnitSignatures.set(unit.id, unitSyncSignature(unit));
  io.emit('unit_spawned', unit);
  if (isCombatTeam(unit.team) && unit.ownerId !== 'SYSTEM') {
    emitBattleEvent('deployment', unit.team, `${unit.team} deployed ${unitName(unit)} at ${Math.round(unit.x)}:${Math.round(unit.y)}`, unit.x, unit.y, 2);
  }
}

const syncedUnitSignatures = new Map<string, string>();
const recentBattleEventTicks = new Map<string, number>();

function unitName(unit: UnitState) {
  return UNIT_STATS[unit.type]?.name || unit.type;
}

function emitBattleEvent(type: BattleEventType, team: Team, message: string, x?: number, y?: number, priority = 1) {
  if (!io) return;
  const event: BattleEvent = {
    id: crypto.randomUUID(),
    type,
    team,
    message,
    x,
    y,
    tick: gameState.tick,
    priority
  };
  io.emit('battle_event', event);
}

function emitThrottledBattleEvent(key: string, cooldownTicks: number, type: BattleEventType, team: Team, message: string, x?: number, y?: number, priority = 1) {
  const lastTick = recentBattleEventTicks.get(key) || -Infinity;
  if (gameState.tick - lastTick < cooldownTicks) return;
  recentBattleEventTicks.set(key, gameState.tick);
  emitBattleEvent(type, team, message, x, y, priority);
}

function unitSyncSignature(unit: UnitState) {
  return JSON.stringify(unit);
}

function buildStateDelta() {
  const units: UnitState[] = [];
  const currentIds = new Set<string>();

  Object.values(gameState.units).forEach(unit => {
    currentIds.add(unit.id);
    const signature = unitSyncSignature(unit);
    if (syncedUnitSignatures.get(unit.id) !== signature) {
      units.push(unit);
      syncedUnitSignatures.set(unit.id, signature);
    }
  });

  const removedUnitIds: string[] = [];
  Array.from(syncedUnitSignatures.keys()).forEach(id => {
    if (currentIds.has(id)) return;
    removedUnitIds.push(id);
    syncedUnitSignatures.delete(id);
  });

  return {
    units,
    removedUnitIds,
    teams: gameState.teams,
    tick: gameState.tick,
    winner: gameState.winner,
    enableAiRed: gameState.enableAiRed,
    enableAiBlue: gameState.enableAiBlue,
    supplyLines: supplyNetworkLines
  };
}

function emitStateDelta() {
  if (!io) return;
  io.emit('state_delta', buildStateDelta());
  Object.values(gameState.players).forEach(p => {
    io.to(p.id).emit('player_sync', p);
  });
}

function emitUnitsUpdated(units: UnitState[]) {
  if (!io || units.length === 0) return;
  units.forEach(unit => syncedUnitSignatures.set(unit.id, unitSyncSignature(unit)));
  io.emit('units_updated', units);
}

function emitUnitsRemoved(ids: string[]) {
  if (!io || ids.length === 0) return;
  ids.forEach(id => syncedUnitSignatures.delete(id));
  io.emit('units_removed', ids);
}

function damageMultiplier(attacker: UnitState, target: UnitState) {
  let mult = DAMAGE_MULTIPLIERS[attacker.type]?.[target.type] ?? 1;
  const targetArmor = UNIT_STATS[target.type]?.armor || 0;
  if (targetArmor > 0 && attacker.type !== 'rocket' && attacker.type !== 'tank' && attacker.type !== 'artillery') {
    mult *= Math.max(0.35, 1 - targetArmor * 0.14);
  }
  const terrain = TERRAIN_STATS[terrainAt(Math.floor(target.x), Math.floor(target.y))];
  if (terrain) mult *= Math.max(0.35, 1 - terrain.defenseBonus * 0.04);
  if (target.entrenchment) mult *= Math.max(0.55, 1 - target.entrenchment * ENTRENCHMENT_DAMAGE_REDUCTION);
  mult *= combinedArmsDefenseMultiplier(target);
  return mult;
}

function findProductionStructure(team: Team, x: number, y: number, type: UnitClass) {
  if (!isCombatTeam(team)) return null;
  const structures = Object.values(gameState.units).filter(u => {
    if (u.team !== team || !['hq', 'factory', 'fob'].includes(u.type)) return false;
    if (type === 'tank' || type === 'artillery' || type === 'ifv' || type === 'aa') return u.type === 'factory' || u.type === 'hq';
    return true;
  });

  structures.sort((a, b) => distance(a.x, a.y, x, y) - distance(b.x, b.y, x, y));
  return structures[0] || null;
}

function isTileOccupied(x: number, y: number) {
  return Object.values(gameState.units).some(u => Math.floor(u.x) === x && Math.floor(u.y) === y);
}

function isNearEnemyStrongpoint(team: Team, x: number, y: number, radius: number) {
  return Object.values(gameState.units).some(u => {
    if (u.team === team || u.team === 'NEUTRAL') return false;
    if (!['hq', 'factory', 'fob', 'bunker'].includes(u.type)) return false;
    return distance(u.x, u.y, x, y) <= radius;
  });
}

function canMarineDeployAt(team: Team, x: number, y: number) {
  if (!isCombatTeam(team) || !inBounds(x, y) || terrainAt(x, y) === 'water') return false;
  if (isTileOccupied(x, y)) return false;
  return !isNearEnemyStrongpoint(team, x, y, 10);
}

function canDeployUnitAt(team: Team, type: UnitClass, x: number, y: number, occupied: Set<string>) {
  if (!isCombatTeam(team) || !inBounds(x, y) || terrainAt(x, y) === 'water') return false;
  if (occupied.has(`${x},${y}`)) return false;

  const idx = y * MAP_WIDTH + x;
  const teamVal = territoryValueFor(team);

  if (type === 'marine') {
    return !isNearEnemyStrongpoint(team, x, y, 10);
  }

  if (type === 'recon') {
    return !isNearEnemyStrongpoint(team, x, y, 6) && (
      territory[idx] === teamVal ||
      hasFriendlyTerritoryNear(team, x, y, 10) ||
      hasFriendlyLogisticsNear(team, x, y)
    );
  }

  return territory[idx] === teamVal || canClaimPixel(team, x, y);
}

function findDeploymentTile(team: Team, type: UnitClass, targetX: number, targetY: number) {
  const occupied = new Set<string>();
  Object.values(gameState.units).forEach(u => occupied.add(`${Math.floor(u.x)},${Math.floor(u.y)}`));
  const searchRadius = type === 'marine' ? 7 : type === 'recon' ? 10 : 6;

  for (let radius = 0; radius <= searchRadius; radius++) {
    const candidates: { x: number, y: number, score: number }[] = [];
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = targetX + dx;
        const y = targetY + dy;
        if (!canDeployUnitAt(team, type, x, y, occupied)) continue;
        const teamVal = territoryValueFor(team);
        const friendlyGroundBonus = territory[y * MAP_WIDTH + x] === teamVal ? -0.25 : 0;
        const roadBonus = terrainAt(x, y) === 'road' || terrainAt(x, y) === 'rail' ? -0.15 : 0;
        candidates.push({ x, y, score: Math.abs(dx) + Math.abs(dy) + friendlyGroundBonus + roadBonus });
      }
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.score - b.score);
      return candidates[0];
    }
  }

  return null;
}

function setUnitOrder(unit: UnitState, type: UnitOrderType, x?: number, y?: number, x2?: number, y2?: number) {
  unit.order = { type, x, y, x2, y2 };
  if (x !== undefined && y !== undefined) {
    unit.targetX = x;
    unit.targetY = y;
  }
}

function nearestSupplyAnchor(team: Team, x: number, y: number) {
  return Object.values(gameState.units)
    .filter(u => u.team === team && (isSupplyRoot(u) || suppliedUnitIds[team as Exclude<Team, 'NEUTRAL'>]?.has(u.id)))
    .sort((a, b) => distance(a.x, a.y, x, y) - distance(b.x, b.y, x, y))[0] || null;
}

function unitHasVisibleTargetInRange(unit: UnitState) {
  const stats = UNIT_STATS[unit.type];
  return Object.values(gameState.units).some(other => {
    if (other.team === unit.team || other.team === 'NEUTRAL') return false;
    if (!canTeamSeeUnit(unit.team, other)) return false;
    return distance(unit.x, unit.y, other.x, other.y) <= stats.range;
  });
}

function stepUnitToward(unit: UnitState, targetX: number, targetY: number) {
  if (gameState.tick - unit.lastMoveTick < 4) return false;
  const occupied = new Set<string>();
  Object.values(gameState.units).forEach(other => {
    if (other.id !== unit.id) occupied.add(`${Math.floor(other.x)},${Math.floor(other.y)}`);
  });

  const dx = targetX - unit.x;
  const dy = targetY - unit.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return false;
  const range = movementRangeFor(unit, Math.floor(targetX), Math.floor(targetY));
  const clampedX = Math.round(unit.x + (dx / len) * Math.min(len, range));
  const clampedY = Math.round(unit.y + (dy / len) * Math.min(len, range));
  const tile = findNearestFormationTile(unit, unit.team, clampedX, clampedY, occupied);
  if (!tile) return false;
  moveUnitTo(unit, tile.x, tile.y);
  return true;
}

function processUnitOrders() {
  Object.values(gameState.units).forEach(unit => {
    if (!isMobileUnit(unit) || !unit.order || !isCombatTeam(unit.team)) return;
    if (unit.order.type === 'hold' || unit.order.type === 'entrench') return;

    if (unit.order.type === 'retreat') {
      const anchor = nearestSupplyAnchor(unit.team, unit.x, unit.y);
      if (anchor) stepUnitToward(unit, anchor.x, anchor.y);
      return;
    }

    if (unit.order.type === 'attack_move') {
      if (unitHasVisibleTargetInRange(unit)) return;
      if (unit.order.x !== undefined && unit.order.y !== undefined) stepUnitToward(unit, unit.order.x, unit.order.y);
      return;
    }

    if (unit.order.type === 'patrol') {
      if (unitHasVisibleTargetInRange(unit)) return;
      const tx = unit.order.x ?? unit.x;
      const ty = unit.order.y ?? unit.y;
      if (distance(unit.x, unit.y, tx, ty) < 2 && unit.order.x2 !== undefined && unit.order.y2 !== undefined) {
        const oldX = unit.order.x;
        const oldY = unit.order.y;
        unit.order.x = unit.order.x2;
        unit.order.y = unit.order.y2;
        unit.order.x2 = oldX;
        unit.order.y2 = oldY;
      }
      if (unit.order.x !== undefined && unit.order.y !== undefined) stepUnitToward(unit, unit.order.x, unit.order.y);
    }
  });
}

function tacticalRole(type: UnitClass) {
  if (type === 'tank' || type === 'ifv') return 'armor';
  if (type === 'artillery' || type === 'aa' || type === 'rocket') return 'support';
  if (type === 'recon') return 'recon';
  if (type === 'supply_truck' || type === 'engineer') return 'logistics';
  if (type === 'marine' || type === 'infantry') return 'line';
  return 'structure';
}

function recomputeCombinedArms(index: SpatialIndex) {
  Object.values(gameState.units).forEach(unit => {
    unit.combinedArms = 0;
    if (!isCombatTeam(unit.team) || !isMobileUnit(unit) || unit.type === 'supply_truck') return;

    const roles = new Set<string>([tacticalRole(unit.type)]);
    nearbyUnits(index, unit.x, unit.y, COMBINED_ARMS_RADIUS).forEach(other => {
      if (other.id === unit.id || other.team !== unit.team || !isMobileUnit(other)) return;
      const role = tacticalRole(other.type);
      if (role !== 'structure') roles.add(role);
    });

    unit.combinedArms = Math.max(0, Math.min(3, roles.size - 1));
  });
}

function processEntrenchment() {
  Object.values(gameState.units).forEach(unit => {
    if (!isCombatTeam(unit.team) || !isMobileUnit(unit) || unit.type === 'supply_truck' || unit.type === 'recon') {
      unit.entrenchment = 0;
      return;
    }

    const holding = unit.order?.type === 'hold' || unit.order?.type === 'entrench';
    const defensiveGround = ['trench', 'urban', 'forest', 'mountain'].includes(terrainAt(Math.floor(unit.x), Math.floor(unit.y)));
    const recentlyMoved = gameState.tick - unit.lastMoveTick < 10;
    const underFire = gameState.tick - (unit.lastCombatTick || 0) < 8;

    if ((holding || defensiveGround) && !recentlyMoved) {
      const gain = unit.order?.type === 'entrench' || defensiveGround ? 0.35 : 0.2;
      unit.entrenchment = Math.min(ENTRENCHMENT_MAX, (unit.entrenchment || 0) + (underFire ? gain * 0.5 : gain));
    } else {
      unit.entrenchment = Math.max(0, (unit.entrenchment || 0) - 0.75);
    }
  });
}

function processFieldRepairs(index: SpatialIndex) {
  let blueRepairing = 0;
  let redRepairing = 0;
  if (gameState.tick % FIELD_REPAIR_INTERVAL_TICKS !== 0) return { BLUE: 0, RED: 0 };

  Object.values(gameState.units).forEach(unit => {
    if (!isCombatTeam(unit.team) || unit.type === 'hq' || unit.type === 'factory') return;
    const maxHp = maxHpFor(unit);
    if (unit.hp >= maxHp || unit.supplied === false) return;
    if (gameState.tick - (unit.lastCombatTick || 0) < FIELD_REPAIR_SAFE_TICKS) return;

    const nearbySupport = nearbyUnits(index, unit.x, unit.y, 5).some(other =>
      other.team === unit.team && ['hq', 'factory', 'fob', 'supply_truck', 'engineer'].includes(other.type)
    );
    if (!nearbySupport) return;

    const engineerBonus = nearbyUnits(index, unit.x, unit.y, 4).some(other => other.team === unit.team && other.type === 'engineer') ? 2 : 0;
    unit.hp = Math.min(maxHp, unit.hp + FIELD_REPAIR_AMOUNT + engineerBonus);
    if (unit.team === 'BLUE') blueRepairing++;
    else redRepairing++;
  });

  return { BLUE: blueRepairing, RED: redRepairing };
}

function pressureForFactory(unit: UnitState) {
  if (!isCombatTeam(unit.team) || !isMobileUnit(unit) || unit.type === 'supply_truck' || unit.type === 'recon') return 0;
  if (unit.supplied === false && unit.type !== 'marine') return 0.5;
  if (unit.type === 'marine') return 2;
  if (unit.type === 'infantry' || unit.type === 'engineer') return 1.4;
  if (unit.type === 'tank' || unit.type === 'ifv') return 1.1;
  return 0.8;
}

function processFactoryCapture(factory: UnitState, index: SpatialIndex) {
  const nearby = nearbyUnits(index, factory.x, factory.y, FACTORY_CAPTURE_RADIUS);
  const pressure: Record<Exclude<Team, 'NEUTRAL'>, number> = { BLUE: 0, RED: 0 };
  nearby.forEach(unit => {
    if (!isCombatTeam(unit.team) || unit.id === factory.id) return;
    pressure[unit.team] += pressureForFactory(unit);
  });

  const idx = Math.floor(factory.y) * MAP_WIDTH + Math.floor(factory.x);
  if (territory[idx] === 1) pressure.BLUE += 1;
  else if (territory[idx] === 2) pressure.RED += 1;

  const contender: Exclude<Team, 'NEUTRAL'> = pressure.BLUE >= pressure.RED ? 'BLUE' : 'RED';
  const defender = enemyOf(contender) as Exclude<Team, 'NEUTRAL'>;
  const advantage = pressure[contender] - pressure[defender];

  if (advantage > 0.2 && factory.team !== contender) {
    if (factory.captureTeam !== contender) {
      factory.captureTeam = contender;
      factory.captureProgress = 0;
    }
    factory.captureProgress = Math.min(FACTORY_CAPTURE_TICKS, (factory.captureProgress || 0) + advantage);
  } else if (factory.captureProgress) {
    factory.captureProgress = Math.max(0, factory.captureProgress - 1);
    if (factory.captureProgress === 0) factory.captureTeam = null;
  }

  if ((factory.captureProgress || 0) >= FACTORY_CAPTURE_TICKS && factory.captureTeam && factory.captureTeam !== 'NEUTRAL') {
    const captorTeam = factory.captureTeam;
    factory.team = captorTeam;
    factory.captureProgress = 0;
    factory.captureTeam = null;
    gameState.teams[captorTeam].supplies += FACTORY_CAPTURE_SUPPLY_BONUS;
    paintTerritoryRadius(captorTeam, factory.x, factory.y, 8, true);
    if (io) io.emit('error_msg', `${captorTeam} secured a factory (+${FACTORY_CAPTURE_SUPPLY_BONUS} SU)`);
    emitBattleEvent('objective', captorTeam, `${captorTeam} secured a factory (+${FACTORY_CAPTURE_SUPPLY_BONUS} SU)`, factory.x, factory.y, 4);
  }

  return (factory.captureProgress || 0) > 0 ? 1 : 0;
}

const gameState: GameStateData = {
  blocks: {},
  units: {},
  players: {},
  teams: {
    BLUE: { supplies: 1500, score: 0, stats: { kills: 0, deployed: 0, pixelsPainted: 0, factories: 0, frontline: 0 } },
    RED: { supplies: 1500, score: 0, stats: { kills: 0, deployed: 0, pixelsPainted: 0, factories: 0, frontline: 0 } },
    NEUTRAL: { supplies: 0, score: 0 }
  },
  tick: 0,
  winner: null,
  enableAiRed: false,
  enableAiBlue: false
};

const aiState: Record<Team, { influence: number, lastMove: number, doctrine: 'expand' | 'fortify' | 'breakthrough' | 'raid', lastDoctrineTick: number }> = {
    BLUE: { influence: 0, lastMove: Date.now(), doctrine: 'expand', lastDoctrineTick: 0 },
    RED: { influence: 0, lastMove: Date.now(), doctrine: 'expand', lastDoctrineTick: 0 },
    NEUTRAL: { influence: 0, lastMove: Date.now(), doctrine: 'expand', lastDoctrineTick: 0 }
};

function resetGame() {
  gameState.blocks = {};
  gameState.units = {};
  gameState.teams.BLUE.supplies = 1500;
  gameState.teams.BLUE.score = 0;
  gameState.teams.BLUE.stats = { kills: 0, deployed: 0, pixelsPainted: 0, factories: 0, frontline: 0 };
  gameState.teams.RED.supplies = 1500;
  gameState.teams.RED.score = 0;
  gameState.teams.RED.stats = { kills: 0, deployed: 0, pixelsPainted: 0, factories: 0, frontline: 0 };
  gameState.tick = 0;
  gameState.winner = null;
  gameState.enableAiRed = false;
  gameState.enableAiBlue = false;
  Object.values(gameState.players).forEach(p => p.influence = 50);
  
  aiState.RED.influence = 0;
  aiState.BLUE.influence = 0;
  aiState.RED.doctrine = 'expand';
  aiState.BLUE.doctrine = 'expand';
  aiState.RED.lastDoctrineTick = 0;
  aiState.BLUE.lastDoctrineTick = 0;
  
  territory.fill(0);
  territoryChanges = [];
  syncedUnitSignatures.clear();
  recentBattleEventTicks.clear();
  
  generateMap();
  recomputeSupplyNetworks();
  recomputeVisibility();
  
  if (io) {
    Object.keys(gameState.players).forEach(emitInitFor);
    territoryChanges = [];
  }
}

function generateMap() {
  const setTile = (x: number, y: number, type: BlockState['type']) => {
    if (!inBounds(x, y)) return;
    gameState.blocks[`${x},${y}`] = { type, ownerId: null, team: 'NEUTRAL' };
  };
  const setTerrain = (x: number, y: number, type: BlockState['type']) => {
    if (!inBounds(x, y)) return;
    const block = gameState.blocks[`${x},${y}`];
    if (block) block.type = type;
    else setTile(x, y, type);
  };
  const mirror = (x: number, y: number) => ({ x: MAP_WIDTH - 1 - x, y: MAP_HEIGHT - 1 - y });
  const setDisc = (cx: number, cy: number, radius: number, type: BlockState['type']) => {
    const radiusSq = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radiusSq) setTerrain(cx + dx, cy + dy, type);
      }
    }
  };
  const carveLine = (a: { x: number, y: number }, b: { x: number, y: number }, type: BlockState['type'], width = 0) => {
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.round(a.x + (b.x - a.x) * t);
      const y = Math.round(a.y + (b.y - a.y) * t);
      for (let dy = -width; dy <= width; dy++) {
        for (let dx = -width; dx <= width; dx++) {
          if (dx * dx + dy * dy <= width * width + 0.5) setTerrain(x + dx, y + dy, type);
        }
      }
    }
  };
  const carvePath = (points: { x: number, y: number }[], type: BlockState['type'], width = 0) => {
    for (let i = 1; i < points.length; i++) carveLine(points[i - 1], points[i], type, width);
  };
  const railYAt = (x: number) => Math.floor(MAP_HEIGHT * 0.47 + Math.sin(x / 13) * 5 + Math.cos(x / 31) * 3);

  for (let x = 0; x < MAP_WIDTH; x++) {
    for (let y = 0; y < MAP_HEIGHT; y++) {
      const m = mirror(x, y);
      if (y > m.y || (y === m.y && x > m.x)) continue;
      let type: BlockState['type'] = 'grass';
      const r = Math.random();
      if (r < 0.09) type = 'forest';
      else if (r < 0.13) type = 'mountain';
      else if (r < 0.17) type = 'swamp';
      else if (r < 0.19) type = 'urban';
      setTile(x, y, type);
      setTile(m.x, m.y, type);
    }
  }

  const riverPhase = Math.random() * Math.PI * 2;
  const riverPath: { x: number, y: number }[] = [];
  for (let x = 0; x < MAP_WIDTH; x += 3) {
    riverPath.push({
      x,
      y: Math.floor(MAP_HEIGHT * 0.5 + Math.sin(x / 16 + riverPhase) * 9 + Math.cos(x / 37) * 5)
    });
  }
  carvePath(riverPath, 'water', 2);

  const tributaryX = Math.floor(MAP_WIDTH * (0.33 + Math.random() * 0.14));
  const tributary: { x: number, y: number }[] = [];
  for (let y = 12; y < MAP_HEIGHT - 12; y += 3) {
    tributary.push({ x: Math.floor(tributaryX + Math.sin(y / 12 + riverPhase) * 7), y });
  }
  carvePath(tributary, 'water', 1);
  carvePath(tributary.map(p => mirror(p.x, p.y)).reverse(), 'water', 1);

  const ridgeA: { x: number, y: number }[] = [];
  for (let x = 0; x < MAP_WIDTH; x += 3) ridgeA.push({ x, y: Math.floor(MAP_HEIGHT * 0.68 + Math.sin(x / 10) * 7) });
  ridgeA.forEach(p => setDisc(p.x, p.y, Math.random() < 0.55 ? 2 : 1, 'mountain'));
  ridgeA.map(p => mirror(p.x, p.y)).forEach(p => setDisc(p.x, p.y, Math.random() < 0.55 ? 2 : 1, 'mountain'));

  const blueHqPos = { x: 10, y: 10 };
  const redHqPos = mirror(blueHqPos.x, blueHqPos.y);
  setDisc(blueHqPos.x, blueHqPos.y, 18, 'grass');
  setDisc(redHqPos.x, redHqPos.y, 18, 'grass');

  const railPath: { x: number, y: number }[] = [];
  for (let x = 4; x < MAP_WIDTH - 4; x += 3) railPath.push({ x, y: railYAt(x) });
  carvePath(railPath, 'rail', 0);

  carvePath([
    blueHqPos,
    { x: 38, y: 22 + Math.floor(Math.random() * 10) },
    { x: 76, y: railYAt(76) - 8 },
    { x: 102, y: 96 },
    { x: 130, y: railYAt(130) + 10 },
    redHqPos
  ], 'road', 0);
  carvePath([
    { x: 20, y: MAP_HEIGHT - 24 },
    { x: 46, y: 136 },
    { x: 78, y: railYAt(78) + 12 },
    { x: 120, y: railYAt(120) - 12 },
    { x: MAP_WIDTH - 24, y: 20 }
  ], 'road', 0);

  type FactorySpot = { x: number, y: number, radius: number };
  const factories: FactorySpot[] = [];
  const isFarEnough = (x: number, y: number) =>
    distance(x, y, blueHqPos.x, blueHqPos.y) >= 24 &&
    distance(x, y, redHqPos.x, redHqPos.y) >= 24 &&
    factories.every(f => distance(x, y, f.x, f.y) >= 11);
  const addFactoryPair = (x: number, y: number, radius: number) => {
    const p = { x: Math.round(x), y: Math.round(y), radius };
    const qRaw = mirror(p.x, p.y);
    const q = { x: qRaw.x, y: qRaw.y, radius };
    if (!isFarEnough(p.x, p.y) || !isFarEnough(q.x, q.y)) return false;
    factories.push(p, q);
    return true;
  };
  [
    { x: 31, y: 20 },
    { x: 20, y: 32 },
    { x: 42, y: 45 }
  ].forEach(p => addFactoryPair(p.x + Math.floor(Math.random() * 7) - 3, p.y + Math.floor(Math.random() * 7) - 3, 3));
  addFactoryPair(92, 83, 4);
  addFactoryPair(79, 105, 4);

  let attempts = 0;
  while (factories.length < 24 && attempts++ < 500) {
    const x = 20 + Math.floor(Math.random() * (MAP_WIDTH - 40));
    const y = 20 + Math.floor(Math.random() * (MAP_HEIGHT - 40));
    addFactoryPair(x, y, 2 + Math.floor(Math.random() * 3));
  }

  for (let i = 0; i < factories.length; i += 2) {
    const pair = factories.slice(i, i + 2);
    const keyTown = i < 8 || pair.some(f => f.radius >= 4);
    const linkedByRail = pair.some(f => Math.abs(f.y - railYAt(f.x)) <= 18);
    const localSpurOnly = !keyTown && !linkedByRail;
    const spurLength = 6 + Math.floor(Math.random() * 8);

    pair.forEach(f => {
      setDisc(f.x, f.y, f.radius, 'urban');
      const railY = railYAt(f.x);

      if (!localSpurOnly) {
        carveLine(f, { x: f.x, y: railY }, 'road', 0);
      } else {
        const railDir = Math.sign(railY - f.y) || 1;
        carveLine(f, {
          x: f.x,
          y: Math.max(2, Math.min(MAP_HEIGHT - 3, f.y + railDir * spurLength))
        }, 'road', 0);
      }

      setTerrain(f.x, f.y, 'urban');
    });
  }

  // Pre-spawn HQs
  const blueHq = spawnUnitInternal('hq', 'BLUE', 'SYSTEM', blueHqPos.x, blueHqPos.y);
  const redHq = spawnUnitInternal('hq', 'RED', 'SYSTEM', redHqPos.x, redHqPos.y);
  paintTerritoryRadius('BLUE', blueHq.x, blueHq.y, 15, true);
  paintTerritoryRadius('RED', redHq.x, redHq.y, 15, true);
  
  factories.forEach(f => spawnUnitInternal('factory', 'NEUTRAL', 'SYSTEM', f.x, f.y));
}

function spawnUnitInternal(unitClass: UnitClass, team: Team, ownerId: string, x: number, y: number) {
  const id = crypto.randomUUID();
  const stats = UNIT_STATS[unitClass];
  
  if (team !== 'NEUTRAL' && gameState.teams[team] && gameState.teams[team].stats) {
    gameState.teams[team].stats!.deployed++;
  }
  
  gameState.units[id] = {
    id,
    type: unitClass,
    team,
    ownerId,
    x,
    y,
    hp: stats.maxHp,
    suppressed: false,
    morale: MORALE_MAX,
    suppression: 0,
    lastAttackTick: 0,
    lastCombatTick: 0,
    lastMoveTick: 0,
    entrenchment: 0,
    combinedArms: 0,
    kills: 0,
    rank: 0
  };
  if (isCombatTeam(team)) {
    const claimRadius = unitClass === 'marine' ? 2 : unitClass === 'infantry' || unitClass === 'engineer' || unitClass === 'rocket' ? 1 : 0;
    if (claimRadius > 0) paintTerritoryRadius(team, x, y, claimRadius, unitClass === 'marine');
  }
  return gameState.units[id];
}

generateMap();
recomputeSupplyNetworks();
recomputeVisibility();

let io: Server;

function distance(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt(Math.pow(x2-x1,2) + Math.pow(y2-y1,2));
}

function isMobileUnit(u: UnitState) {
  return u.type !== 'hq' && u.type !== 'factory' && u.type !== 'fob' && u.type !== 'bunker';
}

function formationRank(type: UnitClass) {
  const ranks: Partial<Record<UnitClass, number>> = {
    recon: -3,
    tank: -2,
    ifv: -1,
    marine: -1,
    infantry: 0,
    rocket: 1,
    aa: 2,
    engineer: 3,
    supply_truck: 4,
    artillery: 5
  };
  return ranks[type] ?? 0;
}

function formationLane(type: UnitClass) {
  const rank = formationRank(type);
  if (rank <= -1) return -1;
  if (rank >= 3) return 2;
  if (rank >= 1) return 1;
  return 0;
}

function movementRangeFor(unit: UnitState, targetX: number, targetY: number) {
  const stats = UNIT_STATS[unit.type];
  let range = Math.max(2, Math.ceil((stats.speed || 1) * MOVE_RANGE_MULTIPLIER));
  const terrain = terrainAt(targetX, targetY);
  if (terrain === 'road' || terrain === 'rail') range += ROAD_MOVE_BONUS;
  if (terrain === 'forest' || terrain === 'swamp' || terrain === 'mountain') range = Math.max(1, range - ROUGH_MOVE_PENALTY);
  if (unit.suppressed && (unit.suppressedUntil || 0) > gameState.tick) range = Math.max(1, Math.floor(range * 0.6));
  return range;
}

function canUnitMoveTo(unit: UnitState, team: Team, targetX: number, targetY: number, occupied: Set<string>) {
  if (!inBounds(targetX, targetY) || terrainAt(targetX, targetY) === 'water') return false;

  const maxRange = movementRangeFor(unit, targetX, targetY);
  const dx = Math.abs(Math.floor(unit.x) - targetX);
  const dy = Math.abs(Math.floor(unit.y) - targetY);
  if (dx > maxRange || dy > maxRange) return false;

  const idx = targetY * MAP_WIDTH + targetX;
  const myTeamVal = territoryValueFor(team);
  if (!canOperateBeyondSupply(unit.type) && territory[idx] !== myTeamVal && !hasFriendlyTerritoryNear(team, targetX, targetY, 2)) return false;

  return !occupied.has(`${targetX},${targetY}`);
}

function moveUnitTo(unit: UnitState, x: number, y: number) {
  unit.targetX = x;
  unit.targetY = y;
  unit.x = x;
  unit.y = y;
  unit.lastMoveTick = gameState.tick;
  unit.entrenchment = 0;
  if (unit.type === 'infantry' || unit.type === 'engineer' || unit.type === 'rocket' || unit.type === 'marine') {
    paintTerritoryRadius(unit.team, x, y, unit.type === 'marine' ? 2 : 1, false);
  }
}

function findNearestFormationTile(unit: UnitState, team: Team, preferredX: number, preferredY: number, occupied: Set<string>, searchRadius = 8) {
  const candidates: { x: number, y: number, score: number }[] = [];

  for (let radius = 0; radius <= searchRadius; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const x = preferredX + dx;
        const y = preferredY + dy;
        if (!canUnitMoveTo(unit, team, x, y, occupied)) continue;
        const terrain = TERRAIN_STATS[terrainAt(x, y)];
        const roadBias = terrain?.name === 'Road' || terrain?.name === 'Rail' ? -0.75 : 0;
        candidates.push({ x, y, score: Math.abs(dx) + Math.abs(dy) + distance(unit.x, unit.y, x, y) * 0.12 + roadBias });
      }
    }
    if (candidates.length > 0) break;
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates[0] || null;
}

function issueFormationMove(p: PlayerState, ids: string[], targetX: number, targetY: number) {
  if (!inBounds(targetX, targetY)) return [];

  const selected = ids
    .map(id => gameState.units[id])
    .filter((u): u is UnitState => Boolean(u) && u.team === p.team && isMobileUnit(u));

  if (selected.length === 0) return [];

  const readyUnits = selected.filter(u => gameState.tick - u.lastMoveTick >= 4);
  if (readyUnits.length === 0) return [];

  const cx = readyUnits.reduce((sum, u) => sum + u.x, 0) / readyUnits.length;
  const cy = readyUnits.reduce((sum, u) => sum + u.y, 0) / readyUnits.length;
  let dirX = targetX - cx;
  let dirY = targetY - cy;
  const len = Math.hypot(dirX, dirY) || 1;
  dirX /= len;
  dirY /= len;
  const sideX = -dirY;
  const sideY = dirX;
  const groupRange = readyUnits.reduce((sum, u) => sum + movementRangeFor(u, targetX, targetY), 0) / readyUnits.length;
  const centerX = len > groupRange ? Math.round(cx + dirX * groupRange) : targetX;
  const centerY = len > groupRange ? Math.round(cy + dirY * groupRange) : targetY;
  const columns = Math.max(3, Math.min(12, Math.ceil(Math.sqrt(readyUnits.length) * 1.35)));

  const occupied = new Set<string>();
  Object.values(gameState.units).forEach(u => {
    if (!readyUnits.some(ru => ru.id === u.id)) occupied.add(`${Math.floor(u.x)},${Math.floor(u.y)}`);
  });

  readyUnits.sort((a, b) => {
    const laneDelta = formationLane(a.type) - formationLane(b.type);
    if (laneDelta !== 0) return laneDelta;
    const aForward = (a.x - cx) * dirX + (a.y - cy) * dirY;
    const bForward = (b.x - cx) * dirX + (b.y - cy) * dirY;
    const forwardDelta = bForward - aForward;
    if (Math.abs(forwardDelta) > 0.1) return forwardDelta;
    const aSide = (a.x - cx) * sideX + (a.y - cy) * sideY;
    const bSide = (b.x - cx) * sideX + (b.y - cy) * sideY;
    return aSide - bSide;
  });

  const moved: UnitState[] = [];
  const laneCounts = new Map<number, number>();
  readyUnits.forEach((unit, index) => {
    const lane = formationLane(unit.type);
    const laneIndex = laneCounts.get(lane) || 0;
    laneCounts.set(lane, laneIndex + 1);

    const laneDepth = lane === -1 ? -1 : lane;
    const row = Math.floor(laneIndex / columns);
    const col = laneIndex % columns;
    const centeredCol = col - (Math.min(columns, readyUnits.length) - 1) / 2;
    const stagger = row % 2 === 0 ? 0 : FORMATION_SPACING * 0.35;
    const sideOffset = centeredCol * FORMATION_SPACING + stagger;
    const backOffset = Math.max(0, row * FORMATION_SPACING + laneDepth * FORMATION_SPACING * 1.35);
    const frontOffset = lane === -1 ? FORMATION_SPACING * 1.5 : 0;
    const preferredX = Math.round(centerX + sideX * sideOffset - dirX * backOffset + dirX * frontOffset);
    const preferredY = Math.round(centerY + sideY * sideOffset - dirY * backOffset + dirY * frontOffset);
    const tile = findNearestFormationTile(unit, p.team, preferredX, preferredY, occupied, 10);
    if (!tile) return;

    occupied.add(`${tile.x},${tile.y}`);
    moveUnitTo(unit, tile.x, tile.y);
    moved.push(unit);
  });

  return moved;
}

function neutralFactoriesAhead(_team: Team) {
  return Object.values(gameState.units).filter(u => u.team === 'NEUTRAL' && u.type === 'factory');
}

function closestUnit(units: UnitState[], x: number, y: number) {
  let best: UnitState | null = null;
  let bestDistance = Infinity;
  units.forEach(unit => {
    const d = distance(x, y, unit.x, unit.y);
    if (d < bestDistance) {
      best = unit;
      bestDistance = d;
    }
  });
  return best;
}

function aiDeployUnit(team: Team, type: UnitClass, x: number, y: number) {
  if (!isCombatTeam(team)) return null;
  const stats = UNIT_STATS[type];
  if (!stats || gameState.teams[team].supplies < stats.cost || ['hq', 'factory', 'fob', 'bunker'].includes(type)) return null;
  if (!findProductionStructure(team, Math.floor(x), Math.floor(y), type)) return null;
  const tile = findDeploymentTile(team, type, Math.floor(x), Math.floor(y));
  if (!tile) return null;

  gameState.teams[team].supplies -= stats.cost;
  const unit = spawnUnitInternal(type, team, 'AI_COMMANDER', tile.x, tile.y);
  if (tile.x !== Math.floor(x) || tile.y !== Math.floor(y)) {
    setUnitOrder(unit, 'attack_move', Math.floor(x), Math.floor(y));
  }
  emitUnitSpawned(unit);
  return unit;
}

function aiConvertEngineer(team: Team, engineer: UnitState, type: 'fob' | 'bunker') {
  if (!isCombatTeam(team) || engineer.team !== team || engineer.type !== 'engineer') return null;
  const cost = type === 'fob' ? FOB_COST : BUNKER_COST;
  const radius = type === 'fob' ? 3 : 2;
  if (gameState.teams[team].supplies < cost || !hasFriendlyTerritoryNear(team, Math.floor(engineer.x), Math.floor(engineer.y), radius)) return null;

  gameState.teams[team].supplies -= cost;
  delete gameState.units[engineer.id];
  emitUnitsRemoved([engineer.id]);
  const structure = spawnUnitInternal(type, team, 'AI_COMMANDER', engineer.x, engineer.y);
  paintTerritoryRadius(team, structure.x, structure.y, type === 'fob' ? 9 : 4, true);
  emitUnitSpawned(structure);
  emitBattleEvent('objective', team, `${team} AI built ${unitName(structure)} at ${Math.round(structure.x)}:${Math.round(structure.y)}`, structure.x, structure.y, 2);
  return structure;
}

function aiImproveTerrain(team: Team, engineer: UnitState, type: 'trench' | 'road') {
  if (!isCombatTeam(team) || engineer.team !== team || engineer.type !== 'engineer') return false;
  const tx = Math.floor(engineer.x);
  const ty = Math.floor(engineer.y);
  const tile = gameState.blocks[`${tx},${ty}`];
  if (!tile || tile.type === 'water' || tile.type === type || !hasFriendlyTerritoryNear(team, tx, ty, 2)) return false;
  const cost = type === 'trench' ? TRENCH_COST : ROADWORK_COST;
  if (gameState.teams[team].supplies < cost) return false;
  gameState.teams[team].supplies -= cost;
  tile.type = type;
  if (io) io.emit('terrain_patch', { x: tx, y: ty, type });
  return true;
}

function processAiCommander(team: Team) {
  if (team === 'RED' && !gameState.enableAiRed) return;
  if (team === 'BLUE' && !gameState.enableAiBlue) return;
  
  const teamData = gameState.teams[team];
  const enemyTeam = team === 'RED' ? 'BLUE' : 'RED';
  const myTeamVal = team === 'BLUE' ? 1 : 2;
  
  const allUnits = Object.values(gameState.units);
  const myUnits = allUnits.filter(u => u.team === team);
  const myMobileUnits = myUnits.filter(isMobileUnit);
  const enemyUnits = allUnits.filter(u => u.team === enemyTeam);
  const visibleEnemies = enemyUnits.filter(u => canTeamSeeUnit(team, u));
  const myEngineers = myUnits.filter(u => u.type === 'engineer');
  const myFobs = myUnits.filter(u => u.type === 'fob');
  const myBunkers = myUnits.filter(u => u.type === 'bunker');
  const mySupplyTrucks = myUnits.filter(u => u.type === 'supply_truck');
  const suppressedUnits = myMobileUnits.filter(u => u.suppressed || (u.morale ?? 100) < 35);
  let myFactoryCount = 1;
  allUnits.forEach(u => {
      if (u.team === team && u.type === 'factory') myFactoryCount++;
  });

  if (gameState.tick - aiState[team].lastDoctrineTick > AI_DOCTRINE_INTERVAL_TICKS) {
      if (myFactoryCount < 3 && neutralFactoriesAhead(team).length > 0) aiState[team].doctrine = 'expand';
      else if (visibleEnemies.length > myMobileUnits.length * 0.75 || suppressedUnits.length > myMobileUnits.length * 0.25) aiState[team].doctrine = 'fortify';
      else if (mySupplyTrucks.length < myFactoryCount + myFobs.length) aiState[team].doctrine = 'raid';
      else aiState[team].doctrine = 'breakthrough';
      aiState[team].lastDoctrineTick = gameState.tick;
  }
  
  // AI budget
  aiState[team].influence += (12 * (TICK_RATE_MS / 1000)) * Math.max(1, (myFactoryCount / 3));
  if (aiState[team].influence > 100) aiState[team].influence = 100;
  
  // Find all internal territory tiles & border tiles
  const borderTiles: {x: number, y: number}[] = [];
  const internalTiles: {x: number, y: number}[] = [];
  const stride = MAP_WIDTH;
  
  for (let i = 0; i < territory.length; i++) {
        const x = i % MAP_WIDTH;
        const y = Math.floor(i / MAP_WIDTH);
        if (territory[i] === myTeamVal) {
            let hasExternalNeighbor = false;
            // Check neighbors boundary
            if (x > 0 && territory[i - 1] !== myTeamVal) hasExternalNeighbor = true;
            if (x < MAP_WIDTH-1 && territory[i + 1] !== myTeamVal) hasExternalNeighbor = true;
            if (y > 0 && territory[i - stride] !== myTeamVal) hasExternalNeighbor = true;
            if (y < MAP_HEIGHT-1 && territory[i + stride] !== myTeamVal) hasExternalNeighbor = true;
            
            if (hasExternalNeighbor) borderTiles.push({x, y});
            else internalTiles.push({x, y});
        }
  }

  // Find enemy objectives
  let enemyHq = allUnits.find(u => u.team === enemyTeam && u.type === 'hq');
  let targetX = enemyHq ? enemyHq.x : MAP_WIDTH / 2;
  let targetY = enemyHq ? enemyHq.y : MAP_HEIGHT / 2;
  
  let neutralFactories = allUnits.filter(u => u.team === 'NEUTRAL' && u.type === 'factory');

  if (borderTiles.length > 0) {
      const objectives = [...neutralFactories, ...allUnits.filter(u => u.team === enemyTeam)];
      if (objectives.length > 0) {
          let minDist = Infinity;
          for (let i = 0; i < Math.min(40, borderTiles.length); i++) {
              const b = borderTiles[Math.floor(Math.random() * borderTiles.length)];
              for (const obj of objectives) {
                  const d = distance(b.x, b.y, obj.x, obj.y);
                  if (d < minDist) {
                      minDist = d;
                      targetX = obj.x;
                      targetY = obj.y;
                  }
              }
          }
      }
  }

  const frontlineTile = borderTiles.length > 0
    ? borderTiles[Math.floor(Math.random() * borderTiles.length)]
    : internalTiles.length > 0 ? internalTiles[Math.floor(Math.random() * internalTiles.length)] : null;
  const visibleThreat = closestUnit(visibleEnemies, targetX, targetY);
  const frontlineEngineer = frontlineTile ? closestUnit(myEngineers, frontlineTile.x, frontlineTile.y) : null;
  if (frontlineEngineer && teamData.supplies >= ROADWORK_COST) {
      const nearEnemy = visibleThreat ? distance(frontlineEngineer.x, frontlineEngineer.y, visibleThreat.x, visibleThreat.y) <= 12 : false;
      const wantsFob = myFobs.length < Math.max(1, Math.floor(myFactoryCount / 2)) && teamData.supplies >= FOB_COST + 70;
      const wantsBunker = nearEnemy && myBunkers.length < myFactoryCount + 2 && teamData.supplies >= BUNKER_COST + 45;
      if (wantsFob && Math.random() < 0.08) aiConvertEngineer(team, frontlineEngineer, 'fob');
      else if (wantsBunker && Math.random() < 0.15) aiConvertEngineer(team, frontlineEngineer, 'bunker');
      else if (nearEnemy && Math.random() < 0.2) aiImproveTerrain(team, frontlineEngineer, 'trench');
      else if (!nearEnemy && Math.random() < 0.12) aiImproveTerrain(team, frontlineEngineer, 'road');
  }

  if (aiState[team].influence >= 5 && (borderTiles.length > 0 || internalTiles.length > 0)) {
      // Pick a unit to build
      const buildable: UnitClass[] = aiState[team].doctrine === 'fortify'
        ? ['infantry', 'rocket', 'engineer', 'aa', 'artillery', 'supply_truck']
        : aiState[team].doctrine === 'raid'
          ? ['recon', 'recon', 'marine', 'supply_truck', 'ifv', 'infantry']
          : aiState[team].doctrine === 'breakthrough'
            ? ['tank', 'tank', 'ifv', 'rocket', 'marine', 'artillery', 'supply_truck']
            : ['infantry', 'infantry', 'marine', 'rocket', 'engineer', 'ifv', 'aa', 'tank', 'artillery', 'recon', 'supply_truck'];
      // Increase odds of supply truck if we have few to expand borders faster
      const mySupplyTrucks = allUnits.filter(u => u.team === team && u.type === 'supply_truck').length;
      if (mySupplyTrucks < myFactoryCount * 2) {
          buildable.push('supply_truck', 'supply_truck', 'supply_truck');
      }
      if (myEngineers.length < 2 && teamData.supplies >= UNIT_STATS.engineer.cost + FOB_COST) {
          buildable.push('engineer', 'engineer');
      }
      if (visibleEnemies.some(u => u.type === 'tank' || u.type === 'ifv')) {
          buildable.push('rocket', 'tank');
      }
      if (suppressedUnits.length > 2 || visibleEnemies.length > 5) {
          buildable.push('artillery', 'aa', 'supply_truck');
      }
      
      const type = buildable[Math.floor(Math.random() * buildable.length)];
      const cost = UNIT_STATS[type].cost;
      
      if (teamData.supplies >= cost + 10) { // Buffer
          let sp: {x: number, y: number} | null = null;
          
          if (type === 'recon') {
             // Spawn recon outside borders towards neutral factories or enemy
             if (borderTiles.length > 0) {
                 let bestBorder = borderTiles[Math.floor(Math.random() * borderTiles.length)];
                 let minDist = Infinity;
                 const objectives = [...neutralFactories, ...allUnits.filter(u => u.team === enemyTeam)];
                 if (objectives.length > 0) {
                     for (let b of borderTiles) {
                         for (let obj of objectives) {
                             const d = distance(b.x, b.y, obj.x, obj.y);
                             if (d < minDist) { minDist = d; bestBorder = b; targetX = obj.x; targetY = obj.y; }
                         }
                     }
                 }
                 // Recon will be placed 10 tiles away towards target
                 const dx = targetX - bestBorder.x;
                 const dy = targetY - bestBorder.y;
                 const d = Math.sqrt(dx*dx + dy*dy);
                 if (d > 0) {
                     let placeDx = Math.round((dx / d) * 8);
                     let placeDy = Math.round((dy / d) * 8);
                     sp = { x: Math.max(0, Math.min(MAP_WIDTH-1, bestBorder.x + placeDx)), 
                            y: Math.max(0, Math.min(MAP_HEIGHT-1, bestBorder.y + placeDy)) };
                 }
             }
          }
          
          if (!sp) {
              // Priority placement near enemy units for tanks and infantry
              if (borderTiles.length > 0) {
                  let bestBorder = borderTiles[0];
                  let minDist = Infinity;
                  // Find nearest enemy unit to any border tile
                  const enemies = allUnits.filter(u => u.team === enemyTeam);
                  if (enemies.length > 0) {
                      // Only check a random subset of borders for performance
                      const sampleBorders = [];
                      for (let i = 0; i < Math.min(20, borderTiles.length); i++) {
                         sampleBorders.push(borderTiles[Math.floor(Math.random() * borderTiles.length)]);
                      }
                      for (let b of sampleBorders) {
                          for (let e of enemies) {
                              const d = distance(b.x, b.y, e.x, e.y);
                              if (d < minDist) { minDist = d; bestBorder = b; }
                          }
                      }
                      sp = bestBorder;
                  } else {
                      sp = borderTiles[Math.floor(Math.random() * borderTiles.length)];
                  }
                  
                  // Add some spread
                  if (sp) {
                      sp.x += Math.floor(Math.random() * 5) - 2;
                      sp.y += Math.floor(Math.random() * 5) - 2;
                      sp.x = Math.max(0, Math.min(MAP_WIDTH-1, sp.x));
                      sp.y = Math.max(0, Math.min(MAP_HEIGHT-1, sp.y));
                  }
              }
          }
          
          // Ensure it's in territory, with expeditionary exceptions for scouts and marine landings.
          if (sp) {
             let validSpawn = false;
             if (type === 'marine') {
                 validSpawn = canMarineDeployAt(team, sp.x, sp.y);
             } else if (type === 'recon') {
                 // Check if near territory
                 for (let dy = -10; dy <= 10; dy++) {
                     for (let dx = -10; dx <= 10; dx++) {
                         const ntx = sp.x + dx; const nty = sp.y + dy;
                         if (ntx >= 0 && nty >= 0 && ntx < MAP_WIDTH && nty < MAP_HEIGHT) {
                             if (territory[nty * MAP_WIDTH + ntx] === myTeamVal) { validSpawn = true; break; }
                         }
                     }
                     if (validSpawn) break;
                 }
             } else {
                 if (territory[sp.y * MAP_WIDTH + sp.x] === myTeamVal) validSpawn = true;
             }
             
             if (!validSpawn) {
                 // Fallback to a guaranteed internal tile
                 if (internalTiles.length > 0) sp = internalTiles[Math.floor(Math.random() * internalTiles.length)];
                 else if (borderTiles.length > 0) sp = borderTiles[Math.floor(Math.random() * borderTiles.length)];
             }
             
             if (sp && aiDeployUnit(team, type, sp.x, sp.y)) {
                 aiState[team].influence = Math.max(0, aiState[team].influence - 12);
             }
          }
      }
  // AI movement for tactical maneuvering
  if (aiState[team].influence >= 3) {
      if (Math.random() < 0.2) { // Occasionally
          const myUnits = allUnits.filter(u => u.team === team && u.type !== 'hq' && u.type !== 'factory' && u.type !== 'fob' && u.type !== 'bunker');
          
          let movedCount = 0;
          const movedUnits: UnitState[] = [];
          const strikeGroup = myUnits
              .filter(u => u.type !== 'supply_truck' && !u.suppressed && (u.morale ?? 100) >= 35)
              .sort((a, b) => distance(a.x, a.y, targetX, targetY) - distance(b.x, b.y, targetX, targetY))
              .slice(0, aiState[team].doctrine === 'breakthrough' ? 24 : 14);
          if (strikeGroup.length >= 3 && Math.random() < 0.45) {
              const aiPlayer: PlayerState = { id: 'AI_COMMANDER', team, influence: 100 };
              issueFormationMove(aiPlayer, strikeGroup.map(u => u.id), Math.floor(targetX), Math.floor(targetY)).forEach(unit => {
                  setUnitOrder(unit, 'attack_move', Math.floor(targetX), Math.floor(targetY));
                  movedUnits.push(unit);
                  movedCount++;
              });
          }
          for (let u of myUnits) {
              if (movedCount > 5) break; // Limit moves per tick
              if (Math.random() > 0.3 && !u.suppressed && (u.morale ?? 100) >= 35) continue;
              
              let tx = Math.floor(u.x);
              let ty = Math.floor(u.y);
              
              // Objective: Enemy HQ, Nearest Enemy, or Nearest Factory
              let targetObjX = targetX;
              let targetObjY = targetY;
              if (u.suppressed || (u.morale ?? 100) < 35) {
                  const refuge = closestUnit(myUnits.filter(other => ['supply_truck', 'fob', 'factory', 'hq', 'bunker'].includes(other.type)), u.x, u.y);
                  if (refuge) {
                      targetObjX = refuge.x;
                      targetObjY = refuge.y;
                      setUnitOrder(u, 'retreat', Math.floor(refuge.x), Math.floor(refuge.y));
                  }
              }
              
              if (u.type === 'recon' && neutralFactories.length > 0) {
                  let nearestF = neutralFactories[0];
                  let minDist = Infinity;
                  for (let f of neutralFactories) {
                      const d = distance(u.x, u.y, f.x, f.y);
                      if (d < minDist) { minDist = d; nearestF = f; }
                  }
                  targetObjX = nearestF.x;
                  targetObjY = nearestF.y;
              }
              
              let dx = targetObjX - tx;
              let dy = targetObjY - ty;
              
              let nx = tx + (dx > 0 ? 1 : (dx < 0 ? -1 : 0));
              let ny = ty + (dy > 0 ? 1 : (dy < 0 ? -1 : 0));
              
              let tryNext = [{x: nx, y: ny}, {x: tx, y: ny}, {x: nx, y: ty}];
              
              for (const pos of tryNext) {
                  if (pos.x === tx && pos.y === ty) continue;
                  if (pos.x >= 0 && pos.x < MAP_WIDTH && pos.y >= 0 && pos.y < MAP_HEIGHT) {
                      const idx = pos.y * MAP_WIDTH + pos.x;
                let canMove = canOperateBeyondSupply(u.type) || territory[idx] === myTeamVal;
                      
                      if (canMove) {
                          let occupied = false;
                          allUnits.forEach(ou => {
                              if (Math.floor(ou.x) === pos.x && Math.floor(ou.y) === pos.y) occupied = true;
                          });
                          if (!occupied) {
                              const moved = stepUnitToward(u, pos.x, pos.y);
                              if (moved) {
                                  if (!u.order) setUnitOrder(u, 'attack_move', Math.floor(targetObjX), Math.floor(targetObjY));
                                  movedUnits.push(u);
                                  movedCount++;
                              }
                              break;
                          }
                      }
                  }
              }
          }
          if (movedCount > 0) {
              emitUnitsUpdated(movedUnits);
              aiState[team].influence -= 3;
          }
      }
  }
}
}

function gameLoop() {
  if (gameState.winner) return;

  gameState.tick++;

  Object.values(gameState.players).forEach(p => {
     p.influence = Math.min(100, p.influence + (15 * (TICK_RATE_MS / 1000)));
  });

  Object.values(gameState.units).forEach(u => {
     if (u.suppressedUntil !== undefined && u.suppressedUntil <= gameState.tick) {
        u.suppressed = false;
        u.suppressedUntil = undefined;
     }
     const inRecentCombat = gameState.tick - (u.lastCombatTick || 0) < SUPPRESSION_TICKS;
     if (!inRecentCombat) {
       u.morale = Math.min(MORALE_MAX, (u.morale ?? MORALE_MAX) + MORALE_RECOVERY_PER_TICK);
       u.suppression = Math.max(0, (u.suppression || 0) - SUPPRESSION_DECAY_PER_TICK);
       if (u.suppression <= 0 && u.morale >= 45 && !u.suppressedUntil) {
         u.suppressed = false;
       }
     }
  });

  refreshLogisticsTerritory();
  recomputeSupplyNetworks();
  recomputeVisibility();
  processUnitOrders();
  const spatialIndex = buildSpatialIndex();
  recomputeCombinedArms(spatialIndex);
  processEntrenchment();
  const repairingUnits = processFieldRepairs(spatialIndex);

  // 1. Economy & Factory Capture
  let blueFactories = 0;
  let redFactories = 0;
  let contestedFactories = 0;

  Object.values(gameState.units).forEach(u => {
    if (u.type === 'factory') {
      contestedFactories += processFactoryCapture(u, spatialIndex);

      if (u.team === 'BLUE') blueFactories++;
      else if (u.team === 'RED') redFactories++;
    }
  });

  if (gameState.teams.BLUE.stats) gameState.teams.BLUE.stats.factories = blueFactories;
  if (gameState.teams.RED.stats) gameState.teams.RED.stats.factories = redFactories;

  gameState.teams['BLUE'].supplies += blueFactories * FACTORY_INCOME;
  gameState.teams['RED'].supplies += redFactories * FACTORY_INCOME;

  // 2. Movement has been removed. Units only move when manually directed or teleported.

  // 3. Combat
  const toDelete: string[] = [];
  Object.values(gameState.units).forEach(u => {
    if (u.type === 'factory' || u.type === 'hq' || u.type === 'supply_truck' || u.type === 'fob') return; 

    const stats = UNIT_STATS[u.type];
    // Every unit attacks roughly once per second (ticksPerSec = 5)
    const ticksPerSec = 1000 / TICK_RATE_MS;
    if (gameState.tick - u.lastAttackTick >= (ticksPerSec * 1.5)) { 
      let target: UnitState | null = null;
      let minDist = stats.range + 1;

      nearbyUnits(spatialIndex, u.x, u.y, stats.range + 1).forEach(other => {
        if (other.team !== u.team && other.team !== 'NEUTRAL') {
          if (!canTeamSeeUnit(u.team, other)) return;
          const d = distance(u.x, u.y, other.x, other.y);
          if (d <= stats.range && d < minDist) {
            minDist = d;
            target = other;
          }
        }
      });

      if (target) {
        let dmg = stats.damage * damageMultiplier(u, target) * combinedArmsDamageMultiplier(u) * (1 + (u.rank || 0) * 0.2); // +20% damage per rank
        dmg = Math.max(1, Math.floor(dmg * supplyCombatMultiplier(u)));
        if (u.suppressed && (u.suppressedUntil || 0) > gameState.tick) {
           dmg = Math.max(1, Math.floor(dmg * SUPPRESSED_DAMAGE_MULTIPLIER));
        }

        const wasSuppressed = Boolean(target.suppressed && (target.suppressedUntil || 0) > gameState.tick);
        target.hp -= dmg;
        u.lastCombatTick = gameState.tick;
        target.lastCombatTick = gameState.tick;
        const supportShock = u.type === 'artillery' || u.type === 'rocket' || u.type === 'aa' || u.type === 'bunker';
        const moraleDamage = Math.max(3, dmg * SUPPRESSION_DAMAGE_FACTOR);
        target.morale = Math.max(0, (target.morale ?? MORALE_MAX) - moraleDamage);
        target.suppression = Math.min(100, (target.suppression || 0) + moraleDamage + (supportShock ? SUPPORT_SUPPRESSION_BONUS : 0));
        if (supportShock || (target.suppression || 0) >= SUPPRESSION_THRESHOLD || (target.morale || 0) <= 30) {
           target.suppressed = true;
           target.suppressedUntil = gameState.tick + SUPPRESSION_TICKS;
        }
        u.lastAttackTick = gameState.tick;
        if (io) io.emit('combat_hit', { fromX: u.x, fromY: u.y, toX: target.x, toY: target.y, team: u.team });
        const sectorKey = `${Math.floor(target.x / 12)},${Math.floor(target.y / 12)}`;
        if (target.type === 'hq' || target.type === 'factory' || target.type === 'fob') {
          emitThrottledBattleEvent(`under_attack:${target.id}`, 20, 'under_attack', target.team, `${target.team} ${unitName(target)} under attack at ${Math.round(target.x)}:${Math.round(target.y)}`, target.x, target.y, 3);
        } else {
          emitThrottledBattleEvent(`contact:${u.team}:${sectorKey}`, 28, 'contact', u.team, `${u.team} units engaging near ${Math.round(target.x)}:${Math.round(target.y)}`, target.x, target.y, 1);
        }
        if (!wasSuppressed && target.suppressed) {
          emitBattleEvent('suppressed', target.team, `${target.team} ${unitName(target)} suppressed near ${Math.round(target.x)}:${Math.round(target.y)}`, target.x, target.y, 2);
        }

        if (target.hp <= 0 && !toDelete.includes(target.id)) {
           toDelete.push(target.id);
           emitBattleEvent('destroyed', target.team, `${target.team} ${unitName(target)} destroyed at ${Math.round(target.x)}:${Math.round(target.y)}`, target.x, target.y, target.type === 'hq' ? 5 : 3);
           
           if (target.type === 'hq' && target.team === 'RED') {
               gameState.winner = 'BLUE';
           } else if (target.type === 'hq' && target.team === 'BLUE') {
               gameState.winner = 'RED';
           }

           if (gameState.teams[u.team].stats) gameState.teams[u.team].stats!.kills++;
           
           if (!u.kills) u.kills = 0;
           u.kills++;
           if (!u.rank) u.rank = 0;
           if (u.rank < 3 && u.kills >= (u.rank + 1) * 3) {
               u.rank++;
               const maxHp = maxHpFor(u);
               u.hp = maxHp; // heal fully on rank up!
               emitBattleEvent('rank_up', u.team, `${u.team} ${unitName(u)} promoted after ${u.kills} kills`, u.x, u.y, 2);
           }
           
           gameState.teams[u.team].score += UNIT_STATS[target.type].cost;
           const ownerPl = gameState.players[u.ownerId];
           if (ownerPl) {
              ownerPl.influence += UNIT_STATS[target.type].cost;
           }
           
           // Natural creeping progress - killer takes over the dead unit's square!
           paintTerritoryRadius(u.team, Math.floor(target.x), Math.floor(target.y), u.type === 'infantry' ? 2 : 1, true);
           if (u.type === 'infantry') {
               u.x = Math.floor(target.x);
               u.y = Math.floor(target.y);
           }
        }
      }
    }
  });

  // Clean up dead
  toDelete.forEach(id => {
    delete gameState.units[id];
  });
  emitUnitsRemoved(toDelete);

  refreshLogisticsTerritory();
  recomputeSupplyNetworks();
  recomputeVisibility();
  let bluePixels = 0;
  let redPixels = 0;
  let blueFrontline = 0;
  let redFrontline = 0;

  for (let i = 0; i < territory.length; i++) {
      const val = territory[i];
      if (val === 1) bluePixels++;
      else if (val === 2) redPixels++;

      if (val !== 0) {
          const x = i % MAP_WIDTH;
          const y = Math.floor(i / MAP_WIDTH);
          const touchesOther =
            (x > 0 && territory[i - 1] !== val) ||
            (x < MAP_WIDTH - 1 && territory[i + 1] !== val) ||
            (y > 0 && territory[i - MAP_WIDTH] !== val) ||
            (y < MAP_HEIGHT - 1 && territory[i + MAP_WIDTH] !== val);
          if (touchesOther && val === 1) blueFrontline++;
          else if (touchesOther && val === 2) redFrontline++;
      }
  }

  if (gameState.teams.BLUE.stats) gameState.teams.BLUE.stats.frontline = blueFrontline;
  if (gameState.teams.RED.stats) gameState.teams.RED.stats.frontline = redFrontline;
  if (gameState.teams.BLUE.stats) {
    gameState.teams.BLUE.stats.suppliedUnits = suppliedUnitIds.BLUE.size;
    gameState.teams.BLUE.stats.spottedEnemies = Object.values(gameState.units).filter(u => u.team === 'RED' && canTeamSeeUnit('BLUE', u)).length;
    gameState.teams.BLUE.stats.activePlayers = Object.values(gameState.players).filter(p => p.team === 'BLUE').length;
    gameState.teams.BLUE.stats.queueSize = 0;
    gameState.teams.BLUE.stats.combinedArmsUnits = Object.values(gameState.units).filter(u => u.team === 'BLUE' && (u.combinedArms || 0) > 0).length;
    gameState.teams.BLUE.stats.entrenchedUnits = Object.values(gameState.units).filter(u => u.team === 'BLUE' && (u.entrenchment || 0) >= 1).length;
    gameState.teams.BLUE.stats.repairingUnits = repairingUnits.BLUE;
    gameState.teams.BLUE.stats.contestedFactories = contestedFactories;
  }
  if (gameState.teams.RED.stats) {
    gameState.teams.RED.stats.suppliedUnits = suppliedUnitIds.RED.size;
    gameState.teams.RED.stats.spottedEnemies = Object.values(gameState.units).filter(u => u.team === 'BLUE' && canTeamSeeUnit('RED', u)).length;
    gameState.teams.RED.stats.activePlayers = Object.values(gameState.players).filter(p => p.team === 'RED').length;
    gameState.teams.RED.stats.queueSize = 0;
    gameState.teams.RED.stats.combinedArmsUnits = Object.values(gameState.units).filter(u => u.team === 'RED' && (u.combinedArms || 0) > 0).length;
    gameState.teams.RED.stats.entrenchedUnits = Object.values(gameState.units).filter(u => u.team === 'RED' && (u.entrenchment || 0) >= 1).length;
    gameState.teams.RED.stats.repairingUnits = repairingUnits.RED;
    gameState.teams.RED.stats.contestedFactories = contestedFactories;
  }
  gameState.teams.BLUE.score = bluePixels;
  gameState.teams.RED.score = redPixels;

  // Process AI
  processAiCommander('RED');
  processAiCommander('BLUE');

  if (io) {
     emitStateDelta();
     
     if (territoryChanges.length > 0) {
         io.emit('territory_diff', territoryChanges);
         territoryChanges = [];
     }
  }
}

setInterval(gameLoop, TICK_RATE_MS);

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  io = new Server(httpServer, {
    cors: { origin: '*' }
  });

  app.get('/api/state', (req, res) => {
    res.json(gameState);
  });

  const spawnCooldowns: Record<string, number> = {};

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    
    // Assign team based on current counts
    let blueCount = 0; let redCount = 0;
    Object.values(gameState.players).forEach(p => p.team === 'BLUE' ? blueCount++ : redCount++);
    const team: Team = blueCount > redCount ? 'RED' : 'BLUE';
    const isHost = Object.keys(gameState.players).length === 0;
    
    gameState.players[socket.id] = { id: socket.id, team, influence: 50, isHost };
    emitInitFor(socket.id);

    socket.on('reset_game', () => {
       Object.keys(spawnCooldowns).forEach(id => delete spawnCooldowns[id]);
       resetGame();
    });

    socket.on('toggle_ai', (teamStr: string) => {
      if (teamStr === 'RED') {
          gameState.enableAiRed = !gameState.enableAiRed;
          io.emit('error_msg', gameState.enableAiRed ? 'AI Red Enabled' : 'AI Red Disabled');
      } else if (teamStr === 'BLUE') {
          gameState.enableAiBlue = !gameState.enableAiBlue;
          io.emit('error_msg', gameState.enableAiBlue ? 'AI Blue Enabled' : 'AI Blue Disabled');
      }
    });

    socket.on('spawn_unit', (data: { type: UnitClass, x: number, y: number }) => {
      const p = gameState.players[socket.id];
      if (!p) return;

      const rejectSpawn = (message: string, cooldownEnd?: number) => {
        if (cooldownEnd) socket.emit('spawn_cooldown', cooldownEnd);
        socket.emit('spawn_result', { ok: false, message, cooldownEnd });
      };
      
      const now = Date.now();
      if (spawnCooldowns[socket.id] && now < spawnCooldowns[socket.id]) {
          rejectSpawn('Spawn on cooldown', spawnCooldowns[socket.id]);
          return;
      }

      const teamData = gameState.teams[p.team];
      const stats = UNIT_STATS[data.type];
      if (!stats || data.type === 'hq' || data.type === 'factory' || data.type === 'fob' || data.type === 'bunker') {
          rejectSpawn('That unit cannot be built from the quartermaster.');
          return;
      }

      if (teamData.supplies < stats.cost) {
        rejectSpawn(`Need ${Math.ceil(stats.cost - teamData.supplies)} more SU.`);
        return;
      }

      const tx = Math.floor(data.x);
      const ty = Math.floor(data.y);

      if (!inBounds(tx, ty)) {
        rejectSpawn('Deployment point is outside the operation map.');
        return;
      }

      const structure = findProductionStructure(p.team, tx, ty, data.type);
      if (!structure) {
        rejectSpawn('No HQ, factory, or FOB can deploy that unit type.');
        return;
      }

      const deploymentTile = findDeploymentTile(p.team, data.type, tx, ty);
      if (!deploymentTile) {
        rejectSpawn(data.type === 'marine'
          ? 'No safe landing zone near that point.'
          : 'Deploy on or near held ground, supply links, or logistics.');
        return;
      }

      teamData.supplies -= stats.cost;
      const unit = spawnUnitInternal(data.type, p.team, socket.id, deploymentTile.x, deploymentTile.y);
      if (deploymentTile.x !== tx || deploymentTile.y !== ty) {
        unit.order = { type: 'attack_move', x: tx, y: ty };
        unit.targetX = tx;
        unit.targetY = ty;
      }

      recomputeSupplyNetworks();
      recomputeVisibility();
      const cooldownMs = deploymentCooldownMs(p.team);
      spawnCooldowns[socket.id] = now + cooldownMs;
      socket.emit('spawn_cooldown', spawnCooldowns[socket.id]);
      emitUnitSpawned(unit);
      socket.emit('spawn_result', {
        ok: true,
        message: `${UNIT_STATS[data.type].name} deployed. Relay cooldown ${Math.ceil(cooldownMs / 100) / 10}s.`,
        cooldownEnd: spawnCooldowns[socket.id],
        unit
      });
      emitStateDelta();
    });

    socket.on('move_unit', (data: { id: string, targetX: number, targetY: number }) => {
      const unit = gameState.units[data.id];
      const p = gameState.players[socket.id];
      if (unit && p && unit.team === p.team && isMobileUnit(unit)) {
         if (gameState.tick - unit.lastMoveTick < 4) {
             socket.emit('error_msg', 'Unit is moving/reloading.');
             return;
         }
         
         if (data.targetX >= 0 && data.targetY >= 0 && data.targetX < MAP_WIDTH && data.targetY < MAP_HEIGHT) {
            let moved = false;
            const occupied = new Set<string>();
            Object.values(gameState.units).forEach(u => {
              if (u.id !== unit.id) occupied.add(`${Math.floor(u.x)},${Math.floor(u.y)}`);
            });

            const targetX = Math.floor(data.targetX);
            const targetY = Math.floor(data.targetY);
            if (canUnitMoveTo(unit, p.team, targetX, targetY, occupied)) {
                moveUnitTo(unit, targetX, targetY);
                setUnitOrder(unit, 'attack_move', targetX, targetY);
                moved = true;
            } else {
                const dx = targetX - unit.x;
                const dy = targetY - unit.y;
                const len = Math.hypot(dx, dy);
                if (len > 0) {
                  const range = movementRangeFor(unit, targetX, targetY);
                  const clampedX = Math.round(unit.x + (dx / len) * Math.min(len, range));
                  const clampedY = Math.round(unit.y + (dy / len) * Math.min(len, range));
                  const tile = findNearestFormationTile(unit, p.team, clampedX, clampedY, occupied);
                  if (tile) {
                    moveUnitTo(unit, tile.x, tile.y);
                    setUnitOrder(unit, 'attack_move', targetX, targetY);
                    moved = true;
                  }
                }
            }
            if (moved) emitUnitsUpdated([unit]);
         }
      }
    });

    socket.on('formation_move', (data: { ids: string[], targetX: number, targetY: number }) => {
      const p = gameState.players[socket.id];
      if (!p || !Array.isArray(data.ids)) return;
      const commandIds = data.ids.slice(0, 120);
      const moved = issueFormationMove(p, commandIds, Math.floor(data.targetX), Math.floor(data.targetY));
      commandIds.forEach(id => {
        const unit = gameState.units[id];
        if (unit && unit.team === p.team && isMobileUnit(unit)) setUnitOrder(unit, 'attack_move', Math.floor(data.targetX), Math.floor(data.targetY));
      });
      const updated = Array.from(new Map([
        ...moved.map(unit => [unit.id, unit] as const),
        ...commandIds
          .map(id => gameState.units[id])
          .filter((unit): unit is UnitState => Boolean(unit) && unit.team === p.team && isMobileUnit(unit))
          .map(unit => [unit.id, unit] as const)
      ]).values());
      emitUnitsUpdated(updated);
      if (moved.length === 0) socket.emit('error_msg', 'Formation cannot reach that ground.');
      else socket.emit('error_msg', `Formation moving: ${moved.length} units.`);
    });

    socket.on('set_order', (data: { ids: string[], type: UnitOrderType, x?: number, y?: number, x2?: number, y2?: number }) => {
      const p = gameState.players[socket.id];
      if (!p || !Array.isArray(data.ids)) return;
      if (!['hold', 'attack_move', 'retreat', 'patrol', 'entrench'].includes(data.type)) return;
      let changed = 0;
      data.ids.slice(0, 80).forEach(id => {
        const unit = gameState.units[id];
        if (!unit || unit.team !== p.team || !isMobileUnit(unit)) return;
        setUnitOrder(unit, data.type, data.x, data.y, data.x2, data.y2);
        changed++;
      });
      if (changed > 0) {
        emitUnitsUpdated(data.ids.map(id => gameState.units[id]).filter((unit): unit is UnitState => Boolean(unit) && unit.team === p.team && isMobileUnit(unit)));
        socket.emit('error_msg', `${changed} unit orders updated: ${data.type.replace('_', ' ')}.`);
      }
    });
    
    socket.on('use_ability', (data: { type: string, x?: number, y?: number, id?: string }) => {
       const p = gameState.players[socket.id];
       const teamData = gameState.teams[p?.team || 'NEUTRAL'];
       if (!p || !teamData) return;
       
       if (data.type === 'deploy_fob' && data.id) {
           const engineer = gameState.units[data.id];
           if (engineer && engineer.team === p.team && engineer.type === 'engineer') {
               if (!hasFriendlyTerritoryNear(p.team, Math.floor(engineer.x), Math.floor(engineer.y), 3)) {
                   socket.emit('error_msg', 'Engineer needs a held pixel to build.');
                   return;
               }
               if (teamData.supplies >= FOB_COST) {
                   teamData.supplies -= FOB_COST;
                   // transform engineer into fob
                   delete gameState.units[engineer.id];
                   const fob = spawnUnitInternal('fob', p.team, p.id, engineer.x, engineer.y);
                   paintTerritoryRadius(p.team, fob.x, fob.y, 9, true);
                   emitUnitSpawned(fob);
               }
           }
       }
       
       if (data.type === 'deploy_bunker' && data.id) {
           const engineer = gameState.units[data.id];
           if (engineer && engineer.team === p.team && engineer.type === 'engineer') {
               if (!hasFriendlyTerritoryNear(p.team, Math.floor(engineer.x), Math.floor(engineer.y), 2)) {
                   socket.emit('error_msg', 'Bunker needs a held pixel.');
                   return;
               }
               if (teamData.supplies >= BUNKER_COST) {
                   teamData.supplies -= BUNKER_COST;
                   delete gameState.units[engineer.id];
                   const bunker = spawnUnitInternal('bunker', p.team, p.id, engineer.x, engineer.y);
                   paintTerritoryRadius(p.team, bunker.x, bunker.y, 4, true);
                   emitUnitSpawned(bunker);
               }
           }
       }

       if ((data.type === 'dig_trench' || data.type === 'build_road') && data.id) {
           const engineer = gameState.units[data.id];
           if (!engineer || engineer.team !== p.team || engineer.type !== 'engineer') return;
           const tx = Math.floor(engineer.x);
           const ty = Math.floor(engineer.y);
           const tile = gameState.blocks[`${tx},${ty}`];
           if (!tile || tile.type === 'water') {
             socket.emit('error_msg', 'Engineers cannot work that ground.');
             return;
           }
           if (!hasFriendlyTerritoryNear(p.team, tx, ty, 2)) {
             socket.emit('error_msg', 'Engineer needs held pixels for field works.');
             return;
           }
           const cost = data.type === 'dig_trench' ? TRENCH_COST : ROADWORK_COST;
           if (teamData.supplies < cost) {
             socket.emit('error_msg', `Need ${Math.ceil(cost - teamData.supplies)} more SU.`);
             return;
           }
           teamData.supplies -= cost;
           tile.type = data.type === 'dig_trench' ? 'trench' : 'road';
           io.emit('terrain_patch', { x: tx, y: ty, type: tile.type });
           socket.emit('error_msg', data.type === 'dig_trench' ? 'Trench line dug.' : 'Roadwork complete.');
       }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
      const wasHost = gameState.players[socket.id]?.isHost;
      delete gameState.players[socket.id];
      delete spawnCooldowns[socket.id];
      if (wasHost) {
        const nextHost = Object.values(gameState.players)[0];
        if (nextHost) {
          nextHost.isHost = true;
          io.to(nextHost.id).emit('player_sync', nextHost);
          io.to(nextHost.id).emit('error_msg', 'You are now operation host.');
        }
      }
    });
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.use('*', (req, res) => {
      let reqPath = req.originalUrl;
      if (reqPath === '/' || !fs.existsSync(path.resolve(__dirname, 'dist', reqPath.replace(/^\//, '')))) {
        res.sendFile(path.resolve(__dirname, 'dist/index.html'));
      } else {
        res.sendFile(path.resolve(__dirname, 'dist', reqPath.replace(/^\//, '')));
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch(console.error);
