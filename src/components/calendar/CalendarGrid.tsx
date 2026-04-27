'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CellPopulation,
  SubEvent,
  Connection,
  POPULATION_COLORS,
  SUB_EVENT_COLORS,
  PlateType,
} from '@/types';
import { addDays, daysBetween, shiftDateHour, toDateStr } from '@/lib/dates';
import * as storage from '@/lib/storage';
import { onRemoteChange, enqueue } from '@/lib/sync';
import Timeline, { type Axis } from './Timeline';
import EventPanel from './EventPanel';
import NewPopulationDialog from './NewPopulationDialog';
import ExperimentPopover from './ExperimentPopover';
import IsolationToolbar from './IsolationToolbar';

interface CalendarGridProps {
  experimentId: string;
  syncStatus?: string;
}

interface PopoverState {
  kind: 'pop' | 'event';
  id: string;
  popId: string;
  anchor: DOMRect;
}

export default function CalendarGrid({ experimentId, syncStatus = 'idle' }: CalendarGridProps) {
  const [populations, setPopulations] = useState<CellPopulation[]>(() =>
    storage.getPopulations(experimentId)
  );
  const [events, setEvents] = useState<SubEvent[]>(() =>
    storage.getAllSubEvents(experimentId)
  );
  const [, setConnections] = useState<Connection[]>(() =>
    storage.getConnections(experimentId)
  );

  // Stale-closure refs (kept in sync via effect to satisfy react-hooks/refs)
  const populationsRef = useRef(populations);
  const eventsRef = useRef(events);
  useEffect(() => { populationsRef.current = populations; }, [populations]);
  useEffect(() => { eventsRef.current = events; }, [events]);

  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [isolatedExperimentId, setIsolatedExperimentId] = useState<string | null>(null);
  const [editingFullPanel, setEditingFullPanel] = useState(false);

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newDialogRange, setNewDialogRange] = useState<{ start: string; end: string } | null>(null);

  const [scrollToTodayToken, setScrollToTodayToken] = useState(0);

  // ---------- Persistence (debounced) ----------
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialMount = useRef(true);
  const prevPopsRef = useRef(populations);
  const prevEventsRef = useRef(events);
  const applyingRemote = useRef(false);
  useEffect(() => {
    if (initialMount.current) { initialMount.current = false; return; }
    if (applyingRemote.current) { applyingRemote.current = false; return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const allPops = storage.getItems<CellPopulation>('cell-scheduler:populations');
      const otherPops = allPops.filter(p => p.experimentId !== experimentId);
      storage.setItems('cell-scheduler:populations', [...otherPops, ...populations]);

      const allEvts = storage.getItems<SubEvent>('cell-scheduler:subevents');
      const popIds = new Set(populations.map(p => p.id));
      const otherEvts = allEvts.filter(e => !popIds.has(e.populationId));
      storage.setItems('cell-scheduler:subevents', [...otherEvts, ...events]);

      const prevPopMap = new Map(prevPopsRef.current.map(p => [p.id, p]));
      const curPopMap = new Map(populations.map(p => [p.id, p]));
      for (const p of populations) {
        if (prevPopMap.get(p.id) !== p) enqueue({ table: 'cell_populations', op: 'upsert', row: p as unknown as Record<string, unknown> });
      }
      for (const p of prevPopsRef.current) {
        if (!curPopMap.has(p.id)) enqueue({ table: 'cell_populations', op: 'delete', row: { id: p.id } });
      }
      const prevEvtMap = new Map(prevEventsRef.current.map(e => [e.id, e]));
      const curEvtMap = new Map(events.map(e => [e.id, e]));
      for (const e of events) {
        if (prevEvtMap.get(e.id) !== e) enqueue({ table: 'sub_events', op: 'upsert', row: e as unknown as Record<string, unknown> });
      }
      for (const e of prevEventsRef.current) {
        if (!curEvtMap.has(e.id)) enqueue({ table: 'sub_events', op: 'delete', row: { id: e.id } });
      }
      prevPopsRef.current = populations;
      prevEventsRef.current = events;
    }, 150);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [populations, events, experimentId]);

  // ---------- Remote-change sync ----------
  useEffect(() => {
    const off = onRemoteChange(() => {
      applyingRemote.current = true;
      const newPops = storage.getPopulations(experimentId);
      const newEvts = storage.getAllSubEvents(experimentId);
      prevPopsRef.current = newPops;
      prevEventsRef.current = newEvts;
      setPopulations(newPops);
      setEvents(newEvts);
      setConnections(storage.getConnections(experimentId));
    });
    return off;
  }, [experimentId]);

  // ---------- Responsive axis ----------
  const [axis, setAxis] = useState<Axis>('horizontal');
  useEffect(() => {
    const check = () => {
      const isPortraitMobile = window.innerWidth < 768 && window.innerHeight > window.innerWidth;
      setAxis(isPortraitMobile ? 'vertical' : 'horizontal');
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ---------- Timeline range (continuous) ----------
  const today = useMemo(() => new Date(), []);
  const todayStr = toDateStr(today);
  const { origin, dayCount } = useMemo(() => {
    let minDate = todayStr;
    let maxDate = todayStr;
    for (const p of populations) {
      if (p.startDate < minDate) minDate = p.startDate;
      if (p.endDate > maxDate) maxDate = p.endDate;
    }
    minDate = addDays(minDate, -60);
    maxDate = addDays(maxDate, 365);
    return { origin: minDate, dayCount: daysBetween(minDate, maxDate) + 1 };
  }, [populations, todayStr]);

  // ---------- Lane assignment (greedy, stable) ----------
  const { laneByPop, totalLanes } = useMemo(() => {
    const sorted = [...populations].sort((a, b) =>
      a.startDate.localeCompare(b.startDate) || a.startHour - b.startHour || a.id.localeCompare(b.id)
    );
    const laneEnds: string[] = []; // last endDate seen per lane
    const result = new Map<string, number>();
    for (const p of sorted) {
      let lane = 0;
      while (lane < laneEnds.length && p.startDate <= laneEnds[lane]) lane++;
      laneEnds[lane] = p.endDate;
      result.set(p.id, lane);
    }
    return { laneByPop: result, totalLanes: Math.max(1, laneEnds.length) };
  }, [populations]);

  // ---------- Selection helpers ----------
  const closePopover = useCallback(() => setPopover(null), []);
  const handleSelectPop = useCallback((popId: string, anchor: DOMRect) => {
    setPopover({ kind: 'pop', id: popId, popId, anchor });
  }, []);
  const handleSelectEvent = useCallback((evId: string, popId: string, anchor: DOMRect) => {
    setPopover({ kind: 'event', id: evId, popId, anchor });
  }, []);

  // Recompute popover anchor (e.g. after scroll) by reading the DOM element back
  const refreshPopoverAnchor = useCallback(() => {
    setPopover(prev => {
      if (!prev) return prev;
      const sel = prev.kind === 'pop'
        ? `[data-pop-id="${prev.id}"]`
        : `[data-ev-id="${prev.id}"]`;
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      return { ...prev, anchor: el.getBoundingClientRect() };
    });
  }, []);

  // ---------- Mutators ----------
  const handleCreatePop = useCallback((startDate: string, endDate: string) => {
    const s = startDate <= endDate ? startDate : endDate;
    const e = startDate <= endDate ? endDate : startDate;
    setNewDialogRange({ start: s, end: e });
    setShowNewDialog(true);
  }, []);

  const handleMovePop = useCallback((popId: string, dayDelta: number) => {
    setPopulations(prev => prev.map(p => p.id === popId ? { ...p, startDate: addDays(p.startDate, dayDelta), endDate: addDays(p.endDate, dayDelta) } : p));
    setEvents(prev => prev.map(ev => ev.populationId === popId ? { ...ev, startDate: addDays(ev.startDate, dayDelta), endDate: addDays(ev.endDate, dayDelta) } : ev));
  }, []);

  const handleResizePop = useCallback((popId: string, edge: 'start' | 'end', date: string, hour: number) => {
    setPopulations(prev => prev.map(p => {
      if (p.id !== popId) return p;
      if (edge === 'start' && (date < p.endDate || (date === p.endDate && hour < p.endHour))) {
        return { ...p, startDate: date, startHour: hour };
      }
      if (edge === 'end' && (date > p.startDate || (date === p.startDate && hour > p.startHour))) {
        return { ...p, endDate: date, endHour: hour };
      }
      return p;
    }));
  }, []);

  const handleCreateEvent = useCallback((popId: string, startDate: string, startHour: number, endDate: string, endHour: number) => {
    const pop = populationsRef.current.find(p => p.id === popId);
    if (!pop) return;
    // Clamp inside parent
    let sd = startDate, sh = startHour, ed = endDate, eh = endHour;
    if (sd < pop.startDate) { sd = pop.startDate; sh = 0; }
    if (sd > pop.endDate) { sd = pop.endDate; sh = 0; }
    if (ed < pop.startDate) { ed = pop.startDate; eh = 23; }
    if (ed > pop.endDate) { ed = pop.endDate; eh = 23; }
    const ev: SubEvent = {
      id: crypto.randomUUID(),
      populationId: popId,
      label: 'New event',
      comments: '',
      allDay: false,
      startDate: sd, startHour: sh,
      endDate: ed, endHour: eh,
      color: SUB_EVENT_COLORS[eventsRef.current.filter(e => e.populationId === popId).length % SUB_EVENT_COLORS.length],
    };
    setEvents(prev => [...prev, ev]);
  }, []);

  const handleMoveEvent = useCallback((evId: string, hourDelta: number) => {
    setEvents(prev => prev.map(ev => {
      if (ev.id !== evId) return ev;
      const pop = populationsRef.current.find(p => p.id === ev.populationId);
      if (!pop) return ev;
      const s = shiftDateHour(ev.startDate, ev.startHour, hourDelta);
      const e2 = shiftDateHour(ev.endDate, ev.endHour, hourDelta);
      if (s.date < pop.startDate || e2.date > pop.endDate) return ev;
      return { ...ev, startDate: s.date, startHour: s.hour, endDate: e2.date, endHour: e2.hour };
    }));
  }, []);

  const handleResizeEvent = useCallback((evId: string, edge: 'start' | 'end', date: string, hour: number) => {
    setEvents(prev => prev.map(ev => {
      if (ev.id !== evId) return ev;
      const pop = populationsRef.current.find(p => p.id === ev.populationId);
      if (!pop) return ev;
      if (edge === 'start') {
        if (date < pop.startDate || (date > ev.endDate || (date === ev.endDate && hour >= ev.endHour))) return ev;
        return { ...ev, startDate: date, startHour: hour };
      } else {
        if (date > pop.endDate || (date < ev.startDate || (date === ev.startDate && hour <= ev.startHour))) return ev;
        return { ...ev, endDate: date, endHour: hour };
      }
    }));
  }, []);

  // Update + delete from the EventPanel
  const handleUpdateEvent = useCallback((updated: SubEvent) => {
    setEvents(prev => prev.map(e => (e.id === updated.id ? updated : e)));
  }, []);
  const handleDeleteEvent = useCallback((id: string) => {
    setEvents(prev => prev.filter(e => e.id !== id));
    setPopover(null);
    setEditingFullPanel(false);
  }, []);
  const handleUpdatePopulation = useCallback((updated: CellPopulation) => {
    setPopulations(prev => prev.map(p => (p.id === updated.id ? updated : p)));
  }, []);
  const handleDeletePopulation = useCallback((id: string) => {
    setPopulations(prev => prev.filter(p => p.id !== id));
    setEvents(prev => prev.filter(e => e.populationId !== id));
    setConnections(prev => prev.filter(c => c.sourcePopulationId !== id && c.targetPopulationId !== id));
    setPopover(null);
    setEditingFullPanel(false);
    if (isolatedExperimentId === id) setIsolatedExperimentId(null);
  }, [isolatedExperimentId]);

  const handleRepeatNextWeek = useCallback((popId: string) => {
    const pop = populationsRef.current.find(p => p.id === popId);
    if (!pop) return;
    const newPopId = crypto.randomUUID();
    const newPop: CellPopulation = {
      ...pop,
      id: newPopId,
      startDate: addDays(pop.startDate, 7),
      endDate: addDays(pop.endDate, 7),
      color: POPULATION_COLORS[(populationsRef.current.length) % POPULATION_COLORS.length],
    };
    const popEvents = eventsRef.current.filter(ev => ev.populationId === popId);
    const newEvents: SubEvent[] = popEvents.map(ev => ({
      ...ev,
      id: crypto.randomUUID(),
      populationId: newPopId,
      startDate: addDays(ev.startDate, 7),
      endDate: addDays(ev.endDate, 7),
    }));
    setPopulations(prev => [...prev, newPop]);
    setEvents(prev => [...prev, ...newEvents]);
  }, []);

  // ---------- Dialog confirm/cancel ----------
  const handleConfirmNewPop = useCallback((data: { name: string; cellLine: string; passage: string; plateType: PlateType; plateCount: number; cellDensity: string; experimenter: string; experimentLabel: string; comments: string }) => {
    if (!newDialogRange) return;
    const pop: CellPopulation = {
      id: crypto.randomUUID(),
      experimentId,
      name: data.name,
      cellLine: data.cellLine,
      passage: data.passage,
      color: POPULATION_COLORS[populations.length % POPULATION_COLORS.length],
      plateType: data.plateType,
      plateCount: data.plateCount,
      cellDensity: data.cellDensity,
      experimenter: data.experimenter,
      experimentLabel: data.experimentLabel,
      comments: data.comments,
      allDay: true,
      startDate: newDialogRange.start, startHour: 0,
      endDate: newDialogRange.end, endHour: 23,
    };
    setPopulations(prev => [...prev, pop]);
    setShowNewDialog(false);
    setNewDialogRange(null);
  }, [newDialogRange, experimentId, populations.length]);

  const handleCancelNewPop = useCallback(() => {
    setShowNewDialog(false);
    setNewDialogRange(null);
  }, []);

  // ---------- Keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
      if (e.key === 'Escape') {
        if (editingFullPanel) { setEditingFullPanel(false); return; }
        if (isolatedExperimentId) { setIsolatedExperimentId(null); setPopover(null); return; }
        if (popover) { setPopover(null); return; }
      }
      if (!inField && (e.key === 'Backspace' || e.key === 'Delete')) {
        if (popover?.kind === 'event') {
          handleDeleteEvent(popover.id);
          e.preventDefault();
        } else if (popover?.kind === 'pop') {
          handleDeletePopulation(popover.id);
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popover, editingFullPanel, isolatedExperimentId, handleDeleteEvent, handleDeletePopulation]);

  // ---------- Derived for popover/panel ----------
  const popoverPop = popover ? populations.find(p => p.id === popover.popId) : null;
  const popoverEv = popover?.kind === 'event' ? events.find(e => e.id === popover.id) : null;
  const popoverEventCount = popoverPop ? events.filter(e => e.populationId === popoverPop.id).length : 0;

  const fullPanelEvent = editingFullPanel && popover?.kind === 'event' ? popoverEv ?? null : null;
  const fullPanelPop = editingFullPanel && popover?.kind === 'pop' ? popoverPop ?? null : null;

  // Selected ids for visual state in Timeline
  const selectedPopId = popover?.kind === 'pop' ? popover.id : (popover?.kind === 'event' ? popover.popId : null);
  const selectedEventId = popover?.kind === 'event' ? popover.id : null;

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Toolbar */}
      <div className="border-b border-slate-200/80 bg-white flex items-center px-3 py-2 flex-shrink-0">
        <button
          className="text-xs font-bold text-indigo-600 px-2.5 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors"
          onClick={() => setScrollToTodayToken(t => t + 1)}
        >
          Today
        </button>
        <span className="ml-3 text-[11px] font-semibold text-slate-400 hidden sm:inline">
          Drag empty space to create an experiment · click a bar to open it
        </span>
        <SyncBadge status={syncStatus} />
      </div>

      {/* Isolation toolbar (only when active) */}
      {isolatedExperimentId && popoverPop && popoverPop.id === isolatedExperimentId && (
        <IsolationToolbar
          population={popoverPop}
          eventCount={popoverEventCount}
          onExit={() => setIsolatedExperimentId(null)}
        />
      )}
      {isolatedExperimentId && (!popoverPop || popoverPop.id !== isolatedExperimentId) && (() => {
        const isoPop = populations.find(p => p.id === isolatedExperimentId);
        if (!isoPop) return null;
        const count = events.filter(e => e.populationId === isolatedExperimentId).length;
        return <IsolationToolbar population={isoPop} eventCount={count} onExit={() => setIsolatedExperimentId(null)} />;
      })()}

      {/* Timeline */}
      <Timeline
        axis={axis}
        origin={origin}
        dayCount={dayCount}
        populations={populations}
        events={events}
        laneByPop={laneByPop}
        totalLanes={totalLanes}
        selectedPopId={selectedPopId}
        selectedEventId={selectedEventId}
        isolatedExperimentId={isolatedExperimentId}
        todayStr={todayStr}
        onCreatePop={handleCreatePop}
        onMovePop={handleMovePop}
        onResizePop={handleResizePop}
        onSelectPop={handleSelectPop}
        onCreateEvent={handleCreateEvent}
        onMoveEvent={handleMoveEvent}
        onResizeEvent={handleResizeEvent}
        onSelectEvent={handleSelectEvent}
        onDeselect={closePopover}
        onLayoutChange={refreshPopoverAnchor}
        scrollToTodayToken={scrollToTodayToken}
      />

      {/* Compact popover */}
      {popover && !editingFullPanel && popoverPop && (
        popover.kind === 'pop' ? (
          <ExperimentPopover
            kind="pop"
            anchor={popover.anchor}
            isMobile={isMobile}
            population={popoverPop}
            eventCount={popoverEventCount}
            onEnterIsolation={() => { setIsolatedExperimentId(popover.popId); setPopover(null); }}
            onEditDetails={() => setEditingFullPanel(true)}
            onDelete={() => handleDeletePopulation(popover.popId)}
            onClose={closePopover}
          />
        ) : popoverEv ? (
          <ExperimentPopover
            kind="event"
            anchor={popover.anchor}
            isMobile={isMobile}
            subEvent={popoverEv}
            onEditDetails={() => setEditingFullPanel(true)}
            onDelete={() => handleDeleteEvent(popover.id)}
            onClose={closePopover}
          />
        ) : null
      )}

      {/* Full inspector (only when explicitly requested) */}
      {editingFullPanel && (fullPanelEvent || fullPanelPop) && (
        <EventPanel
          subEvent={fullPanelEvent}
          population={fullPanelPop}
          allEvents={events}
          onUpdateSubEvent={handleUpdateEvent}
          onDeleteSubEvent={handleDeleteEvent}
          onUpdatePopulation={handleUpdatePopulation}
          onDeletePopulation={handleDeletePopulation}
          onRepeatNextWeek={handleRepeatNextWeek}
          onClose={() => setEditingFullPanel(false)}
          isMobile={isMobile}
        />
      )}

      {/* New experiment dialog */}
      {showNewDialog && newDialogRange && (
        <NewPopulationDialog
          startDate={newDialogRange.start}
          endDate={newDialogRange.end}
          onConfirm={handleConfirmNewPop}
          onCancel={handleCancelNewPop}
        />
      )}

      {populations.length === 0 && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-slate-400 text-base pointer-events-none flex flex-col items-center gap-2">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>Drag across days to create an experiment</span>
        </div>
      )}
    </div>
  );
}

export function SyncBadge({ status }: { status: string }) {
  const cfg = {
    idle: { label: 'Synced', color: 'text-emerald-600 bg-emerald-50' },
    syncing: { label: 'Syncing…', color: 'text-indigo-600 bg-indigo-50' },
    error: { label: 'Sync error', color: 'text-amber-600 bg-amber-50' },
    offline: { label: 'Offline', color: 'text-slate-500 bg-slate-100' },
  }[status as 'idle' | 'syncing' | 'error' | 'offline'] ?? { label: status, color: 'text-slate-500 bg-slate-100' };
  return (
    <span className={`ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full ${cfg.color}`}>{cfg.label}</span>
  );
}
