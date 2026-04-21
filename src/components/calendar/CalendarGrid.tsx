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
import { getMonthGrid, toDateStr, isInRange, rangesOverlap, addDays, shiftDateHour } from '@/lib/dates';
import * as storage from '@/lib/storage';
import { onRemoteChange } from '@/lib/sync';
import CalendarHeader from './CalendarHeader';
import EventPanel from './EventPanel';
import NewPopulationDialog from './NewPopulationDialog';
import MobileWeekView from './MobileWeekView';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LONG_PRESS_MS = 500;

/** Total hours an event spans. Used to pick abbreviated label for small events. */
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

interface CalendarGridProps {
  experimentId: string;
  syncStatus?: string;
}

type DragMode = 'none' | 'create-pop' | 'move-pop' | 'move-event' | 'resize-pop-start' | 'resize-pop-end' | 'resize-event-start' | 'resize-event-end';

export default function CalendarGrid({ experimentId, syncStatus = 'idle' }: CalendarGridProps) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const [populations, setPopulations] = useState<CellPopulation[]>(() =>
    storage.getPopulations(experimentId)
  );
  const [events, setEvents] = useState<SubEvent[]>(() =>
    storage.getAllSubEvents(experimentId)
  );
  const [, setConnections] = useState<Connection[]>(() =>
    storage.getConnections(experimentId)
  );

  // Refs mirroring latest state for use in drag callbacks (avoids stale closures)
  const populationsRef = useRef(populations);
  populationsRef.current = populations;
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const [selectedPopId, setSelectedPopId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Mobile detection + orientation
  const [isMobile, setIsMobile] = useState(false);
  const [isLandscape, setIsLandscape] = useState(false);
  useEffect(() => {
    const check = () => {
      setIsMobile(window.innerWidth < 768);
      setIsLandscape(window.innerWidth > window.innerHeight);
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);

  // Refresh from localStorage when the sync poller brings in remote changes
  useEffect(() => {
    const off = onRemoteChange(() => {
      setPopulations(storage.getPopulations(experimentId));
      setEvents(storage.getAllSubEvents(experimentId));
      setConnections(storage.getConnections(experimentId));
    });
    return off;
  }, [experimentId]);

  // Global safety-net: release outside the grid should also clear drag state.
  useEffect(() => {
    const onUp = () => {
      if (dragMode.current === 'none') return;
      dragMode.current = 'none';
      dragTargetId.current = null;
      dragAnchorDate.current = null;
      dragMoved.current = false;
    };
    document.addEventListener('mouseup', onUp);
    return () => document.removeEventListener('mouseup', onUp);
  }, []);

  // Long-press timer (desktop mouse + mobile touch) for creating events on bars
  const longTapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longTapPopId = useRef<string | null>(null);

  const cancelLongPress = useCallback(() => {
    if (longTapTimer.current) { clearTimeout(longTapTimer.current); longTapTimer.current = null; }
    longTapPopId.current = null;
  }, []);

  // Drag state
  const dragMode = useRef<DragMode>('none');
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragEnd, setDragEnd] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const dragTargetId = useRef<string | null>(null);
  const dragMoved = useRef(false);
  // For move operations: the date where the drag started (anchor point)
  const dragAnchorDate = useRef<string | null>(null);
  const dragAnchorHour = useRef<number>(0);
  const dragDuplicated = useRef(false); // whether we already duplicated during this drag

  const containerRef = useRef<HTMLDivElement>(null);
  const weekRowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const gridDates = useMemo(() => getMonthGrid(year, month), [year, month]);
  const weeks = useMemo(() => {
    const w: Date[][] = [];
    for (let i = 0; i < gridDates.length; i += 7) {
      w.push(gridDates.slice(i, i + 7));
    }
    return w;
  }, [gridDates]);

  const gridStart = toDateStr(gridDates[0]);
  const gridEnd = toDateStr(gridDates[gridDates.length - 1]);

  const visiblePops = useMemo(
    () => populations.filter(p => rangesOverlap(p.startDate, p.endDate, gridStart, gridEnd)),
    [populations, gridStart, gridEnd]
  );

  // Nav
  const goPrev = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const goNext = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };
  const goToday = () => { setYear(today.getFullYear()); setMonth(today.getMonth()); };

  // Which population bar (if any) is currently under the pointer?
  const getPopIdAtPoint = useCallback((clientX: number, clientY: number): string | null => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (!el) return null;
    const barEl = el.closest('[data-pop-id]') as HTMLElement | null;
    return barEl?.dataset.popId || null;
  }, []);

  // --- Global date+hour from mouse position ---
  const getDateHourFromGlobalMouse = useCallback((e: React.MouseEvent | MouseEvent): { date: string; hour: number } | null => {
    for (let wi = 0; wi < weekRowRefs.current.length; wi++) {
      const rowEl = weekRowRefs.current[wi];
      if (!rowEl) continue;
      const rect = rowEl.getBoundingClientRect();
      if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const colWidth = rect.width / 7;
        const xInRow = e.clientX - rect.left;
        const col = Math.min(6, Math.max(0, Math.floor(xInRow / colWidth)));
        const xInCol = xInRow - col * colWidth;
        const hour = Math.min(23, Math.max(0, Math.floor((xInCol / colWidth) * 24)));
        return { date: toDateStr(weeks[wi][col]), hour };
      }
    }
    return null;
  }, [weeks]);

  // --- Drag: create population (on empty space) ---
  const handleCellMouseDown = useCallback((dateStr: string, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-bar]') || (e.target as HTMLElement).closest('[data-event-box]')) return;
    dragMode.current = 'create-pop';
    dragMoved.current = false;
    setDragStart(dateStr);
    setDragEnd(dateStr);
  }, []);

  // --- Create an 8-hour event inside a population at given date+hour ---
  const createEventAt = useCallback((popId: string, dateStr: string, startHour: number) => {
    const pop = populationsRef.current.find(p => p.id === popId);
    if (!pop) return;
    let d = dateStr;
    if (d < pop.startDate) d = pop.startDate;
    if (d > pop.endDate) d = pop.endDate;
    let sH = Math.max(0, Math.min(16, startHour));
    if (sH + 7 > 23) sH = 16;
    const eH = sH + 7;
    const ev: SubEvent = {
      id: crypto.randomUUID(),
      populationId: popId,
      label: 'New event',
      comments: '',
      allDay: false,
      startDate: d,
      startHour: sH,
      endDate: d,
      endHour: eH,
      color: SUB_EVENT_COLORS[eventsRef.current.filter(se => se.populationId === popId).length % SUB_EVENT_COLORS.length],
    };
    storage.saveSubEvent(ev);
    setEvents(prev => [...prev, ev]);
    setSelectedEventId(ev.id);
    setSelectedPopId(popId);
  }, []);

  // --- Mousedown on population bar: prepare to move (or duplicate with Option). Long-press creates event. ---
  const handleBarMouseDown = useCallback((popId: string, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-event-box]') || (e.target as HTMLElement).closest('[data-resize]')) return;
    e.stopPropagation();
    const dh = getDateHourFromGlobalMouse(e);
    if (!dh) return;
    dragMode.current = 'move-pop';
    dragMoved.current = false;
    dragDuplicated.current = false;
    dragTargetId.current = popId;
    dragAnchorDate.current = dh.date;
    dragAnchorHour.current = dh.hour;
    // Long-press timer: fires if no drag movement within LONG_PRESS_MS
    cancelLongPress();
    longTapPopId.current = popId;
    longTapTimer.current = setTimeout(() => {
      longTapTimer.current = null;
      if (!dragMoved.current && longTapPopId.current === popId) {
        dragMode.current = 'none';
        createEventAt(popId, dh.date, dh.hour);
      }
      longTapPopId.current = null;
    }, LONG_PRESS_MS);
  }, [getDateHourFromGlobalMouse, cancelLongPress, createEventAt]);

  // --- Mousedown on event box: prepare to move (or duplicate with Option) ---
  const handleEventMouseDown = useCallback((eventId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if ((e.target as HTMLElement).closest('[data-resize]')) return;
    const dh = getDateHourFromGlobalMouse(e);
    if (!dh) return;
    dragMode.current = 'move-event';
    dragMoved.current = false;
    dragDuplicated.current = false;
    dragTargetId.current = eventId;
    dragAnchorDate.current = dh.date;
    dragAnchorHour.current = dh.hour;
  }, [getDateHourFromGlobalMouse]);

  // --- Resize handles ---
  const handleResizePopStart = useCallback((popId: string, e: React.MouseEvent) => {
    e.stopPropagation(); dragMode.current = 'resize-pop-start'; dragTargetId.current = popId; dragMoved.current = false;
  }, []);
  const handleResizePopEnd = useCallback((popId: string, e: React.MouseEvent) => {
    e.stopPropagation(); dragMode.current = 'resize-pop-end'; dragTargetId.current = popId; dragMoved.current = false;
  }, []);
  const handleResizeEventStart = useCallback((eventId: string, e: React.MouseEvent) => {
    e.stopPropagation(); dragMode.current = 'resize-event-start'; dragTargetId.current = eventId; dragMoved.current = false;
  }, []);
  const handleResizeEventEnd = useCallback((eventId: string, e: React.MouseEvent) => {
    e.stopPropagation(); dragMode.current = 'resize-event-end'; dragTargetId.current = eventId; dragMoved.current = false;
  }, []);

  // --- Global mouse move ---
  const handleGlobalMouseMove = useCallback((e: React.MouseEvent) => {
    // Safety net: if no mouse button is pressed, clear any stuck drag state.
    // Fixes the "bar resizes on hover" bug when a mouseup happened outside the container.
    if (e.buttons === 0 && dragMode.current !== 'none') {
      dragMode.current = 'none';
      dragTargetId.current = null;
      dragAnchorDate.current = null;
      dragMoved.current = false;
      cancelLongPress();
      return;
    }
    if (dragMode.current === 'none') return;
    dragMoved.current = true;
    // Movement cancels any pending long-press (so it becomes a drag, not a create)
    cancelLongPress();
    const dh = getDateHourFromGlobalMouse(e);
    if (!dh) return;

    if (dragMode.current === 'create-pop') {
      setDragEnd(dh.date);
    }

    // Move population (shift all dates by delta). Option+drag = duplicate first.
    if (dragMode.current === 'move-pop' && dragTargetId.current && dragAnchorDate.current) {
      // Option-drag: duplicate population + events on first move
      if (e.altKey && !dragDuplicated.current) {
        dragDuplicated.current = true;
        const origPopId = dragTargetId.current;
        const origPop = populationsRef.current.find(p => p.id === origPopId);
        if (origPop) {
          const newPopId = crypto.randomUUID();
          const newPop: CellPopulation = { ...origPop, id: newPopId, name: origPop.name + ' (copy)', color: POPULATION_COLORS[(populationsRef.current.length) % POPULATION_COLORS.length] };
          storage.savePopulation(newPop);
          // Copy all events with full data from current ref
          const origEvents = eventsRef.current.filter(ev => ev.populationId === origPopId);
          const newEvents: SubEvent[] = origEvents.map(ev => ({ ...ev, id: crypto.randomUUID(), populationId: newPopId }));
          newEvents.forEach(ev => storage.saveSubEvent(ev));
          setPopulations(prev => [...prev, newPop]);
          setEvents(prev => [...prev, ...newEvents]);
          // Switch drag target to the new copy (original stays in place)
          dragTargetId.current = newPopId;
          setSelectedPopId(newPopId);
          setSelectedEventId(null);
        }
      }

      const dayDelta = daysBetween(dragAnchorDate.current, dh.date);
      if (dayDelta !== 0) {
        dragAnchorDate.current = dh.date;
        const popId = dragTargetId.current;
        setPopulations(prev => prev.map(p => {
          if (p.id !== popId) return p;
          const updated = { ...p, startDate: addDays(p.startDate, dayDelta), endDate: addDays(p.endDate, dayDelta) };
          storage.savePopulation(updated);
          return updated;
        }));
        setEvents(prev => prev.map(ev => {
          if (ev.populationId !== popId) return ev;
          const updated = { ...ev, startDate: addDays(ev.startDate, dayDelta), endDate: addDays(ev.endDate, dayDelta) };
          storage.saveSubEvent(updated);
          return updated;
        }));
      }
    }

    // Move event. Option+drag = duplicate first. If pointer is over a different bar,
    // reassign populationId so events can be copied across experiments.
    if (dragMode.current === 'move-event' && dragTargetId.current && dragAnchorDate.current) {
      if (e.altKey && !dragDuplicated.current) {
        dragDuplicated.current = true;
        const origEvId = dragTargetId.current;
        const origEv = eventsRef.current.find(ev => ev.id === origEvId);
        if (origEv) {
          const newEv: SubEvent = { ...origEv, id: crypto.randomUUID(), label: origEv.label + ' (copy)' };
          storage.saveSubEvent(newEv);
          setEvents(prev => [...prev, newEv]);
          dragTargetId.current = newEv.id;
          setSelectedEventId(newEv.id);
          setSelectedPopId(newEv.populationId);
        }
      }

      const evId = dragTargetId.current;
      const ev = eventsRef.current.find(x => x.id === evId);
      if (!ev) return;
      const currentPop = populationsRef.current.find(p => p.id === ev.populationId);
      if (!currentPop) return;

      // Check if pointer is over a different bar → cross-population move.
      const hoveredPopId = getPopIdAtPoint(e.clientX, e.clientY);
      if (hoveredPopId && hoveredPopId !== ev.populationId) {
        const targetPop = populationsRef.current.find(p => p.id === hoveredPopId);
        if (targetPop) {
          // Preserve event duration; snap start to pointer position inside target bar.
          const durHours = Math.max(1, daysBetween(ev.startDate, ev.endDate) * 24 + (ev.endHour - ev.startHour + 1));
          const startDate = dh.date;
          const startHour = dh.hour;
          const endPos = shiftDateHour(startDate, startHour, durHours - 1);
          if (startDate >= targetPop.startDate && endPos.date <= targetPop.endDate) {
            const updated = { ...ev, populationId: hoveredPopId, startDate, startHour, endDate: endPos.date, endHour: endPos.hour };
            storage.saveSubEvent(updated);
            setEvents(prev => prev.map(x => x.id === evId ? updated : x));
            setSelectedPopId(hoveredPopId);
            dragAnchorDate.current = dh.date;
            dragAnchorHour.current = dh.hour;
          }
          return;
        }
      }

      // Same-population move.
      if (ev.allDay) {
        const dayDelta = daysBetween(dragAnchorDate.current, dh.date);
        if (dayDelta !== 0) {
          dragAnchorDate.current = dh.date;
          setEvents(prev => prev.map(x => {
            if (x.id !== evId) return x;
            const newStart = addDays(x.startDate, dayDelta);
            const newEnd = addDays(x.endDate, dayDelta);
            if (newStart < currentPop.startDate || newEnd > currentPop.endDate) return x;
            const updated = { ...x, startDate: newStart, endDate: newEnd };
            storage.saveSubEvent(updated);
            return updated;
          }));
        }
      } else {
        const hourDelta = daysBetween(dragAnchorDate.current, dh.date) * 24 + (dh.hour - dragAnchorHour.current);
        if (hourDelta !== 0) {
          dragAnchorDate.current = dh.date;
          dragAnchorHour.current = dh.hour;
          setEvents(prev => prev.map(x => {
            if (x.id !== evId) return x;
            const s = shiftDateHour(x.startDate, x.startHour, hourDelta);
            const e2 = shiftDateHour(x.endDate, x.endHour, hourDelta);
            if (s.date < currentPop.startDate || e2.date > currentPop.endDate) return x;
            const updated = { ...x, startDate: s.date, startHour: s.hour, endDate: e2.date, endHour: e2.hour };
            storage.saveSubEvent(updated);
            return updated;
          }));
        }
      }
    }

    // Resize population
    if ((dragMode.current === 'resize-pop-start' || dragMode.current === 'resize-pop-end') && dragTargetId.current) {
      setPopulations(prev => prev.map(p => {
        if (p.id !== dragTargetId.current) return p;
        if (dragMode.current === 'resize-pop-start' && (dh.date < p.endDate || (dh.date === p.endDate && dh.hour < p.endHour))) {
          const updated = { ...p, startDate: dh.date, startHour: dh.hour };
          storage.savePopulation(updated);
          return updated;
        }
        if (dragMode.current === 'resize-pop-end' && (dh.date > p.startDate || (dh.date === p.startDate && dh.hour > p.startHour))) {
          const updated = { ...p, endDate: dh.date, endHour: dh.hour };
          storage.savePopulation(updated);
          return updated;
        }
        return p;
      }));
    }

    // Resize event
    if ((dragMode.current === 'resize-event-start' || dragMode.current === 'resize-event-end') && dragTargetId.current) {
      setEvents(prev => prev.map(ev => {
        if (ev.id !== dragTargetId.current) return ev;
        if (dragMode.current === 'resize-event-start' && (dh.date < ev.endDate || (dh.date === ev.endDate && dh.hour < ev.endHour))) {
          const updated = { ...ev, startDate: dh.date, startHour: dh.hour };
          storage.saveSubEvent(updated);
          return updated;
        }
        if (dragMode.current === 'resize-event-end' && (dh.date > ev.startDate || (dh.date === ev.startDate && dh.hour > ev.startHour))) {
          const updated = { ...ev, endDate: dh.date, endHour: dh.hour };
          storage.saveSubEvent(updated);
          return updated;
        }
        return ev;
      }));
    }
  }, [getDateHourFromGlobalMouse, populations, cancelLongPress, getPopIdAtPoint]);

  // --- Mouse up ---
  const handleMouseUp = useCallback(() => {
    const mode = dragMode.current;
    const moved = dragMoved.current;
    dragMode.current = 'none';
    dragTargetId.current = null;
    dragAnchorDate.current = null;
    dragMoved.current = false;
    cancelLongPress();

    if (mode === 'create-pop' && dragStart && dragEnd && moved) {
      const s = dragStart < dragEnd ? dragStart : dragEnd;
      const e = dragStart < dragEnd ? dragEnd : dragStart;
      setDragStart(s);
      setDragEnd(e);
      setShowNewDialog(true);
      return;
    }
    if (mode === 'create-pop' && !moved) {
      setSelectedPopId(null);
      setSelectedEventId(null);
      setDragStart(null);
      setDragEnd(null);
    }
    if (mode === 'move-pop' && !moved && dragTargetId.current) {
      // Was actually stored before reset — use eventDragPopId pattern
    }
  }, [dragStart, dragEnd, cancelLongPress]);

  // For click-without-move on bar: select population (handled separately since dragTargetId is cleared)
  const handleBarClick = useCallback((popId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if ((e.target as HTMLElement).closest('[data-event-box]')) return;
    setSelectedPopId(popId);
    setSelectedEventId(null);
  }, []);

  const handleEventClick = useCallback((eventId: string, popId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedEventId(eventId);
    setSelectedPopId(popId);
  }, []);

  // --- Keyboard: Delete key ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Backspace' || e.key === 'Delete') {
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).tagName === 'SELECT') return;
        if (selectedEventId) {
          storage.deleteSubEvent(selectedEventId);
          setEvents(prev => prev.filter(ev => ev.id !== selectedEventId));
          setSelectedEventId(null);
          e.preventDefault();
        } else if (selectedPopId) {
          storage.deletePopulation(selectedPopId);
          setPopulations(prev => prev.filter(p => p.id !== selectedPopId));
          setEvents(prev => prev.filter(ev => ev.populationId !== selectedPopId));
          setConnections(prev => prev.filter(c => c.sourcePopulationId !== selectedPopId && c.targetPopulationId !== selectedPopId));
          setSelectedPopId(null);
          e.preventDefault();
        }
      }
      if (e.key === 'Escape') {
        setSelectedEventId(null);
        setSelectedPopId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedEventId, selectedPopId]);

  const handleCreatePopulation = useCallback(
    (data: { name: string; cellLine: string; passage: string; plateType: PlateType; plateCount: number; cellDensity: string; experimenter: string; experimentLabel: string; comments: string }) => {
      if (!dragStart || !dragEnd) return;
      const s = dragStart < dragEnd ? dragStart : dragEnd;
      const e = dragStart < dragEnd ? dragEnd : dragStart;
      const pop: CellPopulation = {
        id: crypto.randomUUID(), experimentId,
        name: data.name,
        cellLine: data.cellLine,
        passage: data.passage,
        color: POPULATION_COLORS[populations.length % POPULATION_COLORS.length],
        plateType: data.plateType, plateCount: data.plateCount, cellDensity: data.cellDensity,
        experimenter: data.experimenter,
        experimentLabel: data.experimentLabel,
        comments: data.comments,
        allDay: true,
        startDate: s, startHour: 0, endDate: e, endHour: 23,
      };
      storage.savePopulation(pop);
      setPopulations(prev => [...prev, pop]);
      setDragStart(null); setDragEnd(null); setShowNewDialog(false);
      // Don't auto-open panel — just deselect
      setSelectedPopId(null); setSelectedEventId(null);
    },
    [dragStart, dragEnd, experimentId, populations.length]
  );

  const handleCancelDialog = useCallback(() => {
    setDragStart(null); setDragEnd(null); setShowNewDialog(false);
  }, []);

  // Update/delete handlers
  const handleUpdateEvent = useCallback((updated: SubEvent) => {
    storage.saveSubEvent(updated);
    setEvents(prev => prev.map(e => (e.id === updated.id ? updated : e)));
  }, []);
  const handleDeleteEvent = useCallback((id: string) => {
    storage.deleteSubEvent(id);
    setEvents(prev => prev.filter(e => e.id !== id));
    setSelectedEventId(null);
  }, []);
  const handleUpdatePopulation = useCallback((updated: CellPopulation) => {
    storage.savePopulation(updated);
    setPopulations(prev => prev.map(p => (p.id === updated.id ? updated : p)));
  }, []);
  const handleDeletePopulation = useCallback((id: string) => {
    storage.deletePopulation(id);
    setPopulations(prev => prev.filter(p => p.id !== id));
    setEvents(prev => prev.filter(e => e.populationId !== id));
    setConnections(prev => prev.filter(c => c.sourcePopulationId !== id && c.targetPopulationId !== id));
    setSelectedPopId(null); setSelectedEventId(null);
  }, []);

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
    storage.savePopulation(newPop);
    const popEvents = eventsRef.current.filter(ev => ev.populationId === popId);
    const newEvents: SubEvent[] = popEvents.map(ev => ({
      ...ev,
      id: crypto.randomUUID(),
      populationId: newPopId,
      startDate: addDays(ev.startDate, 7),
      endDate: addDays(ev.endDate, 7),
    }));
    newEvents.forEach(ev => storage.saveSubEvent(ev));
    setPopulations(prev => [...prev, newPop]);
    setEvents(prev => [...prev, ...newEvents]);
    setSelectedPopId(newPopId);
    setSelectedEventId(null);
  }, []);

  // Computed ranges
  const dragRange = useMemo(() => {
    if (!dragStart || !dragEnd) return null;
    const s = dragStart < dragEnd ? dragStart : dragEnd;
    const e = dragStart < dragEnd ? dragEnd : dragStart;
    return { start: s, end: e };
  }, [dragStart, dragEnd]);

  // Bar layout
  const barLayout = useMemo(() => {
    const allBars: { pop: CellPopulation; weekIdx: number; startFrac: number; endFrac: number; slot: number }[] = [];
    visiblePops.forEach(pop => {
      weeks.forEach((week, weekIdx) => {
        const weekStart = toDateStr(week[0]);
        const weekEnd = toDateStr(week[6]);
        if (!rangesOverlap(pop.startDate, pop.endDate, weekStart, weekEnd)) return;
        const isBarStart = pop.startDate >= weekStart;
        const isBarEnd = pop.endDate <= weekEnd;
        let startFrac = 0;
        if (isBarStart) { const col = week.findIndex(d => toDateStr(d) === pop.startDate); startFrac = (col >= 0 ? col : 0) + pop.startHour / 24; }
        let endFrac = 7;
        if (isBarEnd) { const col = week.findIndex(d => toDateStr(d) === pop.endDate); endFrac = (col >= 0 ? col : 6) + (pop.endHour + 1) / 24; }
        allBars.push({ pop, weekIdx, startFrac, endFrac, slot: 0 });
      });
    });
    allBars.forEach(bar => {
      const sameWeek = allBars.filter(b => b.weekIdx === bar.weekIdx && b !== bar);
      let slot = 0;
      while (sameWeek.some(b => b.slot === slot && !(bar.startFrac >= b.endFrac || bar.endFrac <= b.startFrac))) slot++;
      bar.slot = slot;
    });
    const maxSlots = weeks.map((_, wi) => {
      const bars = allBars.filter(b => b.weekIdx === wi);
      return bars.length > 0 ? Math.max(...bars.map(b => b.slot)) + 1 : 0;
    });
    return { allBars, maxSlots };
  }, [visiblePops, weeks]);

  // Touch support: translate touch events to synthetic mouse-like coordinates
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const makeSynth = (t: Touch) => ({ clientX: t.clientX, clientY: t.clientY } as MouseEvent);
    const onTouchMove = (e: TouchEvent) => {
      if (longTapTimer.current) { clearTimeout(longTapTimer.current); longTapTimer.current = null; }
      longTapPopId.current = null;
      if (dragMode.current === 'none') return;
      e.preventDefault();
      dragMoved.current = true;
      const dh = getDateHourFromGlobalMouse(makeSynth(e.touches[0]));
      if (!dh) return;
      // Reuse the same move logic for the active drag mode — dispatch a synthetic React mouse event
      // Since we can't easily call handleGlobalMouseMove with a TouchEvent, duplicate the core date update
      if (dragMode.current === 'create-pop') setDragEnd(dh.date);
      if (dragMode.current === 'move-pop' && dragTargetId.current && dragAnchorDate.current) {
        const dd = daysBetween(dragAnchorDate.current, dh.date);
        if (dd !== 0) {
          dragAnchorDate.current = dh.date;
          const pid = dragTargetId.current;
          setPopulations(prev => prev.map(p => p.id !== pid ? p : (() => { const u = { ...p, startDate: addDays(p.startDate, dd), endDate: addDays(p.endDate, dd) }; storage.savePopulation(u); return u; })()));
          setEvents(prev => prev.map(ev => ev.populationId !== pid ? ev : (() => { const u = { ...ev, startDate: addDays(ev.startDate, dd), endDate: addDays(ev.endDate, dd) }; storage.saveSubEvent(u); return u; })()));
        }
      }
      if (dragMode.current === 'move-event' && dragTargetId.current && dragAnchorDate.current) {
        const eid = dragTargetId.current;
        const ev = eventsRef.current.find(x => x.id === eid);
        const pop = ev ? populationsRef.current.find(p => p.id === ev.populationId) : undefined;
        if (!ev || !pop) return;
        if (ev.allDay) {
          const dd = daysBetween(dragAnchorDate.current, dh.date);
          if (dd !== 0) {
            dragAnchorDate.current = dh.date;
            setEvents(prev => prev.map(x => {
              if (x.id !== eid) return x;
              const ns = addDays(x.startDate, dd); const ne = addDays(x.endDate, dd);
              if (ns < pop.startDate || ne > pop.endDate) return x;
              const u = { ...x, startDate: ns, endDate: ne }; storage.saveSubEvent(u); return u;
            }));
          }
        } else {
          const hourDelta = daysBetween(dragAnchorDate.current, dh.date) * 24 + (dh.hour - dragAnchorHour.current);
          if (hourDelta !== 0) {
            dragAnchorDate.current = dh.date;
            dragAnchorHour.current = dh.hour;
            setEvents(prev => prev.map(x => {
              if (x.id !== eid) return x;
              const s = shiftDateHour(x.startDate, x.startHour, hourDelta);
              const e2 = shiftDateHour(x.endDate, x.endHour, hourDelta);
              if (s.date < pop.startDate || e2.date > pop.endDate) return x;
              const u = { ...x, startDate: s.date, startHour: s.hour, endDate: e2.date, endHour: e2.hour }; storage.saveSubEvent(u); return u;
            }));
          }
        }
      }
    };
    const onTouchEnd = () => {
      if (longTapTimer.current) { clearTimeout(longTapTimer.current); longTapTimer.current = null; }
      longTapPopId.current = null;
      handleMouseUp();
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    return () => { el.removeEventListener('touchmove', onTouchMove); el.removeEventListener('touchend', onTouchEnd); };
  }, [getDateHourFromGlobalMouse, handleMouseUp]);

  const selectedEvent = events.find(e => e.id === selectedEventId) || null;
  const selectedPop = populations.find(p => p.id === selectedPopId) || null;
  const todayStr = toDateStr(today);
  const BAR_HEIGHT = 56;

  if (isMobile) {
    return <MobileWeekView experimentId={experimentId} orientation={isLandscape ? 'landscape' : 'portrait'} syncStatus={syncStatus} />;
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 flex flex-col h-full"
      onMouseMove={handleGlobalMouseMove}
      onMouseUp={handleMouseUp}
    >
      <div className="border-b border-slate-200/80 bg-white flex items-center flex-shrink-0">
        <CalendarHeader year={year} month={month} onPrev={goPrev} onNext={goNext} onToday={goToday} />
        <SyncBadge status={syncStatus} />
      </div>

      <div className={`flex-1 overflow-hidden ${isMobile ? 'flex flex-col' : 'relative'}`}>
        <div className={`${isMobile ? 'flex-1 min-h-0' : 'h-full'} flex flex-col overflow-auto select-none bg-slate-50/50`}>
          <div className="grid grid-cols-7 border-b border-slate-200 flex-shrink-0 bg-white">
            {DAY_NAMES.map(d => (
              <div key={d} className="text-center text-[13px] max-md:text-[11px] font-bold text-slate-400 uppercase tracking-widest py-3 max-md:py-2">{d}</div>
            ))}
          </div>

          <div className="flex-1 flex flex-col">
            {weeks.map((week, wi) => {
              const slotsInWeek = barLayout.maxSlots[wi];
              const barAreaHeight = slotsInWeek * (BAR_HEIGHT + 4);
              return (
                <div
                  key={wi}
                  ref={el => { weekRowRefs.current[wi] = el; }}
                  data-week-row
                  className="relative flex-1 border-b border-slate-100 last:border-b-0"
                  style={{ minHeight: isMobile ? Math.max(60, 24 + barAreaHeight) : Math.max(110, 36 + barAreaHeight) }}
                >
                  <div className="grid grid-cols-7 absolute inset-0">
                    {week.map((date) => {
                      const dateStr = toDateStr(date);
                      const isCurrentMonth = date.getMonth() === month;
                      const isToday = dateStr === todayStr;
                      const inDragRange = dragRange && !showNewDialog && isInRange(dateStr, dragRange.start, dragRange.end);
                      return (
                        <div
                          key={dateStr}
                          className={`
                            border-r border-slate-100 last:border-r-0
                            ${isCurrentMonth ? 'bg-white' : 'bg-slate-50/60'}
                            ${inDragRange ? '!bg-indigo-50 !border-indigo-200' : ''}
                          `}
                          onMouseDown={(e) => handleCellMouseDown(dateStr, e)}
                          onTouchStart={(e) => {
                            const t = e.touches[0];
                            if ((e.target as HTMLElement).closest('[data-bar]') || (e.target as HTMLElement).closest('[data-event-box]')) return;
                            dragMode.current = 'create-pop'; dragMoved.current = false;
                            setDragStart(dateStr); setDragEnd(dateStr);
                          }}
                        >
                          <div className="px-2.5 pt-2 max-md:px-1 max-md:pt-1">
                            <span className={`
                              text-[15px] max-md:text-xs font-semibold inline-block w-8 h-8 max-md:w-6 max-md:h-6 text-center leading-8 max-md:leading-6 rounded-full
                              ${isToday ? 'bg-indigo-600 text-white shadow-sm' : ''}
                              ${!isCurrentMonth && !isToday ? 'text-slate-300' : ''}
                              ${isCurrentMonth && !isToday ? 'text-slate-600' : ''}
                            `}>
                              {date.getDate()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {barLayout.allBars.filter(b => b.weekIdx === wi).map(bar => {
                    const isSelected = bar.pop.id === selectedPopId && !selectedEventId;
                    const weekStart = toDateStr(week[0]);
                    const weekEnd = toDateStr(week[6]);
                    const isBarStart = bar.pop.startDate >= weekStart;
                    const isBarEnd = bar.pop.endDate <= weekEnd;
                    const leftPct = (bar.startFrac / 7) * 100;
                    const widthPct = ((bar.endFrac - bar.startFrac) / 7) * 100;

                    const barEvents = events.filter(ev =>
                      ev.populationId === bar.pop.id &&
                      rangesOverlap(ev.startDate, ev.endDate,
                        bar.pop.startDate > weekStart ? bar.pop.startDate : weekStart,
                        bar.pop.endDate < weekEnd ? bar.pop.endDate : weekEnd)
                    );

                    return (
                      <div
                        key={`${bar.pop.id}-${wi}`}
                        data-bar
                        data-pop-id={bar.pop.id}
                        className={`
                          absolute cursor-grab active:cursor-grabbing overflow-visible z-10
                          ${isSelected ? 'ring-2 ring-offset-2 ring-indigo-500 shadow-lg' : ''}
                          ${isBarStart ? 'rounded-l-xl' : ''} ${isBarEnd ? 'rounded-r-xl' : ''}
                        `}
                        style={{
                          top: 34 + bar.slot * (BAR_HEIGHT + 6),
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          height: BAR_HEIGHT,
                          backgroundColor: bar.pop.color + '12',
                          border: `2px solid ${bar.pop.color}80`,
                          borderLeftStyle: isBarStart ? 'solid' : 'none',
                          borderRightStyle: isBarEnd ? 'solid' : 'none',
                        }}
                        onMouseDown={(e) => handleBarMouseDown(bar.pop.id, e)}
                        onTouchStart={(e) => {
                          if ((e.target as HTMLElement).closest('[data-event-box]') || (e.target as HTMLElement).closest('[data-resize]')) return;
                          const t = e.touches[0];
                          const dh = getDateHourFromGlobalMouse({ clientX: t.clientX, clientY: t.clientY } as MouseEvent);
                          if (!dh) return;
                          // Set up move drag
                          dragMode.current = 'move-pop'; dragMoved.current = false; dragDuplicated.current = false;
                          dragTargetId.current = bar.pop.id; dragAnchorDate.current = dh.date; dragAnchorHour.current = dh.hour;
                          // Long-press: create 4h event if held LONG_PRESS_MS without moving
                          longTapPopId.current = bar.pop.id;
                          if (longTapTimer.current) clearTimeout(longTapTimer.current);
                          longTapTimer.current = setTimeout(() => {
                            longTapTimer.current = null;
                            if (!dragMoved.current && longTapPopId.current) {
                              dragMode.current = 'none';
                              createEventAt(longTapPopId.current, dh.date, dh.hour);
                              longTapPopId.current = null;
                            }
                          }, LONG_PRESS_MS);
                        }}
                        onClick={(e) => handleBarClick(bar.pop.id, e)}
                      >
                        {isBarStart && (
                          <div className="flex flex-col justify-center px-3 max-md:px-1.5 h-full pointer-events-none overflow-hidden">
                            <span className="text-[14px] max-md:text-[11px] font-bold truncate leading-tight" style={{ color: bar.pop.color }}>
                              {platesLabel(bar.pop.plateType, bar.pop.plateCount)}
                            </span>
                            <span className="text-[12px] max-md:text-[10px] font-semibold truncate leading-tight opacity-80" style={{ color: bar.pop.color }}>
                              {bar.pop.name}
                              {bar.pop.cellDensity && <span className="opacity-70 font-medium"> · {bar.pop.cellDensity} {densityUnit(bar.pop.plateType)}</span>}
                            </span>
                          </div>
                        )}

                        {isBarStart && (
                          <div data-resize className="absolute left-0 top-0 bottom-0 w-3 cursor-col-resize hover:bg-black/10 rounded-l-xl"
                            onMouseDown={(e) => handleResizePopStart(bar.pop.id, e)} />
                        )}
                        {isBarEnd && (
                          <div data-resize className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize hover:bg-black/10 rounded-r-xl"
                            onMouseDown={(e) => handleResizePopEnd(bar.pop.id, e)} />
                        )}

                        {barEvents.map(ev => {
                          const bsd = bar.pop.startDate > weekStart ? bar.pop.startDate : weekStart;
                          const bed = bar.pop.endDate < weekEnd ? bar.pop.endDate : weekEnd;
                          const bsHour = bar.pop.startDate >= weekStart ? bar.pop.startHour : 0;
                          const beHour = bar.pop.endDate <= weekEnd ? bar.pop.endHour : 23;
                          const evStartDate = ev.startDate < bsd ? bsd : ev.startDate;
                          const evEndDate = ev.endDate > bed ? bed : ev.endDate;
                          const evStartHour = ev.startDate < bsd ? 0 : ev.startHour;
                          const evEndHour = ev.endDate > bed ? 23 : ev.endHour;
                          const barStartAbs = bsHour / 24;
                          const barEndAbs = daysBetween(bsd, bed) + (beHour + 1) / 24;
                          const evStartAbs = daysBetween(bsd, evStartDate) + evStartHour / 24;
                          const evEndAbs = daysBetween(bsd, evEndDate) + (evEndHour + 1) / 24;
                          const barRange = barEndAbs - barStartAbs;
                          const evLeftPct = barRange > 0 ? ((evStartAbs - barStartAbs) / barRange) * 100 : 0;
                          const evWidthPct = barRange > 0 ? ((evEndAbs - evStartAbs) / barRange) * 100 : 100;
                          const isEvSelected = selectedEventId === ev.id;

                          return (
                            <div
                              key={ev.id}
                              data-event-box
                              className={`
                                absolute top-[4px] bottom-[4px] rounded-lg cursor-grab active:cursor-grabbing
                                flex items-center justify-center
                                ${isEvSelected ? 'ring-2 ring-white ring-offset-1 shadow-lg scale-[1.01]' : 'shadow'}
                              `}
                              style={{ left: `${evLeftPct}%`, width: `${evWidthPct}%`, backgroundColor: ev.color + 'e0', backdropFilter: 'blur(2px)' }}
                              onClick={(e) => handleEventClick(ev.id, ev.populationId, e)}
                              onMouseDown={(e) => handleEventMouseDown(ev.id, e)}
                            >
                              <span className="text-[13px] font-bold text-white truncate px-2 drop-shadow-sm pointer-events-none">{displayEventLabel(ev)}</span>
                              <div data-resize className="absolute left-0 top-0 bottom-0 w-3 cursor-col-resize hover:bg-white/30 rounded-l-lg"
                                onMouseDown={(e) => handleResizeEventStart(ev.id, e)} />
                              <div data-resize className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize hover:bg-white/30 rounded-r-lg"
                                onMouseDown={(e) => handleResizeEventEnd(ev.id, e)} />
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Panel: floating on desktop, inline below calendar on mobile */}
        {(selectedEvent || (selectedPop && !selectedEvent)) && (
          <EventPanel
            subEvent={selectedEvent}
            population={selectedPop}
            allEvents={events}
            onUpdateSubEvent={handleUpdateEvent}
            onDeleteSubEvent={handleDeleteEvent}
            onUpdatePopulation={handleUpdatePopulation}
            onDeletePopulation={handleDeletePopulation}
            onRepeatNextWeek={handleRepeatNextWeek}
            onClose={() => { setSelectedEventId(null); if (!selectedEvent) setSelectedPopId(null); }}
            isMobile={isMobile}
          />
        )}
      </div>

      {dragRange && !showNewDialog && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 text-white px-6 py-3 rounded-2xl text-sm font-semibold shadow-xl z-50 backdrop-blur-sm">
          {dragRange.start} &rarr; {dragRange.end}
        </div>
      )}

      {showNewDialog && dragRange && (
        <NewPopulationDialog
          startDate={dragRange.start}
          endDate={dragRange.end}
          onConfirm={handleCreatePopulation}
          onCancel={handleCancelDialog}
        />
      )}

      {populations.length === 0 && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-slate-400 text-base pointer-events-none flex flex-col items-center gap-2">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-300"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <span>Click and drag across days to create an experiment</span>
        </div>
      )}
    </div>
  );
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd).getTime() - new Date(ay, am - 1, ad).getTime()) / 86400000);
}

export function SyncBadge({ status }: { status: string }) {
  const cfg = {
    idle: { label: 'Synced', color: 'text-emerald-600 bg-emerald-50' },
    syncing: { label: 'Syncing…', color: 'text-indigo-600 bg-indigo-50' },
    error: { label: 'Sync error', color: 'text-amber-600 bg-amber-50' },
    offline: { label: 'Offline', color: 'text-slate-500 bg-slate-100' },
  }[status as 'idle' | 'syncing' | 'error' | 'offline'] ?? { label: status, color: 'text-slate-500 bg-slate-100' };
  return (
    <span className={`ml-auto mr-4 text-[11px] font-semibold px-2 py-0.5 rounded-full ${cfg.color}`}>{cfg.label}</span>
  );
}
