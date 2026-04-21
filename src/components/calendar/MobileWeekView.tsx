'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CellPopulation,
  SubEvent,
  Connection,
  POPULATION_COLORS,
  SUB_EVENT_COLORS,
  PlateType,
  densityUnit,
  platesLabel,
} from '@/types';
import { toDateStr, rangesOverlap, addDays } from '@/lib/dates';
import * as storage from '@/lib/storage';
import { onRemoteChange } from '@/lib/sync';
import EventPanel from './EventPanel';
import NewPopulationDialog from './NewPopulationDialog';
import { SyncBadge } from './CalendarGrid';

// Fraction of bar length near the top/bottom that counts as "edge" for resize.
// Also capped by a pixel threshold so edges stay reachable on very long bars.
const EDGE_FRAC = 0.25;
const EDGE_MAX_PX = 40;
const DOUBLE_TAP_MS = 400;

// Inset for sub-events inside a bar so the bar always has a visible "lip" on
// each long side that the user can tap or drag — otherwise an event-packed
// experiment would be unselectable. Portrait bars are vertical (lips = L/R);
// landscape bars are horizontal (lips = T/B).
const PORT_EVENT_INSET_X = 10;
const LAND_EVENT_INSET_Y = 6;

// Per-experiment lane memo for mobile portrait — same idea as the desktop memo: each
// population keeps its column across renders unless its current column collides with
// another. Critical during resize so dates changing doesn't shuffle columns.
const portraitSlotMemo = new Map<string, Map<string, number>>();

// A population's *extended* range is its declared range widened to include any of
// its events that fell outside (typically because the user shrank the pop later —
// e.g. a pre-coating event left on the day before a 3-day experiment). The solid
// declared region stays; a semi-transparent halo shows the extension.
function computePopExt(pop: CellPopulation, events: SubEvent[]): { extStart: string; extEnd: string } {
  let extStart = pop.startDate;
  let extEnd = pop.endDate;
  for (const ev of events) {
    if (ev.populationId !== pop.id) continue;
    if (ev.startDate < extStart) extStart = ev.startDate;
    if (ev.endDate > extEnd) extEnd = ev.endDate;
  }
  return { extStart, extEnd };
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAY_ROW_H = 72;       // portrait: height of each day row
const LABEL_W = 56;         // portrait: width of left day-label column
const LABEL_H = 28;         // landscape: height of top day-label row
const LONG_PRESS_MS = 500;

function eventDurationHours(ev: SubEvent): number {
  const [sy, sm, sd] = ev.startDate.split('-').map(Number);
  const [ey, em, ed] = ev.endDate.split('-').map(Number);
  const dayDelta = Math.round((new Date(ey, em - 1, ed).getTime() - new Date(sy, sm - 1, sd).getTime()) / 86400000);
  return dayDelta * 24 + (ev.endHour + 1 - ev.startHour);
}

function displayEventLabel(ev: SubEvent): string {
  const h = eventDurationHours(ev);
  const label = (ev.label || '').trim();
  if (h <= 3) return (label.charAt(0) || '?').toUpperCase();
  if (h < 20 && label.length > 3) return label.slice(0, 3).toUpperCase();
  return label || '?';
}

interface Props {
  experimentId: string;
  orientation: 'portrait' | 'landscape';
  syncStatus: string;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86400000);
}

function weekStartOf(d: Date): Date {
  const dow = (d.getDay() + 6) % 7;
  const r = new Date(d);
  r.setDate(d.getDate() - dow);
  r.setHours(0, 0, 0, 0);
  return r;
}

export default function MobileWeekView({ experimentId, orientation, syncStatus }: Props) {
  const [populations, setPopulations] = useState<CellPopulation[]>(() => storage.getPopulations(experimentId));
  const [events, setEvents] = useState<SubEvent[]>(() => storage.getAllSubEvents(experimentId));
  const [, setConnections] = useState<Connection[]>(() => storage.getConnections(experimentId));

  const [selectedPopId, setSelectedPopId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  // First tap highlights; second tap on the same item opens the parameters panel.
  const [panelVisible, setPanelVisible] = useState(false);
  const lastTap = useRef<{ kind: 'pop' | 'event'; id: string; time: number } | null>(null);

  // Active resize: when the user long-presses the edge of an already-highlighted
  // bar or event, we switch into this mode instead of creating something new.
  const [activeResize, setActiveResize] = useState<
    | { kind: 'pop'; id: string; edge: 'start' | 'end' }
    | { kind: 'event'; id: string; edge: 'start' | 'end' }
    | null
  >(null);

  // Active drag-create inside an existing bar (long-press on an unselected bar).
  const [activeEventCreate, setActiveEventCreate] = useState<
    | { popId: string; startDate: string; startHour: number; endDate: string; endHour: number }
    | null
  >(null);

  // Active move: short-press + immediate drag on a bar or event translates it by day.
  // `anchor` is the last-seen day under the finger — moves are incremental so rounding
  // never drifts.
  const activeMove = useRef<
    | { kind: 'pop'; id: string; anchor: string }
    | { kind: 'event'; id: string; anchor: string }
    | null
  >(null);

  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragEnd, setDragEnd] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const dragging = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchOrigin = useRef<{ x: number; y: number; moved: boolean; date: string } | null>(null);

  // Keep locals in sync with remote changes
  useEffect(() => {
    const off = onRemoteChange(() => {
      setPopulations(storage.getPopulations(experimentId));
      setEvents(storage.getAllSubEvents(experimentId));
      setConnections(storage.getConnections(experimentId));
    });
    return off;
  }, [experimentId]);

  // Week list: 8 weeks back, 24 ahead (≈6 months total) centered on today.
  const [weeks, anchorWeekIdx] = useMemo(() => {
    const today = new Date();
    const mon = weekStartOf(today);
    const list: Date[][] = [];
    const BACK = 8, FWD = 24;
    for (let w = -BACK; w < FWD; w++) {
      const ws = new Date(mon);
      ws.setDate(mon.getDate() + w * 7);
      const days: Date[] = [];
      for (let d = 0; d < 7; d++) {
        const x = new Date(ws);
        x.setDate(ws.getDate() + d);
        days.push(x);
      }
      list.push(days);
    }
    return [list, BACK];
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const weekRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [scrolledOnce, setScrolledOnce] = useState(false);

  useEffect(() => {
    setScrolledOnce(false);
  }, [orientation]);
  useEffect(() => {
    if (scrolledOnce) return;
    const el = weekRefs.current[anchorWeekIdx];
    if (el && scrollRef.current) {
      el.scrollIntoView(orientation === 'portrait' ? { block: 'start', behavior: 'auto' } : { inline: 'start', behavior: 'auto' });
      setScrolledOnce(true);
    }
  }, [scrolledOnce, anchorWeekIdx, orientation]);

  const handleCreatePopulation = useCallback((data: { name: string; cellLine: string; passage: string; plateType: PlateType; plateCount: number; cellDensity: string; experimenter: string; experimentLabel: string; comments: string }) => {
    if (!dragStart || !dragEnd) return;
    const s = dragStart < dragEnd ? dragStart : dragEnd;
    const e = dragStart < dragEnd ? dragEnd : dragStart;
    const pop: CellPopulation = {
      id: crypto.randomUUID(), experimentId,
      name: data.name, cellLine: data.cellLine, passage: data.passage,
      color: POPULATION_COLORS[populations.length % POPULATION_COLORS.length],
      plateType: data.plateType, plateCount: data.plateCount, cellDensity: data.cellDensity,
      experimenter: data.experimenter,
      experimentLabel: data.experimentLabel,
      comments: data.comments, allDay: true,
      startDate: s, startHour: 0, endDate: e, endHour: 23,
    };
    storage.savePopulation(pop);
    setPopulations(p => [...p, pop]);
    setDragStart(null); setDragEnd(null); setShowNewDialog(false);
    setSelectedPopId(null); setSelectedEventId(null);
  }, [dragStart, dragEnd, experimentId, populations.length]);

  const createEvent = useCallback((popId: string, date: string, startHour: number) => {
    const pop = populations.find(p => p.id === popId);
    if (!pop) return;
    let d = date;
    if (d < pop.startDate) d = pop.startDate;
    if (d > pop.endDate) d = pop.endDate;
    let sH = Math.max(0, Math.min(16, startHour));
    if (sH + 7 > 23) sH = 16;
    const ev: SubEvent = {
      id: crypto.randomUUID(), populationId: popId,
      label: 'New event', comments: '', allDay: false,
      startDate: d, startHour: sH, endDate: d, endHour: sH + 7,
      color: SUB_EVENT_COLORS[events.filter(se => se.populationId === popId).length % SUB_EVENT_COLORS.length],
    };
    storage.saveSubEvent(ev);
    setEvents(prev => [...prev, ev]);
    setSelectedEventId(ev.id); setSelectedPopId(popId);
  }, [populations, events]);

  const handleUpdateEvent = useCallback((ev: SubEvent) => {
    storage.saveSubEvent(ev);
    setEvents(prev => prev.map(e => e.id === ev.id ? ev : e));
  }, []);
  const handleDeleteEvent = useCallback((id: string) => {
    storage.deleteSubEvent(id);
    setEvents(prev => prev.filter(e => e.id !== id));
    setSelectedEventId(null);
  }, []);
  const handleUpdatePopulation = useCallback((pop: CellPopulation) => {
    storage.savePopulation(pop);
    setPopulations(prev => prev.map(p => p.id === pop.id ? pop : p));
  }, []);
  const handleDeletePopulation = useCallback((id: string) => {
    storage.deletePopulation(id);
    setPopulations(prev => prev.filter(p => p.id !== id));
    setEvents(prev => prev.filter(ev => ev.populationId !== id));
    setSelectedPopId(null); setSelectedEventId(null);
  }, []);
  const handleRepeatNextWeek = useCallback((popId: string) => {
    const pop = populations.find(p => p.id === popId);
    if (!pop) return;
    const newPopId = crypto.randomUUID();
    const newPop: CellPopulation = {
      ...pop, id: newPopId,
      startDate: addDays(pop.startDate, 7), endDate: addDays(pop.endDate, 7),
      color: POPULATION_COLORS[populations.length % POPULATION_COLORS.length],
    };
    storage.savePopulation(newPop);
    const popEvents = events.filter(ev => ev.populationId === popId);
    const newEvents: SubEvent[] = popEvents.map(ev => ({ ...ev, id: crypto.randomUUID(), populationId: newPopId, startDate: addDays(ev.startDate, 7), endDate: addDays(ev.endDate, 7) }));
    newEvents.forEach(ev => storage.saveSubEvent(ev));
    setPopulations(prev => [...prev, newPop]);
    setEvents(prev => [...prev, ...newEvents]);
    setSelectedPopId(newPopId); setSelectedEventId(null);
  }, [populations, events]);

  // Touch → day element. During an active drag the finger usually sits on top of a
  // bar, which hides the underlying day cell from elementFromPoint. Fall back to a
  // geometric scan over all [data-day] elements so dragging still tracks the day.
  const findDayElAt = useCallback((clientX: number, clientY: number): HTMLElement | null => {
    const hit = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const direct = hit?.closest('[data-day]') as HTMLElement | null;
    if (direct) return direct;
    const nodes = document.querySelectorAll<HTMLElement>('[data-day]');
    for (const el of nodes) {
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
        return el;
      }
    }
    return null;
  }, []);
  const getDateFromTouch = useCallback((clientX: number, clientY: number): string | null => {
    return findDayElAt(clientX, clientY)?.dataset.day || null;
  }, [findDayElAt]);
  // Sub-day precision for resize: pick the hour from the touch position within the
  // day cell. In portrait days are rows (time maps to Y); in landscape days are
  // columns (time maps to X).
  const getDateHourFromTouch = useCallback((clientX: number, clientY: number): { date: string; hour: number } | null => {
    const el = findDayElAt(clientX, clientY);
    if (!el) return null;
    const date = el.dataset.day;
    if (!date) return null;
    const r = el.getBoundingClientRect();
    const frac = orientation === 'portrait'
      ? (clientY - r.top) / Math.max(1, r.height)
      : (clientX - r.left) / Math.max(1, r.width);
    const hour = Math.max(0, Math.min(23, Math.floor(frac * 24)));
    return { date, hour };
  }, [findDayElAt, orientation]);

  // Track whether the current touch started on a blank cell so touchEnd can tell a
  // "tap to deselect" from a "tap on bar" (which clears this ref implicitly).
  const blankTapRef = useRef<{ date: string } | null>(null);

  // Long-press to create: a 500 ms hold on an empty cell starts drag-create — but
  // only when nothing is currently highlighted. If something is selected, a tap on
  // blank deselects instead (handled in touchEnd).
  const onTouchStartCell = useCallback((dateStr: string, e: React.TouchEvent) => {
    const t = e.touches[0];
    touchOrigin.current = { x: t.clientX, y: t.clientY, moved: false, date: dateStr };
    blankTapRef.current = { date: dateStr };
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (selectedPopId !== null || selectedEventId !== null) return;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      if (touchOrigin.current && !touchOrigin.current.moved) {
        dragging.current = true;
        setDragStart(dateStr);
        setDragEnd(dateStr);
        if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(25);
      }
    }, 500);
  }, [selectedPopId, selectedEventId]);

  // --- New interaction model -------------------------------------------------

  const clearSelection = useCallback(() => {
    setSelectedPopId(null);
    setSelectedEventId(null);
    setPanelVisible(false);
    lastTap.current = null;
  }, []);

  const handleTapPop = useCallback((popId: string) => {
    const now = Date.now();
    const prev = lastTap.current;
    const alreadyHighlighted = selectedPopId === popId && !selectedEventId;
    const isSecondTap =
      alreadyHighlighted && prev?.kind === 'pop' && prev.id === popId && now - prev.time < DOUBLE_TAP_MS;
    if (isSecondTap) {
      setPanelVisible(true);
    } else {
      setSelectedPopId(popId);
      setSelectedEventId(null);
      setPanelVisible(false);
    }
    lastTap.current = { kind: 'pop', id: popId, time: now };
  }, [selectedPopId, selectedEventId]);

  const handleTapEvent = useCallback((eventId: string, popId: string) => {
    const now = Date.now();
    const prev = lastTap.current;
    const alreadyHighlighted = selectedEventId === eventId;
    const isSecondTap =
      alreadyHighlighted && prev?.kind === 'event' && prev.id === eventId && now - prev.time < DOUBLE_TAP_MS;
    if (isSecondTap) {
      setPanelVisible(true);
    } else {
      setSelectedEventId(eventId);
      setSelectedPopId(popId);
      setPanelVisible(false);
    }
    lastTap.current = { kind: 'event', id: eventId, time: now };
  }, [selectedEventId]);

  const hasAnySelection = selectedPopId !== null || selectedEventId !== null;

  // Resize commit: touchmove while activeResize is set → update the affected record's
  // start or end boundary to the day+hour currently under the finger. Hour gives
  // sub-day precision so dragging feels smooth.
  const resizePopToDateHour = useCallback((popId: string, edge: 'start' | 'end', date: string, hour: number) => {
    setPopulations(prev => prev.map(p => {
      if (p.id !== popId) return p;
      if (edge === 'start') {
        if (date > p.endDate || (date === p.endDate && hour > p.endHour)) return p;
        return { ...p, startDate: date, startHour: hour };
      } else {
        if (date < p.startDate || (date === p.startDate && hour < p.startHour)) return p;
        return { ...p, endDate: date, endHour: hour };
      }
    }));
  }, []);

  const resizeEventToDateHour = useCallback((evtId: string, edge: 'start' | 'end', date: string, hour: number) => {
    setEvents(prev => prev.map(ev => {
      if (ev.id !== evtId) return ev;
      const pop = populations.find(p => p.id === ev.populationId);
      // Clamp to parent pop's range.
      let d = date, h = hour;
      if (pop) {
        if (d < pop.startDate || (d === pop.startDate && h < pop.startHour)) { d = pop.startDate; h = pop.startHour; }
        if (d > pop.endDate || (d === pop.endDate && h > pop.endHour)) { d = pop.endDate; h = pop.endHour; }
      }
      if (edge === 'start') {
        if (d > ev.endDate || (d === ev.endDate && h > ev.endHour)) return ev;
        return { ...ev, startDate: d, startHour: h, allDay: false };
      } else {
        if (d < ev.startDate || (d === ev.startDate && h < ev.startHour)) return ev;
        return { ...ev, endDate: d, endHour: h, allDay: false };
      }
    }));
  }, [populations]);

  // Persist resize changes on release.
  const commitResize = useCallback(() => {
    if (!activeResize) return;
    if (activeResize.kind === 'pop') {
      const p = populations.find(x => x.id === activeResize.id);
      if (p) storage.savePopulation(p);
    } else {
      const ev = events.find(x => x.id === activeResize.id);
      if (ev) storage.saveSubEvent(ev);
    }
    setActiveResize(null);
  }, [activeResize, populations, events]);

  // Move helpers: incremental day-delta moves so rounding never accumulates error.
  const movePopByDays = useCallback((popId: string, dayDelta: number) => {
    if (dayDelta === 0) return;
    setPopulations(prev => prev.map(p => {
      if (p.id !== popId) return p;
      return { ...p, startDate: addDays(p.startDate, dayDelta), endDate: addDays(p.endDate, dayDelta) };
    }));
    setEvents(prev => prev.map(ev => {
      if (ev.populationId !== popId) return ev;
      return { ...ev, startDate: addDays(ev.startDate, dayDelta), endDate: addDays(ev.endDate, dayDelta) };
    }));
  }, []);

  const moveEventByDays = useCallback((evtId: string, dayDelta: number) => {
    if (dayDelta === 0) return;
    setEvents(prev => prev.map(ev => {
      if (ev.id !== evtId) return ev;
      const pop = populations.find(p => p.id === ev.populationId);
      if (!pop) return ev;
      const newStart = addDays(ev.startDate, dayDelta);
      const newEnd = addDays(ev.endDate, dayDelta);
      if (newStart < pop.startDate || newEnd > pop.endDate) return ev;
      return { ...ev, startDate: newStart, endDate: newEnd };
    }));
  }, [populations]);

  const commitMove = useCallback(() => {
    const mv = activeMove.current;
    if (!mv) return;
    if (mv.kind === 'pop') {
      const pop = populations.find(p => p.id === mv.id);
      if (pop) {
        storage.savePopulation(pop);
        events.filter(ev => ev.populationId === pop.id).forEach(ev => storage.saveSubEvent(ev));
      }
    } else {
      const ev = events.find(e => e.id === mv.id);
      if (ev) storage.saveSubEvent(ev);
    }
    activeMove.current = null;
  }, [populations, events]);

  // Start a move drag (called from bar/event touch handlers when the user drags before
  // the long-press timer fires).
  const startMovePop = useCallback((popId: string, anchorDate: string) => {
    activeMove.current = { kind: 'pop', id: popId, anchor: anchorDate };
  }, []);
  const startMoveEvent = useCallback((evtId: string, anchorDate: string) => {
    activeMove.current = { kind: 'event', id: evtId, anchor: anchorDate };
  }, []);

  const startResizePop = useCallback((popId: string, edge: 'start' | 'end') => {
    setActiveResize({ kind: 'pop', id: popId, edge });
  }, []);
  const startResizeEvent = useCallback((evtId: string, edge: 'start' | 'end') => {
    setActiveResize({ kind: 'event', id: evtId, edge });
  }, []);
  const startCreateEventInBar = useCallback(
    (popId: string, date: string, hour: number) => {
      const sH = Math.max(0, Math.min(20, hour));
      const eH = Math.min(23, sH + 3);
      setActiveEventCreate({ popId, startDate: date, startHour: sH, endDate: date, endHour: eH });
    },
    [],
  );

  // Commit event-create on release: turn the dragged range into a real sub-event.
  const commitEventCreate = useCallback(() => {
    if (!activeEventCreate) return;
    const { popId, startDate, startHour, endDate, endHour } = activeEventCreate;
    const pop = populations.find(p => p.id === popId);
    if (!pop) { setActiveEventCreate(null); return; }
    const lo = startDate <= endDate ? startDate : endDate;
    const hi = startDate <= endDate ? endDate : startDate;
    const sDate = lo < pop.startDate ? pop.startDate : lo > pop.endDate ? pop.endDate : lo;
    const eDate = hi < pop.startDate ? pop.startDate : hi > pop.endDate ? pop.endDate : hi;
    const ev: SubEvent = {
      id: crypto.randomUUID(),
      populationId: popId,
      label: 'New event',
      comments: '',
      allDay: sDate !== eDate,
      startDate: sDate,
      startHour,
      endDate: eDate,
      endHour,
      color: SUB_EVENT_COLORS[events.filter(se => se.populationId === popId).length % SUB_EVENT_COLORS.length],
    };
    storage.saveSubEvent(ev);
    setEvents(prev => [...prev, ev]);
    setActiveEventCreate(null);
    setSelectedEventId(ev.id);
    setSelectedPopId(popId);
    setPanelVisible(false);
  }, [activeEventCreate, populations, events]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    // An active MOVE shifts the bar/event by whole days as the finger crosses day boundaries.
    const mv = activeMove.current;
    if (mv) {
      const d = getDateFromTouch(t.clientX, t.clientY);
      if (!d) return;
      const delta = daysBetween(mv.anchor, d);
      if (delta !== 0) {
        if (mv.kind === 'pop') movePopByDays(mv.id, delta);
        else moveEventByDays(mv.id, delta);
        mv.anchor = d;
      }
      return;
    }
    // If a resize is active, update the target entity's boundary with sub-day precision.
    if (activeResize) {
      const dh = getDateHourFromTouch(t.clientX, t.clientY);
      if (!dh) return;
      if (activeResize.kind === 'pop') resizePopToDateHour(activeResize.id, activeResize.edge, dh.date, dh.hour);
      else resizeEventToDateHour(activeResize.id, activeResize.edge, dh.date, dh.hour);
      return;
    }
    // If an event-create drag is active, extend its end date to the finger position.
    if (activeEventCreate) {
      const d = getDateFromTouch(t.clientX, t.clientY);
      if (!d) return;
      setActiveEventCreate(prev => prev ? { ...prev, endDate: d } : prev);
      return;
    }
    // If we haven't committed to create mode yet, watch for movement and cancel the long-press.
    if (!dragging.current) {
      const origin = touchOrigin.current;
      if (origin && !origin.moved) {
        const dx = Math.abs(t.clientX - origin.x);
        const dy = Math.abs(t.clientY - origin.y);
        if (dx > 6 || dy > 6) {
          origin.moved = true;
          if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
        }
      }
      return; // let native scroll handle it
    }
    const d = getDateFromTouch(t.clientX, t.clientY);
    if (d) setDragEnd(d);
  }, [getDateFromTouch, getDateHourFromTouch, activeResize, activeEventCreate, resizePopToDateHour, resizeEventToDateHour, movePopByDays, moveEventByDays]);

  const onTouchEnd = useCallback(() => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
    const wasBlankTap = blankTapRef.current !== null && !touchOrigin.current?.moved;
    touchOrigin.current = null;
    blankTapRef.current = null;
    if (activeMove.current) { commitMove(); return; }
    if (activeResize) { commitResize(); return; }
    if (activeEventCreate) { commitEventCreate(); return; }
    if (!dragging.current) {
      // Short tap on a blank cell → deselect if anything was highlighted.
      if (wasBlankTap && (selectedPopId !== null || selectedEventId !== null)) {
        clearSelection();
      }
      return;
    }
    dragging.current = false;
    if (dragStart && dragEnd) setShowNewDialog(true);
  }, [dragStart, dragEnd, activeResize, activeEventCreate, commitMove, commitResize, commitEventCreate, selectedPopId, selectedEventId, clearSelection]);

  const selectedEvent = events.find(e => e.id === selectedEventId) || null;
  const selectedPop = populations.find(p => p.id === selectedPopId) || null;
  const todayStr = toDateStr(new Date());
  const dragRange = dragStart && dragEnd ? { start: dragStart < dragEnd ? dragStart : dragEnd, end: dragStart < dragEnd ? dragEnd : dragStart } : null;

  // Global slot assignment — each population keeps the same column across every week
  // it spans AND across re-renders (so resizing doesn't shuffle columns). A pop only
  // moves to a new column when its remembered column collides with another.
  const portraitSlots = useMemo(() => {
    const memo = portraitSlotMemo.get(experimentId) ?? new Map<string, number>();
    const assignment = new Map<string, number>();
    const popById = new Map(populations.map(p => [p.id, p] as const));

    const slotConflicts = (popId: string, slot: number) => {
      const pop = popById.get(popId);
      if (!pop) return false;
      for (const [otherId, otherSlot] of assignment) {
        if (otherSlot !== slot) continue;
        const other = popById.get(otherId);
        if (!other) continue;
        if (pop.startDate <= other.endDate && pop.endDate >= other.startDate) return true;
      }
      return false;
    };

    const memoized = populations
      .filter(p => memo.has(p.id))
      .sort((a, b) => (memo.get(a.id)! - memo.get(b.id)!) || a.id.localeCompare(b.id));
    const fresh = populations
      .filter(p => !memo.has(p.id))
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));

    for (const pop of [...memoized, ...fresh]) {
      const preferred = memo.get(pop.id);
      let slot: number;
      if (preferred !== undefined && !slotConflicts(pop.id, preferred)) slot = preferred;
      else {
        slot = 0;
        while (slotConflicts(pop.id, slot)) slot++;
      }
      assignment.set(pop.id, slot);
    }

    const next = new Map(memo);
    for (const [id, slot] of assignment) next.set(id, slot);
    const liveIds = new Set(populations.map(p => p.id));
    for (const id of Array.from(next.keys())) if (!liveIds.has(id)) next.delete(id);
    portraitSlotMemo.set(experimentId, next);

    const result: Record<string, number> = {};
    for (const [id, slot] of assignment) result[id] = slot;
    return result;
  }, [populations, experimentId]);
  const portraitSlotCount = useMemo(() => {
    const vals = Object.values(portraitSlots);
    return vals.length > 0 ? Math.max(...vals) + 1 : 1;
  }, [portraitSlots]);

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="border-b border-slate-200 bg-white flex items-center px-3 py-2 flex-shrink-0">
        <button
          className="text-xs font-bold text-indigo-600 px-2 py-1 rounded hover:bg-indigo-50"
          onClick={() => {
            const el = weekRefs.current[anchorWeekIdx];
            el?.scrollIntoView(orientation === 'portrait' ? { block: 'start', behavior: 'smooth' } : { inline: 'start', behavior: 'smooth' });
          }}
        >
          Today
        </button>
        <span className="ml-2 text-xs font-semibold text-slate-400">
          {orientation === 'portrait' ? 'Swipe up/down to scroll weeks' : 'Swipe left/right for weeks'}
        </span>
        <SyncBadge status={syncStatus} />
      </div>

      <div
        ref={scrollRef}
        className={orientation === 'portrait'
          ? 'flex-1 overflow-y-auto overflow-x-hidden bg-slate-50'
          : 'flex-1 overflow-x-auto overflow-y-hidden bg-slate-50 flex'
        }
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {weeks.map((week, wi) => (
          <div
            key={wi}
            ref={el => { weekRefs.current[wi] = el; }}
            className={orientation === 'portrait'
              ? 'bg-white border-b-4 border-slate-100'
              : 'bg-white border-r-4 border-slate-100 flex-shrink-0 w-screen h-full flex flex-col'
            }
          >
            <WeekHeader week={week} orientation={orientation} />
            {orientation === 'portrait' ? (
              <PortraitWeek
                week={week}
                populations={populations}
                events={events}
                selectedPopId={selectedPopId}
                selectedEventId={selectedEventId}
                todayStr={todayStr}
                dragRange={dragRange}
                showNewDialog={showNewDialog}
                onTouchStartCell={onTouchStartCell}
                onSelectPop={(id) => { setSelectedPopId(id); setSelectedEventId(null); }}
                onSelectEvent={(id, popId) => { setSelectedEventId(id); setSelectedPopId(popId); }}
                onCreateSubEvent={createEvent}
                slots={portraitSlots}
                slotCount={portraitSlotCount}
                hasAnySelection={hasAnySelection}
                onPopTap={handleTapPop}
                onEventTap={handleTapEvent}
                onPopMoveStart={startMovePop}
                onEventMoveStart={startMoveEvent}
                onPopResizeStart={startResizePop}
                onEventResizeStart={startResizeEvent}
                onStartCreateEventInBar={startCreateEventInBar}
                activeEventCreate={activeEventCreate}
              />
            ) : (
              <LandscapeWeek
                week={week}
                populations={populations}
                events={events}
                selectedPopId={selectedPopId}
                selectedEventId={selectedEventId}
                todayStr={todayStr}
                dragRange={dragRange}
                showNewDialog={showNewDialog}
                onTouchStartCell={onTouchStartCell}
                onSelectPop={(id) => { setSelectedPopId(id); setSelectedEventId(null); }}
                onSelectEvent={(id, popId) => { setSelectedEventId(id); setSelectedPopId(popId); }}
                onCreateSubEvent={createEvent}
                hasAnySelection={hasAnySelection}
                onPopTap={handleTapPop}
                onEventTap={handleTapEvent}
                onPopMoveStart={startMovePop}
                onEventMoveStart={startMoveEvent}
                onPopResizeStart={startResizePop}
                onEventResizeStart={startResizeEvent}
                onStartCreateEventInBar={startCreateEventInBar}
                activeEventCreate={activeEventCreate}
              />
            )}
          </div>
        ))}
      </div>

      {panelVisible && (selectedEvent || selectedPop) && (
        <EventPanel
          subEvent={selectedEvent}
          population={selectedPop}
          allEvents={events}
          onUpdateSubEvent={handleUpdateEvent}
          onDeleteSubEvent={handleDeleteEvent}
          onUpdatePopulation={handleUpdatePopulation}
          onDeletePopulation={handleDeletePopulation}
          onRepeatNextWeek={handleRepeatNextWeek}
          onClose={() => { setPanelVisible(false); }}
          isMobile
        />
      )}

      {dragRange && !showNewDialog && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-4 py-2 rounded-2xl text-xs font-semibold shadow-xl z-50">
          {dragRange.start} → {dragRange.end}
        </div>
      )}

      {showNewDialog && dragRange && (
        <NewPopulationDialog
          startDate={dragRange.start}
          endDate={dragRange.end}
          onConfirm={handleCreatePopulation}
          onCancel={() => { setDragStart(null); setDragEnd(null); setShowNewDialog(false); }}
        />
      )}
    </div>
  );
}

function WeekHeader({ week, orientation }: { week: Date[]; orientation: 'portrait' | 'landscape' }) {
  const wsd = week[0], wed = week[6];
  const label = wsd.getMonth() === wed.getMonth()
    ? `${MONTH_SHORT[wsd.getMonth()]} ${wsd.getDate()}–${wed.getDate()}`
    : `${MONTH_SHORT[wsd.getMonth()]} ${wsd.getDate()} – ${MONTH_SHORT[wed.getMonth()]} ${wed.getDate()}`;
  const cls = orientation === 'portrait'
    ? 'sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500'
    : 'bg-white/95 backdrop-blur border-b border-slate-200 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500 flex-shrink-0';
  return (
    <div className={cls}>
      {label} <span className="text-slate-300 font-normal">· {wsd.getFullYear()}</span>
    </div>
  );
}

// --- PORTRAIT: days stacked as rows, bars as vertical strips ---

interface WeekProps {
  week: Date[];
  populations: CellPopulation[];
  events: SubEvent[];
  selectedPopId: string | null;
  selectedEventId: string | null;
  todayStr: string;
  dragRange: { start: string; end: string } | null;
  showNewDialog: boolean;
  onTouchStartCell: (dateStr: string, e: React.TouchEvent) => void;
  onSelectPop: (id: string) => void;
  onSelectEvent: (id: string, popId: string) => void;
  onCreateSubEvent?: (popId: string, date: string, startHour: number) => void;
  slots?: Record<string, number>;
  slotCount?: number;
  // New-model callbacks
  hasAnySelection: boolean;
  onPopTap: (popId: string) => void;
  onEventTap: (evtId: string, popId: string) => void;
  onPopMoveStart: (popId: string, anchorDate: string) => void;
  onEventMoveStart: (evtId: string, anchorDate: string) => void;
  onPopResizeStart: (popId: string, edge: 'start' | 'end') => void;
  onEventResizeStart: (evtId: string, edge: 'start' | 'end') => void;
  onStartCreateEventInBar: (popId: string, date: string, hour: number) => void;
  activeEventCreate: { popId: string; startDate: string; startHour: number; endDate: string; endHour: number } | null;
}

function PortraitWeek(p: WeekProps) {
  const weekStart = toDateStr(p.week[0]);
  const weekEnd = toDateStr(p.week[6]);
  // A pop is visible in this week if its *extended* range (declared + outside events)
  // overlaps the week. This keeps orphan events showing inside the extension halo.
  const visible = p.populations
    .map(pop => ({ pop, ...computePopExt(pop, p.events) }))
    .filter(({ extStart, extEnd }) => rangesOverlap(extStart, extEnd, weekStart, weekEnd));

  // Per-week fallback slot assignment (only used if caller didn't supply global slots).
  const localSlots = useMemo(() => {
    const result: Record<string, number> = {};
    const sorted = [...visible].sort((a, b) => a.extStart.localeCompare(b.extStart));
    const occupied: { slot: number; start: string; end: string }[] = [];
    for (const { pop, extStart, extEnd } of sorted) {
      const sDate = extStart > weekStart ? extStart : weekStart;
      const eDate = extEnd < weekEnd ? extEnd : weekEnd;
      let slot = 0;
      while (occupied.some(o => o.slot === slot && !(sDate > o.end || eDate < o.start))) slot++;
      occupied.push({ slot, start: sDate, end: eDate });
      result[pop.id] = slot;
    }
    return result;
  }, [visible, weekStart, weekEnd]);

  // Caller-provided global slots (stable column across weeks) take precedence so
  // multi-week experiments read as one continuous strip.
  const slots = p.slots ?? localSlots;

  const totalHeight = 7 * DAY_ROW_H;
  const vs = Object.values(slots);
  const slotCount = p.slotCount ?? Math.max(1, (vs.length > 0 ? Math.max(...vs) : -1) + 1);
  const laneWPct = 100 / slotCount;

  return (
    <div className="flex relative w-full" style={{ height: totalHeight }}>
      {/* Day label / cell column */}
      <div className="flex flex-col flex-shrink-0 bg-white" style={{ width: LABEL_W }}>
        {p.week.map((d) => {
          const ds = toDateStr(d);
          const isToday = ds === p.todayStr;
          const inDrag = p.dragRange && !p.showNewDialog && ds >= p.dragRange.start && ds <= p.dragRange.end;
          return (
            <div
              key={ds}
              data-day={ds}
              className={`flex flex-col items-center justify-center border-b border-slate-100 ${inDrag ? 'bg-indigo-50' : ''}`}
              style={{ height: DAY_ROW_H }}
              onTouchStart={(e) => {
                if ((e.target as HTMLElement).closest('[data-bar-v]') || (e.target as HTMLElement).closest('[data-event-v]')) return;
                p.onTouchStartCell(ds, e);
              }}
            >
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{DAY_NAMES[(d.getDay() + 6) % 7]}</span>
              <span className={`text-lg font-bold ${isToday ? 'text-white bg-indigo-600 w-8 h-8 rounded-full flex items-center justify-center' : 'text-slate-700'}`}>{d.getDate()}</span>
            </div>
          );
        })}
      </div>

      {/* Day content + bars area */}
      <div className="relative flex-1" style={{ height: totalHeight }}>
        {/* Day cells for touch targeting */}
        {p.week.map((d, idx) => {
          const ds = toDateStr(d);
          const inDrag = p.dragRange && !p.showNewDialog && ds >= p.dragRange.start && ds <= p.dragRange.end;
          return (
            <div
              key={ds}
              data-day={ds}
              className={`absolute left-0 right-0 border-b border-slate-100 ${inDrag ? 'bg-indigo-50/70' : ''}`}
              style={{ top: idx * DAY_ROW_H, height: DAY_ROW_H }}
              onTouchStart={(e) => {
                if ((e.target as HTMLElement).closest('[data-bar-v]') || (e.target as HTMLElement).closest('[data-event-v]')) return;
                p.onTouchStartCell(ds, e);
              }}
            />
          );
        })}

        {/* Vertical bars */}
        {visible.map(({ pop, extStart, extEnd }) => {
          const slot = slots[pop.id];
          const hasExtension = extStart < pop.startDate || extEnd > pop.endDate;

          // Extended bar covers extStart..extEnd clipped to this week.
          const extBarStart = extStart > weekStart ? extStart : weekStart;
          const extBarEnd = extEnd < weekEnd ? extEnd : weekEnd;
          const extContinuesAbove = extStart < weekStart;
          const extContinuesBelow = extEnd > weekEnd;
          const extStartOffsetDays = daysBetween(weekStart, extBarStart);
          const extEndOffsetDays = daysBetween(weekStart, extBarEnd);
          const top = extContinuesAbove ? 0 : extStartOffsetDays * DAY_ROW_H + 3;
          const bottom = extContinuesBelow ? totalHeight : (extEndOffsetDays + 1) * DAY_ROW_H - 3;

          // Declared region within this week (may be absent if all of declared is
          // in another week but events pulled the extension into this week).
          const declaredInWeek = rangesOverlap(pop.startDate, pop.endDate, weekStart, weekEnd);
          const decStartInWeek = pop.startDate > weekStart ? pop.startDate : weekStart;
          const decEndInWeek = pop.endDate < weekEnd ? pop.endDate : weekEnd;
          const decContinuesAbove = pop.startDate < weekStart;
          const decContinuesBelow = pop.endDate > weekEnd;
          const decTopAbs = declaredInWeek
            ? (decContinuesAbove ? 0 : daysBetween(weekStart, decStartInWeek) * DAY_ROW_H + 3)
            : null;
          const decBottomAbs = declaredInWeek
            ? (decContinuesBelow ? totalHeight : (daysBetween(weekStart, decEndInWeek) + 1) * DAY_ROW_H - 3)
            : null;

          const isSelected = p.selectedPopId === pop.id && !p.selectedEventId;
          // Show every event that overlaps the extended range so orphaned events
          // remain visible inside the halo.
          const barEvents = p.events.filter(ev =>
            ev.populationId === pop.id &&
            rangesOverlap(ev.startDate, ev.endDate, extBarStart, extBarEnd)
          );

          // Outer bar styling: if there's an extension, fade the outer so the inner
          // declared rectangle reads as the "real" experiment bounds.
          const outerBg = hasExtension ? pop.color + '0a' : pop.color + '18';
          const outerBorderColor = hasExtension ? pop.color + '55' : pop.color + '80';
          const outerBorderStyle = hasExtension ? 'dashed' : 'solid';

          return (
            <div
              key={pop.id}
              data-bar-v
              className={`absolute overflow-visible ${isSelected ? 'ring-2 ring-offset-2 ring-indigo-500' : ''}`}
              style={{
                top,
                height: bottom - top,
                left: `calc(${slot * laneWPct}% + 2px)`,
                width: `calc(${laneWPct}% - 4px)`,
                backgroundColor: outerBg,
                border: `2px ${outerBorderStyle} ${outerBorderColor}`,
                borderTopWidth: extContinuesAbove ? 0 : 2,
                borderBottomWidth: extContinuesBelow ? 0 : 2,
                borderTopLeftRadius: extContinuesAbove ? 0 : 12,
                borderTopRightRadius: extContinuesAbove ? 0 : 12,
                borderBottomLeftRadius: extContinuesBelow ? 0 : 12,
                borderBottomRightRadius: extContinuesBelow ? 0 : 12,
                // Block default scroll so drag-to-move works. Users scroll weeks via
                // empty cells or the day-label column.
                touchAction: 'none',
              }}
              onTouchStart={(e) => {
                // If the touch landed on a sub-event inside the bar, let the event's
                // own handler deal with it; bar doesn't preempt.
                if ((e.target as HTMLElement).closest('[data-event-v]')) return;
                e.stopPropagation();
                const t = e.touches[0];
                const barEl = e.currentTarget as HTMLElement;
                const rect = barEl.getBoundingClientRect();
                const yInBar = t.clientY - rect.top;
                const edgeThresh = Math.min(EDGE_MAX_PX, rect.height * EDGE_FRAC);
                // Resize edges sit at the *declared* boundaries, not the extension
                // boundaries — user expects to drag the solid rectangle's edge.
                const decTopInBar = decTopAbs !== null ? decTopAbs - top : null;
                const decBottomInBar = decBottomAbs !== null ? decBottomAbs - top : null;
                const nearTop = declaredInWeek && !decContinuesAbove && decTopInBar !== null &&
                  Math.abs(yInBar - decTopInBar) < edgeThresh;
                const nearBottom = declaredInWeek && !decContinuesBelow && decBottomInBar !== null &&
                  Math.abs(yInBar - decBottomInBar) < edgeThresh;
                const dayAtStart = (() => {
                  const el = document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null;
                  const dayEl = el?.closest('[data-day]') as HTMLElement | null;
                  return dayEl?.dataset.day || extBarStart;
                })();
                const origin = { x: t.clientX, y: t.clientY };
                let resolved = false;
                let moved = false;
                const thisBarSelected = p.selectedPopId === pop.id && !p.selectedEventId;

                const onMove = (mv: TouchEvent) => {
                  if (resolved) return;
                  const m = mv.touches[0];
                  const dx = Math.abs(m.clientX - origin.x);
                  const dy = Math.abs(m.clientY - origin.y);
                  if (!moved && (dx > 6 || dy > 6)) {
                    moved = true;
                    resolved = true;
                    clearTimeout(timer);
                    // Drag on a HIGHLIGHTED bar's edge → resize; otherwise move.
                    if (thisBarSelected && (nearTop || nearBottom)) {
                      p.onPopResizeStart(pop.id, nearTop ? 'start' : 'end');
                    } else {
                      p.onPopMoveStart(pop.id, dayAtStart);
                    }
                  }
                };
                const onEnd = () => {
                  window.removeEventListener('touchmove', onMove);
                  window.removeEventListener('touchend', onEnd);
                  clearTimeout(timer);
                  if (!resolved && !moved) {
                    // Short tap: highlight or open panel on double-tap.
                    p.onPopTap(pop.id);
                  }
                };
                const timer = setTimeout(() => {
                  if (resolved) return;
                  // Long-press only creates when nothing is highlighted anywhere.
                  // On a highlighted bar, holding still does nothing — release becomes a tap.
                  if (!p.hasAnySelection) {
                    resolved = true;
                    p.onStartCreateEventInBar(pop.id, dayAtStart, 9);
                    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(25);
                  }
                }, LONG_PRESS_MS);

                window.addEventListener('touchmove', onMove, { passive: true });
                window.addEventListener('touchend', onEnd);
              }}
            >
              {/* Solid inner rectangle marking the *declared* experiment bounds. Only
                  rendered when the outer bar has extension past declared; otherwise
                  the outer bar itself shows the declared bounds. */}
              {hasExtension && declaredInWeek && decTopAbs !== null && decBottomAbs !== null && (
                <div
                  className="absolute left-0 right-0 pointer-events-none"
                  style={{
                    top: decTopAbs - top,
                    height: decBottomAbs - decTopAbs,
                    backgroundColor: pop.color + '18',
                    border: `2px solid ${pop.color}80`,
                    borderTopWidth: decContinuesAbove ? 0 : 2,
                    borderBottomWidth: decContinuesBelow ? 0 : 2,
                    borderTopLeftRadius: decContinuesAbove ? 0 : 10,
                    borderTopRightRadius: decContinuesAbove ? 0 : 10,
                    borderBottomLeftRadius: decContinuesBelow ? 0 : 10,
                    borderBottomRightRadius: decContinuesBelow ? 0 : 10,
                  }}
                />
              )}

              {/* Side lips: always-visible draggable strips on the bar edges so the
                  experiment stays tappable even when it's packed with events. */}
              <div
                className="absolute top-1 bottom-1 left-0 pointer-events-none flex items-center justify-center"
                style={{ width: PORT_EVENT_INSET_X }}
              >
                <div className="w-0.5 rounded-full" style={{ height: 22, backgroundColor: pop.color + 'a0' }} />
              </div>
              <div
                className="absolute top-1 bottom-1 right-0 pointer-events-none flex items-center justify-center"
                style={{ width: PORT_EVENT_INSET_X }}
              >
                <div className="w-0.5 rounded-full" style={{ height: 22, backgroundColor: pop.color + 'a0' }} />
              </div>

              <div className="absolute inset-0 flex flex-col items-stretch px-1 py-1.5 pointer-events-none overflow-hidden">
                <span
                  className="text-[11px] font-bold leading-tight break-words text-center"
                  style={{ color: pop.color }}
                >
                  {platesLabel(pop.plateType, pop.plateCount)}
                </span>
                <span
                  className="mt-1 text-[10px] font-semibold leading-tight break-words text-center opacity-80"
                  style={{ color: pop.color }}
                >
                  {pop.name}
                </span>
                {pop.cellDensity && (
                  <span className="mt-0.5 text-[10px] font-semibold text-center opacity-70" style={{ color: pop.color }}>
                    {pop.cellDensity} {densityUnit(pop.plateType)}
                  </span>
                )}
              </div>

              {/* Drag-create ghost: translucent band showing the span being drawn. */}
              {p.activeEventCreate && p.activeEventCreate.popId === pop.id && (() => {
                const aec = p.activeEventCreate!;
                const lo = aec.startDate < aec.endDate ? aec.startDate : aec.endDate;
                const hi = aec.startDate < aec.endDate ? aec.endDate : aec.startDate;
                const cLo = lo < extBarStart ? extBarStart : lo;
                const cHi = hi > extBarEnd ? extBarEnd : hi;
                const topDays = daysBetween(extBarStart, cLo);
                const botDays = daysBetween(extBarStart, cHi) + 1;
                const span = daysBetween(extBarStart, extBarEnd) + 1;
                const topPct = (topDays / span) * 100;
                const hPct = ((botDays - topDays) / span) * 100;
                return (
                  <div
                    className="absolute rounded-md ring-2 ring-white/70 pointer-events-none"
                    style={{
                      top: `${topPct}%`,
                      height: `${hPct}%`,
                      left: PORT_EVENT_INSET_X,
                      right: PORT_EVENT_INSET_X,
                      backgroundColor: pop.color + 'b0',
                    }}
                  />
                );
              })()}

              {/* Sub-events as horizontal bands within the vertical bar — positioned
                  across the *extended* range so outside events stay visible. */}
              {barEvents.map(ev => {
                const evStart = ev.startDate < extBarStart ? extBarStart : ev.startDate;
                const evEnd = ev.endDate > extBarEnd ? extBarEnd : ev.endDate;
                const evTopDays = daysBetween(extBarStart, evStart);
                const evBottomDays = daysBetween(extBarStart, evEnd) + 1;
                const barSpanDays = daysBetween(extBarStart, extBarEnd) + 1;
                const evTopPct = (evTopDays / barSpanDays) * 100;
                const evHPct = ((evBottomDays - evTopDays) / barSpanDays) * 100;
                const isEvSel = p.selectedEventId === ev.id;
                return (
                  <div
                    key={ev.id}
                    data-event-v
                    className={`absolute rounded-md flex items-center justify-center ${isEvSel ? 'z-20' : ''}`}
                    style={{
                      top: `${evTopPct}%`,
                      height: `${evHPct}%`,
                      left: PORT_EVENT_INSET_X,
                      right: PORT_EVENT_INSET_X,
                      backgroundColor: ev.color + 'd0',
                      touchAction: 'none',
                      boxShadow: isEvSel
                        ? '0 0 0 2px #fff, 0 0 0 5px #4f46e5, 0 0 24px 6px rgba(79,70,229,0.65)'
                        : '0 1px 3px rgba(0,0,0,0.15)',
                    }}
                    onTouchStart={(e) => {
                      e.stopPropagation();
                      const t = e.touches[0];
                      const evEl = e.currentTarget as HTMLElement;
                      const rect = evEl.getBoundingClientRect();
                      const yIn = t.clientY - rect.top;
                      const edgeThresh = Math.min(EDGE_MAX_PX, rect.height * EDGE_FRAC);
                      const nearTop = yIn < edgeThresh;
                      const nearBottom = yIn > rect.height - edgeThresh;
                      const dayAtStart = (() => {
                        const el = document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null;
                        const dayEl = el?.closest('[data-day]') as HTMLElement | null;
                        return dayEl?.dataset.day || evStart;
                      })();
                      const origin = { x: t.clientX, y: t.clientY };
                      let resolved = false;
                      let moved = false;
                      const thisEvSelected = p.selectedEventId === ev.id;

                      const onMove = (mv: TouchEvent) => {
                        if (resolved) return;
                        const m = mv.touches[0];
                        const dx = Math.abs(m.clientX - origin.x);
                        const dy = Math.abs(m.clientY - origin.y);
                        if (!moved && (dx > 6 || dy > 6)) {
                          moved = true;
                          resolved = true;
                          clearTimeout(timer);
                          // Drag on a HIGHLIGHTED event's edge → resize; otherwise move.
                          if (thisEvSelected && (nearTop || nearBottom)) {
                            p.onEventResizeStart(ev.id, nearTop ? 'start' : 'end');
                          } else {
                            p.onEventMoveStart(ev.id, dayAtStart);
                          }
                        }
                      };
                      const onEnd = () => {
                        window.removeEventListener('touchmove', onMove);
                        window.removeEventListener('touchend', onEnd);
                        clearTimeout(timer);
                        if (!resolved && !moved) {
                          p.onEventTap(ev.id, ev.populationId);
                        }
                      };
                      // Long-press on an event does nothing (no events on events).
                      const timer = setTimeout(() => { /* intentionally no-op */ }, LONG_PRESS_MS);

                      window.addEventListener('touchmove', onMove, { passive: true });
                      window.addEventListener('touchend', onEnd);
                    }}
                  >
                    <span className="text-[10px] font-bold text-white truncate px-1">{displayEventLabel(ev)}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- LANDSCAPE: days as columns, bars horizontal ---

function LandscapeWeek(p: WeekProps) {
  const weekStart = toDateStr(p.week[0]);
  const weekEnd = toDateStr(p.week[6]);
  const visible = p.populations
    .map(pop => ({ pop, ...computePopExt(pop, p.events) }))
    .filter(({ extStart, extEnd }) => rangesOverlap(extStart, extEnd, weekStart, weekEnd));

  const slots = useMemo(() => {
    const result: Record<string, number> = {};
    const sorted = [...visible].sort((a, b) => a.extStart.localeCompare(b.extStart));
    const occupied: { slot: number; start: string; end: string }[] = [];
    for (const { pop, extStart, extEnd } of sorted) {
      const sDate = extStart > weekStart ? extStart : weekStart;
      const eDate = extEnd < weekEnd ? extEnd : weekEnd;
      let slot = 0;
      while (occupied.some(o => o.slot === slot && !(sDate > o.end || eDate < o.start))) slot++;
      occupied.push({ slot, start: sDate, end: eDate });
      result[pop.id] = slot;
    }
    return result;
  }, [visible, weekStart, weekEnd]);

  const maxSlot = Object.values(slots).length > 0 ? Math.max(0, ...Object.values(slots)) : -1;
  const slotCount = Math.max(1, maxSlot + 1);
  const laneHPct = 100 / slotCount;

  return (
    <div className="relative flex-1 flex flex-col min-h-0">
      {/* Day columns (label row) */}
      <div className="grid grid-cols-7 flex-shrink-0" style={{ height: LABEL_H }}>
        {p.week.map((d) => {
          const ds = toDateStr(d);
          const isToday = ds === p.todayStr;
          const inDrag = p.dragRange && !p.showNewDialog && ds >= p.dragRange.start && ds <= p.dragRange.end;
          return (
            <div
              key={`h-${ds}`}
              className={`border-r border-slate-100 last:border-r-0 ${inDrag ? 'bg-indigo-50/70' : ''}`}
            >
              <div className="flex items-baseline justify-center gap-1 py-1" style={{ height: LABEL_H }}>
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{DAY_NAMES[(d.getDay() + 6) % 7]}</span>
                <span className={`text-[13px] font-bold ${isToday ? 'text-white bg-indigo-600 w-6 h-6 rounded-full flex items-center justify-center' : 'text-slate-700'}`}>{d.getDate()}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bar area — fills remaining vertical space, bars compress */}
      <div className="relative flex-1 min-h-0">
        {/* Touch-target day columns in the bar area */}
        <div className="absolute inset-0 grid grid-cols-7">
          {p.week.map((d) => {
            const ds = toDateStr(d);
            const inDrag = p.dragRange && !p.showNewDialog && ds >= p.dragRange.start && ds <= p.dragRange.end;
            return (
              <div
                key={`c-${ds}`}
                data-day={ds}
                className={`border-r border-slate-100 last:border-r-0 ${inDrag ? 'bg-indigo-50/70' : ''}`}
                onTouchStart={(e) => {
                  if ((e.target as HTMLElement).closest('[data-bar-h]') || (e.target as HTMLElement).closest('[data-event-h]')) return;
                  p.onTouchStartCell(ds, e);
                }}
              />
            );
          })}
        </div>

        {visible.map(({ pop, extStart, extEnd }) => {
          const slot = slots[pop.id];
          const hasExtension = extStart < pop.startDate || extEnd > pop.endDate;

          const extBarStart = extStart > weekStart ? extStart : weekStart;
          const extBarEnd = extEnd < weekEnd ? extEnd : weekEnd;
          const extStartCol = daysBetween(weekStart, extBarStart);
          const extEndCol = daysBetween(weekStart, extBarEnd);
          const extLeftPct = (extStartCol / 7) * 100;
          const extWidthPct = ((extEndCol - extStartCol + 1) / 7) * 100;

          const declaredInWeek = rangesOverlap(pop.startDate, pop.endDate, weekStart, weekEnd);
          const decStartInWeek = pop.startDate > weekStart ? pop.startDate : weekStart;
          const decEndInWeek = pop.endDate < weekEnd ? pop.endDate : weekEnd;
          const decStartCol = daysBetween(weekStart, decStartInWeek);
          const decEndCol = daysBetween(weekStart, decEndInWeek);
          // Declared position inside the outer (ext) bar, expressed as percentages.
          const extSpanDays = extEndCol - extStartCol + 1;
          const decLeftPctInBar = declaredInWeek ? ((decStartCol - extStartCol) / extSpanDays) * 100 : 0;
          const decWidthPctInBar = declaredInWeek ? ((decEndCol - decStartCol + 1) / extSpanDays) * 100 : 0;
          const decContinuesLeft = pop.startDate < weekStart;
          const decContinuesRight = pop.endDate > weekEnd;

          const isSelected = p.selectedPopId === pop.id && !p.selectedEventId;
          const barEvents = p.events.filter(ev =>
            ev.populationId === pop.id &&
            rangesOverlap(ev.startDate, ev.endDate, extBarStart, extBarEnd)
          );

          const outerBg = hasExtension ? pop.color + '0a' : pop.color + '18';
          const outerBorderColor = hasExtension ? pop.color + '55' : pop.color + '80';
          const outerBorderStyle = hasExtension ? 'dashed' : 'solid';

          return (
            <div
              key={pop.id}
              data-bar-h
              data-pop-id={pop.id}
              className={`absolute rounded-lg overflow-visible ${isSelected ? 'ring-2 ring-offset-2 ring-indigo-500' : ''}`}
              style={{
                top: `calc(${slot * laneHPct}% + 2px)`,
                left: `calc(${extLeftPct}% + 2px)`,
                width: `calc(${extWidthPct}% - 4px)`,
                height: `calc(${laneHPct}% - 4px)`,
                backgroundColor: outerBg,
                border: `2px ${outerBorderStyle} ${outerBorderColor}`,
                touchAction: 'none',
              }}
              onTouchStart={(e) => {
                if ((e.target as HTMLElement).closest('[data-event-h]')) return;
                e.stopPropagation();
                const t = e.touches[0];
                const barEl = e.currentTarget as HTMLElement;
                const rect = barEl.getBoundingClientRect();
                const xIn = t.clientX - rect.left;
                const edgeThresh = Math.min(EDGE_MAX_PX, rect.width * EDGE_FRAC);
                // Edges at *declared* boundaries within the outer (ext) bar.
                const decLeftPx = (decLeftPctInBar / 100) * rect.width;
                const decRightPx = ((decLeftPctInBar + decWidthPctInBar) / 100) * rect.width;
                const nearLeft = declaredInWeek && !decContinuesLeft && Math.abs(xIn - decLeftPx) < edgeThresh;
                const nearRight = declaredInWeek && !decContinuesRight && Math.abs(xIn - decRightPx) < edgeThresh;
                const dayAtStart = (() => {
                  const el = document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null;
                  const dayEl = el?.closest('[data-day]') as HTMLElement | null;
                  return dayEl?.dataset.day || extBarStart;
                })();
                const origin = { x: t.clientX, y: t.clientY };
                let resolved = false;
                let moved = false;
                const thisBarSelected = p.selectedPopId === pop.id && !p.selectedEventId;

                const onMove = (mv: TouchEvent) => {
                  if (resolved) return;
                  const m = mv.touches[0];
                  const dx = Math.abs(m.clientX - origin.x);
                  const dy = Math.abs(m.clientY - origin.y);
                  if (!moved && (dx > 6 || dy > 6)) {
                    moved = true;
                    resolved = true;
                    clearTimeout(timer);
                    // Drag on a HIGHLIGHTED bar's edge → resize; otherwise move.
                    if (thisBarSelected && (nearLeft || nearRight)) {
                      p.onPopResizeStart(pop.id, nearLeft ? 'start' : 'end');
                    } else {
                      p.onPopMoveStart(pop.id, dayAtStart);
                    }
                  }
                };
                const onEnd = () => {
                  window.removeEventListener('touchmove', onMove);
                  window.removeEventListener('touchend', onEnd);
                  clearTimeout(timer);
                  if (!resolved && !moved) p.onPopTap(pop.id);
                };
                const timer = setTimeout(() => {
                  if (resolved) return;
                  // Long-press only creates when nothing is highlighted.
                  if (!p.hasAnySelection) {
                    resolved = true;
                    p.onStartCreateEventInBar(pop.id, dayAtStart, 9);
                    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(25);
                  }
                }, LONG_PRESS_MS);

                window.addEventListener('touchmove', onMove, { passive: true });
                window.addEventListener('touchend', onEnd);
              }}
            >
              {/* Declared inner rectangle inside the outer extended bar. */}
              {hasExtension && declaredInWeek && (
                <div
                  className="absolute pointer-events-none"
                  style={{
                    top: 0,
                    bottom: 0,
                    left: `${decLeftPctInBar}%`,
                    width: `${decWidthPctInBar}%`,
                    backgroundColor: pop.color + '18',
                    border: `2px solid ${pop.color}80`,
                    borderLeftWidth: decContinuesLeft ? 0 : 2,
                    borderRightWidth: decContinuesRight ? 0 : 2,
                    borderTopLeftRadius: decContinuesLeft ? 0 : 8,
                    borderBottomLeftRadius: decContinuesLeft ? 0 : 8,
                    borderTopRightRadius: decContinuesRight ? 0 : 8,
                    borderBottomRightRadius: decContinuesRight ? 0 : 8,
                  }}
                />
              )}

              {/* Top/bottom lips with small grip marks. */}
              <div
                className="absolute left-1 right-1 top-0 pointer-events-none flex items-center justify-center"
                style={{ height: LAND_EVENT_INSET_Y }}
              >
                <div className="h-0.5 rounded-full" style={{ width: 22, backgroundColor: pop.color + 'a0' }} />
              </div>
              <div
                className="absolute left-1 right-1 bottom-0 pointer-events-none flex items-center justify-center"
                style={{ height: LAND_EVENT_INSET_Y }}
              >
                <div className="h-0.5 rounded-full" style={{ width: 22, backgroundColor: pop.color + 'a0' }} />
              </div>

              <div className="flex flex-col justify-center h-full px-2 pointer-events-none overflow-hidden">
                <span className="text-[11px] font-bold truncate leading-tight" style={{ color: pop.color }}>
                  {platesLabel(pop.plateType, pop.plateCount)}
                </span>
                <span className="text-[10px] font-semibold truncate leading-tight opacity-80" style={{ color: pop.color }}>
                  {pop.name}
                </span>
              </div>

              {/* Drag-create ghost */}
              {p.activeEventCreate && p.activeEventCreate.popId === pop.id && (() => {
                const aec = p.activeEventCreate!;
                const lo = aec.startDate < aec.endDate ? aec.startDate : aec.endDate;
                const hi = aec.startDate < aec.endDate ? aec.endDate : aec.startDate;
                const cLo = lo < extBarStart ? extBarStart : lo;
                const cHi = hi > extBarEnd ? extBarEnd : hi;
                const span = daysBetween(extBarStart, extBarEnd) + 1;
                const leftDays = daysBetween(extBarStart, cLo);
                const rightDays = daysBetween(extBarStart, cHi) + 1;
                const leftP = (leftDays / span) * 100;
                const wP = ((rightDays - leftDays) / span) * 100;
                return (
                  <div
                    className="absolute rounded ring-2 ring-white/70 pointer-events-none"
                    style={{
                      left: `${leftP}%`,
                      width: `${wP}%`,
                      top: LAND_EVENT_INSET_Y,
                      bottom: LAND_EVENT_INSET_Y,
                      backgroundColor: pop.color + 'b0',
                    }}
                  />
                );
              })()}

              {barEvents.map(ev => {
                const evStart = ev.startDate < extBarStart ? extBarStart : ev.startDate;
                const evEnd = ev.endDate > extBarEnd ? extBarEnd : ev.endDate;
                const barSpan = daysBetween(extBarStart, extBarEnd) + 1;
                const evLeftDays = daysBetween(extBarStart, evStart);
                const evRightDays = daysBetween(extBarStart, evEnd) + 1;
                const evLeft = (evLeftDays / barSpan) * 100;
                const evW = ((evRightDays - evLeftDays) / barSpan) * 100;
                const isEvSel = p.selectedEventId === ev.id;
                return (
                  <div
                    key={ev.id}
                    data-event-h
                    className={`absolute rounded flex items-center justify-center ${isEvSel ? 'z-20' : ''}`}
                    style={{
                      left: `${evLeft}%`,
                      width: `${evW}%`,
                      top: LAND_EVENT_INSET_Y,
                      bottom: LAND_EVENT_INSET_Y,
                      backgroundColor: ev.color + 'd0',
                      touchAction: 'none',
                      boxShadow: isEvSel
                        ? '0 0 0 2px #fff, 0 0 0 5px #4f46e5, 0 0 24px 6px rgba(79,70,229,0.65)'
                        : '0 1px 3px rgba(0,0,0,0.15)',
                    }}
                    onTouchStart={(e) => {
                      e.stopPropagation();
                      const t = e.touches[0];
                      const evEl = e.currentTarget as HTMLElement;
                      const rect = evEl.getBoundingClientRect();
                      const xIn = t.clientX - rect.left;
                      const edgeThresh = Math.min(EDGE_MAX_PX, rect.width * EDGE_FRAC);
                      const nearLeft = xIn < edgeThresh;
                      const nearRight = xIn > rect.width - edgeThresh;
                      const dayAtStart = (() => {
                        const el = document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null;
                        const dayEl = el?.closest('[data-day]') as HTMLElement | null;
                        return dayEl?.dataset.day || evStart;
                      })();
                      const origin = { x: t.clientX, y: t.clientY };
                      let resolved = false;
                      let moved = false;
                      const thisEvSelected = p.selectedEventId === ev.id;

                      const onMove = (mv: TouchEvent) => {
                        if (resolved) return;
                        const m = mv.touches[0];
                        const dx = Math.abs(m.clientX - origin.x);
                        const dy = Math.abs(m.clientY - origin.y);
                        if (!moved && (dx > 6 || dy > 6)) {
                          moved = true;
                          resolved = true;
                          clearTimeout(timer);
                          // Drag on a HIGHLIGHTED event's edge → resize; otherwise move.
                          if (thisEvSelected && (nearLeft || nearRight)) {
                            p.onEventResizeStart(ev.id, nearLeft ? 'start' : 'end');
                          } else {
                            p.onEventMoveStart(ev.id, dayAtStart);
                          }
                        }
                      };
                      const onEnd = () => {
                        window.removeEventListener('touchmove', onMove);
                        window.removeEventListener('touchend', onEnd);
                        clearTimeout(timer);
                        if (!resolved && !moved) p.onEventTap(ev.id, ev.populationId);
                      };
                      // Long-press on an event does nothing (no events on events).
                      const timer = setTimeout(() => { /* intentionally no-op */ }, LONG_PRESS_MS);

                      window.addEventListener('touchmove', onMove, { passive: true });
                      window.addEventListener('touchend', onEnd);
                    }}
                  >
                    <span className="text-[9px] font-bold text-white truncate px-1">{displayEventLabel(ev)}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

