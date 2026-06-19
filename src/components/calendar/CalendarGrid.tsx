'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CellPopulation,
  SubEvent,
  Connection,
  Operator,
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
import IsolationAddPanel from './IsolationAddPanel';

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

function rangesOverlap(a: CellPopulation, b: CellPopulation): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/** Resolve effective lane for every population. Manual `pop.lane` wins; everything else
 *  is filled greedily into the first non-conflicting lane. */
function computeLanes(populations: CellPopulation[]): { laneByPop: Map<string, number>; totalLanes: number } {
  const sorted = [...populations].sort((a, b) =>
    a.startDate.localeCompare(b.startDate) || a.startHour - b.startHour || a.id.localeCompare(b.id)
  );
  const result = new Map<string, number>();
  const laneRanges: { start: string; end: string }[][] = [];
  const placeAt = (lane: number, p: CellPopulation) => {
    while (laneRanges.length <= lane) laneRanges.push([]);
    laneRanges[lane].push({ start: p.startDate, end: p.endDate });
    result.set(p.id, lane);
  };
  for (const p of sorted) {
    if (typeof p.lane === 'number' && p.lane >= 0) placeAt(p.lane, p);
  }
  for (const p of sorted) {
    if (result.has(p.id)) continue;
    let lane = 0;
    const conflicts = (l: number) => (laneRanges[l] ?? []).some(r => p.startDate <= r.end && r.start <= p.endDate);
    while (conflicts(lane)) lane++;
    placeAt(lane, p);
  }
  return { laneByPop: result, totalLanes: Math.max(1, laneRanges.length) };
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
  // Operators own the bar colors (global, keyed by experimenter name).
  const [operators, setOperators] = useState<Operator[]>(() => storage.getOperators());

  // Stale-closure refs (kept in sync via effect to satisfy react-hooks/refs)
  const populationsRef = useRef(populations);
  const eventsRef = useRef(events);
  useEffect(() => { populationsRef.current = populations; }, [populations]);
  useEffect(() => { eventsRef.current = events; }, [events]);

  const [popover, setPopover] = useState<PopoverState | null>(null);
  // Experiments picked out by a shift-drag marquee. Independent of the single-bar
  // popover selection; populated only by the rubber-band gesture.
  const [selectedPopIds, setSelectedPopIds] = useState<string[]>([]);
  const [isolatedExperimentId, setIsolatedExperimentId] = useState<string | null>(null);
  // Whether the floating "Add event" pane has been dismissed for the current isolation
  // session. Reset to false whenever a (different) population is isolated.
  const [addPanelDismissed, setAddPanelDismissed] = useState(false);
  const [editingFullPanel, setEditingFullPanel] = useState(false);
  const editingFullPanelRef = useRef(editingFullPanel);
  useEffect(() => { editingFullPanelRef.current = editingFullPanel; }, [editingFullPanel]);

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
      setOperators(storage.getOperators());
    });
    return off;
  }, [experimentId]);

  // Operators own bar colors. A bar's color is its operator's color; for an experimenter
  // with no stored operator record yet, fall back to the deterministic default for that
  // name. Bars with no experimenter keep their own stored color (legacy).
  // Operator records get persisted (for sync + autocomplete) in the population mutation
  // handlers below via storage.ensureOperator.
  const operatorById = useMemo(() => new Map(operators.map(o => [o.id, o])), [operators]);
  const colorForPop = useCallback((p: CellPopulation): string => {
    const name = (p.experimenter || '').trim();
    if (!name) return p.color;
    return operatorById.get(storage.normalizeOperatorId(name))?.color || storage.defaultOperatorColor(name);
  }, [operatorById]);
  const displayPopulations = useMemo(
    () => populations.map(p => ({ ...p, color: colorForPop(p) })),
    [populations, colorForPop]
  );

  const handleUpdateOperatorColor = useCallback((op: Operator, color: string) => {
    storage.saveOperator({ ...op, color });
    setOperators(storage.getOperators());
  }, []);

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

  // ---------- Lane assignment ----------
  // Manual lanes (pop.lane) take priority. Remaining bars are placed greedily into the
  // first lane that doesn't conflict, which preserves the old auto-layout for any pop
  // the user hasn't explicitly placed.
  const { laneByPop, totalLanes } = useMemo(() => computeLanes(populations), [populations]);

  // ---------- Selection helpers ----------
  // closePopover doubles as the deselect-on-blank-click handler — it tears down both
  // the mini popover and the full details panel so the canvas returns to a clean state.
  const closePopover = useCallback(() => {
    setPopover(null);
    setEditingFullPanel(false);
    setSelectedPopIds([]);
  }, []);
  const handleSelectPop = useCallback((popId: string, anchor: DOMRect) => {
    setSelectedPopIds([]);
    setPopover(prev => {
      // Switching to a different bar collapses the open details back to a mini popover.
      if (prev && prev.popId !== popId) setEditingFullPanel(false);
      return { kind: 'pop', id: popId, popId, anchor };
    });
  }, []);
  const handleSelectEvent = useCallback((evId: string, popId: string, anchor: DOMRect) => {
    setSelectedPopIds([]);
    setPopover(prev => {
      if (prev && prev.id !== evId) setEditingFullPanel(false);
      return { kind: 'event', id: evId, popId, anchor };
    });
  }, []);

  // ---------- Multi-select (shift-drag marquee) ----------
  const handleMarqueeSelect = useCallback((ids: string[]) => {
    // A marquee result replaces the selection and tears down any open popover/details.
    setPopover(null);
    setEditingFullPanel(false);
    setSelectedPopIds(ids);
  }, []);
  const clearSelection = useCallback(() => setSelectedPopIds([]), []);
  const handleDeleteSelected = useCallback(() => {
    setSelectedPopIds(ids => {
      if (ids.length === 0) return ids;
      const drop = new Set(ids);
      setPopulations(prev => prev.filter(p => !drop.has(p.id)));
      setEvents(prev => prev.filter(e => !drop.has(e.populationId)));
      setConnections(prev => prev.filter(c => !drop.has(c.sourcePopulationId) && !drop.has(c.targetPopulationId)));
      if (isolatedExperimentId && drop.has(isolatedExperimentId)) setIsolatedExperimentId(null);
      return [];
    });
  }, [isolatedExperimentId]);

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

  const handleSetPopLane = useCallback((popId: string, lane: number) => {
    const targetLane = Math.max(0, lane);
    setPopulations(prev => {
      const target = prev.find(p => p.id === popId);
      if (!target) return prev;
      const { laneByPop } = computeLanes(prev);
      const oldLane = laneByPop.get(popId) ?? 0;
      if (oldLane === targetLane) return prev;
      const dir = targetLane > oldLane ? 1 : -1;

      // Cascade: place popId at targetLane; any pop already there with a date overlap
      // gets pushed one lane in the direction of motion. Recurse.
      const updates = new Map<string, number>();
      const popById = new Map(prev.map(p => [p.id, p]));
      const visit = (id: string, l: number) => {
        if (updates.get(id) === l) return;
        updates.set(id, l);
        const me = popById.get(id);
        if (!me) return;
        for (const other of prev) {
          if (other.id === id) continue;
          const otherLane = updates.has(other.id) ? updates.get(other.id)! : (laneByPop.get(other.id) ?? 0);
          if (otherLane !== l) continue;
          if (!rangesOverlap(me, other)) continue;
          visit(other.id, l + dir);
        }
      };
      visit(popId, targetLane);

      // If the cascade pushed something into a negative lane, shift everything down.
      const minLane = Math.min(0, ...updates.values());
      const shift = minLane < 0 ? -minLane : 0;

      return prev.map(p => updates.has(p.id) ? { ...p, lane: updates.get(p.id)! + shift } : p);
    });
  }, []);

  const handleDuplicatePop = useCallback((popId: string): string | null => {
    const pop = populationsRef.current.find(p => p.id === popId);
    if (!pop) return null;
    const newPopId = crypto.randomUUID();
    const newPop: CellPopulation = {
      ...pop,
      id: newPopId,
      // A copy is a fresh passage — clear the inherited passage number.
      passage: '',
      // Drop manual-lane so the duplicate finds its own row instead of stacking on the original.
      lane: undefined,
    };
    const newEvents: SubEvent[] = eventsRef.current
      .filter(ev => ev.populationId === popId)
      .map(ev => ({ ...ev, id: crypto.randomUUID(), populationId: newPopId }));
    setPopulations(prev => [...prev, newPop]);
    setEvents(prev => [...prev, ...newEvents]);
    return newPopId;
  }, []);

  // Duplicate every marquee-selected experiment, then select the copies.
  const handleDuplicateSelected = useCallback(() => {
    setSelectedPopIds(ids => {
      const newIds: string[] = [];
      ids.forEach(id => { const n = handleDuplicatePop(id); if (n) newIds.push(n); });
      return newIds;
    });
  }, [handleDuplicatePop]);

  const handleDuplicateEvent = useCallback((evId: string): string | null => {
    const ev = eventsRef.current.find(e => e.id === evId);
    if (!ev) return null;
    const newId = crypto.randomUUID();
    setEvents(prev => [...prev, { ...ev, id: newId }]);
    return newId;
  }, []);

  const handleOpenPopDetails = useCallback((popId: string) => {
    // Second double-click on the bar whose details are already open → escalate into isolation.
    setPopover(prev => {
      if (prev && prev.kind === 'pop' && prev.popId === popId && editingFullPanelRef.current) {
        setEditingFullPanel(false);
        setIsolatedExperimentId(popId);
        setAddPanelDismissed(false);
        return null;
      }
      const popEl = document.querySelector(`[data-pop-id="${popId}"]`) as HTMLElement | null;
      setEditingFullPanel(true);
      return { kind: 'pop', id: popId, popId, anchor: popEl?.getBoundingClientRect() ?? new DOMRect() };
    });
  }, []);

  const handleAddQuickEvent = useCallback((popId: string, label: string, color: string, durationH: number, offsetFromEndH: number) => {
    const pop = populationsRef.current.find(p => p.id === popId);
    if (!pop) return;
    const dur = Math.max(1, durationH);
    // Place at the same hour-distance from the parent's end as the source event was
    // (e.g. "1 day before harvest"), then clamp inside the parent if it doesn't fit.
    let end = shiftDateHour(pop.endDate, pop.endHour, -Math.max(0, offsetFromEndH));
    if (end.date < pop.startDate || (end.date === pop.startDate && end.hour < pop.startHour)) {
      end = { date: pop.startDate, hour: pop.startHour };
    }
    let start = shiftDateHour(end.date, end.hour, -(dur - 1));
    if (start.date < pop.startDate || (start.date === pop.startDate && start.hour < pop.startHour)) {
      start = { date: pop.startDate, hour: pop.startHour };
    }
    if (end.date > pop.endDate || (end.date === pop.endDate && end.hour > pop.endHour)) {
      end = { date: pop.endDate, hour: pop.endHour };
    }
    const newEv: SubEvent = {
      id: crypto.randomUUID(),
      populationId: popId,
      label, color, comments: '',
      allDay: dur >= 24 && dur % 24 === 0,
      startDate: start.date, startHour: start.hour,
      endDate: end.date, endHour: end.hour,
    };
    setEvents(prev => [...prev, newEv]);
  }, []);

  const handleEnterIsolationFor = useCallback((popId: string) => {
    setIsolatedExperimentId(popId);
    setEditingFullPanel(false);
    setAddPanelDismissed(false);
    setPopover(null);
  }, []);

  const handleOpenEventDetails = useCallback((evId: string, popId: string) => {
    const evEl = document.querySelector(`[data-ev-id="${evId}"]`) as HTMLElement | null;
    setPopover({ kind: 'event', id: evId, popId, anchor: evEl?.getBoundingClientRect() ?? new DOMRect() });
    setEditingFullPanel(true);
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

  // "Create new" from the isolation add-panel: drop a fresh full-day event at the start
  // of the population and open its inspector so the user can name it immediately.
  const handleCreateBlankEvent = useCallback((popId: string) => {
    const pop = populationsRef.current.find(p => p.id === popId);
    if (!pop) return;
    const id = crypto.randomUUID();
    const ev: SubEvent = {
      id,
      populationId: popId,
      label: 'New event',
      comments: '',
      allDay: false,
      startDate: pop.startDate, startHour: 0,
      endDate: pop.startDate, endHour: 23,
      color: SUB_EVENT_COLORS[eventsRef.current.filter(e => e.populationId === popId).length % SUB_EVENT_COLORS.length],
    };
    setEvents(prev => [...prev, ev]);
    setPopover({ kind: 'event', id, popId, anchor: new DOMRect() });
    setEditingFullPanel(true);
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

  const handleReparentEvent = useCallback((evId: string, newPopId: string, anchorDate: string, anchorHour: number) => {
    setEvents(prev => prev.map(ev => {
      if (ev.id !== evId) return ev;
      const newPop = populationsRef.current.find(p => p.id === newPopId);
      if (!newPop) return ev;
      const durationH = daysBetween(ev.startDate, ev.endDate) * 24 + (ev.endHour - ev.startHour) + 1;
      let start = { date: anchorDate, hour: anchorHour };
      let end = shiftDateHour(start.date, start.hour, durationH - 1);
      // Clamp inside the new parent.
      if (start.date < newPop.startDate || (start.date === newPop.startDate && start.hour < newPop.startHour)) {
        start = { date: newPop.startDate, hour: newPop.startHour };
        end = shiftDateHour(start.date, start.hour, durationH - 1);
      }
      if (end.date > newPop.endDate || (end.date === newPop.endDate && end.hour > newPop.endHour)) {
        end = { date: newPop.endDate, hour: newPop.endHour };
        const earliest = shiftDateHour(end.date, end.hour, -(durationH - 1));
        if (earliest.date > newPop.startDate || (earliest.date === newPop.startDate && earliest.hour >= newPop.startHour)) {
          start = earliest;
        } else {
          start = { date: newPop.startDate, hour: newPop.startHour };
        }
      }
      return { ...ev, populationId: newPopId, startDate: start.date, startHour: start.hour, endDate: end.date, endHour: end.hour };
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
    if (storage.ensureOperator(updated.experimenter)) setOperators(storage.getOperators());
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
      // A repeat is a fresh passage — clear the inherited passage number.
      passage: '',
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
    if (storage.ensureOperator(newPop.experimenter)) setOperators(storage.getOperators());
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
    if (storage.ensureOperator(pop.experimenter)) setOperators(storage.getOperators());
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
        if (selectedPopIds.length > 0) { setSelectedPopIds([]); return; }
        if (popover) { setPopover(null); return; }
      }
      if (!inField && (e.key === 'Backspace' || e.key === 'Delete')) {
        if (selectedPopIds.length > 0) {
          handleDeleteSelected();
          e.preventDefault();
        } else if (popover?.kind === 'event') {
          handleDeleteEvent(popover.id);
          e.preventDefault();
        } else if (popover?.kind === 'pop') {
          handleDeletePopulation(popover.id);
          e.preventDefault();
        }
      }
      // Copy/paste events between isolation modes (clipboard lives in sessionStorage so it
      // survives navigation between different experiment pages).
      const meta = e.metaKey || e.ctrlKey;
      if (meta && !inField && (e.key === 'c' || e.key === 'C')) {
        if (isolatedExperimentId && popover?.kind === 'event') {
          const ev = eventsRef.current.find(x => x.id === popover.id);
          const pop = populationsRef.current.find(p => p.id === isolatedExperimentId);
          if (ev && pop) {
            const startOffsetH = daysBetween(pop.startDate, ev.startDate) * 24 + (ev.startHour - pop.startHour);
            const durationH = daysBetween(ev.startDate, ev.endDate) * 24 + (ev.endHour - ev.startHour) + 1;
            sessionStorage.setItem('cell-scheduler:event-clipboard', JSON.stringify({
              label: ev.label, color: ev.color, comments: ev.comments, allDay: ev.allDay,
              startOffsetH, durationH,
            }));
            e.preventDefault();
          }
        }
      }
      if (meta && !inField && (e.key === 'v' || e.key === 'V')) {
        if (isolatedExperimentId) {
          const raw = sessionStorage.getItem('cell-scheduler:event-clipboard');
          if (!raw) return;
          try {
            const clip = JSON.parse(raw) as { label: string; color: string; comments: string; allDay: boolean; startOffsetH: number; durationH: number };
            const pop = populationsRef.current.find(p => p.id === isolatedExperimentId);
            if (!pop) return;
            const start = shiftDateHour(pop.startDate, pop.startHour, Math.max(0, clip.startOffsetH));
            const end = shiftDateHour(start.date, start.hour, Math.max(1, clip.durationH) - 1);
            // Clamp inside parent
            let sd = start.date, sh = start.hour, ed = end.date, eh = end.hour;
            if (sd < pop.startDate) { sd = pop.startDate; sh = 0; }
            if (ed > pop.endDate) { ed = pop.endDate; eh = 23; }
            const newEv: SubEvent = {
              id: crypto.randomUUID(),
              populationId: pop.id,
              label: clip.label, color: clip.color, comments: clip.comments, allDay: clip.allDay,
              startDate: sd, startHour: sh, endDate: ed, endHour: eh,
            };
            setEvents(prev => [...prev, newEv]);
            e.preventDefault();
          } catch {}
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [popover, editingFullPanel, isolatedExperimentId, selectedPopIds, handleDeleteEvent, handleDeletePopulation, handleDeleteSelected]);

  // ---------- Derived for popover/panel ----------
  const popoverPop = popover ? populations.find(p => p.id === popover.popId) : null;
  // Display copy with operator color resolved (popover swatch / isolation toolbar).
  const popoverPopDisplay = popoverPop ? { ...popoverPop, color: colorForPop(popoverPop) } : null;
  const popoverEv = popover?.kind === 'event' ? events.find(e => e.id === popover.id) : null;
  const popoverEventCount = popoverPop ? events.filter(e => e.populationId === popoverPop.id).length : 0;

  const fullPanelEvent = editingFullPanel && popover?.kind === 'event' ? popoverEv ?? null : null;
  const fullPanelPop = editingFullPanel && popover?.kind === 'pop' ? popoverPop ?? null : null;
  // Operator for the population open in the full panel (its color picker edits this).
  // Synthesize one from the experimenter name if no record is stored yet, so editing the
  // color works immediately (the first edit persists it via handleUpdateOperatorColor).
  const fullPanelOperator: Operator | null = (() => {
    const name = (fullPanelPop?.experimenter || '').trim();
    if (!name) return null;
    const id = storage.normalizeOperatorId(name);
    return operatorById.get(id) ?? { id, name, color: storage.defaultOperatorColor(name) };
  })();

  // Selected ids for visual state in Timeline
  const selectedPopId = popover?.kind === 'pop' ? popover.id : (popover?.kind === 'event' ? popover.popId : null);
  const selectedEventId = popover?.kind === 'event' ? popover.id : null;

  return (
    <div className="flex-1 flex flex-col h-full relative">
      {/* Toolbar */}
      <div className="border-b border-slate-200/80 bg-white flex items-center px-3 py-2 flex-shrink-0">
        <button
          className="text-xs font-bold text-indigo-600 px-2.5 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors"
          onClick={() => setScrollToTodayToken(t => t + 1)}
        >
          Today
        </button>
        <span className="ml-3 text-[11px] font-semibold text-slate-400 hidden sm:inline">
          Drag empty space to create an experiment · shift-drag to select · click a bar to open it
        </span>
        <SyncBadge status={syncStatus} />
      </div>

      {/* Isolation toolbar (only when active) */}
      {isolatedExperimentId && popoverPopDisplay && popoverPopDisplay.id === isolatedExperimentId && (
        <IsolationToolbar
          population={popoverPopDisplay}
          eventCount={popoverEventCount}
          onExit={() => setIsolatedExperimentId(null)}
        />
      )}
      {isolatedExperimentId && (!popoverPop || popoverPop.id !== isolatedExperimentId) && (() => {
        const isoPop = displayPopulations.find(p => p.id === isolatedExperimentId);
        if (!isoPop) return null;
        const count = events.filter(e => e.populationId === isolatedExperimentId).length;
        return <IsolationToolbar population={isoPop} eventCount={count} onExit={() => setIsolatedExperimentId(null)} />;
      })()}

      {/* Timeline */}
      <Timeline
        axis={axis}
        origin={origin}
        dayCount={dayCount}
        populations={displayPopulations}
        events={events}
        laneByPop={laneByPop}
        totalLanes={totalLanes}
        selectedPopId={selectedPopId}
        selectedEventId={selectedEventId}
        selectedPopIds={selectedPopIds}
        isolatedExperimentId={isolatedExperimentId}
        todayStr={todayStr}
        onCreatePop={handleCreatePop}
        onMovePop={handleMovePop}
        onResizePop={handleResizePop}
        onSelectPop={handleSelectPop}
        onSetPopLane={handleSetPopLane}
        onDuplicatePop={handleDuplicatePop}
        onOpenPopDetails={handleOpenPopDetails}
        onCreateEvent={handleCreateEvent}
        onMoveEvent={handleMoveEvent}
        onResizeEvent={handleResizeEvent}
        onSelectEvent={handleSelectEvent}
        onDuplicateEvent={handleDuplicateEvent}
        onOpenEventDetails={handleOpenEventDetails}
        onReparentEvent={handleReparentEvent}
        onDeselect={closePopover}
        onMarqueeSelect={handleMarqueeSelect}
        onExitIsolation={() => { setIsolatedExperimentId(null); setPopover(null); }}
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
            population={popoverPopDisplay!}
            eventCount={popoverEventCount}
            eventTemplates={storage.getAllSubEventTemplates()}
            onEnterIsolation={() => handleEnterIsolationFor(popover.popId)}
            onEditDetails={() => setEditingFullPanel(true)}
            onDelete={() => handleDeletePopulation(popover.popId)}
            onRepeatNextWeek={() => { handleRepeatNextWeek(popover.popId); closePopover(); }}
            onAddQuickEvent={(label, color, durationH, offsetFromEndH) =>
              handleAddQuickEvent(popover.popId, label, color, durationH, offsetFromEndH)
            }
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
          operator={fullPanelOperator}
          onUpdateOperatorColor={handleUpdateOperatorColor}
          allEvents={events}
          onUpdateSubEvent={handleUpdateEvent}
          onDeleteSubEvent={handleDeleteEvent}
          onUpdatePopulation={handleUpdatePopulation}
          onDeletePopulation={handleDeletePopulation}
          onRepeatNextWeek={handleRepeatNextWeek}
          onEnterIsolation={handleEnterIsolationFor}
          onAddQuickEvent={handleAddQuickEvent}
          eventTemplates={storage.getAllSubEventTemplates()}
          onClose={closePopover}
          isMobile={isMobile}
        />
      )}

      {/* Floating add-event pane — auto-surfaced over the dimmed area in isolation mode */}
      {isolatedExperimentId && !editingFullPanel && !addPanelDismissed && (() => {
        const isoPop = displayPopulations.find(p => p.id === isolatedExperimentId);
        if (!isoPop) return null;
        return (
          <IsolationAddPanel
            population={isoPop}
            eventTemplates={storage.getAllSubEventTemplates()}
            isMobile={isMobile}
            onAddQuickEvent={(label, color, durationH, offsetFromEndH) =>
              handleAddQuickEvent(isolatedExperimentId, label, color, durationH, offsetFromEndH)
            }
            onCreateNew={() => handleCreateBlankEvent(isolatedExperimentId)}
            onClose={() => setAddPanelDismissed(true)}
          />
        );
      })()}

      {/* Multi-select action bar — shown while a shift-drag selection is active */}
      {selectedPopIds.length > 0 && !isolatedExperimentId && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 bg-slate-900 text-white rounded-2xl shadow-2xl px-2 py-1.5">
          <span className="px-2.5 text-xs font-bold whitespace-nowrap">
            {selectedPopIds.length} selected
          </span>
          <div className="w-px h-5 bg-white/20" />
          <button
            onClick={handleDuplicateSelected}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-white/15 transition-colors"
          >
            Duplicate
          </button>
          <button
            onClick={handleDeleteSelected}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-300 hover:bg-red-500/25 transition-colors"
          >
            Delete
          </button>
          <button
            onClick={clearSelection}
            aria-label="Clear selection"
            title="Clear (Esc)"
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/15 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>
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
