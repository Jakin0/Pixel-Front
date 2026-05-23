import React, { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { useGameStore } from './store';
import { FACTORY_CAPTURE_TICKS, FORMATION_SPACING, MAP_WIDTH, MAP_HEIGHT, MOVE_RANGE_MULTIPLIER, SPAWN_COOLDOWN_MS, TICK_RATE_MS } from './shared/constants';
import { TANK_SVG, INFANTRY_SVG, MARINE_SVG, IFV_SVG, ARTILLERY_SVG, RECON_SVG, HQ_SVG, FACTORY_SVG, SUPPLY_TRUCK_SVG, ENGINEER_SVG, FOB_SVG, ROCKET_SVG, AA_SVG, BUNKER_SVG } from './shared/svgs';
import { UNIT_STATS } from './shared/constants';
import { BlockState, UnitClass } from './shared/types';

const colors: Record<string, number> = {
  grass: 0x758b58,
  forest: 0x2f5232,
  urban: 0x736f66,
  trench: 0x5a4935,
  swamp: 0x516145,
  water: 0x436d7d,
  road: 0x776c59,
  rail: 0x706c63,
  mountain: 0x746b58
};

const outlineColors: Record<string, number> = {
  grass: 0x4f6c40,
  forest: 0x1e3a24,
  urban: 0x555148,
  trench: 0x3f3122,
  swamp: 0x3d4a33,
  water: 0x2c5263,
  road: 0x5c5142,
  rail: 0x4f4a42,
  mountain: 0x55503f
};

const teamColors: Record<string, number> = {
  BLUE: 0x1f6fff,
  RED: 0xdc2626,
  NEUTRAL: 0xe5e7eb,
};

const factionAccents: Record<string, { label: string, accent: number, trim: number, dark: number }> = {
  BLUE: { label: 'USA', accent: 0xffffff, trim: 0x60a5fa, dark: 0x0b1d4a },
  RED: { label: 'USSR', accent: 0xffd34d, trim: 0xff4d4d, dark: 0x4a0707 },
  NEUTRAL: { label: 'N', accent: 0xffffff, trim: 0xcbd5e1, dark: 0x1f2937 },
};

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.4;
const FOG_REDRAW_MS = 180;
const HEAVY_FOG_REDRAW_MS = 360;
const MAP_EDGE_PADDING = 96;
const DOUBLE_CLICK_MS = 320;

function tileNoise(x: number, y: number, salt = 0) {
  const n = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function mixColor(a: number, b: number, t: number) {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  return ((ar + (br - ar) * t) << 16) + ((ag + (bg - ag) * t) << 8) + (ab + (bb - ab) * t);
}

function drawStar(graphics: PIXI.Graphics, cx: number, cy: number, outer: number, inner: number, color: number, alpha = 1, rotation = -Math.PI / 2) {
  for (let i = 0; i <= 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = rotation + (i * Math.PI) / 5;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) graphics.moveTo(x, y);
    else graphics.lineTo(x, y);
  }
  graphics.fill({ color, alpha });
}

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
  const baseColor = colors[type] || colors.grass;
  const color = mixColor(baseColor, tileNoise(x, y, 1) > 0.5 ? 0xffffff : 0x050505, 0.06 + tileNoise(x, y, 2) * 0.07);
  const outline = outlineColors[type] || 0x111111;

  graphics.rect(px, py, tileSize, tileSize);
  graphics.fill(color);
  graphics.stroke({ width: 1, color: outline, alpha: 0.55 });

  graphics.rect(px, py, tileSize, 3);
  graphics.fill({ color: 0xffffff, alpha: 0.045 });
  graphics.rect(px, py + tileSize - 4, tileSize, 4);
  graphics.fill({ color: 0x000000, alpha: 0.08 });

  if (type === 'road') {
    graphics.rect(px, py + tileSize / 2 - 5, tileSize, 10);
    graphics.fill({ color: 0x4d4334, alpha: 0.32 });
    graphics.rect(px, py + tileSize / 2 - 3, tileSize, 6);
    graphics.fill({ color: 0xc0b08d, alpha: 0.76 });
    if ((x + y) % 3 === 0) {
      graphics.rect(px + 8, py + tileSize / 2 - 1, 9, 2);
      graphics.rect(px + 23, py + tileSize / 2 - 1, 6, 2);
      graphics.fill({ color: 0x3d3529, alpha: 0.34 });
    }
  } else if (type === 'rail') {
    graphics.rect(px, py + 8, tileSize, 3);
    graphics.rect(px, py + 21, tileSize, 3);
    graphics.fill({ color: 0xe0d4bd, alpha: 0.9 });
    graphics.rect(px + 2, py + 6, 3, 20);
    graphics.rect(px + 14, py + 6, 3, 20);
    graphics.rect(px + 26, py + 6, 3, 20);
    graphics.fill({ color: 0x2f2924, alpha: 0.82 });
  } else if (type === 'urban') {
    const tint = (x * 17 + y * 31) % 4;
    graphics.rect(px + 4, py + 4, 10 + tint, 9);
    graphics.rect(px + 17, py + 13, 10, 11 + (tint % 2));
    graphics.rect(px + 6, py + 21, 7, 7);
    graphics.fill({ color: 0xa59b8d, alpha: 0.64 });
    graphics.rect(px + 8, py + 8, 2, 2);
    graphics.rect(px + 20, py + 17, 2, 2);
    graphics.rect(px + 23, py + 17, 2, 2);
    graphics.fill({ color: 0xffd982, alpha: 0.48 });
  } else if (type === 'water') {
    const offset = tileNoise(x, y, 3) * 5;
    graphics.moveTo(px + 3, py + 10 + offset);
    graphics.lineTo(px + 14, py + 8 + offset);
    graphics.lineTo(px + 29, py + 12 + offset);
    graphics.moveTo(px + 2, py + 22 - offset / 2);
    graphics.lineTo(px + 17, py + 20 - offset / 2);
    graphics.lineTo(px + 30, py + 23 - offset / 2);
    graphics.stroke({ width: 1.5, color: 0xb9efff, alpha: 0.36 });
  } else if (type === 'forest') {
    const trees = 2 + Math.floor(tileNoise(x, y, 4) * 3);
    for (let i = 0; i < trees; i++) {
      const tx = px + 7 + tileNoise(x, y, 10 + i) * 18;
      const ty = py + 7 + tileNoise(x, y, 20 + i) * 17;
      graphics.circle(tx, ty, 4 + tileNoise(x, y, 30 + i) * 2);
      graphics.fill({ color: 0x172b1a, alpha: 0.42 });
    }
  } else if (type === 'grass') {
    if (tileNoise(x, y, 5) > 0.35) {
      graphics.moveTo(px + 5, py + 8 + tileNoise(x, y, 6) * 12);
      graphics.lineTo(px + 18, py + 5 + tileNoise(x, y, 7) * 18);
      graphics.lineTo(px + 28, py + 9 + tileNoise(x, y, 8) * 13);
      graphics.stroke({ width: 1, color: 0xe0e8b9, alpha: 0.12 });
    }
  } else if (type === 'trench') {
    graphics.moveTo(px + 2, py + 17);
    graphics.lineTo(px + 9, py + 12);
    graphics.lineTo(px + 17, py + 20);
    graphics.lineTo(px + 24, py + 13);
    graphics.lineTo(px + 31, py + 17);
    graphics.stroke({ width: 4, color: 0x2b2118, alpha: 0.78 });
    graphics.stroke({ width: 1.5, color: 0xd2bc83, alpha: 0.38 });
  } else if (type === 'swamp') {
    graphics.ellipse(px + 12, py + 20, 8, 3);
    graphics.ellipse(px + 23, py + 11, 6, 2);
    graphics.fill({ color: 0x1d3832, alpha: 0.32 });
    graphics.stroke({ width: 1, color: 0x9cbf7f, alpha: 0.22 });
  } else if (type === 'mountain') {
    graphics.moveTo(px + 4, py + 27);
    graphics.lineTo(px + 14, py + 7);
    graphics.lineTo(px + 22, py + 27);
    graphics.moveTo(px + 13, py + 27);
    graphics.lineTo(px + 24, py + 10);
    graphics.lineTo(px + 31, py + 27);
    graphics.stroke({ width: 2.5, color: 0x2f302c, alpha: 0.5 });
    graphics.stroke({ width: 1, color: 0xf1e7c2, alpha: 0.24 });
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

function clampMapPosition(mapContainer: PIXI.Container, viewportWidth: number, viewportHeight: number, tileSize: number) {
  const mapWidth = MAP_WIDTH * tileSize * mapContainer.scale.x;
  const mapHeight = MAP_HEIGHT * tileSize * mapContainer.scale.y;
  const minX = Math.min(MAP_EDGE_PADDING, viewportWidth - mapWidth - MAP_EDGE_PADDING);
  const maxX = Math.max(viewportWidth - MAP_EDGE_PADDING, MAP_EDGE_PADDING);
  const minY = Math.min(MAP_EDGE_PADDING, viewportHeight - mapHeight - MAP_EDGE_PADDING);
  const maxY = Math.max(viewportHeight - MAP_EDGE_PADDING, MAP_EDGE_PADDING);
  mapContainer.x = Math.max(minX, Math.min(maxX, mapContainer.x));
  mapContainer.y = Math.max(minY, Math.min(maxY, mapContainer.y));
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
  const selectedTypeToBuild = useGameStore(state => state.selectedTypeToBuild);
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
  const lastUnitClickAtRef = useRef(0);
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
       const width = containerRef.current?.clientWidth || window.innerWidth;
       const height = containerRef.current?.clientHeight || window.innerHeight;
       const cx = (-(x * TILE_SIZE) - TILE_SIZE / 2) * mapContainer.scale.x + width / 2;
       const cy = (-(y * TILE_SIZE) - TILE_SIZE / 2) * mapContainer.scale.y + height / 2;

       mapContainer.x = cx;
       mapContainer.y = cy;
       clampMapPosition(mapContainer, width, height, TILE_SIZE);
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
      const textureEntries = await Promise.all([
        ['infantry', INFANTRY_SVG],
        ['marine', MARINE_SVG],
        ['tank', TANK_SVG],
        ['ifv', IFV_SVG],
        ['artillery', ARTILLERY_SVG],
        ['recon', RECON_SVG],
        ['hq', HQ_SVG],
        ['factory', FACTORY_SVG],
        ['supply_truck', SUPPLY_TRUCK_SVG],
        ['engineer', ENGINEER_SVG],
        ['fob', FOB_SVG],
        ['rocket', ROCKET_SVG],
        ['aa', AA_SVG],
        ['bunker', BUNKER_SVG],
      ].map(async ([type, src]) => [type, await PIXI.Assets.load(src)] as [string, PIXI.Texture]));
      unitTexturesRef.current = Object.fromEntries(textureEntries);
      
      if (destroyed) return;
      setTexturesLoaded(true);

      await app.init({
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundColor: 0x2b2e25, // dark olive background surrounding the map
        autoDensity: true,
        powerPreference: 'high-performance',
        resolution: Math.min(window.devicePixelRatio || 1, 2),
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
         if (e.button === 0) {
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
          clampMapPosition(mapContainer, width, height, TILE_SIZE);
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

      let resizeFrame = 0;
      const handleResize = () => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(recoverRenderer);
      };
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
      let rightDownStart: PIXI.Point | null = null;
      let rightDragDistance = 0;
      
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

      const issueMoveOrder = (globalPos: PIXI.Point) => {
          const pos = mapContainer.toLocal(globalPos);
          const tx = Math.floor(pos.x / TILE_SIZE);
          const ty = Math.floor(pos.y / TILE_SIZE);
          if (tx < 0 || ty < 0 || tx >= MAP_WIDTH || ty >= MAP_HEIGHT) return;
          const state = useGameStore.getState();
          if (!state.socket || state.selectedUnitIds.length === 0 || !state.playerDetails) return;

          const friendlySelectedIds = state.selectedUnitIds.filter(id => {
             const unit = state.units[id];
             return unit && unit.team === state.playerDetails?.team;
          });

          if (friendlySelectedIds.length > 0) {
             buildFormationPreview(friendlySelectedIds, tx, ty);
             state.socket.emit('formation_move', { ids: friendlySelectedIds, targetX: tx, targetY: ty });
          }
      };

      app.stage.on('pointerdown', (e) => {
        if (e.button === 1 || e.button === 2) {
            panning = true;
            lastPos = { x: e.global.x, y: e.global.y };
            if (e.button === 2) {
              rightDownStart = new PIXI.Point(e.global.x, e.global.y);
              rightDragDistance = 0;
            }
        } else if (e.button === 0) {
            if (deploySelectedUnitType(e.global)) return;
            if (!useGameStore.getState().selectedTypeToBuild) {
                dragStart = mapContainer.toLocal(e.global);
                dragBox.clear();
            }
        }
      });
      app.stage.on('pointerup', (e) => {
          if (e.button === 2) {
             const wasClick = rightDragDistance < 8;
             panning = false;
             rightDownStart = null;
             rightDragDistance = 0;
             if (wasClick) issueMoveOrder(e.global);
             return;
          }
          if (e.button === 1) panning = false;
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
                           const selectedSet = new Set(state.selectedUnitIds);
                           const allAlreadySelected = newSelected.every(id => selectedSet.has(id));
                           state.setSelectedUnits(allAlreadySelected
                             ? state.selectedUnitIds.filter(id => !newSelected.includes(id))
                             : Array.from(new Set([...state.selectedUnitIds, ...newSelected]))
                           );
                         } else {
                           state.setSelectedUnits(newSelected);
                         }
                     } else if (!e.shiftKey) {
                         state.setSelectedUnit(null);
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
          clampMapPosition(mapContainer, app.renderer.width, app.renderer.height, TILE_SIZE);
          lastPos = { x: e.global.x, y: e.global.y };
          if (rightDownStart) {
            rightDragDistance = Math.max(rightDragDistance, Math.hypot(e.global.x - rightDownStart.x, e.global.y - rightDownStart.y));
          }
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
           clampMapPosition(mapContainer, app.renderer.width, app.renderer.height, TILE_SIZE);
       };
      containerRef.current?.addEventListener('wheel', handleWheel, { passive: false });
       
       mapContainer.x = - (MAP_WIDTH * TILE_SIZE) / 2 + app.renderer.width / 2;
       mapContainer.y = - (MAP_HEIGHT * TILE_SIZE) / 2 + app.renderer.height / 2;
       clampMapPosition(mapContainer, app.renderer.width, app.renderer.height, TILE_SIZE);

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
                  for (let i = 0; i < territory.length; i++) {
                      if (territory[i] !== myTerritoryValue) continue;
                      visibilityGrid[i] = 1;
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
                      const pulse = Math.sin(now / 300) * 0.08 + 0.16;
                      lines.circle(sprite.x, sprite.y, radius * TILE_SIZE);
                      lines.fill({ color: 0x88ccff, alpha: pulse * 0.35 });
                      lines.stroke({ width: 4, color: 0x07121a, alpha: 0.4 });
                      lines.stroke({ width: 1.5, color: 0x9ee7ff, alpha: 0.75 });
                      for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
                        const inner = radius * TILE_SIZE - 8;
                        const outer = radius * TILE_SIZE + 8;
                        lines.moveTo(sprite.x + Math.cos(a) * inner, sprite.y + Math.sin(a) * inner);
                        lines.lineTo(sprite.x + Math.cos(a) * outer, sprite.y + Math.sin(a) * outer);
                      }
                      lines.stroke({ width: 2, color: 0xf6d36f, alpha: 0.42 });
                  }
                  
                  // Draw movement range
                  if (u.team === myTeam && u.type !== 'hq' && u.type !== 'factory' && u.type !== 'fob' && u.type !== 'bunker') {
                      const maxRange = Math.max(2, Math.ceil((UNIT_STATS[u.type]?.speed || 1) * MOVE_RANGE_MULTIPLIER));
                      const rx = (Math.floor(u.x) - maxRange);
                      const ry = (Math.floor(u.y) - maxRange);
                      const rw = (maxRange * 2 + 1);
                      const rh = (maxRange * 2 + 1);

                      lines.rect(rx * TILE_SIZE, ry * TILE_SIZE, rw * TILE_SIZE, rh * TILE_SIZE);
                      lines.fill({ color: 0x8bd3ff, alpha: 0.035 });
                      lines.stroke({ width: 3, color: 0x07121a, alpha: 0.35 });
                      lines.stroke({ width: 1, color: 0xdff8ff, alpha: 0.32 });
                  }

                  if (u && u.targetX != null && u.targetY != null) {
                      const tColor = teamColors[u.team] || teamColors.NEUTRAL;
                      const tgtX = u.targetX * TILE_SIZE + TILE_SIZE/2;
                      const tgtY = u.targetY * TILE_SIZE + TILE_SIZE/2;
                      const dx = tgtX - sprite.x;
                      const dy = tgtY - sprite.y;
                      const len = Math.max(1, Math.hypot(dx, dy));
                      const ux = dx / len;
                      const uy = dy / len;
                      const sx = -uy;
                      const sy = ux;

                      lines.moveTo(sprite.x, sprite.y);
                      lines.lineTo(tgtX, tgtY);
                      lines.stroke({ width: 7, color: 0x050706, alpha: 0.34 });
                      lines.moveTo(sprite.x, sprite.y);
                      lines.lineTo(tgtX, tgtY);
                      lines.stroke({ width: 2.5, color: tColor, alpha: 0.72 });

                      for (let d = 24 + ((now / 18) % 28); d < len - 10; d += 28) {
                        const cx = sprite.x + ux * d;
                        const cy = sprite.y + uy * d;
                        lines.moveTo(cx - ux * 6 + sx * 4, cy - uy * 6 + sy * 4);
                        lines.lineTo(cx + ux * 6, cy + uy * 6);
                        lines.lineTo(cx - ux * 6 - sx * 4, cy - uy * 6 - sy * 4);
                        lines.stroke({ width: 2, color: 0xffe08a, alpha: 0.62 });
                      }

                      lines.circle(tgtX, tgtY, 12);
                      lines.stroke({ width: 4, color: 0x050706, alpha: 0.44 });
                      lines.stroke({ width: 2, color: tColor, alpha: 0.9 });
                      lines.moveTo(tgtX - 15, tgtY); lines.lineTo(tgtX - 5, tgtY);
                      lines.moveTo(tgtX + 5, tgtY); lines.lineTo(tgtX + 15, tgtY);
                      lines.moveTo(tgtX, tgtY - 15); lines.lineTo(tgtX, tgtY - 5);
                      lines.moveTo(tgtX, tgtY + 5); lines.lineTo(tgtX, tgtY + 15);
                      lines.stroke({ width: 2, color: 0xffe08a, alpha: 0.85 });
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
                  lines.circle(targetPx, targetPy, 18);
                  lines.fill({ color: 0xfacc15, alpha: 0.08 * fade });
                  lines.stroke({ width: 4, color: 0x050706, alpha: 0.45 * fade });
                  lines.stroke({ width: 2, color: 0xfacc15, alpha: 0.95 * fade });
                  for (let a = 0; a < Math.PI * 2; a += Math.PI / 2) {
                    lines.moveTo(targetPx + Math.cos(a) * 7, targetPy + Math.sin(a) * 7);
                    lines.lineTo(targetPx + Math.cos(a) * 24, targetPy + Math.sin(a) * 24);
                  }
                  lines.stroke({ width: 2, color: 0xfff3c4, alpha: 0.78 * fade });

                  commandPreview.points.forEach(point => {
                    const px = point.x * TILE_SIZE + TILE_SIZE / 2;
                    const py = point.y * TILE_SIZE + TILE_SIZE / 2;
                    const color = point.type === 'artillery' || point.type === 'supply_truck' ? 0xcca054 : point.type === 'recon' || point.type === 'tank' || point.type === 'ifv' ? 0x8bd3ff : 0xffffff;
                    const size = point.type === 'artillery' || point.type === 'supply_truck' ? 5 : 6;
                    lines.rect(px - size, py - size, size * 2, size * 2);
                    lines.fill({ color, alpha: 0.14 * fade });
                    lines.stroke({ width: 2, color: 0x050706, alpha: 0.35 * fade });
                    lines.stroke({ width: 1, color, alpha: 0.86 * fade });
                  });
              }
          }

          // Lasers
          state.combatHits.forEach(hit => {
              const hColor = teamColors[hit.team] || teamColors.NEUTRAL;
              const tx = (hit.toX + 0.5) * TILE_SIZE;
              const ty = (hit.toY + 0.5) * TILE_SIZE;
              lines.moveTo((hit.fromX + 0.5) * TILE_SIZE, (hit.fromY + 0.5) * TILE_SIZE);
              lines.lineTo(tx, ty);
              lines.stroke({ width: 7, color: 0xfff3c4, alpha: 0.2 });
              lines.moveTo((hit.fromX + 0.5) * TILE_SIZE, (hit.fromY + 0.5) * TILE_SIZE);
              lines.lineTo(tx, ty);
              lines.stroke({ width: 3, color: hColor, alpha: 0.88 });
              lines.circle(tx, ty, 7);
              lines.fill({ color: 0xffa000, alpha: 0.22 });
              lines.stroke({ width: 2, color: 0xfff3c4, alpha: 0.78 });
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
             fow.fill({ color: 0x000000, alpha: 0.88 });
             for (let y = 0; y < MAP_HEIGHT; y += 2) {
                 fow.rect(0, y * TILE_SIZE, MAP_WIDTH * TILE_SIZE, TILE_SIZE);
             }
             fow.fill({ color: 0x071015, alpha: 0.18 });
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
              supplyLineGraphics.stroke({ width: 12, color: 0x030706, alpha: 0.24 });
              supplyLineGraphics.moveTo(x1, y1);
              supplyLineGraphics.lineTo(x2, y2);
              supplyLineGraphics.stroke({ width: 7, color, alpha: 0.12 + supplyPulse * 0.08 });
              supplyLineGraphics.moveTo(x1, y1);
              supplyLineGraphics.lineTo(x2, y2);
              supplyLineGraphics.stroke({ width: 2, color: 0xffe8a3, alpha: 0.28 });
              supplyLineGraphics.moveTo(x1, y1);
              supplyLineGraphics.lineTo(x2, y2);
              supplyLineGraphics.stroke({ width: 1.5, color, alpha: supplyPulse });

              if (unitCount > 1200) return;
              const step = TILE_SIZE * 1.8;
              const offset = (now / 18) % step;
              for (let d = offset; d < len; d += step) {
                const t = d / len;
                const px = x1 + dx * t;
                const py = y1 + dy * t;
                supplyLineGraphics.circle(px, py, 4.2);
                supplyLineGraphics.fill({ color: 0xfff0b4, alpha: 0.18 });
                supplyLineGraphics.circle(px, py, 2.2);
                supplyLineGraphics.fill({ color, alpha: 0.9 });
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
      territoryContainer.fill({ color, alpha: 0.18 });

      if ((tx + ty) % 4 === 0) {
        territoryContainer.moveTo(tx * TILE_SIZE + 5, ty * TILE_SIZE + TILE_SIZE - 4);
        territoryContainer.lineTo(tx * TILE_SIZE + TILE_SIZE - 4, ty * TILE_SIZE + 5);
        territoryContainer.stroke({ width: 1, color, alpha: 0.2 });
      }

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
        territoryContainer.stroke({ width: 3, color: 0x050706, alpha: 0.22 });
        territoryContainer.stroke({ width: 1.5, color, alpha: 0.68 });
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
          const texture = unitTexturesRef.current[unit.type] || PIXI.Texture.WHITE;
          
          spriteContainer.x = unit.x * TILE_SIZE + TILE_SIZE/2;
          spriteContainer.y = unit.y * TILE_SIZE + TILE_SIZE/2;

          const baseGraphics = new PIXI.Graphics();
          spriteContainer.addChild(baseGraphics);

          const sprite = new PIXI.Sprite(texture);
          sprite.anchor.set(0.5);
          sprite.width = TILE_SIZE * 1.2;
          sprite.height = TILE_SIZE * 1.2;
          sprite.tint = 0xffffff;
          spriteContainer.addChild(sprite);

          const overlayGraphics = new PIXI.Graphics();
          spriteContainer.addChild(overlayGraphics);

          spriteContainer.eventMode = 'static';
          spriteContainer.cursor = 'pointer';
          spriteContainer.on('pointerdown', (e) => {
             if (e.button !== 0) return;
             e.stopPropagation();
             const state = useGameStore.getState();
             const clickedAt = Date.now();
             if (clickedAt - lastUnitClickAtRef.current < DOUBLE_CLICK_MS) {
                const unit = state.units[id];
                if (unit) {
                  window.dispatchEvent(new CustomEvent('center-map', { detail: { x: unit.x, y: unit.y } }));
                }
             }
             lastUnitClickAtRef.current = clickedAt;
             if (e.shiftKey) {
                const exists = state.selectedUnitIds.includes(id);
                const next = exists ? state.selectedUnitIds.filter(selectedId => selectedId !== id) : [...state.selectedUnitIds, id];
                state.setSelectedUnits(next);
             } else {
                setSelectedUnit(id);
             }
          });

          container.addChild(spriteContainer);
          unitSpritesRef.current[id] = spriteContainer;
       }

       const iconSprite = spriteContainer.children.find(c => c instanceof PIXI.Sprite) as PIXI.Sprite;
       if (iconSprite) {
           iconSprite.tint = 0xffffff;
           const iconScale = ['hq', 'factory', 'fob', 'bunker'].includes(unit.type) ? 1.28 : unit.type === 'infantry' ? 1.1 : 1.2;
           iconSprite.width = TILE_SIZE * iconScale;
           iconSprite.height = TILE_SIZE * iconScale;
       }

       const graphicsLayers = spriteContainer.children.filter((c): c is PIXI.Graphics => c instanceof PIXI.Graphics);
       let baseG = graphicsLayers[0];
       let g = graphicsLayers[1];
       if (!baseG) {
          baseG = new PIXI.Graphics();
          spriteContainer.addChildAt(baseG, 0);
       }
       if (!g) {
          g = new PIXI.Graphics();
          spriteContainer.addChild(g);
       }
       baseG.clear();
       g.clear();

       const maxHp = UNIT_STATS[unit.type]?.maxHp || 100;
       const hpPct = Math.max(0, unit.hp / maxHp);
       const isFriendlyMobile = unit.team === useGameStore.getState().playerDetails?.team && !['hq', 'factory', 'fob', 'bunker'].includes(unit.type);
       const tColor = teamColors[unit.team] || teamColors.NEUTRAL;
       const faction = factionAccents[unit.team] || factionAccents.NEUTRAL;
       const isSelected = useGameStore.getState().selectedUnitIds.includes(unit.id);

       baseG.ellipse(0, TILE_SIZE * 0.2, TILE_SIZE * 0.62, TILE_SIZE * 0.34);
       baseG.fill({ color: 0x020403, alpha: 0.46 });
       baseG.circle(0, 0, TILE_SIZE * (isSelected ? 0.72 : 0.6));
       baseG.fill({ color: faction.dark, alpha: isSelected ? 0.32 : 0.2 });
       baseG.circle(0, 0, TILE_SIZE * (isSelected ? 0.66 : 0.52));
       baseG.fill({ color: tColor, alpha: isSelected ? 0.32 : 0.2 });
       baseG.stroke({ width: isSelected ? 3 : 2, color: 0x050706, alpha: 0.7 });
       baseG.stroke({ width: 2, color: faction.accent, alpha: unit.team === 'RED' ? 0.92 : 0.82 });
       baseG.stroke({ width: 1.5, color: tColor, alpha: isSelected ? 1 : 0.78 });
       baseG.moveTo(-TILE_SIZE * 0.52, TILE_SIZE * 0.38);
       baseG.lineTo(0, TILE_SIZE * 0.56);
       baseG.lineTo(TILE_SIZE * 0.52, TILE_SIZE * 0.38);
       baseG.stroke({ width: 2, color: 0xffe7a3, alpha: isSelected ? 0.58 : 0.22 });

       baseG.roundRect(-TILE_SIZE * 0.52, TILE_SIZE * 0.42, TILE_SIZE * 1.04, TILE_SIZE * 0.28, 3);
       baseG.fill({ color: faction.dark, alpha: 0.96 });
       baseG.stroke({ width: 1.5, color: faction.accent, alpha: 0.9 });
       if (unit.team === 'BLUE') {
          baseG.rect(-TILE_SIZE * 0.48, TILE_SIZE * 0.47, TILE_SIZE * 0.78, 2);
          baseG.rect(-TILE_SIZE * 0.48, TILE_SIZE * 0.56, TILE_SIZE * 0.78, 2);
          baseG.fill({ color: 0xffffff, alpha: 0.95 });
          baseG.rect(-TILE_SIZE * 0.48, TILE_SIZE * 0.47, TILE_SIZE * 0.28, TILE_SIZE * 0.15);
          baseG.fill({ color: 0x1d4ed8, alpha: 1 });
          drawStar(baseG, -TILE_SIZE * 0.34, TILE_SIZE * 0.545, 4, 1.8, 0xffffff, 1);
       } else if (unit.team === 'RED') {
          drawStar(baseG, -TILE_SIZE * 0.35, TILE_SIZE * 0.545, 7, 3, 0xffd34d, 1);
          baseG.arc(-TILE_SIZE * 0.07, TILE_SIZE * 0.55, 7, -Math.PI * 0.35, Math.PI * 0.88);
          baseG.stroke({ width: 2, color: 0xffd34d, alpha: 0.95 });
          baseG.moveTo(TILE_SIZE * 0.08, TILE_SIZE * 0.47);
          baseG.lineTo(TILE_SIZE * 0.25, TILE_SIZE * 0.62);
          baseG.stroke({ width: 2.2, color: 0xffd34d, alpha: 0.95 });
       } else {
          baseG.rect(-TILE_SIZE * 0.42, TILE_SIZE * 0.52, TILE_SIZE * 0.84, 2);
          baseG.fill({ color: 0xe5e7eb, alpha: 0.86 });
       }

       if (['hq', 'factory', 'fob', 'bunker'].includes(unit.type)) {
          baseG.rect(-TILE_SIZE * 0.62, -TILE_SIZE * 0.62, TILE_SIZE * 1.24, TILE_SIZE * 1.24);
          baseG.stroke({ width: 2, color: tColor, alpha: 0.38 });
       }

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

       if (hpPct < 1 || isSelected) {
          g.rect(-TILE_SIZE/2 + 1, -TILE_SIZE/2 - 9, TILE_SIZE - 2, 5);
          g.fill({ color: 0x050706, alpha: 0.88 });
          g.rect(-TILE_SIZE/2 + 3, -TILE_SIZE/2 - 7, (TILE_SIZE - 6) * hpPct, 2);
          g.fill(hpPct < 0.3 ? 0xff4a3d : 0x7dff9f);
          g.stroke({ width: 1, color: 0xfff1bd, alpha: 0.25 });
       }

       if (unit.type === 'factory' && (unit.captureProgress || 0) > 0) {
          const pct = Math.max(0, Math.min(1, (unit.captureProgress || 0) / FACTORY_CAPTURE_TICKS));
          g.rect(-TILE_SIZE/2 + 2, TILE_SIZE/2 + 5, TILE_SIZE - 4, 4);
          g.fill({ color: 0x111111, alpha: 0.75 });
          g.rect(-TILE_SIZE/2 + 2, TILE_SIZE/2 + 5, (TILE_SIZE - 4) * pct, 4);
          g.fill({ color: unit.captureTeam === 'RED' ? teamColors.RED : teamColors.BLUE, alpha: 0.9 });
       }

       if (isSelected) {
          const bracketColor = 0xe9fbff;
          const s = TILE_SIZE / 2 + 5;
          g.circle(0, 0, TILE_SIZE * 0.76);
          g.stroke({ width: 1, color: 0xfacc15, alpha: 0.45 });
          g.moveTo(-s, -s + 6); g.lineTo(-s, -s); g.lineTo(-s + 6, -s);
          g.stroke({ width: 3, color: 0x050706, alpha: 0.7 });
          g.stroke({ width: 1.5, color: bracketColor });
          g.moveTo(s - 6, -s); g.lineTo(s, -s); g.lineTo(s, -s + 6);
          g.stroke({ width: 3, color: 0x050706, alpha: 0.7 });
          g.stroke({ width: 1.5, color: bracketColor });
          g.moveTo(-s, s - 6); g.lineTo(-s, s); g.lineTo(-s + 6, s);
          g.stroke({ width: 3, color: 0x050706, alpha: 0.7 });
          g.stroke({ width: 1.5, color: bracketColor });
          g.moveTo(s - 6, s); g.lineTo(s, s); g.lineTo(s, s - 6);
          g.stroke({ width: 3, color: 0x050706, alpha: 0.7 });
          g.stroke({ width: 1.5, color: bracketColor });
       }

       if (unit.suppressed) {
          g.rect(-TILE_SIZE/2 + 3, TILE_SIZE/2 + 7, TILE_SIZE - 6, 5);
          g.fill({ color: 0x050706, alpha: 0.8 });
          g.rect(-TILE_SIZE/2 + 5, TILE_SIZE/2 + 9, TILE_SIZE - 10, 1.5);
          g.fill({ color: 0xfacc15, alpha: 0.95 });
          g.moveTo(-TILE_SIZE * 0.45, -TILE_SIZE * 0.45);
          g.lineTo(TILE_SIZE * 0.45, TILE_SIZE * 0.45);
          g.moveTo(TILE_SIZE * 0.45, -TILE_SIZE * 0.45);
          g.lineTo(-TILE_SIZE * 0.45, TILE_SIZE * 0.45);
          g.stroke({ width: 1.5, color: 0xfacc15, alpha: 0.4 });
       }
       
       if (unit.rank) {
           for (let i = 0; i < unit.rank; i++) {
               const px = -TILE_SIZE/2 + 5 + (i * 6);
               const py = TILE_SIZE/2 + 4;
               g.moveTo(px, py - 3);
               g.lineTo(px + 3, py + 3);
               g.lineTo(px - 3, py + 3);
               g.lineTo(px, py - 3);
               g.fill({ color: 0xffd867, alpha: 0.95 });
               g.stroke({ width: 1, color: 0x000000, alpha: 0.8 });
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
        
        g.circle(ex, ey, rad * 1.15);
        g.fill({ color: 0x0b0703, alpha: 0.22 });
        g.circle(ex, ey, rad);
        g.fill({ color: 0xff7a1a, alpha: 0.14 });
        g.stroke({ color: 0xffd36b, width: 3, alpha: 0.6 });
        
        g.circle(ex, ey, rad * 0.5);
        g.fill({ color: 0xffe0a3, alpha: 0.28 });
        g.circle(ex, ey, rad * 0.2);
        g.fill({ color: 0xffffff, alpha: 0.32 });
        
        for(let i=0; i<14; i++) {
            const angle = (i / 14) * Math.PI * 2;
            const spoke = rad * (0.72 + tileNoise(exp.x, exp.y, i) * 0.42);
            g.moveTo(ex + Math.cos(angle) * (rad * 0.2), ey + Math.sin(angle) * (rad * 0.2));
            g.lineTo(ex + Math.cos(angle) * spoke, ey + Math.sin(angle) * spoke);
            g.stroke({ color: i % 2 ? 0xffaa00 : 0xfff0bd, width: i % 2 ? 1.5 : 1, alpha: 0.48 });
        }
        container.addChild(g);
        explosionSpritesRef.current[exp.id] = g;
     });

  }, [units, selectedUnitId, explosions, texturesLoaded]);

  return <div ref={containerRef} onContextMenu={e => e.preventDefault()} className={`absolute inset-0 overflow-hidden ${selectedTypeToBuild ? 'cursor-crosshair' : ''}`} />;
}
