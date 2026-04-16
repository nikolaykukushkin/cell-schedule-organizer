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

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAY_ROW_H = 72;       // portrait: height of each day row
const BAR_LANE_W = 110;     // portrait: width of a vertical bar lane
const BAR_LANE_H_LAND = 40; // landscape: height of a horizontal bar lane
const LABEL_W = 64;         // portrait: width of left day-label column
const LABEL_H = 28;         // landscape: height of top day-label row
const LONG_PRESS_MS = 500;

function eventDurationHours(ev: SubEvent): number {
  const [sy, sm, sd] = ev.startDate.split('-').map(Number);
  const [ey, em, ed] = ev.endDate.split('-').map(Number);
  const dayDelta = Math.round((new Date(ey, em - 1, ed).getTime() - new Date(sy, sm - 1, sd).getTime()) / 86400000);
  return dayDelta * 24 + (ev.endHour + 1 - ev.startHour);
}

function displayEventLabel(ev: SubEvent): string {
  if (eventDurationHours(ev) < 5) return ((ev.label || '?').trim().charAt(0).toUpperCase()) || '?';
  return ev.label;
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

  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragEnd, setDragEnd] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const dragging = useRef(false);

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
    if (scrolledOnce) return;
    const el = weekRefs.current[anchorWeekIdx];
    if (el && scrollRef.current) {
      el.scrollIntoView({ block: 'start', behavior: 'auto' });
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
    let sH = Math.max(0, Math.min(20, startHour));
    if (sH + 3 > 23) sH = 20;
    const ev: SubEvent = {
      id: crypto.randomUUID(), populationId: popId,
      label: 'New event', comments: '', allDay: false,
      startDate: d, startHour: sH, endDate: d, endHour: sH + 3,
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

  // Touch → date
  const getDateFromTouch = useCallback((clientX: number, clientY: number): string | null => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    if (!el) return null;
    const dayEl = el.closest('[data-day]') as HTMLElement | null;
    if (!dayEl) return null;
    return dayEl.dataset.day || null;
  }, []);

  const onTouchStartCell = useCallback((dateStr: string) => {
    dragging.current = true;
    setDragStart(dateStr);
    setDragEnd(dateStr);
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragging.current) return;
    const t = e.touches[0];
    const d = getDateFromTouch(t.clientX, t.clientY);
    if (d) setDragEnd(d);
  }, [getDateFromTouch]);

  const onTouchEnd = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    if (dragStart && dragEnd && dragStart !== dragEnd) {
      setShowNewDialog(true);
    } else if (dragStart && dragEnd && dragStart === dragEnd) {
      // Single tap: open quick-create from that day (1 day range)
      setShowNewDialog(true);
    }
  }, [dragStart, dragEnd]);

  const selectedEvent = events.find(e => e.id === selectedEventId) || null;
  const selectedPop = populations.find(p => p.id === selectedPopId) || null;
  const todayStr = toDateStr(new Date());
  const dragRange = dragStart && dragEnd ? { start: dragStart < dragEnd ? dragStart : dragEnd, end: dragStart < dragEnd ? dragEnd : dragStart } : null;

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="border-b border-slate-200 bg-white flex items-center px-3 py-2 flex-shrink-0">
        <button
          className="text-xs font-bold text-indigo-600 px-2 py-1 rounded hover:bg-indigo-50"
          onClick={() => {
            const el = weekRefs.current[anchorWeekIdx];
            el?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          }}
        >
          Today
        </button>
        <span className="ml-2 text-xs font-semibold text-slate-400">
          {orientation === 'portrait' ? 'Swipe up/down to scroll weeks' : 'Swipe to scroll weeks'}
        </span>
        <SyncBadge status={syncStatus} />
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-50"
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {weeks.map((week, wi) => (
          <div
            key={wi}
            ref={el => { weekRefs.current[wi] = el; }}
            className="bg-white border-b-4 border-slate-100"
          >
            <WeekHeader week={week} />
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
              />
            )}
          </div>
        ))}
      </div>

      {(selectedEvent || selectedPop) && (
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

function WeekHeader({ week }: { week: Date[] }) {
  const wsd = week[0], wed = week[6];
  const label = wsd.getMonth() === wed.getMonth()
    ? `${MONTH_SHORT[wsd.getMonth()]} ${wsd.getDate()}–${wed.getDate()}`
    : `${MONTH_SHORT[wsd.getMonth()]} ${wsd.getDate()} – ${MONTH_SHORT[wed.getMonth()]} ${wed.getDate()}`;
  return (
    <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
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
  onTouchStartCell: (dateStr: string) => void;
  onSelectPop: (id: string) => void;
  onSelectEvent: (id: string, popId: string) => void;
  onCreateSubEvent?: (popId: string, date: string, startHour: number) => void;
}

function PortraitWeek(p: WeekProps) {
  const weekStart = toDateStr(p.week[0]);
  const weekEnd = toDateStr(p.week[6]);
  const visible = p.populations.filter(pop => rangesOverlap(pop.startDate, pop.endDate, weekStart, weekEnd));

  // Slot assignment (column index for vertical bars)
  const slots = useMemo(() => {
    const result: Record<string, number> = {};
    const sorted = [...visible].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const occupied: { slot: number; start: string; end: string }[] = [];
    for (const pop of sorted) {
      const sDate = pop.startDate > weekStart ? pop.startDate : weekStart;
      const eDate = pop.endDate < weekEnd ? pop.endDate : weekEnd;
      let slot = 0;
      while (occupied.some(o => o.slot === slot && !(sDate > o.end || eDate < o.start))) slot++;
      occupied.push({ slot, start: sDate, end: eDate });
      result[pop.id] = slot;
    }
    return result;
  }, [visible, weekStart, weekEnd]);

  const totalHeight = 7 * DAY_ROW_H;

  return (
    <div className="flex" style={{ height: totalHeight }}>
      {/* Day label / cell column */}
      <div className="flex flex-col" style={{ width: LABEL_W }}>
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
                p.onTouchStartCell(ds);
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
                p.onTouchStartCell(ds);
              }}
            />
          );
        })}

        {/* Vertical bars */}
        {visible.map(pop => {
          const slot = slots[pop.id];
          const barStartDate = pop.startDate > weekStart ? pop.startDate : weekStart;
          const barEndDate = pop.endDate < weekEnd ? pop.endDate : weekEnd;
          const startOffsetDays = daysBetween(weekStart, barStartDate);
          const endOffsetDays = daysBetween(weekStart, barEndDate);
          const top = startOffsetDays * DAY_ROW_H;
          const bottom = (endOffsetDays + 1) * DAY_ROW_H;
          const isSelected = p.selectedPopId === pop.id && !p.selectedEventId;
          const barEvents = p.events.filter(ev =>
            ev.populationId === pop.id &&
            rangesOverlap(ev.startDate, ev.endDate, barStartDate, barEndDate)
          );

          return (
            <div
              key={pop.id}
              data-bar-v
              className={`absolute overflow-visible rounded-xl ${isSelected ? 'ring-2 ring-offset-2 ring-indigo-500' : ''}`}
              style={{
                top: top + 3,
                height: bottom - top - 6,
                left: 4 + slot * BAR_LANE_W,
                width: BAR_LANE_W - 8,
                backgroundColor: pop.color + '18',
                border: `2px solid ${pop.color}80`,
              }}
              onClick={(e) => { e.stopPropagation(); p.onSelectPop(pop.id); }}
              onTouchStart={(e) => {
                const t = e.touches[0];
                // Long-press (no movement for LONG_PRESS_MS) → create event at tapped day.
                // We can't know the exact hour from a bar tap (bar is vertical, days on Y axis);
                // default to 9am local for the tapped day.
                const held = { x: t.clientX, y: t.clientY, moved: false };
                const onMove = (mv: TouchEvent) => {
                  const m = mv.touches[0];
                  if (Math.abs(m.clientX - held.x) > 6 || Math.abs(m.clientY - held.y) > 6) held.moved = true;
                };
                window.addEventListener('touchmove', onMove, { passive: true });
                const timer = setTimeout(() => {
                  window.removeEventListener('touchmove', onMove);
                  if (held.moved) return;
                  // Find which day was long-pressed by reading the data-day under the touch
                  const el = document.elementFromPoint(held.x, held.y) as HTMLElement | null;
                  const dayEl = el?.closest('[data-day]') as HTMLElement | null;
                  const day = dayEl?.dataset.day || barStartDate;
                  if (p.onCreateSubEvent) p.onCreateSubEvent(pop.id, day, 9);
                }, LONG_PRESS_MS);
                const onEnd = () => {
                  clearTimeout(timer);
                  window.removeEventListener('touchmove', onMove);
                  window.removeEventListener('touchend', onEnd);
                };
                window.addEventListener('touchend', onEnd);
              }}
            >
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

              {/* Sub-events as horizontal bands within the vertical bar */}
              {barEvents.map(ev => {
                const evStart = ev.startDate < barStartDate ? barStartDate : ev.startDate;
                const evEnd = ev.endDate > barEndDate ? barEndDate : ev.endDate;
                const evTopDays = daysBetween(barStartDate, evStart);
                const evBottomDays = daysBetween(barStartDate, evEnd) + 1;
                const barSpanDays = daysBetween(barStartDate, barEndDate) + 1;
                const evTopPct = (evTopDays / barSpanDays) * 100;
                const evHPct = ((evBottomDays - evTopDays) / barSpanDays) * 100;
                const isEvSel = p.selectedEventId === ev.id;
                return (
                  <div
                    key={ev.id}
                    data-event-v
                    className={`absolute left-0 right-0 rounded-md flex items-center justify-center ${isEvSel ? 'ring-2 ring-white shadow-lg' : 'shadow'}`}
                    style={{ top: `${evTopPct}%`, height: `${evHPct}%`, backgroundColor: ev.color + 'd0' }}
                    onClick={(e) => { e.stopPropagation(); p.onSelectEvent(ev.id, ev.populationId); }}
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
  const visible = p.populations.filter(pop => rangesOverlap(pop.startDate, pop.endDate, weekStart, weekEnd));

  const slots = useMemo(() => {
    const result: Record<string, number> = {};
    const sorted = [...visible].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const occupied: { slot: number; start: string; end: string }[] = [];
    for (const pop of sorted) {
      const sDate = pop.startDate > weekStart ? pop.startDate : weekStart;
      const eDate = pop.endDate < weekEnd ? pop.endDate : weekEnd;
      let slot = 0;
      while (occupied.some(o => o.slot === slot && !(sDate > o.end || eDate < o.start))) slot++;
      occupied.push({ slot, start: sDate, end: eDate });
      result[pop.id] = slot;
    }
    return result;
  }, [visible, weekStart, weekEnd]);

  const maxSlot = Object.values(slots).length > 0 ? Math.max(0, ...Object.values(slots)) : -1;
  const barArea = (maxSlot + 1) * BAR_LANE_H_LAND;
  const contentHeight = LABEL_H + Math.max(80, barArea + 20);

  return (
    <div className="relative" style={{ height: contentHeight }}>
      {/* Day columns */}
      <div className="grid grid-cols-7 h-full">
        {p.week.map((d) => {
          const ds = toDateStr(d);
          const isToday = ds === p.todayStr;
          const inDrag = p.dragRange && !p.showNewDialog && ds >= p.dragRange.start && ds <= p.dragRange.end;
          return (
            <div
              key={ds}
              data-day={ds}
              className={`border-r border-slate-100 last:border-r-0 ${inDrag ? 'bg-indigo-50/70' : ''}`}
              onTouchStart={(e) => {
                if ((e.target as HTMLElement).closest('[data-bar-h]') || (e.target as HTMLElement).closest('[data-event-h]')) return;
                p.onTouchStartCell(ds);
              }}
            >
              <div className="flex items-baseline justify-center gap-1 py-1" style={{ height: LABEL_H }}>
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{DAY_NAMES[(d.getDay() + 6) % 7]}</span>
                <span className={`text-[13px] font-bold ${isToday ? 'text-white bg-indigo-600 w-6 h-6 rounded-full flex items-center justify-center' : 'text-slate-700'}`}>{d.getDate()}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Horizontal bars */}
      <div className="absolute inset-x-0" style={{ top: LABEL_H, bottom: 0 }}>
        {visible.map(pop => {
          const slot = slots[pop.id];
          const sColDay = pop.startDate > weekStart ? pop.startDate : weekStart;
          const eColDay = pop.endDate < weekEnd ? pop.endDate : weekEnd;
          const startCol = daysBetween(weekStart, sColDay);
          const endCol = daysBetween(weekStart, eColDay);
          const leftPct = (startCol / 7) * 100;
          const widthPct = ((endCol - startCol + 1) / 7) * 100;
          const isSelected = p.selectedPopId === pop.id && !p.selectedEventId;
          const barEvents = p.events.filter(ev =>
            ev.populationId === pop.id &&
            rangesOverlap(ev.startDate, ev.endDate, sColDay, eColDay)
          );

          return (
            <div
              key={pop.id}
              data-bar-h
              className={`absolute rounded-lg overflow-visible ${isSelected ? 'ring-2 ring-offset-2 ring-indigo-500' : ''}`}
              style={{
                top: 4 + slot * BAR_LANE_H_LAND,
                left: `calc(${leftPct}% + 2px)`,
                width: `calc(${widthPct}% - 4px)`,
                height: BAR_LANE_H_LAND - 4,
                backgroundColor: pop.color + '18',
                border: `2px solid ${pop.color}80`,
              }}
              onClick={(e) => { e.stopPropagation(); p.onSelectPop(pop.id); }}
              onTouchStart={(e) => {
                const t = e.touches[0];
                const held = { x: t.clientX, y: t.clientY, moved: false };
                const onMove = (mv: TouchEvent) => {
                  const m = mv.touches[0];
                  if (Math.abs(m.clientX - held.x) > 6 || Math.abs(m.clientY - held.y) > 6) held.moved = true;
                };
                window.addEventListener('touchmove', onMove, { passive: true });
                const timer = setTimeout(() => {
                  window.removeEventListener('touchmove', onMove);
                  if (held.moved) return;
                  const el = document.elementFromPoint(held.x, held.y) as HTMLElement | null;
                  const dayEl = el?.closest('[data-day]') as HTMLElement | null;
                  const day = dayEl?.dataset.day || sColDay;
                  if (p.onCreateSubEvent) p.onCreateSubEvent(pop.id, day, 9);
                }, LONG_PRESS_MS);
                const onEnd = () => {
                  clearTimeout(timer);
                  window.removeEventListener('touchmove', onMove);
                  window.removeEventListener('touchend', onEnd);
                };
                window.addEventListener('touchend', onEnd);
              }}
            >
              <div className="flex flex-col justify-center h-full px-2 pointer-events-none overflow-hidden">
                <span className="text-[11px] font-bold truncate leading-tight" style={{ color: pop.color }}>
                  {platesLabel(pop.plateType, pop.plateCount)}
                </span>
                <span className="text-[10px] font-semibold truncate leading-tight opacity-80" style={{ color: pop.color }}>
                  {pop.name}
                </span>
              </div>

              {barEvents.map(ev => {
                const evStart = ev.startDate < sColDay ? sColDay : ev.startDate;
                const evEnd = ev.endDate > eColDay ? eColDay : ev.endDate;
                const barSpan = daysBetween(sColDay, eColDay) + 1;
                const evLeftDays = daysBetween(sColDay, evStart);
                const evRightDays = daysBetween(sColDay, evEnd) + 1;
                const evLeft = (evLeftDays / barSpan) * 100;
                const evW = ((evRightDays - evLeftDays) / barSpan) * 100;
                const isEvSel = p.selectedEventId === ev.id;
                return (
                  <div
                    key={ev.id}
                    data-event-h
                    className={`absolute top-0.5 bottom-0.5 rounded flex items-center justify-center ${isEvSel ? 'ring-2 ring-white' : 'shadow'}`}
                    style={{ left: `${evLeft}%`, width: `${evW}%`, backgroundColor: ev.color + 'd0' }}
                    onClick={(e) => { e.stopPropagation(); p.onSelectEvent(ev.id, ev.populationId); }}
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

