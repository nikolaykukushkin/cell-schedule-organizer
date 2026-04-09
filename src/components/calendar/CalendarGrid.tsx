'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  CellPopulation,
  SubEvent,
  Connection,
  POPULATION_COLORS,
  SUB_EVENT_COLORS,
  PlateType,
  densityUnit,
} from '@/types';
import { getMonthGrid, toDateStr, isInRange, rangesOverlap } from '@/lib/dates';
import * as storage from '@/lib/storage';
import CalendarHeader from './CalendarHeader';
import EventPanel from './EventPanel';
import NewPopulationDialog from './NewPopulationDialog';
import PlateVisual from './PlateVisual';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface CalendarGridProps {
  experimentId: string;
}

type DragMode = 'none' | 'create-pop' | 'create-sub' | 'resize-pop-start' | 'resize-pop-end' | 'resize-sub-start' | 'resize-sub-end';

export default function CalendarGrid({ experimentId }: CalendarGridProps) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const [populations, setPopulations] = useState<CellPopulation[]>(() =>
    storage.getPopulations(experimentId)
  );
  const [subEvents, setSubEvents] = useState<SubEvent[]>(() =>
    storage.getAllSubEvents(experimentId)
  );
  const [, setConnections] = useState<Connection[]>(() =>
    storage.getConnections(experimentId)
  );

  const [selectedPopId, setSelectedPopId] = useState<string | null>(null);
  const [selectedSubEventId, setSelectedSubEventId] = useState<string | null>(null);

  // Unified drag state
  const dragMode = useRef<DragMode>('none');
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragEnd, setDragEnd] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const dragTargetId = useRef<string | null>(null); // pop or sub-event id for resize

  // Sub-event creation drag
  const [subDragPopId, setSubDragPopId] = useState<string | null>(null);
  const [subDragStart, setSubDragStart] = useState<string | null>(null);
  const [subDragEnd, setSubDragEnd] = useState<string | null>(null);

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

  // --- Date + hour from mouse position ---
  const getDateHourFromMouse = useCallback((e: React.MouseEvent, weekIdx: number): { date: string; hour: number } | null => {
    const rowEl = (e.target as HTMLElement).closest('[data-week-row]');
    if (!rowEl) return null;
    const rect = rowEl.getBoundingClientRect();
    const colWidth = rect.width / 7;
    const xInRow = e.clientX - rect.left;
    const col = Math.min(6, Math.max(0, Math.floor(xInRow / colWidth)));
    const xInCol = xInRow - col * colWidth;
    const hour = Math.min(23, Math.max(0, Math.floor((xInCol / colWidth) * 24)));
    return { date: toDateStr(weeks[weekIdx][col]), hour };
  }, [weeks]);

  // --- Drag: create population ---
  const handleCellMouseDown = useCallback((dateStr: string, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-bar]') || (e.target as HTMLElement).closest('[data-subevent]')) return;
    dragMode.current = 'create-pop';
    setDragStart(dateStr);
    setDragEnd(dateStr);
  }, []);

  const handleCellMouseEnter = useCallback((dateStr: string) => {
    if (dragMode.current === 'create-pop') setDragEnd(dateStr);
  }, []);

  // --- Drag: create sub-event ---
  const handleBarMouseDown = useCallback((popId: string, weekIdx: number, e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-subevent]') || (e.target as HTMLElement).closest('[data-resize]')) return;
    e.stopPropagation();
    const dh = getDateHourFromMouse(e, weekIdx);
    if (!dh) return;
    dragMode.current = 'create-sub';
    setSubDragPopId(popId);
    setSubDragStart(dh.date);
    setSubDragEnd(dh.date);
  }, [getDateHourFromMouse]);

  const handleBarMouseMove = useCallback((weekIdx: number, e: React.MouseEvent) => {
    if (dragMode.current === 'create-sub') {
      const dh = getDateHourFromMouse(e, weekIdx);
      if (dh) setSubDragEnd(dh.date);
    }
    if ((dragMode.current === 'resize-pop-start' || dragMode.current === 'resize-pop-end') && dragTargetId.current) {
      const dh = getDateHourFromMouse(e, weekIdx);
      if (!dh) return;
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
    if ((dragMode.current === 'resize-sub-start' || dragMode.current === 'resize-sub-end') && dragTargetId.current) {
      const dh = getDateHourFromMouse(e, weekIdx);
      if (!dh) return;
      setSubEvents(prev => prev.map(se => {
        if (se.id !== dragTargetId.current) return se;
        if (dragMode.current === 'resize-sub-start' && (dh.date < se.endDate || (dh.date === se.endDate && dh.hour < se.endHour))) {
          const updated = { ...se, startDate: dh.date, startHour: dh.hour };
          storage.saveSubEvent(updated);
          return updated;
        }
        if (dragMode.current === 'resize-sub-end' && (dh.date > se.startDate || (dh.date === se.startDate && dh.hour > se.startHour))) {
          const updated = { ...se, endDate: dh.date, endHour: dh.hour };
          storage.saveSubEvent(updated);
          return updated;
        }
        return se;
      }));
    }
  }, [getDateHourFromMouse]);

  // --- Resize handles ---
  const handleResizePopStart = useCallback((popId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    dragMode.current = 'resize-pop-start';
    dragTargetId.current = popId;
  }, []);
  const handleResizePopEnd = useCallback((popId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    dragMode.current = 'resize-pop-end';
    dragTargetId.current = popId;
  }, []);
  const handleResizeSubStart = useCallback((subId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    dragMode.current = 'resize-sub-start';
    dragTargetId.current = subId;
  }, []);
  const handleResizeSubEnd = useCallback((subId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    dragMode.current = 'resize-sub-end';
    dragTargetId.current = subId;
  }, []);

  // --- Mouse up ---
  const handleMouseUp = useCallback(() => {
    const mode = dragMode.current;
    dragMode.current = 'none';
    dragTargetId.current = null;

    if (mode === 'create-pop' && dragStart && dragEnd) {
      const s = dragStart < dragEnd ? dragStart : dragEnd;
      const e = dragStart < dragEnd ? dragEnd : dragStart;
      setDragStart(s);
      setDragEnd(e);
      setShowNewDialog(true);
      return;
    }
    if (mode === 'create-sub' && subDragPopId && subDragStart && subDragEnd) {
      const s = subDragStart < subDragEnd ? subDragStart : subDragEnd;
      const e = subDragStart < subDragEnd ? subDragEnd : subDragStart;
      const pop = populations.find(p => p.id === subDragPopId);
      if (pop) {
        const clampedStart = s < pop.startDate ? pop.startDate : s;
        const clampedEnd = e > pop.endDate ? pop.endDate : e;
        const sub: SubEvent = {
          id: crypto.randomUUID(),
          populationId: subDragPopId,
          label: 'New event',
          startDate: clampedStart,
          startHour: 0,
          endDate: clampedEnd,
          endHour: 23,
          color: SUB_EVENT_COLORS[subEvents.filter(se => se.populationId === subDragPopId).length % SUB_EVENT_COLORS.length],
        };
        storage.saveSubEvent(sub);
        setSubEvents(prev => [...prev, sub]);
        setSelectedSubEventId(sub.id);
        setSelectedPopId(subDragPopId);
      }
    }
    setSubDragPopId(null);
    setSubDragStart(null);
    setSubDragEnd(null);
  }, [dragStart, dragEnd, subDragPopId, subDragStart, subDragEnd, populations, subEvents]);

  const handleCreatePopulation = useCallback(
    (data: { name: string; plateType: PlateType; plateCount: number; cellDensity: string }) => {
      if (!dragStart || !dragEnd) return;
      const s = dragStart < dragEnd ? dragStart : dragEnd;
      const e = dragStart < dragEnd ? dragEnd : dragStart;
      const pop: CellPopulation = {
        id: crypto.randomUUID(),
        experimentId,
        name: data.name,
        color: POPULATION_COLORS[populations.length % POPULATION_COLORS.length],
        plateType: data.plateType,
        plateCount: data.plateCount,
        cellDensity: data.cellDensity,
        startDate: s,
        startHour: 0,
        endDate: e,
        endHour: 23,
      };
      storage.savePopulation(pop);
      setPopulations(prev => [...prev, pop]);
      setDragStart(null);
      setDragEnd(null);
      setShowNewDialog(false);
      setSelectedPopId(pop.id);
      setSelectedSubEventId(null);
    },
    [dragStart, dragEnd, experimentId, populations.length]
  );

  const handleCancelDialog = useCallback(() => {
    setDragStart(null);
    setDragEnd(null);
    setShowNewDialog(false);
  }, []);

  // Update/delete handlers
  const handleUpdateSubEvent = useCallback((updated: SubEvent) => {
    storage.saveSubEvent(updated);
    setSubEvents(prev => prev.map(e => (e.id === updated.id ? updated : e)));
  }, []);

  const handleDeleteSubEvent = useCallback((id: string) => {
    storage.deleteSubEvent(id);
    setSubEvents(prev => prev.filter(e => e.id !== id));
    setSelectedSubEventId(null);
  }, []);

  const handleUpdatePopulation = useCallback((updated: CellPopulation) => {
    storage.savePopulation(updated);
    setPopulations(prev => prev.map(p => (p.id === updated.id ? updated : p)));
  }, []);

  const handleDeletePopulation = useCallback((id: string) => {
    storage.deletePopulation(id);
    setPopulations(prev => prev.filter(p => p.id !== id));
    setSubEvents(prev => prev.filter(e => e.populationId !== id));
    setConnections(prev => prev.filter(c => c.sourcePopulationId !== id && c.targetPopulationId !== id));
    setSelectedPopId(null);
    setSelectedSubEventId(null);
  }, []);

  // Computed ranges
  const dragRange = useMemo(() => {
    if (!dragStart || !dragEnd) return null;
    const s = dragStart < dragEnd ? dragStart : dragEnd;
    const e = dragStart < dragEnd ? dragEnd : dragStart;
    return { start: s, end: e };
  }, [dragStart, dragEnd]);

  const subDragRange = useMemo(() => {
    if (!subDragStart || !subDragEnd) return null;
    const s = subDragStart < subDragEnd ? subDragStart : subDragEnd;
    const e = subDragStart < subDragEnd ? subDragEnd : subDragStart;
    return { start: s, end: e, popId: subDragPopId };
  }, [subDragStart, subDragEnd, subDragPopId]);

  // Bar layout — uses fractional columns for hourly precision
  const barLayout = useMemo(() => {
    const allBars: { pop: CellPopulation; weekIdx: number; startFrac: number; endFrac: number; slot: number }[] = [];
    visiblePops.forEach(pop => {
      weeks.forEach((week, weekIdx) => {
        const weekStart = toDateStr(week[0]);
        const weekEnd = toDateStr(week[6]);
        if (!rangesOverlap(pop.startDate, pop.endDate, weekStart, weekEnd)) return;

        const isBarStart = pop.startDate >= weekStart;
        const isBarEnd = pop.endDate <= weekEnd;

        // Fractional column: col + hour/24
        let startFrac: number;
        if (isBarStart) {
          const col = week.findIndex(d => toDateStr(d) === pop.startDate);
          startFrac = (col >= 0 ? col : 0) + pop.startHour / 24;
        } else {
          startFrac = 0;
        }

        let endFrac: number;
        if (isBarEnd) {
          const col = week.findIndex(d => toDateStr(d) === pop.endDate);
          endFrac = (col >= 0 ? col : 6) + (pop.endHour + 1) / 24;
        } else {
          endFrac = 7;
        }

        allBars.push({ pop, weekIdx, startFrac, endFrac, slot: 0 });
      });
    });
    // Assign slots (use integer column overlap check)
    allBars.forEach(bar => {
      const sameWeek = allBars.filter(b => b.weekIdx === bar.weekIdx && b !== bar);
      let slot = 0;
      while (sameWeek.some(b => b.slot === slot && !(bar.startFrac >= b.endFrac || bar.endFrac <= b.startFrac))) {
        slot++;
      }
      bar.slot = slot;
    });
    const maxSlots = weeks.map((_, wi) => {
      const bars = allBars.filter(b => b.weekIdx === wi);
      return bars.length > 0 ? Math.max(...bars.map(b => b.slot)) + 1 : 0;
    });
    return { allBars, maxSlots };
  }, [visiblePops, weeks]);

  const selectedSubEvent = subEvents.find(e => e.id === selectedSubEventId) || null;
  const selectedPop = populations.find(p => p.id === selectedPopId) || null;
  const todayStr = toDateStr(today);
  const BAR_HEIGHT = 56;

  return (
    <div className="flex-1 flex flex-col h-full" onMouseUp={handleMouseUp}>
      {/* Header */}
      <div className="border-b border-gray-200 bg-white flex items-center flex-shrink-0">
        <CalendarHeader year={year} month={month} onPrev={goPrev} onNext={goNext} onToday={goToday} />
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col overflow-auto select-none">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-gray-200 flex-shrink-0">
            {DAY_NAMES.map(d => (
              <div key={d} className="text-center text-sm font-semibold text-gray-500 py-2 bg-gray-50">{d}</div>
            ))}
          </div>

          {/* Weeks */}
          <div className="flex-1 flex flex-col">
            {weeks.map((week, wi) => {
              const slotsInWeek = barLayout.maxSlots[wi];
              const barAreaHeight = slotsInWeek * (BAR_HEIGHT + 4);

              return (
                <div
                  key={wi}
                  data-week-row
                  className="relative flex-1 border-b border-gray-100 last:border-b-0"
                  style={{ minHeight: Math.max(100, 32 + barAreaHeight) }}
                >
                  {/* Day cells */}
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
                            border-r border-gray-100 last:border-r-0
                            ${isCurrentMonth ? 'bg-white' : 'bg-gray-50/50'}
                            ${inDragRange ? '!bg-indigo-100' : ''}
                          `}
                          onMouseDown={(e) => handleCellMouseDown(dateStr, e)}
                          onMouseEnter={() => handleCellMouseEnter(dateStr)}
                        >
                          <div className="px-2 pt-1.5">
                            <span className={`
                              text-sm font-semibold inline-block w-7 h-7 text-center leading-7 rounded-full
                              ${isToday ? 'bg-indigo-600 text-white' : ''}
                              ${!isCurrentMonth && !isToday ? 'text-gray-300' : 'text-gray-700'}
                            `}>
                              {date.getDate()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Population bars */}
                  {barLayout.allBars.filter(b => b.weekIdx === wi).map(bar => {
                    const isSelected = bar.pop.id === selectedPopId && !selectedSubEventId;
                    const weekStart = toDateStr(week[0]);
                    const weekEnd = toDateStr(week[6]);
                    const isBarStart = bar.pop.startDate >= weekStart;
                    const isBarEnd = bar.pop.endDate <= weekEnd;
                    const leftPct = (bar.startFrac / 7) * 100;
                    const widthPct = ((bar.endFrac - bar.startFrac) / 7) * 100;

                    const barSubEvents = subEvents.filter(se =>
                      se.populationId === bar.pop.id &&
                      rangesOverlap(se.startDate, se.endDate,
                        bar.pop.startDate > weekStart ? bar.pop.startDate : weekStart,
                        bar.pop.endDate < weekEnd ? bar.pop.endDate : weekEnd)
                    );

                    const showSubDragPreview = subDragRange && subDragRange.popId === bar.pop.id &&
                      rangesOverlap(subDragRange.start, subDragRange.end,
                        bar.pop.startDate > weekStart ? bar.pop.startDate : weekStart,
                        bar.pop.endDate < weekEnd ? bar.pop.endDate : weekEnd);

                    return (
                      <div
                        key={`${bar.pop.id}-${wi}`}
                        data-bar
                        className={`
                          absolute cursor-pointer overflow-visible z-10
                          ${isSelected ? 'ring-2 ring-offset-1 ring-indigo-500' : ''}
                          ${isBarStart ? 'rounded-l-lg' : ''} ${isBarEnd ? 'rounded-r-lg' : ''}
                        `}
                        style={{
                          top: 32 + bar.slot * (BAR_HEIGHT + 4),
                          left: `calc(${leftPct}% + 1px)`,
                          width: `calc(${widthPct}% - 2px)`,
                          height: BAR_HEIGHT,
                          backgroundColor: bar.pop.color + '15',
                          border: `2px solid ${bar.pop.color}`,
                          borderLeftStyle: isBarStart ? 'solid' : 'none',
                          borderRightStyle: isBarEnd ? 'solid' : 'none',
                        }}
                        onClick={(e) => { e.stopPropagation(); setSelectedPopId(bar.pop.id); setSelectedSubEventId(null); }}
                        onMouseDown={(e) => handleBarMouseDown(bar.pop.id, wi, e)}
                        onMouseMove={(e) => handleBarMouseMove(wi, e)}
                      >
                        {/* Content on first segment */}
                        {isBarStart && (
                          <div className="flex items-center gap-2 px-2 h-full pointer-events-none overflow-hidden">
                            <span className="text-sm font-bold truncate" style={{ color: bar.pop.color }}>
                              {bar.pop.name}
                            </span>
                            <span className="flex-shrink-0" style={{ color: bar.pop.color }}>
                              <PlateVisual plateType={bar.pop.plateType} count={bar.pop.plateCount} size={28} />
                            </span>
                            {bar.pop.cellDensity && (
                              <span className="text-xs font-semibold whitespace-nowrap" style={{ color: bar.pop.color }}>
                                {bar.pop.cellDensity} {densityUnit(bar.pop.plateType)}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Resize handles for population */}
                        {isBarStart && (
                          <div
                            data-resize
                            className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-black/10 rounded-l-lg"
                            onMouseDown={(e) => handleResizePopStart(bar.pop.id, e)}
                          />
                        )}
                        {isBarEnd && (
                          <div
                            data-resize
                            className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-black/10 rounded-r-lg"
                            onMouseDown={(e) => handleResizePopEnd(bar.pop.id, e)}
                          />
                        )}

                        {/* Sub-events */}
                        {barSubEvents.map(se => {
                          // Use fractional hours for sub-event positioning within bar
                          const bsd = bar.pop.startDate > weekStart ? bar.pop.startDate : weekStart;
                          const bed = bar.pop.endDate < weekEnd ? bar.pop.endDate : weekEnd;
                          const bsHour = bar.pop.startDate >= weekStart ? bar.pop.startHour : 0;
                          const beHour = bar.pop.endDate <= weekEnd ? bar.pop.endHour : 23;

                          const seStartDate = se.startDate < bsd ? bsd : se.startDate;
                          const seEndDate = se.endDate > bed ? bed : se.endDate;
                          const seStartHour = se.startDate < bsd ? 0 : se.startHour;
                          const seEndHour = se.endDate > bed ? 23 : se.endHour;

                          const barStartAbs = daysBetween(bsd, bsd) + bsHour / 24; // = 0 + hour fraction
                          const seStartAbs = daysBetween(bsd, seStartDate) + seStartHour / 24;
                          const seEndAbs = daysBetween(bsd, seEndDate) + (seEndHour + 1) / 24;
                          const barEndAbs = daysBetween(bsd, bed) + (beHour + 1) / 24;

                          const barRange = barEndAbs - barStartAbs;
                          const seLeftPct = barRange > 0 ? ((seStartAbs - barStartAbs) / barRange) * 100 : 0;
                          const seWidthPct = barRange > 0 ? ((seEndAbs - seStartAbs) / barRange) * 100 : 100;
                          const isSeSelected = selectedSubEventId === se.id;

                          return (
                            <div
                              key={se.id}
                              data-subevent
                              className={`
                                absolute top-[3px] bottom-[3px] rounded-md cursor-pointer flex items-center justify-center
                                ${isSeSelected ? 'ring-2 ring-white shadow-lg' : 'shadow-sm'}
                              `}
                              style={{ left: `${seLeftPct}%`, width: `${seWidthPct}%`, backgroundColor: se.color + 'dd' }}
                              onClick={(e) => { e.stopPropagation(); setSelectedSubEventId(se.id); setSelectedPopId(se.populationId); }}
                            >
                              <span className="text-xs font-bold text-white truncate px-1.5 drop-shadow">
                                {se.label}
                              </span>
                              {/* Resize handles for sub-event */}
                              <div
                                data-resize
                                className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-white/30 rounded-l-md"
                                onMouseDown={(e) => handleResizeSubStart(se.id, e)}
                              />
                              <div
                                data-resize
                                className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-white/30 rounded-r-md"
                                onMouseDown={(e) => handleResizeSubEnd(se.id, e)}
                              />
                            </div>
                          );
                        })}

                        {/* Sub-drag preview */}
                        {showSubDragPreview && subDragRange && (() => {
                          const bsd = bar.pop.startDate > weekStart ? bar.pop.startDate : weekStart;
                          const bed = bar.pop.endDate < weekEnd ? bar.pop.endDate : weekEnd;
                          const bsH = bar.pop.startDate >= weekStart ? bar.pop.startHour : 0;
                          const beH = bar.pop.endDate <= weekEnd ? bar.pop.endHour : 23;
                          const barStartAbs2 = bsH / 24;
                          const barEndAbs2 = daysBetween(bsd, bed) + (beH + 1) / 24;
                          const barRange2 = barEndAbs2 - barStartAbs2;
                          const ps = subDragRange.start < bsd ? bsd : subDragRange.start;
                          const pe = subDragRange.end > bed ? bed : subDragRange.end;
                          const psAbs = daysBetween(bsd, ps);
                          const peAbs = daysBetween(bsd, pe) + 1;
                          const pLeftPct = barRange2 > 0 ? ((psAbs - barStartAbs2) / barRange2) * 100 : 0;
                          const pWidthPct = barRange2 > 0 ? ((peAbs - psAbs) / barRange2) * 100 : 100;
                          return (
                            <div
                              className="absolute top-[3px] bottom-[3px] rounded-md bg-yellow-400/40 border-2 border-yellow-400 border-dashed pointer-events-none"
                              style={{ left: `${Math.max(0, pLeftPct)}%`, width: `${Math.min(100 - Math.max(0, pLeftPct), pWidthPct)}%` }}
                            />
                          );
                        })()}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Side panel */}
        {(selectedSubEvent || (selectedPop && !selectedSubEvent)) && (
          <EventPanel
            subEvent={selectedSubEvent}
            population={selectedPop}
            onUpdateSubEvent={handleUpdateSubEvent}
            onDeleteSubEvent={handleDeleteSubEvent}
            onUpdatePopulation={handleUpdatePopulation}
            onDeletePopulation={handleDeletePopulation}
            onClose={() => { setSelectedSubEventId(null); if (!selectedSubEvent) setSelectedPopId(null); }}
          />
        )}
      </div>

      {/* Drag indicator */}
      {dragRange && !showNewDialog && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-indigo-600 text-white px-5 py-2.5 rounded-full text-sm font-semibold shadow-lg z-50">
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
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-gray-400 text-base pointer-events-none">
          Click and drag across days to create a cell population timeline
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
