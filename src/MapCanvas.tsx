import React, { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { useGameStore } from './store';
import { FACTORY_CAPTURE_TICKS, FORMATION_SPACING, MAP_WIDTH, MAP_HEIGHT, MOVE_RANGE_MULTIPLIER, SPAWN_COOLDOWN_MS, TICK_RATE_MS, VISIBILITY_TERRITORY_RADIUS } from './shared/constants';
import { TANK_SVG, INFANTRY_SVG, MARINE_SVG, IFV_SVG, ARTILLERY_SVG, RECON_SVG, HQ_SVG, FACTORY_SVG, SUPPLY_TRUCK_SVG, ENGINEER_SVG, FOB_SVG, ROCKET_SVG, AA_SVG, BUNKER_SVG } from './shared/svgs';
import { UNIT_STATS } from './shared/constants';
import { BlockState, UnitClass } from './shared/types';

const colors: Record<string, number> = {
  grass: 0x6e885c,
  forest: 0x415b33,
  urban: 0x736b60,
  trench: 0x5c4d3c,
  swamp: 0x5a6345,
  water: 0x516e78,
  road: 0x6f6757,
  rail: 0x6f6a62,
  mountain: 0x756c58
};

const outlineColors: Record<string, number> = {
  grass: 0x5a734a,
  forest: 0x314725,
  urban: 0x5c544a,
  trench: 0x47392a,
  swamp: 0x475035,
  water: 0x3d5660,
  road: 0x5a5347,
  rail: 0x4f4a44,
  mountain: 0x5e5645
};

const teamColors: Record<string, number> = {
  BLUE: 0x3b82f6,
  RED: 0xef4444,
  NEUTRAL: 0xe5e7eb,
};

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.4;
const FOG_REDRAW_MS = 180;
const HEAVY_FOG_REDRAW_MS = 360;

function clientFormationRank(type: UnitClass) {
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

function clientFormationLane(type: UnitClass) {
  const rank = clientFormationRank(type);
  if (rank <= -1) return -1;
  if (rank >= 3) return 2;
  if (rank >= 1) return 1;
  return 0;
}

function drawTerrainTile(graphics: PIXI.Graphics, x: number, y: number, type: string, tileSize: number) {
  const px = x * tileSize;
  const py = y * tileSize;
  const color = colors[type] || colors.grass;
  const outline = outlineColors[type] || 0x111111;

  graphics.rect(px, py, tileSize, tileSize);
  graphics.fill(color);
  graphics.stroke({ width: 1, color: outline, alpha: 0.8 });

  if (type === 'road') {
    graphics.rect(px, py + tileSize / 2 - 2, tileSize, 4);
    graphics.fill({ color: 0xb6a887, alpha: 0.58 });
    if ((x + y) % 3 === 0) {
      graphics.rect(px + 12, py + tileSize / 2 - 1, 8, 2);
      graphics.fill({ color: 0x4b4232, alpha: 0.28 });
    }
  } else if (type === 'rail') {
    graphics.rect(px, py + 9, tileSize, 2);
    graphics.rect(px, py + 21, tileSize, 2);
    graphics.fill({ color: 0xd8d0bf, alpha: 0.82 });
    graphics.rect(px + 2, py + 6, 3, 20);
    graphics.rect(px + 14, py + 6, 3, 20);
    graphics.rect(px + 26, py + 6, 3, 20);
    graphics.fill({ color: 0x2f2924, alpha: 0.8 });
  } else if (type === 'urban') {
    const tint = (x * 17 + y * 31) % 4;
    graphics.rect(px + 5, py + 5, 9 + tint, 8);
    graphics.rect(px + 17, py + 14, 9, 10 + (tint % 2));
    graphics.fill({ color: 0x9b9184, alpha: 0.58 });
    graphics.rect(px + 8, py + 8, 2, 2);
    graphics.rect(px + 20, py + 17, 2, 2);
    graphics.fill({ color: 0xf4d06f, alpha: 0.4 });
  } else if (type === 'water') {
    graphics.moveTo(px + 4, py + 11);
    graphics.lineTo(px + 14, py + 9);
    graphics.lineTo(px + 28, py + 13);
    graphics.moveTo(px + 3, py + 22);
    graphics.lineTo(px + 17, py + 20);
    graphics.lineTo(px + 29, py + 23);
    graphics.stroke({ width: 1.5, color: 0x8cc7d6, alpha: 0.35 });
  }
}

function drawTerrainLayer(graphics: PIXI.Graphics, blocks: Record<string, BlockState>, tileSize: number) {
  graphics.clear();
  for (let x = 0; x < MAP_WIDTH; x++) {
    for (let y = 0; y < MAP_HEIGHT; y++) {
      const block = blocks[`${x},${y}`];
      if (block) drawTerrainTile(graphics, x, y, block.type, tileSize);
    }
  }
}

export default function MapCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const pixiAppRef = useRef<PIXI.Application | null>(null);
  const unitsContainerRef = useRef<PIXI.Container | null>(null);
  const terrainGraphicsRef = useRef<PIXI.Graphics | null>(null);
  const linesContainerRef = useRef<PIXI.Graphics | null>(null);
  const territoryContainerRef = useRef<PIXI.Graphics | null>(null);
  const supplyLinesContainerRef = useRef<PIXI.Graphics | null>(null);
  const fowContainerRef = useRef<PIXI.Graphics | null>(null);
  
  const blocks = useGameStore(state => state.blocks);
  const units = useGameStore(state => state.units);
  const selectedUnitId = useGameStore(state => state.selectedUnitId);
  const setSelectedUnit = useGameStore(state => state.setSelectedUnit);
  const explosions = useGameStore(state => state.explosions);
  const supplyLines = useGameStore(state => state.supplyLines);
  const territoryVersion = useGameStore(state => state.territoryVersion);
  const terrainVersion = useGameStore(state => state.terrainVersion);
  const mapReady = Boolean(blocks['0,0']);

  const unitSpritesRef = useRef<Record<string, PIXI.Container>>({});
  const explosionSpritesRef = useRef<Record<string, PIXI.Graphics>>({});
  const lastTickTimeRef = useRef<number>(Date.now());
  const interpolationUnitsRef = useRef<Record<string, { prevX: number, prevY: number, currX: number, currY: number, rotation: number, hp: number, maxHp: number, team: string, type: string, targetX: number | null, targetY: number | null }>>({});
  const serverNetworkLinesRef = useRef<{ team: string, u1Id: string, u2Id: string, x1: number, y1: number, x2: number, y2: number }[]>([]);
  const commandPreviewRef = useRef<{ until: number, targetX: number, targetY: number, points: { x: number, y: number, type: UnitClass }[] } | null>(null);
  const visibilityGridRef = useRef(new Uint8Array(MAP_WIDTH * MAP_HEIGHT));
  const lastFogDrawRef = useRef(0);
  const pageVisibleRef = useRef(!document.hidden);

  const [texturesLoaded, setTexturesLoaded] = useState(false);
  const unitTexturesRef = useRef<Record<string, PIXI.Texture>>({});

  const TILE_SIZE = 32;

  useEffect(() => {
    const handleCenterMap = (e: CustomEvent<{x: number, y: number}>) => {
       if (!pixiAppRef.current) return;
       const mapContainer = pixiAppRef.current.stage.children[0] as PIXI.Container;
       if (!mapContainer) return;
       
       const {x, y} = e.detail;
       const TILE_SIZE = 32;
       const cx = (-(x * TILE_SIZE) - TILE_SIZE / 2) * mapContainer.scale.x + window.innerWidth / 2;
       const cy = (-(y * TILE_SIZE) - TILE_SIZE / 2) * mapContainer.scale.y + window.innerHeight / 2;

       mapContainer.x = cx;
       mapContainer.y = cy;
    };

    window.addEventListener('center-map', handleCenterMap as EventListener);
    return () => window.removeEventListener('center-map', handleCenterMap as EventListener);
  }, []);

  useEffect(() => {
    if (!containerRef.current || !mapReady) return;

    let destroyed = false;
    let app = new PIXI.Application();
    pixiAppRef.current = app;

    async function initPixi() {
      // Load unit textures
      unitTexturesRef.current = {
        infantry: await PIXI.Assets.load(INFANTRY_SVG),
        marine: await PIXI.Assets.load(MARINE_SVG),
        tank: await PIXI.Assets.load(TANK_SVG),
        ifv: await PIXI.Assets.load(IFV_SVG),
        artillery: await PIXI.Assets.load(ARTILLERY_SVG),
        recon: await PIXI.Assets.load(RECON_SVG),
        hq: await PIXI.Assets.load(HQ_SVG),
        factory: await PIXI.Assets.load(FACTORY_SVG),
        supply_truck: await PIXI.Assets.load(SUPPLY_TRUCK_SVG),
        engineer: await PIXI.Assets.load(ENGINEER_SVG),
        fob: await PIXI.Assets.load(FOB_SVG),
        rocket: await PIXI.Assets.load(ROCKET_SVG),
        aa: await PIXI.Assets.load(AA_SVG),
        bunker: await PIXI.Assets.load(BUNKER_SVG),
      };
      
      if (destroyed) return;
      setTexturesLoaded(true);

      await app.init({
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: 0x2b2e25, // dark olive background surrounding the map
        autoDensity: true,
        powerPreference: 'high-performance',
      });
      
      if (destroyed) {
         app.destroy({ removeView: true });
         return;
      }
      
      containerRef.current?.appendChild(app.canvas);
      app.canvas.style.width = '100%';
      app.canvas.style.height = '100%';
      app.canvas.style.display = 'block';

      const mapContainer = new PIXI.Container();
      mapContainer.eventMode = 'static';
      mapContainer.cursor = 'pointer';
      
      const graphics = new PIXI.Graphics();
      mapContainer.addChild(graphics);
      terrainGraphicsRef.current = graphics;

      const territoryContainer = new PIXI.Graphics();
      mapContainer.addChild(territoryContainer);
      territoryContainerRef.current = territoryContainer;

      const supplyLinesContainer = new PIXI.Graphics();
      mapContainer.addChild(supplyLinesContainer);
      supplyLinesContainerRef.current = supplyLinesContainer;

      const fowGraphics = new PIXI.Graphics();
      mapContainer.addChild(fowGraphics);
      fowContainerRef.current = fowGraphics;

      drawTerrainLayer(graphics, blocks, TILE_SIZE);

      mapContainer.on('pointerdown', (e) => {
         if (e.button === 2) {
             const pos = mapContainer.toLocal(e.global);
             const tx = Math.floor(pos.x / TILE_SIZE);
             const ty = Math.floor(pos.y / TILE_SIZE);
             const socketState = useGameStore.getState().socket;

             const selectedIds = useGameStore.getState().selectedUnitIds;
             if (selectedIds.length > 0 && socketState) {
                const gameUnits = useGameStore.getState().units;
                const pDetails = useGameStore.getState().playerDetails;
                if (!pDetails) return;

                const friendlySelectedIds = selectedIds.filter(id => {
                   const u = gameUnits[id];
                   return u && u.team === pDetails.team;
                });

                if (friendlySelectedIds.length > 1) {
                   buildFormationPreview(friendlySelectedIds, tx, ty);
                   socketState.emit('formation_move', { ids: friendlySelectedIds, targetX: tx, targetY: ty });
                } else if (friendlySelectedIds.length === 1) {
                   buildFormationPreview(friendlySelectedIds, tx, ty);
                   socketState.emit('move_unit', { id: friendlySelectedIds[0], targetX: tx, targetY: ty });
                }
             }
         } else if (e.button === 0) {
             useGameStore.getState().setSelectedUnit(null); // Clear selection
         }
      });

      app.stage.addChild(mapContainer);

      const recoverRenderer = () => {
        if (destroyed || !containerRef.current) return;
        try {
          const width = Math.max(1, containerRef.current.clientWidth || window.innerWidth);
          const height = Math.max(1, containerRef.current.clientHeight || window.innerHeight);
          app.renderer.resize(width, height);
          app.canvas.style.display = 'block';
          if (!app.canvas.isConnected) containerRef.current.appendChild(app.canvas);
          if (!mapContainer.parent) app.stage.addChild(mapContainer);
          visibilityGridRef.current.fill(0);
          lastFogDrawRef.current = 0;
          lastTickTimeRef.current = Date.now();
          if (terrainGraphicsRef.current) drawTerrainLayer(terrainGraphicsRef.current, useGameStore.getState().blocks, TILE_SIZE);
          if (!app.ticker.started) app.ticker.start();
        } catch (error) {
          console.error('PIXI renderer recovery failed:', error);
        }
      };

      const handleResize = () => recoverRenderer();
      const handleVisibilityChange = () => {
        pageVisibleRef.current = document.visibilityState === 'visible';
        if (document.visibilityState === 'visible') {
          requestAnimationFrame(recoverRenderer);
        } else {
          app.ticker.stop();
        }
      };
      const handleContextLost = (event: Event) => {
        event.preventDefault();
        app.ticker.stop();
      };
      const handleContextRestored = () => requestAnimationFrame(recoverRenderer);

      window.addEventListener('resize', handleResize);
      document.addEventListener('visibilitychange', handleVisibilityChange);
      app.canvas.addEventListener('webglcontextlost', handleContextLost);
      app.canvas.addEventListener('webglcontextrestored', handleContextRestored);
      
      const dragBox = new PIXI.Graphics();
      mapContainer.addChild(dragBox);

      const dragLabel = new PIXI.Text({
        text: '',
        style: {
          fontFamily: 'monospace',
          fontSize: 14,
          fontWeight: '700',
          fill: 0xffffff,
          stroke: { color: 0x111111, width: 3 },
        }
      });
      dragLabel.visible = false;
      mapContainer.addChild(dragLabel);

      const linesContainer = new PIXI.Graphics();
      mapContainer.addChild(linesContainer);
      linesContainerRef.current = linesContainer;

      const unitsContainer = new PIXI.Container();
      mapContainer.addChild(unitsContainer);
      unitsContainerRef.current = unitsContainer;

      let panning = false;
      let dragStart: PIXI.Point | null = null;
      let lastPos = {x: 0, y: 0};
      let lastDeploySentAt = 0;
      
      app.stage.eventMode = 'static';
      app.stage.hitArea = new PIXI.Rectangle(-10000, -10000, 20000, 20000);
      
      const deploySelectedUnitType = (globalPos: PIXI.Point) => {
          const pos = mapContainer.toLocal(globalPos);
          const tx = Math.floor(pos.x / TILE_SIZE);
          const ty = Math.floor(pos.y / TILE_SIZE);
          if (tx < 0 || ty < 0 || tx >= MAP_WIDTH || ty >= MAP_HEIGHT) return false;
          const store = useGameStore.getState();
          if (!store.socket || !store.selectedTypeToBuild) return false;
          const now = Date.now();
          if (store.spawnCooldownEnd > now || now - lastDeploySentAt < SPAWN_COOLDOWN_MS) return true;
          lastDeploySentAt = now;
          store.setSpawnCooldownEnd(now + SPAWN_COOLDOWN_MS);
          store.socket.emit('spawn_unit', { type: store.selectedTypeToBuild, x: tx, y: ty });
          return true;
      };

      const buildFormationPreview = (ids: string[], targetX: number, targetY: number) => {
          const state = useGameStore.getState();
          const selected = ids
            .map(id => state.units[id])
            .filter(u => u && u.team === state.playerDetails?.team && !['hq', 'factory', 'fob', 'bunker'].includes(u.type));
          if (selected.length === 0) return;

          const cx = selected.reduce((sum, u) => sum + u.x, 0) / selected.length;
          const cy = selected.reduce((sum, u) => sum + u.y, 0) / selected.length;
          let dirX = targetX - cx;
          let dirY = targetY - cy;
          const len = Math.hypot(dirX, dirY) || 1;
          dirX /= len;
          dirY /= len;
          const sideX = -dirY;
          const sideY = dirX;
          const columns = Math.max(3, Math.min(12, Math.ceil(Math.sqrt(selected.length) * 1.35)));
          const laneCounts = new Map<number, number>();

          selected.sort((a, b) => {
            const laneDelta = clientFormationLane(a.type) - clientFormationLane(b.type);
            if (laneDelta !== 0) return laneDelta;
            return clientFormationRank(a.type) - clientFormationRank(b.type);
          });

          const points = selected.slice(0, 120).map(unit => {
            const lane = clientFormationLane(unit.type);
            const laneIndex = laneCounts.get(lane) || 0;
            laneCounts.set(lane, laneIndex + 1);
            const laneDepth = lane === -1 ? -1 : lane;
            const row = Math.floor(laneIndex / columns);
            const col = laneIndex % columns;
            const centeredCol = col - (Math.min(columns, selected.length) - 1) / 2;
            const stagger = row % 2 === 0 ? 0 : FORMATION_SPACING * 0.35;
            const sideOffset = centeredCol * FORMATION_SPACING + stagger;
            const backOffset = Math.max(0, row * FORMATION_SPACING + laneDepth * FORMATION_SPACING * 1.35);
            const frontOffset = lane === -1 ? FORMATION_SPACING * 1.5 : 0;
            return {
              x: Math.round(targetX + sideX * sideOffset - dirX * backOffset + dirX * frontOffset),
              y: Math.round(targetY + sideY * sideOffset - dirY * backOffset + dirY * frontOffset),
              type: unit.type as UnitClass
            };
          });

          commandPreviewRef.current = { until: Date.now() + 1800, targetX, targetY, points };
      };

      app.stage.on('pointerdown', (e) => {
        if (e.button === 1 || e.button === 2) {
            panning = true;
            lastPos = { x: e.global.x, y: e.global.y };
        } else if (e.button === 0) {
            if (deploySelectedUnitType(e.global)) return;
            if (!useGameStore.getState().selectedTypeToBuild) {
                dragStart = mapContainer.toLocal(e.global);
                dragBox.clear();
            }
        }
      });
      app.stage.on('pointerup', (e) => {
          if (e.button === 1 || e.button === 2) panning = false;
          if (e.button === 0) { 
             if (dragStart) {
                 const current = mapContainer.toLocal(e.global);
                 const dist = Math.hypot(current.x - dragStart.x, current.y - dragStart.y);
                 if (dist > 5) {
                     const minX = Math.min(dragStart.x, current.x);
                     const maxX = Math.max(dragStart.x, current.x);
                     const minY = Math.min(dragStart.y, current.y);
                     const maxY = Math.max(dragStart.y, current.y);
                     
                     const state = useGameStore.getState();
                     const myTeam = state.playerDetails?.team;
                     const newSelected: string[] = [];
                     if (myTeam) {
                         Object.values(state.units).forEach(u => {
                             if (u.team === myTeam) {
                                 const ux = u.x * TILE_SIZE + TILE_SIZE / 2;
                                 const uy = u.y * TILE_SIZE + TILE_SIZE / 2;
                                 if (ux >= minX && ux <= maxX && uy >= minY && uy <= maxY) {
                                     newSelected.push(u.id);
                                 }
                             }
                         });
                     }
                     if (newSelected.length > 0) {
                         if (e.shiftKey) {
                           state.setSelectedUnits(Array.from(new Set([...state.selectedUnitIds, ...newSelected])));
                         } else {
                           state.setSelectedUnits(newSelected);
                         }
                     }
                 }
                 dragStart = null;
                 dragBox.clear();
                 dragLabel.visible = false;
             }
          }
      });
      app.stage.on('pointerupoutside', () => { 
         panning = false; 
         dragStart = null; 
         dragBox.clear(); 
         dragLabel.visible = false;
      });
      app.stage.on('pointermove', (e) => {
        if (panning) {
          mapContainer.x += (e.global.x - lastPos.x);
          mapContainer.y += (e.global.y - lastPos.y);
          lastPos = { x: e.global.x, y: e.global.y };
        }
        if (dragStart) {
            const current = mapContainer.toLocal(e.global);
            dragBox.clear();
            const minX = Math.min(dragStart.x, current.x);
            const minY = Math.min(dragStart.y, current.y);
            const w = Math.abs(current.x - dragStart.x);
            const h = Math.abs(current.y - dragStart.y);
            dragBox.rect(minX, minY, w, h);
            dragBox.fill({ color: 0x3b82f6, alpha: 0.15 });
            dragBox.stroke({ width: 1, color: 0x3b82f6, alpha: 0.5 });

            const state = useGameStore.getState();
            const myTeam = state.playerDetails?.team;
            let hoveredCount = 0;
            if (myTeam) {
              Object.values(state.units).forEach(u => {
                const ux = u.x * TILE_SIZE + TILE_SIZE / 2;
                const uy = u.y * TILE_SIZE + TILE_SIZE / 2;
                if (u.team === myTeam && ux >= minX && ux <= minX + w && uy >= minY && uy <= minY + h) hoveredCount++;
              });
            }
            dragLabel.text = `${hoveredCount} selected`;
            dragLabel.x = minX;
            dragLabel.y = minY - 22;
            dragLabel.visible = hoveredCount > 0;
        }
      });
      
      // Disable context menu on the canvas wrapper correctly in JSX, but we handle the wheel here
      const handleWheel = (e: WheelEvent) => {
           e.preventDefault();
           const zoomAmount = e.deltaY > 0 ? 0.9 : 1.1;
           const pos = mapContainer.toLocal(new PIXI.Point(e.clientX, e.clientY));
           const nextScale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, mapContainer.scale.x * zoomAmount));
           
           mapContainer.scale.set(nextScale);
           
           const newPos = mapContainer.toGlobal(pos);
           mapContainer.x += e.clientX - newPos.x;
           mapContainer.y += e.clientY - newPos.y;
       };
      containerRef.current?.addEventListener('wheel', handleWheel, { passive: false });
       
       mapContainer.x = - (MAP_WIDTH * TILE_SIZE) / 2 + window.innerWidth / 2;
       mapContainer.y = - (MAP_HEIGHT * TILE_SIZE) / 2 + window.innerHeight / 2;

      // Interpolation Ticker
      app.ticker.add(() => {
          if (!pageVisibleRef.current || document.hidden) return;
          const now = Date.now();
          const elapsed = now - lastTickTimeRef.current;
          const t = Math.min(1, elapsed / TICK_RATE_MS); 

          const state = useGameStore.getState();
          const units = state.units;
          const currentSelectedId = state.selectedUnitId;
          const playerDetails = state.playerDetails;
          const selectedSet = new Set(state.selectedUnitIds);
          const unitsContainer = unitsContainerRef.current;
          const lines = linesContainerRef.current;
          const supplyLineGraphics = supplyLinesContainerRef.current;
          const fow = fowContainerRef.current;
          
          if (!unitsContainer || !lines || !fow || !supplyLineGraphics) return;

          lines.clear();
          supplyLineGraphics.clear();

          // 1. Interpolate and Draw Units
          const myTeam = playerDetails?.team;
          const unitCount = unitsContainer.children.length;
          const fogCadence = unitCount > 900 ? HEAVY_FOG_REDRAW_MS : FOG_REDRAW_MS;
          const shouldRedrawFog = now - lastFogDrawRef.current >= fogCadence;
          const visibilityGrid = visibilityGridRef.current;
          if (shouldRedrawFog) {
              visibilityGrid.fill(0);
              const territory = state.territory;
              const myTerritoryValue = myTeam === 'BLUE' ? 1 : myTeam === 'RED' ? 2 : 0;
              if (myTerritoryValue) {
                  const territoryVisionSq = VISIBILITY_TERRITORY_RADIUS * VISIBILITY_TERRITORY_RADIUS;
                  for (let i = 0; i < territory.length; i++) {
                      if (territory[i] !== myTerritoryValue) continue;
                      const tx = i % MAP_WIDTH;
                      const ty = Math.floor(i / MAP_WIDTH);
                      for (let x = Math.max(0, tx - VISIBILITY_TERRITORY_RADIUS); x <= Math.min(MAP_WIDTH - 1, tx + VISIBILITY_TERRITORY_RADIUS); x++) {
                          for (let y = Math.max(0, ty - VISIBILITY_TERRITORY_RADIUS); y <= Math.min(MAP_HEIGHT - 1, ty + VISIBILITY_TERRITORY_RADIUS); y++) {
                              if ((x - tx) * (x - tx) + (y - ty) * (y - ty) <= territoryVisionSq) {
                                  visibilityGrid[x + y * MAP_WIDTH] = 1;
                              }
                          }
                      }
                  }
              }
          }
          const currentLerpPositions: Record<string, {x: number, y: number}> = {};

          Object.entries(interpolationUnitsRef.current).forEach(([id, data]) => {
              const typedData = data as { prevX: number, prevY: number, currX: number, currY: number, rotation: number, hp: number, maxHp: number, team: string, type: string, targetX: number | null, targetY: number | null };
              const sprite = unitSpritesRef.current[id];
              if (!sprite) return;

              // Lerp position
              const lerpX = typedData.prevX + (typedData.currX - typedData.prevX) * t;
              const lerpY = typedData.prevY + (typedData.currY - typedData.prevY) * t;
              currentLerpPositions[id] = { x: lerpX, y: lerpY };

              sprite.x = lerpX * TILE_SIZE + TILE_SIZE/2;
              sprite.y = lerpY * TILE_SIZE + TILE_SIZE/2;

              // Update Vision if friendly
              if (shouldRedrawFog && myTeam && myTeam !== 'NEUTRAL' && typedData.team === myTeam) {
                  const vision = UNIT_STATS[typedData.type as UnitClass]?.vision || 4;
                  const cx = Math.floor(lerpX);
                  const cy = Math.floor(lerpY);
                  const visionSq = vision * vision;
                  
                  for (let x = Math.max(0, cx - vision); x <= Math.min(MAP_WIDTH - 1, cx + vision); x++) {
                      for (let y = Math.max(0, cy - vision); y <= Math.min(MAP_HEIGHT - 1, cy + vision); y++) {
                          if (Math.pow(x - cx, 2) + Math.pow(y - cy, 2) <= visionSq) {
                              visibilityGrid[x + y * MAP_WIDTH] = 1;
                          }
                      }
                  }
              }

              // Selection brackets and target lines
              if (selectedSet.has(id)) {
                  const u = units[id];

                  // Draw territory radius indicator for generators
                  let radius = 0;
                  if (u.type === 'hq') radius = 15;
                  else if (u.type === 'factory') radius = 8;
                  else if (u.type === 'fob') radius = 9;
                  else if (u.type === 'supply_truck') radius = 6;
                  else if (u.type === 'bunker') radius = 4;
                  
                  if (radius > 0) {
                      const pulse = Math.sin(now / 300) * 0.1 + 0.2;
                      lines.circle(sprite.x, sprite.y, radius * TILE_SIZE);
                      lines.stroke({ width: 2, color: 0x88ccff, alpha: 0.5 });
                      lines.fill({ color: 0x88ccff, alpha: pulse });
                  }
                  
                  // Draw movement range
                  if (u.team === myTeam && u.type !== 'hq' && u.type !== 'factory' && u.type !== 'fob' && u.type !== 'bunker') {
                      const maxRange = Math.max(2, Math.ceil((UNIT_STATS[u.type]?.speed || 1) * MOVE_RANGE_MULTIPLIER));
                      const rx = (Math.floor(u.x) - maxRange);
                      const ry = (Math.floor(u.y) - maxRange);
                      const rw = (maxRange * 2 + 1);
                      const rh = (maxRange * 2 + 1);

                      lines.rect(rx * TILE_SIZE, ry * TILE_SIZE, rw * TILE_SIZE, rh * TILE_SIZE);
                      lines.fill({ color: 0xffffff, alpha: 0.05 });
                      lines.stroke({ width: 1, color: 0xffffff, alpha: 0.2 });
                  }

                  if (u && u.targetX != null && u.targetY != null) {
                      const tColor = teamColors[u.team] || teamColors.NEUTRAL;
                      const tgtX = u.targetX * TILE_SIZE + TILE_SIZE/2;
                      const tgtY = u.targetY * TILE_SIZE + TILE_SIZE/2;
                      
                      lines.moveTo(sprite.x, sprite.y);
                      lines.lineTo(tgtX, tgtY);
                      lines.stroke({ width: 2, color: tColor, alpha: 0.6 });
                      
                      lines.moveTo(tgtX - 4, tgtY - 4); lines.lineTo(tgtX + 4, tgtY + 4);
                      lines.moveTo(tgtX + 4, tgtY - 4); lines.lineTo(tgtX - 4, tgtY + 4);
                      lines.stroke({ width: 2, color: tColor, alpha: 0.8 });
                  }
              }
              
              // Smooth rotation if moving
              const unitIcon = sprite.children.find(c => c instanceof PIXI.Sprite) as PIXI.Sprite;
              if (unitIcon && typedData.type !== 'hq' && typedData.type !== 'factory' && typedData.type !== 'fob') {
                  const dx = typedData.currX - typedData.prevX;
                  const dy = typedData.currY - typedData.prevY;
                  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
                      const targetRot = Math.atan2(dy, dx);
                      let diff = targetRot - unitIcon.rotation;
                      while(diff < -Math.PI) diff += Math.PI * 2;
                      while(diff > Math.PI) diff -= Math.PI * 2;
                      unitIcon.rotation += diff * 0.1;
                  }
              }
          });

          const commandPreview = commandPreviewRef.current;
          if (commandPreview) {
              if (now > commandPreview.until) {
                  commandPreviewRef.current = null;
              } else {
                  const fade = Math.max(0, (commandPreview.until - now) / 1800);
                  const targetPx = commandPreview.targetX * TILE_SIZE + TILE_SIZE / 2;
                  const targetPy = commandPreview.targetY * TILE_SIZE + TILE_SIZE / 2;
                  lines.circle(targetPx, targetPy, 10);
                  lines.stroke({ width: 2, color: 0xfacc15, alpha: 0.9 * fade });
                  lines.moveTo(targetPx - 16, targetPy);
                  lines.lineTo(targetPx + 16, targetPy);
                  lines.moveTo(targetPx, targetPy - 16);
                  lines.lineTo(targetPx, targetPy + 16);
                  lines.stroke({ width: 1.5, color: 0xfacc15, alpha: 0.8 * fade });

                  commandPreview.points.forEach(point => {
                    const px = point.x * TILE_SIZE + TILE_SIZE / 2;
                    const py = point.y * TILE_SIZE + TILE_SIZE / 2;
                    const color = point.type === 'artillery' || point.type === 'supply_truck' ? 0xcca054 : point.type === 'recon' || point.type === 'tank' || point.type === 'ifv' ? 0x8bd3ff : 0xffffff;
                    lines.circle(px, py, point.type === 'artillery' || point.type === 'supply_truck' ? 4 : 5);
                    lines.fill({ color, alpha: 0.18 * fade });
                    lines.stroke({ width: 1, color, alpha: 0.75 * fade });
                  });
              }
          }

          // Lasers
          state.combatHits.forEach(hit => {
              const hColor = teamColors[hit.team] || teamColors.NEUTRAL;
              lines.moveTo((hit.fromX + 0.5) * TILE_SIZE, (hit.fromY + 0.5) * TILE_SIZE);
              lines.lineTo((hit.toX + 0.5) * TILE_SIZE, (hit.toY + 0.5) * TILE_SIZE);
              lines.stroke({ width: 3, color: hColor, alpha: 0.8 });
              lines.circle((hit.toX + 0.5) * TILE_SIZE, (hit.toY + 0.5) * TILE_SIZE, 4);
              lines.fill({ color: 0xffa000, alpha: 0.8 });
          });

          // 2. Smooth Fog of War
          if (myTeam && myTeam !== 'NEUTRAL') {
             if (shouldRedrawFog) {
             fow.clear();
             let startX = -1;
             for (let y = 0; y < MAP_HEIGHT; y++) {
                 for (let x = 0; x <= MAP_WIDTH; x++) {
                     const isDark = (x < MAP_WIDTH) && (visibilityGrid[x + y * MAP_WIDTH] === 0);
                     if (isDark && startX === -1) {
                         startX = x;
                     } else if (!isDark && startX !== -1) {
                         fow.rect(startX * TILE_SIZE, y * TILE_SIZE, (x - startX) * TILE_SIZE, TILE_SIZE);
                         startX = -1;
                     }
                 }
             }
             fow.fill({ color: 0x000000, alpha: 0.65 });
             lastFogDrawRef.current = now;
             }

             // Update unit visibility
             (Object.entries(unitSpritesRef.current) as [string, PIXI.Container][]).forEach(([id, sprite]) => {
                const data = interpolationUnitsRef.current[id] as any;
                const pos = currentLerpPositions[id];
                if (!data || !pos) return;
                const unit = units[id];
                const cx = Math.floor(pos.x);
                const cy = Math.floor(pos.y);
                const visibleIndex = cx >= 0 && cy >= 0 && cx < MAP_WIDTH && cy < MAP_HEIGHT ? cx + cy * MAP_WIDTH : -1;
                if (data.team === myTeam || unit?.spottedBy?.includes(myTeam) || (visibleIndex >= 0 && visibilityGrid[visibleIndex])) {
                    sprite.visible = true;
                } else {
                    sprite.visible = false;
                }
             });
          } else {
             fow.clear();
             Object.values(unitSpritesRef.current).forEach(s => (s as PIXI.Container).visible = true);
          }

          // 3. Smooth Supply Lines (using lerp positions for endpoints)
          const serverNetworkLines = serverNetworkLinesRef.current;
          const supplyPulse = 0.55 + Math.sin(now / 260) * 0.2;
          serverNetworkLines.forEach(line => {
              const p1 = currentLerpPositions[line.u1Id] || { x: line.x1, y: line.y1 };
              const p2 = currentLerpPositions[line.u2Id] || { x: line.x2, y: line.y2 };
              const x1 = (p1.x + 0.5) * TILE_SIZE;
              const y1 = (p1.y + 0.5) * TILE_SIZE;
              const x2 = (p2.x + 0.5) * TILE_SIZE;
              const y2 = (p2.y + 0.5) * TILE_SIZE;
              const dx = x2 - x1;
              const dy = y2 - y1;
              const len = Math.max(1, Math.hypot(dx, dy));
              const color = teamColors[line.team];
              supplyLineGraphics.moveTo(x1, y1);
              supplyLineGraphics.lineTo(x2, y2);
              supplyLineGraphics.stroke({ width: 7, color, alpha: 0.12 });
              supplyLineGraphics.moveTo(x1, y1);
              supplyLineGraphics.lineTo(x2, y2);
              supplyLineGraphics.stroke({ width: 2, color, alpha: supplyPulse });

              if (unitCount > 1200) return;
              const step = TILE_SIZE * 2.25;
              const offset = (now / 24) % step;
              for (let d = offset; d < len; d += step) {
                const t = d / len;
                supplyLineGraphics.circle(x1 + dx * t, y1 + dy * t, 2.4);
                supplyLineGraphics.fill({ color, alpha: 0.78 });
              }
          });
       });

       return () => {
          containerRef.current?.removeEventListener('wheel', handleWheel);
          window.removeEventListener('resize', handleResize);
          document.removeEventListener('visibilitychange', handleVisibilityChange);
          app.canvas.removeEventListener('webglcontextlost', handleContextLost);
          app.canvas.removeEventListener('webglcontextrestored', handleContextRestored);
       };
    }

    const cleanupPromise = initPixi();

    return () => {
      destroyed = true;
      cleanupPromise.then(cleanupWheel => cleanupWheel?.()).catch(() => undefined);
      try {
          app.destroy({ removeView: true }, { children: true });
      } catch (err) {
          console.error("PIXI cleanup error:", err);
      }
      pixiAppRef.current = null;
      linesContainerRef.current = null;
      unitsContainerRef.current = null;
      territoryContainerRef.current = null;
      supplyLinesContainerRef.current = null;
      explosionSpritesRef.current = {};
      setTexturesLoaded(false);
    };
  }, [mapReady]); // Create PIXI once; terrain patches redraw the layer without rebuilding the renderer.

  useEffect(() => {
    serverNetworkLinesRef.current = supplyLines;
  }, [supplyLines]);

  useEffect(() => {
    const terrainGraphics = terrainGraphicsRef.current;
    if (!texturesLoaded || !terrainGraphics || !mapReady) return;
    drawTerrainLayer(terrainGraphics, blocks, TILE_SIZE);
  }, [terrainVersion, texturesLoaded, mapReady, blocks]);

  useEffect(() => {
    const territoryContainer = territoryContainerRef.current;
    if (!texturesLoaded || !territoryContainer) return;
    const territoryState = useGameStore.getState().territory;
    territoryContainer.clear();
    for (let i = 0; i < territoryState.length; i++) {
      const val = territoryState[i];
      if (val === 0) continue;
      const tx = i % MAP_WIDTH;
      const ty = Math.floor(i / MAP_WIDTH);
      const color = val === 1 ? teamColors.BLUE : teamColors.RED;
      territoryContainer.rect(tx * TILE_SIZE, ty * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      territoryContainer.fill({ color, alpha: 0.28 });

      const px = tx * TILE_SIZE;
      const py = ty * TILE_SIZE;
      const leftDiff = tx === 0 || territoryState[i - 1] !== val;
      const rightDiff = tx === MAP_WIDTH - 1 || territoryState[i + 1] !== val;
      const topDiff = ty === 0 || territoryState[i - MAP_WIDTH] !== val;
      const bottomDiff = ty === MAP_HEIGHT - 1 || territoryState[i + MAP_WIDTH] !== val;
      if (leftDiff || rightDiff || topDiff || bottomDiff) {
        if (leftDiff) { territoryContainer.moveTo(px, py); territoryContainer.lineTo(px, py + TILE_SIZE); }
        if (rightDiff) { territoryContainer.moveTo(px + TILE_SIZE, py); territoryContainer.lineTo(px + TILE_SIZE, py + TILE_SIZE); }
        if (topDiff) { territoryContainer.moveTo(px, py); territoryContainer.lineTo(px + TILE_SIZE, py); }
        if (bottomDiff) { territoryContainer.moveTo(px, py + TILE_SIZE); territoryContainer.lineTo(px + TILE_SIZE, py + TILE_SIZE); }
        territoryContainer.stroke({ width: 1.5, color, alpha: 0.5 });
      }
    }
  }, [territoryVersion, texturesLoaded]);

  useEffect(() => {
    if (!texturesLoaded || !unitsContainerRef.current || !linesContainerRef.current || !territoryContainerRef.current || !fowContainerRef.current) return;
    const container = unitsContainerRef.current;
    const fow = fowContainerRef.current;
    if (fow.destroyed) return;

    const currentSelectedId = selectedUnitId;
    lastTickTimeRef.current = Date.now();

    // Reconcile Units
    const unitIds = Object.keys(units);
    
    // Remove dead units
    Object.keys(unitSpritesRef.current).forEach(id => {
       if (!units[id]) {
          const sprite = unitSpritesRef.current[id];
          if (sprite) {
             container.removeChild(sprite);
             sprite.destroy({ children: true });
          }
          delete unitSpritesRef.current[id];
          delete interpolationUnitsRef.current[id];
       }
    });

    // Update or Create units
    unitIds.forEach(id => {
       const unit = units[id];
       const inter = interpolationUnitsRef.current[id];
       
       if (inter) {
          inter.prevX = inter.currX;
          inter.prevY = inter.currY;
          inter.currX = unit.x;
          inter.currY = unit.y;
          inter.hp = unit.hp;
          inter.maxHp = UNIT_STATS[unit.type]?.maxHp || 100;
          inter.team = unit.team;
          inter.type = unit.type;
          inter.targetX = unit.targetX;
          inter.targetY = unit.targetY;
       } else {
          interpolationUnitsRef.current[id] = {
             prevX: unit.x,
             prevY: unit.y,
             currX: unit.x,
             currY: unit.y,
             rotation: 0,
             hp: unit.hp,
             maxHp: UNIT_STATS[unit.type]?.maxHp || 100,
             team: unit.team,
             type: unit.type,
             targetX: unit.targetX,
             targetY: unit.targetY
          };
       }

       let spriteContainer = unitSpritesRef.current[id];
       if (!spriteContainer) {
          spriteContainer = new PIXI.Container();
          const tColor = teamColors[unit.team] || teamColors.NEUTRAL;
          const texture = unitTexturesRef.current[unit.type] || PIXI.Texture.WHITE;
          
          spriteContainer.x = unit.x * TILE_SIZE + TILE_SIZE/2;
          spriteContainer.y = unit.y * TILE_SIZE + TILE_SIZE/2;

          const sprite = new PIXI.Sprite(texture);
          sprite.anchor.set(0.5);
          sprite.width = TILE_SIZE * 0.9;
          sprite.height = TILE_SIZE * 0.9;
          sprite.tint = tColor;
          spriteContainer.addChild(sprite);

          spriteContainer.eventMode = 'static';
          spriteContainer.cursor = 'pointer';
          spriteContainer.on('pointerdown', (e) => {
             e.stopPropagation();
             const state = useGameStore.getState();
             if (e.shiftKey) {
                const exists = state.selectedUnitIds.includes(unit.id);
                const next = exists ? state.selectedUnitIds.filter(id => id !== unit.id) : [...state.selectedUnitIds, unit.id];
                state.setSelectedUnits(next);
             } else {
                setSelectedUnit(unit.id);
             }
          });

          container.addChild(spriteContainer);
          unitSpritesRef.current[id] = spriteContainer;
       }

       // Update tint dynamically (important for factories changing team)
       const iconSprite = spriteContainer.children.find(c => c instanceof PIXI.Sprite) as PIXI.Sprite;
       if (iconSprite) {
           iconSprite.tint = teamColors[unit.team] || teamColors.NEUTRAL;
       }

       // Update health bar and selection visual
       // Clear any temporary graphics on the container before redraw
       const existingGraphic = spriteContainer.children.find(c => c instanceof PIXI.Graphics) as PIXI.Graphics;
       if (existingGraphic) {
          existingGraphic.clear();
       } else {
          const g = new PIXI.Graphics();
          spriteContainer.addChild(g);
       }
       
       const g = spriteContainer.children.find(c => c instanceof PIXI.Graphics) as PIXI.Graphics;
       const maxHp = UNIT_STATS[unit.type]?.maxHp || 100;
       const hpPct = Math.max(0, unit.hp / maxHp);
       const isFriendlyMobile = unit.team === useGameStore.getState().playerDetails?.team && !['hq', 'factory', 'fob', 'bunker'].includes(unit.type);

       if (isFriendlyMobile) {
          if (unit.supplied === false) {
             const warningColor = unit.type === 'marine' ? 0xffb86b : 0xff5a5a;
             g.circle(0, 0, TILE_SIZE * 0.55);
             g.stroke({ width: 2, color: warningColor, alpha: 0.85 });
             g.moveTo(-6, TILE_SIZE * 0.48);
             g.lineTo(6, TILE_SIZE * 0.48);
             g.stroke({ width: 2, color: warningColor, alpha: 0.9 });
          } else {
             g.circle(0, 0, TILE_SIZE * 0.58);
             g.stroke({ width: 2, color: 0x82f3b5, alpha: 0.52 });
             g.circle(TILE_SIZE * 0.38, -TILE_SIZE * 0.38, 2.5);
             g.fill({ color: 0x82f3b5, alpha: 0.95 });
          }
       }

       if (isFriendlyMobile && (unit.combinedArms || 0) > 0) {
          const pips = Math.min(3, unit.combinedArms || 0);
          for (let i = 0; i < pips; i++) {
             g.circle(-7 + i * 7, TILE_SIZE * 0.58, 2.3);
             g.fill({ color: 0x8bd3ff, alpha: 0.95 });
             g.stroke({ width: 1, color: 0x0b2130, alpha: 0.8 });
          }
       }

       if ((unit.entrenchment || 0) >= 1) {
          const level = Math.min(5, Math.floor(unit.entrenchment || 0));
          for (let i = 0; i < level; i++) {
             const y = -TILE_SIZE * 0.58 + i * 3;
             g.moveTo(-TILE_SIZE * 0.52, y);
             g.lineTo(-TILE_SIZE * 0.32, y - 3);
             g.moveTo(TILE_SIZE * 0.32, y - 3);
             g.lineTo(TILE_SIZE * 0.52, y);
          }
          g.stroke({ width: 1.5, color: 0xd6c28a, alpha: 0.78 });
       }

       const isSelected = useGameStore.getState().selectedUnitIds.includes(unit.id);
       if (hpPct < 1 || isSelected) {
          g.rect(-TILE_SIZE/2 + 2, -TILE_SIZE/2 - 6, TILE_SIZE - 4, 3);
          g.fill(0x333333);
          g.rect(-TILE_SIZE/2 + 2, -TILE_SIZE/2 - 6, (TILE_SIZE - 4) * hpPct, 3);
          g.fill(hpPct < 0.3 ? 0xff0000 : 0x4adc4a);
       }

       if (unit.type === 'factory' && (unit.captureProgress || 0) > 0) {
          const pct = Math.max(0, Math.min(1, (unit.captureProgress || 0) / FACTORY_CAPTURE_TICKS));
          g.rect(-TILE_SIZE/2 + 2, TILE_SIZE/2 + 5, TILE_SIZE - 4, 4);
          g.fill({ color: 0x111111, alpha: 0.75 });
          g.rect(-TILE_SIZE/2 + 2, TILE_SIZE/2 + 5, (TILE_SIZE - 4) * pct, 4);
          g.fill({ color: unit.captureTeam === 'RED' ? teamColors.RED : teamColors.BLUE, alpha: 0.9 });
       }

       if (isSelected) {
          const bracketColor = 0xcaf0f8;
          const s = TILE_SIZE / 2 + 2;
          g.moveTo(-s, -s + 6); g.lineTo(-s, -s); g.lineTo(-s + 6, -s);
          g.stroke({ width: 2, color: bracketColor });
          g.moveTo(s - 6, -s); g.lineTo(s, -s); g.lineTo(s, -s + 6);
          g.stroke({ width: 2, color: bracketColor });
          g.moveTo(-s, s - 6); g.lineTo(-s, s); g.lineTo(-s + 6, s);
          g.stroke({ width: 2, color: bracketColor });
          g.moveTo(s - 6, s); g.lineTo(s, s); g.lineTo(s, s - 6);
          g.stroke({ width: 2, color: bracketColor });
       }

       if (unit.suppressed) {
          g.rect(-TILE_SIZE/2 + 4, TILE_SIZE/2 + 8, TILE_SIZE - 8, 4);
          g.fill({ color: 0xfacc15, alpha: 0.85 });
          g.stroke({ width: 1, color: 0x000000, alpha: 0.7 });
       }
       
       if (unit.rank) {
           for (let i = 0; i < unit.rank; i++) {
               g.circle(-TILE_SIZE/2 + 4 + (i * 6), TILE_SIZE/2 + 4, 2);
               g.fill(0xffd700);
               g.stroke({ width: 1, color: 0x000000 });
           }
       }
    });
    
    // Explosions (reconcile by id so flashes do not duplicate on every tick)
    const activeExplosionIds = new Set(explosions.map(exp => exp.id));
    (Object.entries(explosionSpritesRef.current) as [string, PIXI.Graphics][]).forEach(([id, graphic]) => {
        if (!activeExplosionIds.has(id)) {
            container.removeChild(graphic);
            graphic.destroy();
            delete explosionSpritesRef.current[id];
        }
    });

    explosions.forEach(exp => {
        if (explosionSpritesRef.current[exp.id]) return;
        const g = new PIXI.Graphics();
        const ex = exp.x * TILE_SIZE + TILE_SIZE/2;
        const ey = exp.y * TILE_SIZE + TILE_SIZE/2;
        const rad = exp.radius * TILE_SIZE;
        
        g.circle(ex, ey, rad);
        g.fill({ color: 0xff4400, alpha: 0.15 });
        g.stroke({ color: 0xffaa00, width: 2, alpha: 0.6 });
        
        g.circle(ex, ey, rad * 0.5);
        g.fill({ color: 0xff2200, alpha: 0.3 });
        
        for(let i=0; i<8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            g.moveTo(ex + Math.cos(angle) * (rad * 0.2), ey + Math.sin(angle) * (rad * 0.2));
            g.lineTo(ex + Math.cos(angle) * rad, ey + Math.sin(angle) * rad);
            g.stroke({ color: 0xffaa00, width: 1, alpha: 0.4 });
        }
        container.addChild(g);
        explosionSpritesRef.current[exp.id] = g;
     });

  }, [units, selectedUnitId, explosions, texturesLoaded]);

  return <div ref={containerRef} onContextMenu={e => e.preventDefault()} className="absolute inset-0 overflow-hidden" />;
}
