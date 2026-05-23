import React, { useEffect, useRef } from 'react';
import { useGameStore } from './store';
import { MAP_WIDTH, MAP_HEIGHT } from './shared/constants';

const colors: Record<string, string> = {
  grass: '#758b58',
  forest: '#2f5232',
  urban: '#736f66',
  trench: '#5a4935',
  swamp: '#516145',
  water: '#436d7d',
  road: '#9b8d70',
  rail: '#706c63',
  mountain: '#746b58'
};

const teamColors: Record<string, string> = {
  BLUE: '#1f6fff',
  RED: '#dc2626',
  NEUTRAL: '#e5e7eb',
};

const territoryColors: Record<string, string> = {
  BLUE: 'rgba(31, 111, 255, 0.24)',
  RED: 'rgba(220, 38, 38, 0.24)',
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
          if ((x + y) % 9 === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.fillRect(x * cellW, y * cellH, cellW + 0.5, Math.max(1, cellH * 0.35));
          }
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
            if ((tx + ty) % 5 === 0) {
              ctx.fillStyle = val === 1 ? 'rgba(147,197,253,0.25)' : 'rgba(252,165,165,0.25)';
              ctx.fillRect(tx * cellW, ty * cellH, Math.max(1, cellW * 0.35), cellH + 0.5);
            }
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

    const gradient = ctx.createRadialGradient(cw / 2, ch / 2, 8, cw / 2, ch / 2, Math.max(cw, ch) / 1.35);
    gradient.addColorStop(0, 'rgba(255,255,255,0.04)');
    gradient.addColorStop(0.74, 'rgba(0,0,0,0.04)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, cw, ch);

    // Draw Supply Lines
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    supplyLines.forEach(line => {
       ctx.shadowColor = teamColors[line.team];
       ctx.shadowBlur = 6;
       ctx.strokeStyle = 'rgba(0,0,0,0.55)';
       ctx.lineWidth = 3;
       ctx.beginPath();
       ctx.moveTo((line.x1 + 0.5) * cellW, (line.y1 + 0.5) * cellH);
       ctx.lineTo((line.x2 + 0.5) * cellW, (line.y2 + 0.5) * cellH);
       ctx.stroke();
       ctx.shadowBlur = 3;
       ctx.strokeStyle = teamColors[line.team];
       ctx.lineWidth = 1.25;
       ctx.setLineDash([3, 2]);
       ctx.beginPath();
       ctx.moveTo((line.x1 + 0.5) * cellW, (line.y1 + 0.5) * cellH);
       ctx.lineTo((line.x2 + 0.5) * cellW, (line.y2 + 0.5) * cellH);
       ctx.stroke();
       ctx.setLineDash([]);
    });
    ctx.shadowBlur = 0;

    // Draw Units
    Object.values(units).forEach(u => {
       ctx.fillStyle = teamColors[u.team] || teamColors.NEUTRAL;
       
       const isSelected = selectedUnitIds.includes(u.id);
       ctx.shadowColor = isSelected ? '#facc15' : (teamColors[u.team] || '#fff');
       ctx.shadowBlur = isSelected ? 8 : 3;
       if (u.type === 'hq' || u.type === 'factory' || u.type === 'fob' || u.type === 'bunker') {
           ctx.fillStyle = 'rgba(0,0,0,0.55)';
           ctx.fillRect(u.x * cellW - 1, u.y * cellH - 1, cellW * 2 + 2, cellH * 2 + 2);
           ctx.fillStyle = teamColors[u.team] || teamColors.NEUTRAL;
           ctx.fillRect(u.x * cellW, u.y * cellH, cellW * 2, cellH * 2);
           ctx.strokeStyle = isSelected ? '#facc15' : 'rgba(255,255,255,0.9)';
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
    ctx.shadowBlur = 0;

  }, [units, terrainVersion, territoryVersion, selectedUnitIds, supplyLines]);

  return (
    <div className={`p-1 bg-[#11130f] border-2 border-white/10 rounded overflow-hidden shadow-xl ring-1 ring-[#facc15]/20 ${className}`}>
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
