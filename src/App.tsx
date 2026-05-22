import React, { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useGameStore } from './store';
import MapCanvas from './MapCanvas';
import MiniMap from './MiniMap';
import { Anchor, Crosshair, Shield, Zap, CircleDashed, Navigation, Menu, X, Rocket, Radio, Wrench, Boxes, TimerReset, Factory, Flag } from 'lucide-react';
import { BUILDABLE_UNITS, BUNKER_COST, FACTORY_CAPTURE_TICKS, FOB_COST, UNIT_STATS } from './shared/constants';
import { BattleEvent, UnitClass, UnitOrderType, UnitState } from './shared/types';

const UNIT_DESCRIPTIONS: Partial<Record<UnitClass, string>> = {
  supply_truck: 'Extends territory and supply chains.',
  infantry: 'Cheap line troops that advance after kills.',
  marine: 'Elite expeditionary troops. Can land outside supply, fights best when linked up.',
  rocket: 'High burst damage against armor.',
  engineer: 'Builds FOBs and bunkers in the field.',
  ifv: 'Fast armored support.',
  aa: 'Long sightline defensive fire.',
  tank: 'Durable breakthrough armor.',
  artillery: 'Long-range fire support.',
  recon: 'Scouts beyond controlled ground.'
};

const UNIT_ROLES: Partial<Record<UnitClass, string>> = {
  supply_truck: 'Logistics',
  infantry: 'Line',
  marine: 'Expeditionary',
  rocket: 'Anti-armor',
  engineer: 'Builder',
  ifv: 'Mobile fire',
  aa: 'Screen',
  tank: 'Breakthrough',
  artillery: 'Siege',
  recon: 'Scout'
};

export default function App() {
  const [connected, setConnected] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Awaiting orders');
  
  const setSocket = useGameStore(state => state.setSocket);
  const initGame = useGameStore(state => state.initGame);
  const updateTick = useGameStore(state => state.updateTick);
  const applyStateDelta = useGameStore(state => state.applyStateDelta);
  const updateUnit = useGameStore(state => state.updateUnit);
  const updateUnits = useGameStore(state => state.updateUnits);
  const removeUnits = useGameStore(state => state.removeUnits);
  const updatePlayerState = useGameStore(state => state.updatePlayerState);
  const addBattleEvent = useGameStore(state => state.addBattleEvent);
  
  const socket = useGameStore(state => state.socket);
  const selectedTypeToBuild = useGameStore(state => state.selectedTypeToBuild);
  const setSelectedTypeToBuild = useGameStore(state => state.setSelectedTypeToBuild);
  const selectedUnitId = useGameStore(state => state.selectedUnitId);
  const selectedUnitIds = useGameStore(state => state.selectedUnitIds);
  const units = useGameStore(state => state.units);
  const playerDetails = useGameStore(state => state.playerDetails);
  const teams = useGameStore(state => state.teams);
  const winner = useGameStore(state => state.winner);
  const spawnCooldownEnd = useGameStore(state => state.spawnCooldownEnd);
  const battleEvents = useGameStore(state => state.battleEvents);
  
  const enableAiRed = useGameStore(state => state.enableAiRed);
  const enableAiBlue = useGameStore(state => state.enableAiBlue);
  const myTeam = playerDetails ? playerDetails.team : null;

  const [cooldownRemainingMs, setCooldownRemainingMs] = useState(0);
  const effectiveCooldownMs = Math.max(cooldownRemainingMs, spawnCooldownEnd - Date.now());
  const cooldownActive = effectiveCooldownMs > 0;
  const showCooldown = effectiveCooldownMs >= 450;
  const cdRemaining = Math.ceil(effectiveCooldownMs / 1000);

  const dismissStatusLater = (message: string) => {
    setStatusMessage(message);
    window.setTimeout(() => {
      setStatusMessage(current => current === message ? 'Awaiting orders' : current);
    }, 3500);
  };

  useEffect(() => {
    let interval = setInterval(() => {
       const now = Date.now();
       setCooldownRemainingMs(Math.max(0, spawnCooldownEnd - now));
    }, 50);
    return () => clearInterval(interval);
  }, [spawnCooldownEnd]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSelectedTypeToBuild(null);
        setMobileMenuOpen(false);
        useGameStore.getState().setSelectedUnit(null);
      }
      if (event.key.toLowerCase() === 'h' && myTeam) {
        const hq = Object.values(useGameStore.getState().units).find(u => (u.type === 'hq' || u.type === 'factory' || u.type === 'fob') && u.team === myTeam);
        if (hq) window.dispatchEvent(new CustomEvent('center-map', { detail: { x: hq.x, y: hq.y } }));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [myTeam, setSelectedTypeToBuild]);

  useEffect(() => {
    const s = io(undefined, { path: '/socket.io' });
    
    s.on('connect', () => {
      setConnected(true);
      setSocket(s);
      dismissStatusLater('Secure comm link established');
    });

    s.on('disconnect', () => {
      setConnected(false);
      dismissStatusLater('Comm link interrupted');
    });

    s.on('init', (gameState) => {
       initGame(gameState);
    });

    s.on('init_territory', (buf: ArrayBuffer) => {
       useGameStore.getState().setTerritory(new Uint8Array(buf));
    });

    s.on('territory_diff', (diffs: [number, number][]) => {
       useGameStore.getState().applyTerritoryDiff(diffs);
    });

    s.on('terrain_patch', (patch) => {
       useGameStore.getState().applyTerrainPatch(patch);
    });

    s.on('spawn_cooldown', (time: number) => {
       useGameStore.getState().setSpawnCooldownEnd(time);
    });

    s.on('spawn_result', (result: { ok: boolean, message?: string, cooldownEnd?: number, unit?: UnitState }) => {
       const store = useGameStore.getState();
       if (result.unit) updateUnit(result.unit);
       if (result.cooldownEnd) {
          store.setSpawnCooldownEnd(result.cooldownEnd);
       } else if (!result.ok) {
          store.setSpawnCooldownEnd(0);
       }
       if (result.message) dismissStatusLater(result.message);
    });

    s.on('error_msg', (msg: string) => {
       dismissStatusLater(msg);
    });

    s.on('tick', (data) => {
       updateTick(data);
    });

    s.on('state_delta', (data) => {
       applyStateDelta(data);
    });

    s.on('player_sync', (p) => {
       updatePlayerState(p);
    });

    s.on('explosion', (data) => {
       useGameStore.getState().addExplosion(data.x, data.y, data.radius);
    });

    s.on('combat_hit', (data) => {
       useGameStore.getState().addCombatHit(data);
    });

    s.on('unit_spawned', (unit) => {
       updateUnit(unit);
    });

    s.on('units_updated', (unitList: UnitState[]) => {
       updateUnits(unitList);
    });

    s.on('units_removed', (ids: string[]) => {
       removeUnits(ids);
    });

    s.on('battle_event', (event: BattleEvent) => {
       addBattleEvent(event);
       if (event.priority >= 3) dismissStatusLater(event.message);
    });

    return () => {
      s.disconnect();
    };
  }, []);

  const selectedUnit = selectedUnitId ? units[selectedUnitId] : null;
  const myTeamData = myTeam && teams[myTeam] ? teams[myTeam] : { supplies: 0, score: 0 };
  const selectedUnits = selectedUnitIds.map(id => units[id]).filter(Boolean);
  const influence = Math.floor(playerDetails?.influence || 0);
  const selectedHp = selectedUnits.reduce((sum, unit) => sum + unit.hp, 0);
  const selectedMaxHp = selectedUnits.reduce((sum, unit) => sum + (UNIT_STATS[unit.type]?.maxHp || 100), 0) || (selectedUnit ? UNIT_STATS[selectedUnit.type]?.maxHp || 100 : 100);
  const selectedHpPct = Math.max(0, Math.min(100, (selectedHp / selectedMaxHp) * 100));
  const selectedSupplied = selectedUnits.filter(unit => unit.supplied !== false).length;
  const selectedOrders = Object.entries(
    selectedUnits.reduce<Record<string, number>>((counts, unit) => {
      const order = unit.order?.type?.replace('_', ' ') || 'idle';
      counts[order] = (counts[order] || 0) + 1;
      return counts;
    }, {})
  ).map(([order, count]) => `${count} ${order}`).join(' / ');
  const selectedComposition = Object.entries(
    selectedUnits.reduce<Record<string, number>>((counts, unit) => {
      const name = UNIT_STATS[unit.type]?.name || unit.type;
      counts[name] = (counts[name] || 0) + 1;
      return counts;
    }, {})
  ).map(([name, count]) => `${count} ${name}`).join(' / ');
  const friendlySelectedIds = selectedUnitIds.filter(id => units[id]?.team === myTeam);
  const sendOrder = (type: UnitOrderType) => {
    if (friendlySelectedIds.length === 0) return;
    socket?.emit('set_order', { ids: friendlySelectedIds, type });
  };
  return (
    <div className="relative w-full h-screen bg-[#1c1c1a] font-sans overflow-hidden select-none">
       <MapCanvas />
       {connected && (
         <div className="absolute top-4 right-[300px] z-[999] pointer-events-auto flex gap-2">
           <button 
              onClick={() => socket?.emit('toggle_ai', 'RED')} 
              className={`px-4 py-2 font-bold uppercase tracking-widest text-xs rounded transition-colors ${enableAiRed ? 'bg-red-500 text-white' : 'bg-red-900/50 text-red-300 border border-red-700'}`}
           >
             {enableAiRed ? 'AI Red: ON' : 'AI Red: OFF'}
           </button>
           <button 
              onClick={() => socket?.emit('toggle_ai', 'BLUE')} 
              className={`px-4 py-2 font-bold uppercase tracking-widest text-xs rounded transition-colors ${enableAiBlue ? 'bg-blue-500 text-white' : 'bg-blue-900/50 text-blue-300 border border-blue-700'}`}
           >
             {enableAiBlue ? 'AI Blue: ON' : 'AI Blue: OFF'}
           </button>
           <button 
              onClick={() => {
                if (window.confirm("Are you sure you want to reset the game?")) {
                  socket?.emit('reset_game');
                }
              }} 
              className="px-4 py-2 bg-red-800 text-white font-bold uppercase tracking-widest text-xs rounded hover:bg-red-700"
           >
             Reset Game
           </button>
         </div>
       )}
       
       <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 pointer-events-none flex flex-col items-center opacity-80">
           <span className="text-white font-bold tracking-widest text-sm drop-shadow-md bg-black/60 px-4 py-1 rounded-sm border border-white/20">PIXEL FRONT: {selectedTypeToBuild ? 'INSTANT DEPLOYMENT' : 'SQUAD COMMAND'}</span>
           <span className="text-[#a4c294] font-bold tracking-widest text-[10px] mt-1 drop-shadow-md bg-black/40 px-2 py-0.5 rounded-sm uppercase">Troops and logistics claim pixels. Feed the front with trucks, factories, FOBs, and bunkers.</span>
           <span className="text-[#cca054] font-bold tracking-widest text-[10px] mt-1 drop-shadow-md bg-black/40 px-2 py-0.5 rounded-sm uppercase">Drag-select troops, right-click to formation march. Shift-click adds or removes squads.</span>
       </div>

       <div className="absolute inset-0 canvas-texture map-gradient pointer-events-none z-0 mix-blend-multiply opacity-80"></div>

       <div className="absolute left-1/2 top-24 md:top-28 -translate-x-1/2 z-[60] pointer-events-none">
         <div className="flex items-center gap-2 bg-black/70 border border-white/15 px-3 py-1.5 text-[10px] md:text-xs uppercase tracking-[0.2em] text-white/75 shadow-lg">
           <Radio className="w-3 h-3 text-[#cca054]" />
           {statusMessage}
         </div>
       </div>

       {battleEvents.length > 0 && (
         <div className="absolute left-2 md:left-6 top-28 md:top-36 z-[55] pointer-events-none w-[calc(100%-1rem)] max-w-[360px]">
           <div className="bg-black/68 border border-white/12 shadow-xl">
             <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 text-[10px] uppercase tracking-[0.22em] text-white/55">
               <Radio className="w-3 h-3 text-[#cca054]" />
               Battle Net
             </div>
             <div className="divide-y divide-white/5">
               {battleEvents.slice(0, 5).map(event => {
                 const eventColor = event.team === 'BLUE' ? 'text-blue-200' : event.team === 'RED' ? 'text-red-200' : 'text-white/70';
                 const badgeColor = event.priority >= 4 ? 'bg-[#cca054] text-black' : event.type === 'suppressed' ? 'bg-[#7a5c29] text-black' : event.team === 'BLUE' ? 'bg-blue-500/25 text-blue-100' : event.team === 'RED' ? 'bg-red-500/25 text-red-100' : 'bg-white/10 text-white/70';
                 return (
                   <div key={event.id} className="px-3 py-2 bg-black/20">
                     <div className="flex items-start gap-2">
                       <span className={`mt-0.5 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-widest ${badgeColor}`}>
                         {event.type.replace('_', ' ')}
                       </span>
                       <div className={`text-[10px] md:text-[11px] uppercase tracking-wider leading-4 ${eventColor}`}>
                         {event.message}
                       </div>
                     </div>
                   </div>
                 );
               })}
             </div>
           </div>
         </div>
       )}

       {/* Top HUD */}
       <div className="absolute top-0 left-0 w-full p-2 md:p-6 pointer-events-none flex flex-col md:flex-row justify-between items-start z-20 gap-2 md:gap-0">
           <div className={`hud-panel p-3 md:p-4 md:pb-5 pr-4 md:pr-8 pointer-events-auto border-4 relative w-full md:w-auto ${myTeam ? (myTeam === 'BLUE' ? 'bg-[#2b332b]/95 border-[#4a5d3f] text-[#a4c294]' : 'bg-[#3b2727]/95 border-[#613636] text-[#d48b8b]') : 'bg-[#292723]/95 border-[#4a463d] text-[#a19989]'}`}>
               <div className="absolute top-0 left-0 w-full h-1 bg-black/30"></div>
               <div className="flex justify-between items-center md:items-start">
                   <h1 className="text-xl md:text-3xl font-[family-name:var(--font-stencil)] tracking-[0.1em] flex items-center gap-2 md:gap-4 drop-shadow-md">
                     PIXEL FRONT <span className="text-xs md:text-base font-sans tracking-widest opacity-80 mt-1 md:mt-2">[ {myTeam || 'STDBY'} ]</span>
                   </h1>
                   <button 
                     className="md:hidden p-2 bg-black/40 rounded border border-white/20 active:bg-black/60"
                     onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                   >
                     {mobileMenuOpen ? <X className="w-5 h-5 text-white/80" /> : <Menu className="w-5 h-5 text-white/80" />}
                   </button>
               </div>
                 <div className="flex items-center gap-2 md:gap-3 mt-1 md:mt-2 text-[10px] md:text-xs tracking-widest font-bold border-t border-black/20 pt-1 md:pt-2">
                 <div className={`w-2 h-2 md:w-3 md:h-3 rounded-full border border-black/50 ${connected ? (myTeam ? (myTeam === 'BLUE' ? 'bg-green-500 shadow-[0_0_5px_currentColor]' : 'bg-red-500 shadow-[0_0_5px_currentColor]') : 'bg-amber-500') : 'bg-neutral-600'}`} />
                 <span className="opacity-90">{connected ? 'SECURE COMM LINK' : 'ESTABLISHING...'}</span>
                 <span className="hidden md:inline-flex items-center gap-1 border-l border-white/20 pl-2 ml-1 text-white/70">
                   <Radio className="w-3 h-3" /> {statusMessage}
                 </span>
                 {myTeam && myTeamData.stats && (
                     <div className="flex gap-2 text-[10px] items-center border-l border-white/20 pl-2 ml-1 opacity-80 uppercase tracking-widest hidden md:flex text-white">
                         <span>Pixels: <span className="text-[#cca054]">{Math.floor(myTeamData.score || 0).toLocaleString()}</span></span>
                         <span>Kills: <span className="text-[#a4c294]">{myTeamData.stats.kills}</span></span>
                           <span>Units: <span className="text-[#a4c294]">{myTeamData.stats.deployed}</span></span>
                         <span>Players: <span className="text-[#a4c294]">{myTeamData.stats.activePlayers || 0}</span></span>
                     </div>
                 )}
               </div>
           </div>

           {myTeam && (
             <div className="flex flex-col gap-2 w-full md:w-auto items-end pointer-events-none">
                 <div className={`hud-panel p-2 md:p-4 flex gap-4 md:gap-10 pointer-events-auto border-4 w-full md:w-auto justify-between md:justify-end ${myTeam === 'BLUE' ? 'bg-[#2b332b]/95 border-[#4a5d3f] text-[#a4c294]' : 'bg-[#3b2727]/95 border-[#613636] text-[#d48b8b]'}`}>
                     <div className="text-right">
                         <div className="text-[9px] md:text-[11px] font-bold tracking-[0.2em] opacity-80 mb-1 uppercase text-black/60 drop-shadow-sm flex items-center justify-end gap-1">Logistics</div>
                         <div className="text-xl md:text-3xl font-[family-name:var(--font-stencil)] tracking-wider drop-shadow-md">
                           {Math.floor(myTeamData.supplies).toLocaleString()} <span className="text-[10px] md:text-sm opacity-50">SU</span>
                         </div>
                         <div className="mt-2 h-1.5 w-32 bg-black/40 border border-white/10 ml-auto">
                           <div className="h-full bg-[#cca054] transition-all" style={{ width: `${Math.min(100, influence)}%` }} />
                         </div>
                         <div className="mt-1 text-[9px] font-bold tracking-[0.2em] text-white/50 uppercase">{influence} command influence</div>
                         <div className="mt-2 flex justify-end gap-3 text-[9px] uppercase tracking-widest text-white/55">
                           <span className="inline-flex items-center gap-1"><Factory className="w-3 h-3" /> {myTeamData.stats?.factories || 0}</span>
                           <span className="inline-flex items-center gap-1"><Flag className="w-3 h-3" /> {myTeamData.stats?.frontline || 0}</span>
                           <span>SUP {myTeamData.stats?.suppliedUnits || 0}</span>
                           <span>SPOT {myTeamData.stats?.spottedEnemies || 0}</span>
                           <span>Q {myTeamData.stats?.queueSize || 0}</span>
                           <span>CA {myTeamData.stats?.combinedArmsUnits || 0}</span>
                           <span>ENT {myTeamData.stats?.entrenchedUnits || 0}</span>
                           <span>REP {myTeamData.stats?.repairingUnits || 0}</span>
                         </div>
                     </div>
                     
                     <button 
                        onClick={() => {
                           // Center on HQ
                           // Find friendly HQ
                           const hq = Object.values(units).find(u => (u.type === 'hq' || u.type === 'factory' || u.type === 'fob') && u.team === myTeam);
                           if (hq) {
                               window.dispatchEvent(new CustomEvent('center-map', { detail: { x: hq.x, y: hq.y } }));
                           }
                        }}
                        className="flex flex-col items-center justify-center p-2 bg-black/30 border border-white/20 rounded active:bg-black/50 hover:bg-black/40 transition-colors ml-2 pointer-events-auto"
                        title="Center on HQ"
                     >
                        <Navigation className="w-5 h-5 opacity-80" />
                        <span className="text-[9px] font-bold mt-1 tracking-widest opacity-70">HQ</span>
                     </button>
                 </div>
                 
                 <div className="pointer-events-auto block w-[120px] h-[120px] md:w-[240px] md:h-[240px] mt-1 md:mt-2 relative ml-auto border-[3px] border-black/40 rounded shadow-2xl">
                     <MiniMap className="w-full h-full" />
                 </div>
             </div>
           )}
       </div>

       {/* Controls Panel */}
       {myTeam && (
         <div className={`absolute bottom-0 left-0 w-full md:bottom-6 md:left-6 pointer-events-auto flex flex-col gap-2 md:gap-4 z-10 md:w-[420px] transition-transform duration-300 ${mobileMenuOpen ? 'translate-y-0' : 'translate-y-full md:translate-y-0'}`}>
              <div className={`hud-panel p-4 md:p-5 bg-[#252422]/95 border-t-4 md:border-4 shadow-2xl ${myTeam === 'BLUE' ? 'border-[#4a5d3f] text-[#b5cf9e]' : 'border-[#613636] text-[#d48b8b]'}`}>
                  <div className="flex justify-between items-center mb-3 md:mb-4 border-b-2 border-black/30 pb-2">
                    <h3 className="text-sm md:text-base font-bold tracking-[0.2em] opacity-100 flex items-center gap-2 md:gap-3 drop-shadow-md">
                      <Zap className="w-4 h-4 md:w-5 md:h-5 opacity-80" /> PIXEL LOGISTICS
                    </h3>
                    <button className="md:hidden opacity-70 p-1" onClick={() => setMobileMenuOpen(false)}>
                        <X className="w-4 h-4" />
                      </button>
                  </div>
                  <div className="flex overflow-x-auto md:grid md:grid-cols-3 gap-2 md:gap-3 pb-2 md:pb-0 snap-x">
                      {BUILDABLE_UNITS.map(type => {
                        const canAfford = myTeamData.supplies >= UNIT_STATS[type].cost;
                        const disabled = !canAfford || cooldownActive;
                        const unitStats = UNIT_STATS[type];
                        const tooltip = `${UNIT_DESCRIPTIONS[type]} ${UNIT_ROLES[type] || 'Combat'} | HP ${unitStats.maxHp} | DMG ${unitStats.damage} | RNG ${unitStats.range}.`;
                        const Icon = type === 'marine' ? Anchor : type === 'rocket' ? Rocket : type === 'engineer' ? Wrench : type === 'supply_truck' ? Boxes : Shield;
                        return (
                        <button 
                          key={type}
                          onClick={() => { setSelectedTypeToBuild(type === selectedTypeToBuild ? null : type); }} 
                          disabled={disabled}
                          title={disabled ? (!canAfford ? `Need ${unitStats.cost - Math.floor(myTeamData.supplies)} more SU` : 'Rearming') : `${tooltip} Click map to deploy instantly.`}
                          className={`relative flex-shrink-0 w-24 md:w-auto flex flex-col items-center justify-center p-2 md:p-3 h-20 md:h-24 bg-[#1c1b19] transition-all text-xs gap-1 opacity-90 group cursor-pointer snap-center relative
                          disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed overflow-hidden
                          hover:-translate-y-1 hover:shadow-lg active:translate-y-0 shadow-inner
                          ${myTeam === 'BLUE' ? 'text-[#a4c294]' : 'text-[#d48b8b]'}
                          ${selectedTypeToBuild === type ? 'border-4 border-white' : (myTeam === 'BLUE' ? 'border-2 border-[#3f4f35] hover:border-[#7ca361]' : 'border-2 border-[#4a2828] hover:border-[#a35252]')}`}
                        >
                            <Icon className="w-5 h-5 md:w-6 md:h-6 opacity-60 group-hover:opacity-100 transition-all drop-shadow-md z-10" />
                            <span className="uppercase font-bold tracking-widest text-[9px] md:text-[11px] font-sans opacity-90 z-10">{unitStats.name}</span>
                            <span className="bg-[#111] px-1 md:px-2 py-0.5 border border-white/10 rounded shadow-inner text-white/90 font-mono font-bold text-[10px] md:text-xs z-10">{unitStats.cost} SU</span>
                            <span className="hidden md:block text-[8px] text-[#cca054] font-bold uppercase tracking-widest z-10">{UNIT_ROLES[type]}</span>
                            <span className="hidden md:block text-[8px] text-white/45 font-mono z-10">{unitStats.maxHp}HP {unitStats.damage}D R{unitStats.range}</span>
                            <span className="hidden md:block text-[8px] leading-tight text-white/45 font-bold uppercase tracking-wider z-10 text-center line-clamp-2">{UNIT_DESCRIPTIONS[type]}</span>
                            
                            {showCooldown && (
                               <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center z-20">
                                   <TimerReset className="w-5 h-5 text-white/80 mb-1" />
                                   <div className="text-xl font-bold font-mono text-white tracking-widest drop-shadow-lg">{cdRemaining}s</div>
                               </div>
                            )}
                            {!canAfford && !cooldownActive && (
                               <div className="absolute inset-x-0 bottom-0 bg-black/70 text-[8px] text-white/80 py-0.5 uppercase tracking-widest z-20">Need SU</div>
                            )}
                        </button>
                      )})}
                  </div>
              </div>
         </div>
       )}

       {/* Selected Unit Info */}
       {selectedUnit && (
           <div className={`absolute bottom-0 md:bottom-auto md:top-6 right-0 md:right-6 pointer-events-auto z-40 w-full md:w-[340px] transition-transform duration-300 ${!mobileMenuOpen ? 'translate-y-0' : 'translate-y-full md:translate-y-0'}`}>
               <div className={`hud-panel p-4 md:p-5 bg-[#252422]/95 border-t-4 md:border-4 shadow-2xl ${selectedUnit.team === 'BLUE' ? 'border-[#4a5d3f] text-[#b5cf9e]' : (selectedUnit.team === 'RED' ? 'border-[#613636] text-[#d48b8b]' : 'border-[#4a463d] text-[#a19989]')}`}>
                  <div className="flex justify-between items-start mb-3 md:mb-5 pb-3 md:pb-4 border-b-2 border-black/40">
                      <div>
                          <h3 className="uppercase tracking-[0.1em] font-bold text-lg md:text-xl flex items-center gap-2 md:gap-3 drop-shadow-md font-[family-name:var(--font-stencil)]">
                              <Crosshair className="w-4 h-4 md:w-5 md:h-5 opacity-80" />
                              {selectedUnitIds.length > 1 ? `MULTI-SELECT (${selectedUnitIds.length})` : (UNIT_STATS[selectedUnit.type]?.name || selectedUnit.type)}
                          </h3>
                          <div className="text-[10px] md:text-[12px] font-bold opacity-80 mt-1 md:mt-2 tracking-widest text-white/50">{selectedUnitIds.length > 1 ? 'BATTALION GROUP' : `REG: ${selectedUnit.id.split('-')[0]}`}</div>
                          {selectedUnitIds.length > 1 && selectedComposition && (
                            <div className="mt-2 text-[9px] uppercase tracking-widest text-white/45 max-w-[220px] leading-4">
                              {selectedComposition}
                            </div>
                          )}
                          {selectedUnitIds.length > 1 && (
                            <div className="mt-2 grid grid-cols-2 gap-1 text-[9px] uppercase tracking-widest text-white/55">
                              <span className="bg-black/25 border border-white/5 px-2 py-1">Supply {selectedSupplied}/{selectedUnits.length}</span>
                              <span className="bg-black/25 border border-white/5 px-2 py-1 truncate">{selectedOrders}</span>
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-1">
                            {selectedUnit.suppressed && (
                              <span className="inline-flex bg-[#7a5c29] text-black px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest">Suppressed</span>
                            )}
                            {selectedUnit.morale !== undefined && selectedUnit.morale < 55 && (
                              <span className="inline-flex bg-[#5c3d2f] text-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest">Morale {Math.round(selectedUnit.morale)}%</span>
                            )}
                            {selectedUnit.team === myTeam && !['hq', 'factory', 'fob', 'bunker'].includes(selectedUnit.type) && selectedUnit.supplied !== false && (
                              <span className="inline-flex bg-[#2f6b4b] text-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest" title="Supplied units deal 15% more damage.">In Supply +15%</span>
                            )}
                            {selectedUnit.supplied === false && (
                              <span
                                className={`inline-flex ${selectedUnit.type === 'marine' ? 'bg-[#8a5a25] text-white' : 'bg-[#7a2c2c] text-white'} px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest`}
                                title={selectedUnit.type === 'marine' ? 'Marines can operate outside supply at -20% firepower.' : 'Out-of-supply troops fight at 50% firepower.'}
                              >
                                {selectedUnit.type === 'marine' ? 'Expeditionary -20%' : 'Out Supply -50%'}
                              </span>
                            )}
                            {selectedUnit.order?.type && (
                              <span className="inline-flex bg-black/40 text-white/70 border border-white/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest">{selectedUnit.order.type.replace('_', ' ')}</span>
                            )}
                            {(selectedUnit.combinedArms || 0) > 0 && (
                              <span className="inline-flex bg-[#244f64] text-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest" title="Mixed nearby roles increase damage and reduce incoming damage.">Combined Arms +{selectedUnit.combinedArms}</span>
                            )}
                            {(selectedUnit.entrenchment || 0) >= 1 && (
                              <span className="inline-flex bg-[#5b5138] text-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest" title="Entrenched units take less damage.">Entrenched {Math.floor(selectedUnit.entrenchment || 0)}</span>
                            )}
                            {selectedUnit.type === 'factory' && (selectedUnit.captureProgress || 0) > 0 && (
                              <span className="inline-flex bg-[#8b6b2f] text-black px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest" title="Factories now require sustained local pressure to capture.">{selectedUnit.captureTeam} capture {Math.floor(((selectedUnit.captureProgress || 0) / FACTORY_CAPTURE_TICKS) * 100)}%</span>
                            )}
                          </div>
                      </div>
                      <div className="bg-[#111] border border-white/10 px-2 py-1 md:px-3 flex items-center gap-1 md:gap-2 text-xs md:text-sm shadow-inner rounded-sm text-white/70 font-mono">
                          <CircleDashed className="w-3 h-3 opacity-50" />
                          {selectedUnitIds.length > 1 ? 'MULTI' : `${Math.round(selectedUnit.x)}:${Math.round(selectedUnit.y)}`}
                      </div>
                  </div>
                  
                  <div className="space-y-3 md:space-y-4">
                      <div>
                          <div className="flex justify-between mb-1 md:mb-2 border-b border-white/5 pb-1 md:border-0 md:pb-0">
                              <span className="text-[10px] md:text-[12px] tracking-[0.2em] uppercase font-bold opacity-80 text-black/60 drop-shadow-sm">Combat Effectiveness</span>
                              <span className="font-bold text-xs md:text-sm tracking-widest font-mono text-white/80">
                                {selectedUnitIds.length > 1 ? `${Math.ceil(selectedHp)} / ${selectedMaxHp}` : `${Math.ceil(selectedUnit.hp)} / ${UNIT_STATS[selectedUnit.type]?.maxHp || 100}`}
                              </span>
                          </div>
                           <div className="w-full bg-[#111] h-3 md:h-4 border border-white/10 shadow-inner p-[1px]">
                                <div className={`h-full transition-all duration-300 ${(selectedUnitIds.length > 1 ? selectedHpPct < 30 : selectedUnit.hp < (UNIT_STATS[selectedUnit.type]?.maxHp || 100) * 0.3) ? 'bg-red-700' : 'bg-current opacity-80'}`} 
                                     style={{ width: `${selectedUnitIds.length > 1 ? selectedHpPct : Math.max(0, (selectedUnit.hp / (UNIT_STATS[selectedUnit.type]?.maxHp || 100)) * 100)}%` }}></div>
                           </div>
                      </div>

                    <div className="grid grid-cols-4 md:grid-cols-2 gap-2 md:gap-4 mt-2 md:mt-6 text-[10px] md:text-xs bg-black/20 p-2 md:p-3 rounded-sm border border-white/5">
                          <div className="flex flex-col items-center md:items-start md:flex-col gap-1">
                              <span className="opacity-50 font-bold uppercase tracking-widest text-[8px] md:text-[10px]">Damage</span>
                              <span className="text-sm md:text-xl font-[family-name:var(--font-stencil)]">{UNIT_STATS[selectedUnit.type]?.damage || 0}</span>
                          </div>
                          <div className="flex flex-col items-center md:items-start md:flex-col gap-1 border-l md:border-0 border-white/5">
                              <span className="opacity-50 font-bold uppercase tracking-widest text-[8px] md:text-[10px]">Vision</span>
                              <span className="text-sm md:text-xl font-[family-name:var(--font-stencil)]">{UNIT_STATS[selectedUnit.type]?.vision || 0}</span>
                          </div>
                          <div className="flex flex-col items-center md:items-start md:flex-col gap-1 border-l md:border-0 border-white/5">
                              <span className="opacity-50 font-bold uppercase tracking-widest text-[8px] md:text-[10px]">Speed</span>
                              <span className="text-sm md:text-xl font-[family-name:var(--font-stencil)]">{UNIT_STATS[selectedUnit.type]?.speed || 0}</span>
                          </div>
                          <div className="flex flex-col items-center md:items-start md:flex-col gap-1 border-l md:border-0 border-white/5">
                              <span className="opacity-50 font-bold uppercase tracking-widest text-[8px] md:text-[10px]">Range</span>
                              <span className="text-sm md:text-xl font-[family-name:var(--font-stencil)]">{UNIT_STATS[selectedUnit.type]?.range || 0}</span>
                          </div>
                      </div>
                  </div>

                  {selectedUnit.team === myTeam && selectedUnit.type === 'engineer' && (
                      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-2">
                          <button
                              onClick={() => socket?.emit('use_ability', { type: 'deploy_fob', id: selectedUnit.id })}
                              disabled={myTeamData.supplies < FOB_COST}
                              className="w-full py-3 bg-[#a8823b] hover:bg-[#bda061] text-black font-bold uppercase tracking-widest text-[11px] shadow-lg disabled:opacity-50 disabled:grayscale transition-colors"
                          >
                              Deploy FOB ({FOB_COST} SU)
                          </button>
                          <button
                              onClick={() => socket?.emit('use_ability', { type: 'deploy_bunker', id: selectedUnit.id })}
                              disabled={myTeamData.supplies < BUNKER_COST}
                              className="w-full py-3 bg-[#5f6b4d] hover:bg-[#758460] text-white font-bold uppercase tracking-widest text-[11px] shadow-lg disabled:opacity-50 disabled:grayscale transition-colors"
                          >
                              Deploy Bunker ({BUNKER_COST} SU)
                          </button>
                          <button
                              onClick={() => socket?.emit('use_ability', { type: 'dig_trench', id: selectedUnit.id })}
                              className="w-full py-3 bg-[#604c32] hover:bg-[#7a6345] text-white font-bold uppercase tracking-widest text-[11px] shadow-lg transition-colors"
                          >
                              Dig Trench
                          </button>
                          <button
                              onClick={() => socket?.emit('use_ability', { type: 'build_road', id: selectedUnit.id })}
                              className="w-full py-3 bg-[#786f5e] hover:bg-[#918776] text-black font-bold uppercase tracking-widest text-[11px] shadow-lg transition-colors"
                          >
                              Build Road
                          </button>
                      </div>
                  )}

                  {selectedUnit.team === myTeam && ['hq', 'factory', 'fob'].includes(selectedUnit.type) && (
                    <div className="mt-4 border-t-2 border-black/30 pt-3">
                      <div className="flex justify-between text-[10px] uppercase tracking-[0.2em] font-bold text-white/45 mb-2">
                        <span>Deployment Relay</span>
                        <span>Instant</span>
                      </div>
                      <div className="bg-black/25 border border-white/5 px-2 py-2 text-[10px] uppercase tracking-widest text-white/45 leading-4">
                        Select a unit card, then click valid ground to deploy immediately. Heavy units need an HQ or factory online.
                      </div>
                    </div>
                  )}

                  {selectedUnit.team === myTeam && !['hq', 'factory', 'fob', 'bunker'].includes(selectedUnit.type) && (
                    <div className="mt-5 pt-4 border-t-2 border-black/30 grid grid-cols-3 gap-2">
                        <button onClick={() => sendOrder('hold')} className="py-2 bg-black/30 border border-white/10 text-[10px] uppercase tracking-widest font-bold hover:bg-black/50">Hold</button>
                        <button onClick={() => sendOrder('entrench')} className="py-2 bg-[#5b5138] border border-white/10 text-[10px] uppercase tracking-widest font-bold hover:bg-[#6f6549]" title="Dig in over time for damage reduction. Movement breaks entrenchment.">Entrench</button>
                        <button onClick={() => sendOrder('retreat')} className="py-2 bg-[#5c2f2f] border border-white/10 text-[10px] uppercase tracking-widest font-bold hover:bg-[#733b3b]">Retreat</button>
                        <div className="col-span-3 text-[9px] uppercase tracking-widest text-white/40 text-center">
                          Right-click ground sets attack-move rally.
                        </div>
                    </div>
                  )}
               </div>
           </div>
       )}

       {winner && (
          <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-black/80 backdrop-blur-sm pointer-events-auto">
             <div className="flex flex-col items-center bg-[#2b2b2b] border-4 border-[#3a3a3a] p-12 text-center rounded-sm">
                <h2 className="text-4xl md:text-6xl font-[family-name:var(--font-stencil)] tracking-[0.2em] mb-4 drop-shadow-md pb-4 border-b border-white/10 w-full font-bold uppercase text-white">
                   {winner} WINS
                </h2>
                <div className="text-lg opacity-80 mb-8 uppercase tracking-widest text-[#a19989]">
                   Opposing Headquarters Destroyed
                </div>
                <button 
                  onClick={() => socket?.emit('reset_game')}
                  className="px-8 py-4 bg-[#7a2c2c] text-white hover:bg-[#8a3333] border border-[#a84444] font-[family-name:var(--font-stencil)] tracking-[0.1em] text-xl transition-all shadow-lg active:translate-y-1"
                >
                  START NEW OPERATION
                </button>
             </div>
          </div>
       )}

    </div>
  );
}
