import React, { useEffect, useRef } from 'react';
import { useGameStore } from './store';
import { MAP_WIDTH, MAP_HEIGHT } from './shared/constants';

const colors: Record<string, string> = {
  grass: '#6e885c',
  forest: '#415b33',
  urban: '#736b60',
  trench: '#5c4d3c',
  swamp: '#5a6345',
  water: '#516e78',
  road: '#8a8170',
  rail: '#6f6a62',
  mountain: '#756c58'
};

const teamColors: Record<string, string> = {
  BLUE: '#3b82f6',
  RED: '#ef4444',
  NEUTRAL: '#e5e7eb',
};

const territoryColors: Record<string, string> = {
  BLUE: 'rgba(59, 130, 246, 0.3)',
  RED: 'rgba(239, 68, 68, 0.3)',
};

export default function MiniMap({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const territoryCanvasRef = useRef<HTMLCanvasElement | null>(null);
  
  const blocks = useGameStore(state => state.blocks);
  const units = useGameStore(state => state.units);
  const selectedUnitIds = useGameStore(state => state.selectedUnitIds);
  const territory = useGameStore(state => state.territory);
  const territoryVersion = useGameStore(state => state.territoryVersion);
  const terrainVersion = useGameStore(state => state.terrainVersion);
  const supplyLines = useGameStore(state => state.supplyLines);

  useEffect(() => {
    if (Object.keys(blocks).length === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = MAP_WIDTH * 2;
    canvas.height = MAP_HEIGHT * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    const cellW = cw / MAP_WIDTH;
    const cellH = ch / MAP_HEIGHT;

    for (let x = 0; x < MAP_WIDTH; x++) {
      for (let y = 0; y < MAP_HEIGHT; y++) {
        const block = blocks[`${x},${y}`];
        if (block) {
          ctx.fillStyle = colors[block.type] || colors.grass;
          ctx.fillRect(x * cellW, y * cellH, cellW + 0.5, cellH + 0.5); 
        }
      }
    }

    terrainCanvasRef.current = canvas;
  }, [blocks, terrainVersion]);

  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = MAP_WIDTH * 2;
    canvas.height = MAP_HEIGHT * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cellW = canvas.width / MAP_WIDTH;
    const cellH = canvas.height / MAP_HEIGHT;
    for (let i = 0; i < territory.length; i++) {
        const val = territory[i];
        if (val !== 0) {
            const tx = i % MAP_WIDTH;
            const ty = Math.floor(i / MAP_WIDTH);
            ctx.fillStyle = val === 1 ? territoryColors.BLUE : territoryColors.RED;
            ctx.fillRect(tx * cellW, ty * cellH, cellW + 0.5, cellH + 0.5);
        }
    }
    territoryCanvasRef.current = canvas;
  }, [territory, territoryVersion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!terrainCanvasRef.current) return;

    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    const cellW = cw / MAP_WIDTH;
    const cellH = ch / MAP_HEIGHT;

    ctx.drawImage(terrainCanvasRef.current, 0, 0, cw, ch);
    if (territoryCanvasRef.current) ctx.drawImage(territoryCanvasRef.current, 0, 0, cw, ch);

    // Draw Supply Lines
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    supplyLines.forEach(line => {
       ctx.strokeStyle = teamColors[line.team];
       ctx.beginPath();
       ctx.moveTo((line.x1 + 0.5) * cellW, (line.y1 + 0.5) * cellH);
       ctx.lineTo((line.x2 + 0.5) * cellW, (line.y2 + 0.5) * cellH);
       ctx.stroke();
    });
    ctx.setLineDash([]);

    // Draw Units
    Object.values(units).forEach(u => {
       ctx.fillStyle = teamColors[u.team] || teamColors.NEUTRAL;
       
       const isSelected = selectedUnitIds.includes(u.id);
       if (u.type === 'hq' || u.type === 'factory' || u.type === 'fob' || u.type === 'bunker') {
           ctx.fillRect(u.x * cellW, u.y * cellH, cellW * 2, cellH * 2);
           ctx.strokeStyle = isSelected ? '#facc15' : '#fff';
           ctx.lineWidth = isSelected ? 2.5 : 1.5;
           ctx.strokeRect(u.x * cellW, u.y * cellH, cellW * 2, cellH * 2);
       } else if (u.type === 'supply_truck') {
           ctx.fillRect(u.x * cellW, u.y * cellH, cellW, cellH);
           ctx.strokeStyle = isSelected ? '#facc15' : '#000';
           ctx.lineWidth = isSelected ? 2 : 1;
           ctx.strokeRect(u.x * cellW, u.y * cellH, cellW, cellH);
       } else {
           ctx.beginPath();
           ctx.arc((u.x + 0.5) * cellW, (u.y + 0.5) * cellH, Math.max(cellW * (isSelected ? 1.2 : 0.8), 1.5), 0, Math.PI * 2);
           ctx.fill();
           if (isSelected) {
             ctx.strokeStyle = '#facc15';
             ctx.lineWidth = 2;
             ctx.stroke();
           }
       }
    });

  }, [units, terrainVersion, territoryVersion, selectedUnitIds, supplyLines]);

  return (
    <div className={`p-1 bg-[#1a1711] border-2 border-white/10 rounded overflow-hidden shadow-xl ${className}`}>
        <canvas 
            ref={canvasRef} 
            width={MAP_WIDTH * 2} 
            height={MAP_HEIGHT * 2} 
            className="w-full h-full cursor-pointer"
            style={{ imageRendering: 'pixelated' }}
            onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width * MAP_WIDTH;
                const y = (e.clientY - rect.top) / rect.height * MAP_HEIGHT;
                window.dispatchEvent(new CustomEvent('center-map', { detail: { x, y } }));
            }}
        />
        <div className="absolute top-2 left-2 text-[8px] font-mono text-white/50 tracking-widest pointer-events-none drop-shadow-md font-bold uppercase">Tactical Map</div>
    </div>
  );
}
