'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CellPopulation, SubEvent, platesAbbrev } from '@/types';
import { addDays, daysBetween } from '@/lib/dates';

export type Axis = 'horizontal' | 'vertical';

const LONG_PRESS_MS = 350;
const TAP_SLOP_PX = 8;

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Geom {
  axis: Axis;
  /** Pixels per day along the time axis */
  dayPx: number;
  /** Pixel width (vertical-time) or height (horizontal-time) of a single bar lane. */
  lanePx: number;
  /** Gap between lanes */
  laneGap: number;
  /** Header strip thickness perpendicular to time. */
  headerPx: number;
}

export interface TimelineProps {
  axis: Axis;
  origin: string;       // YYYY-MM-DD; day index 0
  dayCount: number;     // total days rendered
  populations: CellPopulation[];
  events: SubEvent[];
  /** Stable lane index per population. */
  laneByPop: Map<string, number>;
  totalLanes: number;
  selectedPopId: string | null;
  selectedEventId: string | null;
  /** Experiments highlighted by a shift-drag marquee selection. */
  selectedPopIds: string[];
  isolatedExperimentId: string | null;
  todayStr: string;
  syncStatus?: string;

  onCreatePop: (startDate: string, endDate: string) => void;
  onMovePop: (popId: string, dayDelta: number) => void;
  onResizePop: (popId: string, edge: 'start' | 'end', date: string, hour: number) => void;
  onSelectPop: (popId: string, anchor: DOMRect) => void;
  onSetPopLane: (popId: string, lane: number) => void;
  onDuplicatePop: (popId: string) => string | null;
  onOpenPopDetails: (popId: string) => void;

  onCreateEvent: (popId: string, startDate: string, startHour: number, endDate: string, endHour: number) => void;
  onMoveEvent: (evId: string, hourDelta: number) => void;
  onResizeEvent: (evId: string, edge: 'start' | 'end', date: string, hour: number) => void;
  onSelectEvent: (evId: string, popId: string, anchor: DOMRect) => void;
  onDuplicateEvent: (evId: string) => string | null;
  onRenameEvent: (evId: string, popId: string) => void;
  /** Move an event into a different parent population, preserving its duration and
   *  placing its start at the given date/hour. */
  onReparentEvent: (evId: string, newPopId: string, anchorDate: string, anchorHour: number) => void;

  onDeselect: () => void;
  /** Report the experiments enclosed by a shift-drag marquee (replaces selection). */
  onMarqueeSelect: (popIds: string[]) => void;
  onExitIsolation: () => void;

  /** Hook: recompute popover anchor when layout shifts (scroll, resize, drag). */
  onLayoutChange?: () => void;

  /** Increment to trigger a smooth scroll back to today. */
  scrollToTodayToken?: number;
}

function geomFor(axis: Axis, isMobile: boolean): Geom {
  if (axis === 'horizontal') {
    return {
      axis,
      dayPx: isMobile ? 96 : 132,
      lanePx: isMobile ? 50 : 60,
      laneGap: 6,
      headerPx: 44,
    };
  }
  return {
    axis,
    dayPx: 80,
    lanePx: 110,
    laneGap: 8,
    headerPx: 64,
  };
}

const ZOOM_STEP = 1.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

/** Two stacked zoom pills — one scales the horizontal axis, one the vertical axis. */
function ZoomControls({ zoomX, zoomY, onZoomX, onZoomY }: {
  zoomX: number; zoomY: number;
  onZoomX: (dir: 1 | -1) => void; onZoomY: (dir: 1 | -1) => void;
}) {
  const row = (label: string, value: number, onStep: (dir: 1 | -1) => void, horizontal: boolean) => (
    <div className="flex items-center gap-0.5 bg-white/90 backdrop-blur rounded-full shadow-sm border border-slate-200 px-1 py-0.5">
      <span title={label} className="w-5 h-5 flex items-center justify-center text-slate-500">
        {horizontal ? (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2.5 8h11M2.5 8l2-2M2.5 8l2 2M13.5 8l-2-2M13.5 8l-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 2.5v11M8 2.5l-2 2M8 2.5l2 2M8 13.5l-2-2M8 13.5l2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        )}
      </span>
      <button
        onClick={() => onStep(-1)}
        disabled={value <= ZOOM_MIN + 1e-6}
        aria-label={`${label} out`}
        className="w-6 h-6 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
      </button>
      <span className="text-[10px] font-bold text-slate-500 w-9 text-center tabular-nums">{Math.round(value * 100)}%</span>
      <button
        onClick={() => onStep(1)}
        disabled={value >= ZOOM_MAX - 1e-6}
        aria-label={`${label} in`}
        className="w-6 h-6 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
      </button>
    </div>
  );
  return (
    <div className="absolute top-2 right-2 z-30 flex flex-col gap-1.5">
      {row('Zoom horizontal', zoomX, onZoomX, true)}
      {row('Zoom vertical', zoomY, onZoomY, false)}
    </div>
  );
}

function eventDurationHours(ev: SubEvent): number {
  return daysBetween(ev.startDate, ev.endDate) * 24 + (ev.endHour + 1 - ev.startHour);
}

function displayEventLabel(ev: SubEvent): string {
  if (eventDurationHours(ev) < 5) return ((ev.label || '?').trim().charAt(0).toUpperCase()) || '?';
  return ev.label;
}

interface DragState {
  pointerId: number;
  pointerType: string;
  startClient: { x: number; y: number };
  /** Date/hour where pointer went down. */
  startDH: { date: string; hour: number };
  mode: DragMode;
  longPressTimer: ReturnType<typeof setTimeout> | null;
  /** True once pointer has moved past slop or long-press fired (= we own the gesture). */
  active: boolean;
  moved: boolean;
  pendingTargetEl: HTMLElement | null;
  /** Most recent date/hour from pointermove (used for resize previews). */
  currentDH: { date: string; hour: number };
  /** For move-pop / move-event: anchor date/hour, mutates as drag re-anchors. */
  anchorDate: string;
  anchorHour: number;
  duplicated: boolean;
}

type DragMode =
  | { kind: 'none' }
  | { kind: 'marquee' }
  | { kind: 'create-event'; popId: string }
  | { kind: 'move-pop'; popId: string }
  | { kind: 'move-event'; evId: string; popId: string }
  | { kind: 'resize-pop'; popId: string; edge: 'start' | 'end' }
  | { kind: 'resize-event'; evId: string; edge: 'start' | 'end' }
  | { kind: 'pending-click-pop'; popId: string }
  | { kind: 'pending-click-event'; evId: string; popId: string };

export default function Timeline(props: TimelineProps) {
  const {
    axis, origin, dayCount, populations, events,
    laneByPop, totalLanes,
    selectedPopId, selectedEventId, selectedPopIds, isolatedExperimentId, todayStr,
    onCreatePop, onMovePop, onResizePop, onSelectPop,
    onSetPopLane, onDuplicatePop, onOpenPopDetails,
    onCreateEvent, onMoveEvent, onResizeEvent, onSelectEvent,
    onDuplicateEvent, onRenameEvent, onReparentEvent,
    onDeselect, onMarqueeSelect, onExitIsolation, onLayoutChange,
    scrollToTodayToken,
  } = props;

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Independent zoom for the screen-horizontal and screen-vertical axes. Which timeline
  // dimension each maps to depends on orientation: in horizontal mode time runs along X
  // and lanes stack along Y; in vertical mode it's the reverse.
  const [zoomX, setZoomX] = useState(1);
  const [zoomY, setZoomY] = useState(1);

  const scrollerRef = useRef<HTMLDivElement>(null);
  // Remember the viewport's focal point (center, as a fraction of total content) just
  // before a zoom change so we can re-anchor scroll afterwards — otherwise the content
  // rescales but scrollLeft/Top stay fixed and the view appears to jump.
  const zoomFocusRef = useRef<{ fx: number; fy: number } | null>(null);
  const captureZoomFocus = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const sw = el.scrollWidth || 1;
    const sh = el.scrollHeight || 1;
    zoomFocusRef.current = {
      fx: (el.scrollLeft + el.clientWidth / 2) / sw,
      fy: (el.scrollTop + el.clientHeight / 2) / sh,
    };
  }, []);
  const stepZoomX = useCallback((dir: 1 | -1) => { captureZoomFocus(); setZoomX(z => clampZoom(dir > 0 ? z * ZOOM_STEP : z / ZOOM_STEP)); }, [captureZoomFocus]);
  const stepZoomY = useCallback((dir: 1 | -1) => { captureZoomFocus(); setZoomY(z => clampZoom(dir > 0 ? z * ZOOM_STEP : z / ZOOM_STEP)); }, [captureZoomFocus]);

  const geom = useMemo(() => {
    const base = geomFor(axis, isMobile);
    const timeZoom = axis === 'horizontal' ? zoomX : zoomY;
    const laneZoom = axis === 'horizontal' ? zoomY : zoomX;
    return { ...base, dayPx: base.dayPx * timeZoom, lanePx: base.lanePx * laneZoom };
  }, [axis, isMobile, zoomX, zoomY]);

  // After a zoom rescales the content, re-center on the captured focal point (before paint,
  // so there's no visible jump). No-op for any geom change that wasn't a zoom click.
  useLayoutEffect(() => {
    const f = zoomFocusRef.current;
    const el = scrollerRef.current;
    if (!f || !el) return;
    zoomFocusRef.current = null;
    el.scrollLeft = f.fx * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = f.fy * el.scrollHeight - el.clientHeight / 2;
  }, [geom.dayPx, geom.lanePx]);

  // Total content size along the time axis (scroll length)
  const timeAxisPx = dayCount * geom.dayPx;
  // Cross-axis content size (just the populated lanes). The lane area itself spans
  // the full viewport minus the header so grid lines extend all the way to the edge.
  const crossAxisPx = Math.max(1, totalLanes) * (geom.lanePx + geom.laneGap) + geom.laneGap;

  const laneAreaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  // Live preview rectangle for an event-creation drag (inside an isolated bar).
  const [dragPreview, setDragPreview] = useState<{ kind: 'event'; popId?: string; startDate: string; startHour: number; endDate: string; endHour: number } | null>(null);
  // Live rubber-band rectangle for shift-drag multi-select (lane-area-local pixels).
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  // --- Convert client x/y → date/hour ---
  const clientToDH = useCallback((clientX: number, clientY: number): { date: string; hour: number } | null => {
    const el = laneAreaRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    let posOnAxis: number;
    if (axis === 'horizontal') posOnAxis = clientX - rect.left;
    else posOnAxis = clientY - rect.top;
    if (posOnAxis < 0) posOnAxis = 0;
    const totalAxis = dayCount * geom.dayPx;
    if (posOnAxis > totalAxis) posOnAxis = totalAxis - 1;
    const dayIndex = Math.floor(posOnAxis / geom.dayPx);
    const fracInDay = (posOnAxis - dayIndex * geom.dayPx) / geom.dayPx;
    const hour = Math.min(23, Math.max(0, Math.floor(fracInDay * 24)));
    return { date: addDays(origin, dayIndex), hour };
  }, [axis, dayCount, geom.dayPx, origin]);

  // Cross-axis pointer position → fractional lane (used for vertical drag-reorder, where
  // the fractional part drives the "gentle resistance" hysteresis).
  const clientToLaneFloat = useCallback((clientX: number, clientY: number): number => {
    const el = laneAreaRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const posCross = axis === 'horizontal' ? clientY - rect.top : clientX - rect.left;
    return (posCross - geom.laneGap) / (geom.lanePx + geom.laneGap);
  }, [axis, geom.lanePx, geom.laneGap]);

  // --- Marquee (shift-drag multi-select) geometry ---
  // Two client points → a rectangle in lane-area-local pixels (for rendering the overlay,
  // which lives inside the scrolled lane content so it tracks the bars).
  const clientRectToLocal = useCallback((x0: number, y0: number, x1: number, y1: number) => {
    const el = laneAreaRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: Math.min(x0, x1) - r.left,
      top: Math.min(y0, y1) - r.top,
      width: Math.abs(x1 - x0),
      height: Math.abs(y1 - y0),
    };
  }, []);
  // Population bars (not sub-events) whose rendered rect intersects the marquee.
  const popIdsInClientRect = useCallback((x0: number, y0: number, x1: number, y1: number): string[] => {
    const el = laneAreaRef.current;
    if (!el) return [];
    const left = Math.min(x0, x1), right = Math.max(x0, x1);
    const top = Math.min(y0, y1), bottom = Math.max(y0, y1);
    const ids: string[] = [];
    el.querySelectorAll<HTMLElement>('[data-pop-id]:not([data-ev-id])').forEach(node => {
      const r = node.getBoundingClientRect();
      if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) {
        const id = node.dataset.popId;
        if (id) ids.push(id);
      }
    });
    return ids;
  }, []);

  // --- Auto-scroll to today on mount + on scrollToTodayToken change ---
  const didScrollRef = useRef(false);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const todayIdx = daysBetween(origin, todayStr);
    if (todayIdx < 0 || todayIdx >= dayCount) return;
    const todayPx = todayIdx * geom.dayPx;
    const smooth = didScrollRef.current;
    if (axis === 'horizontal') {
      el.scrollTo({ left: Math.max(0, todayPx - el.clientWidth / 3), behavior: smooth ? 'smooth' : 'auto' });
    } else {
      el.scrollTo({ top: Math.max(0, todayPx - el.clientHeight / 3), behavior: smooth ? 'smooth' : 'auto' });
    }
    didScrollRef.current = true;
  }, [axis, dayCount, geom.dayPx, origin, todayStr, scrollToTodayToken]);

  // --- Floating month label, driven by scroll position ---
  const [floatingLabel, setFloatingLabel] = useState('');
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      const px = axis === 'horizontal' ? el.scrollLeft : el.scrollTop;
      const dayIdx = Math.floor(px / geom.dayPx);
      const date = addDays(origin, Math.min(dayCount - 1, Math.max(0, dayIdx)));
      const [y, m] = date.split('-').map(Number);
      setFloatingLabel(`${MONTH_SHORT[m - 1]} ${y}`);
      onLayoutChange?.();
    };
    update();
    el.addEventListener('scroll', update);
    return () => el.removeEventListener('scroll', update);
  }, [axis, geom.dayPx, geom.lanePx, origin, dayCount, onLayoutChange]);

  // --- Pointer event handling (unified for mouse + touch) ---

  // Compute drag mode from a pointerdown event target.
  // `mods.meta` (cmd / ctrl) overrides the event-passivity lock outside isolation —
  // letting the user grab an event without first entering isolation mode.
  const resolveDragIntent = useCallback((target: HTMLElement, dh: { date: string; hour: number }, mods: { meta: boolean }): DragMode => {
    const resizeEl = target.closest('[data-resize]') as HTMLElement | null;
    if (resizeEl) {
      const kind = resizeEl.getAttribute('data-resize') || '';
      const popEl = resizeEl.closest('[data-pop-id]') as HTMLElement | null;
      const evEl = resizeEl.closest('[data-ev-id]') as HTMLElement | null;
      if (evEl && (kind === 'ev-start' || kind === 'ev-end')) {
        return { kind: 'resize-event', evId: evEl.dataset.evId!, edge: kind === 'ev-start' ? 'start' : 'end' };
      }
      if (popEl && (kind === 'pop-start' || kind === 'pop-end')) {
        return { kind: 'resize-pop', popId: popEl.dataset.popId!, edge: kind === 'pop-start' ? 'start' : 'end' };
      }
    }

    const evEl = target.closest('[data-ev-id]') as HTMLElement | null;
    if (evEl) {
      const evPopId = evEl.dataset.popId!;
      const inIsoBar = isolatedExperimentId && evPopId === isolatedExperimentId;
      const cmdOverride = !isolatedExperimentId && mods.meta;
      if (inIsoBar || cmdOverride) {
        return { kind: 'pending-click-event', evId: evEl.dataset.evId!, popId: evPopId };
      }
      // Else fall through: outside isolation without cmd, the click is treated as a
      // click on the parent bar (preserves the previous "events are passive" feel).
    }

    const popEl = target.closest('[data-pop-id]') as HTMLElement | null;
    if (popEl) {
      const popId = popEl.dataset.popId!;
      // Inside the isolated experiment's bar interior → create event drag
      if (isolatedExperimentId && popId === isolatedExperimentId) {
        return { kind: 'create-event', popId };
      }
      // Otherwise it's a click-or-move on the experiment bar
      return { kind: 'pending-click-pop', popId };
    }

    // Empty lane area
    if (isolatedExperimentId) {
      // Outside the isolated experiment → no-op
      return { kind: 'none' };
    }
    // Drag on empty space → rubber-band selection. Experiments are created only by
    // double-clicking empty space (or duplicating an existing one), never by drag.
    void dh;
    return { kind: 'marquee' };
  }, [isolatedExperimentId]);

  const cancelDrag = useCallback(() => {
    if (dragRef.current?.longPressTimer) clearTimeout(dragRef.current.longPressTimer);
    dragRef.current = null;
    setDragPreview(null);
    setMarquee(null);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return;
    const target = e.target as HTMLElement;
    const dh = clientToDH(e.clientX, e.clientY);
    if (!dh) return;
    const meta = e.metaKey || e.ctrlKey;
    let intent = resolveDragIntent(target, dh, { meta });
    if (intent.kind === 'none') {
      onDeselect();
      return;
    }

    // Option-drag duplicates whatever you're grabbing — uniform across bars and events.
    // (Cmd is reserved as the "override-passivity" modifier and doesn't duplicate.)
    if (intent.kind === 'pending-click-pop' && e.altKey) {
      const newId = onDuplicatePop(intent.popId);
      if (newId) intent = { kind: 'pending-click-pop', popId: newId };
    }
    if (intent.kind === 'pending-click-event' && e.altKey) {
      const newId = onDuplicateEvent(intent.evId);
      if (newId) intent = { kind: 'pending-click-event', evId: newId, popId: intent.popId };
    }

    const isTouch = e.pointerType === 'touch';
    // Resize handles always activate immediately, regardless of input type.
    const immediatelyActive = intent.kind === 'resize-pop' || intent.kind === 'resize-event';

    const state: DragState = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startClient: { x: e.clientX, y: e.clientY },
      startDH: dh,
      mode: intent,
      longPressTimer: null,
      active: immediatelyActive,
      moved: false,
      pendingTargetEl: target,
      currentDH: dh,
      anchorDate: dh.date,
      anchorHour: dh.hour,
      duplicated: false,
    };

    if (immediatelyActive) {
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    } else if (isTouch) {
      // Touch pending-click / move / create — gate on long-press
      state.longPressTimer = setTimeout(() => {
        if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return;
        // Promote to active drag
        dragRef.current.active = true;
        // Pending clicks promote to move, others just begin
        if (dragRef.current.mode.kind === 'pending-click-pop') {
          dragRef.current.mode = { kind: 'move-pop', popId: dragRef.current.mode.popId };
        } else if (dragRef.current.mode.kind === 'pending-click-event') {
          dragRef.current.mode = { kind: 'move-event', evId: dragRef.current.mode.evId, popId: dragRef.current.mode.popId };
        }
        try { laneAreaRef.current?.setPointerCapture(e.pointerId); } catch {}
        if (dragRef.current.mode.kind === 'create-event') {
          const sd = dragRef.current.startDH;
          setDragPreview({ kind: 'event', popId: dragRef.current.mode.popId, startDate: sd.date, startHour: sd.hour, endDate: sd.date, endHour: Math.min(23, sd.hour + 3) });
        }
      }, LONG_PRESS_MS);
    } else {
      // Mouse: gestures stay pending until the pointer actually moves past slop.
      // (Previously a click on empty space immediately created a 1-day experiment;
      // now creation requires an actual drag, with double-click providing a fast path.)
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    }

    dragRef.current = state;
  }, [clientToDH, resolveDragIntent, onDeselect, onDuplicatePop, onDuplicateEvent]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const st = dragRef.current;
    if (!st || st.pointerId !== e.pointerId) return;

    const dx = e.clientX - st.startClient.x;
    const dy = e.clientY - st.startClient.y;
    const moved = Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX;

    // Touch with pending mode that hasn't long-pressed yet: movement cancels (allow scroll)
    if (st.pointerType === 'touch' && !st.active) {
      if (moved) {
        if (st.longPressTimer) clearTimeout(st.longPressTimer);
        dragRef.current = null;
      }
      return;
    }

    // Mouse with pending-click that just moved: escalate to move
    if (st.pointerType !== 'touch' && (st.mode.kind === 'pending-click-pop' || st.mode.kind === 'pending-click-event') && moved) {
      if (st.mode.kind === 'pending-click-pop') {
        st.mode = { kind: 'move-pop', popId: st.mode.popId };
      } else {
        st.mode = { kind: 'move-event', evId: st.mode.evId, popId: st.mode.popId };
      }
      st.active = true;
    }
    // Mouse shift-drag that just moved: escalate to an active marquee selection.
    if (st.pointerType !== 'touch' && st.mode.kind === 'marquee' && moved && !st.active) {
      st.active = true;
    }
    // Mouse inside the isolated bar that just moved: escalate to event creation.
    if (st.pointerType !== 'touch' && st.mode.kind === 'create-event' && moved && !st.active) {
      st.active = true;
      const sd = st.startDH;
      setDragPreview({ kind: 'event', popId: st.mode.popId, startDate: sd.date, startHour: sd.hour, endDate: sd.date, endHour: sd.hour });
    }

    if (!st.active) return;
    st.moved = moved || st.moved;

    const dh = clientToDH(e.clientX, e.clientY);
    if (!dh) return;
    st.currentDH = dh;

    const m = st.mode;
    if (m.kind === 'marquee') {
      setMarquee(clientRectToLocal(st.startClient.x, st.startClient.y, e.clientX, e.clientY));
    } else if (m.kind === 'create-event') {
      const sd = st.startDH;
      const a = (sd.date < dh.date) || (sd.date === dh.date && sd.hour <= dh.hour) ? sd : dh;
      const b = (sd.date < dh.date) || (sd.date === dh.date && sd.hour <= dh.hour) ? dh : sd;
      setDragPreview({ kind: 'event', popId: m.popId, startDate: a.date, startHour: a.hour, endDate: b.date, endHour: b.hour });
    } else if (m.kind === 'move-pop') {
      const dayDelta = daysBetween(st.anchorDate, dh.date);
      if (dayDelta !== 0) {
        st.anchorDate = dh.date;
        onMovePop(m.popId, dayDelta);
      }
      // Gentle resistance: the bar only leaves its lane once the pointer has travelled
      // past the lane midpoint by an extra margin, so brushing a neighbour doesn't reorder.
      const RESIST = 0.4;
      const laneF = clientToLaneFloat(e.clientX, e.clientY);
      const currentLane = laneByPop.get(m.popId) ?? 0;
      let targetLane = currentLane;
      if (laneF >= currentLane + 0.5 + RESIST || laneF <= currentLane - 0.5 - RESIST) {
        targetLane = Math.max(0, Math.round(laneF));
      }
      if (targetLane !== currentLane) onSetPopLane(m.popId, targetLane);
    } else if (m.kind === 'move-event') {
      // Detect whether the cursor is over a different parent bar — if so, reparent.
      // Skip in isolation mode (only the iso bar is interactive).
      let reparented = false;
      if (!isolatedExperimentId) {
        const elAt = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        const popEl = elAt?.closest('[data-pop-id]') as HTMLElement | null;
        const targetPopId = popEl?.dataset.popId;
        if (targetPopId && targetPopId !== m.popId) {
          onReparentEvent(m.evId, targetPopId, dh.date, dh.hour);
          m.popId = targetPopId;
          st.anchorDate = dh.date;
          st.anchorHour = dh.hour;
          reparented = true;
        }
      }
      if (!reparented) {
        const hourDelta = daysBetween(st.anchorDate, dh.date) * 24 + (dh.hour - st.anchorHour);
        if (hourDelta !== 0) {
          st.anchorDate = dh.date;
          st.anchorHour = dh.hour;
          onMoveEvent(m.evId, hourDelta);
        }
      }
    } else if (m.kind === 'resize-pop') {
      onResizePop(m.popId, m.edge, dh.date, dh.hour);
    } else if (m.kind === 'resize-event') {
      onResizeEvent(m.evId, m.edge, dh.date, dh.hour);
    }
  }, [clientToDH, clientToLaneFloat, clientRectToLocal, isolatedExperimentId, laneByPop, onMovePop, onMoveEvent, onResizePop, onResizeEvent, onSetPopLane, onReparentEvent]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const st = dragRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    if (st.longPressTimer) clearTimeout(st.longPressTimer);

    const m = st.mode;

    if (st.active) {
      const dh = st.currentDH;
      if (m.kind === 'marquee') {
        // Real drag → select enclosed experiments; a shift-click with no drag clears.
        onMarqueeSelect(st.moved ? popIdsInClientRect(st.startClient.x, st.startClient.y, e.clientX, e.clientY) : []);
      } else if (m.kind === 'create-event') {
        const sd = st.startDH;
        const aDate = sd.date < dh.date || (sd.date === dh.date && sd.hour <= dh.hour) ? sd.date : dh.date;
        const aHour = sd.date < dh.date || (sd.date === dh.date && sd.hour <= dh.hour) ? sd.hour : dh.hour;
        const bDate = aDate === sd.date && aHour === sd.hour ? dh.date : sd.date;
        const bHour = aDate === sd.date && aHour === sd.hour ? dh.hour : sd.hour;
        // Ensure at least a 3-hour default if user just tapped without dragging
        const endDate = bDate;
        let endHour = bHour;
        if (endDate === aDate && endHour === aHour) {
          endHour = Math.min(23, aHour + 3);
        }
        onCreateEvent(m.popId, aDate, aHour, endDate, endHour);
      }
    } else {
      // Tap / click without movement → select, or deselect on blank canvas.
      const target = st.pendingTargetEl;
      if (target) {
        if (m.kind === 'pending-click-pop' || m.kind === 'move-pop') {
          const popId = m.kind === 'pending-click-pop' ? m.popId : m.popId;
          const popEl = target.closest('[data-pop-id]') as HTMLElement | null;
          if (popEl) onSelectPop(popId, popEl.getBoundingClientRect());
        } else if (m.kind === 'pending-click-event' || m.kind === 'move-event') {
          const evId = m.evId;
          const popId = m.popId;
          const evEl = target.closest('[data-ev-id]') as HTMLElement | null;
          if (evEl) onSelectEvent(evId, popId, evEl.getBoundingClientRect());
        } else if (m.kind === 'create-event' || m.kind === 'marquee') {
          // Click on empty canvas (no drag) → tear down any open popover, details, or selection.
          onDeselect();
        }
      }
    }

    setDragPreview(null);
    setMarquee(null);
    dragRef.current = null;
  }, [onCreateEvent, onSelectPop, onSelectEvent, onDeselect, onMarqueeSelect, popIdsInClientRect]);

  const onPointerCancel = useCallback(() => {
    cancelDrag();
  }, [cancelDrag]);

  const onDoubleClick = useCallback((e: React.MouseEvent) => {
    // Pointer capture during the click sequence can leave `e.target` pointing at the
    // lane area instead of the bar/event under the cursor — so look up the real element
    // by point and walk up from there.
    const fromTarget = e.target as HTMLElement;
    const fromPoint = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const candidates = [fromPoint, fromTarget].filter(Boolean) as HTMLElement[];
    const findClosest = (sel: string) => {
      for (const c of candidates) {
        const hit = c.closest(sel) as HTMLElement | null;
        if (hit) return hit;
      }
      return null;
    };

    if (findClosest('[data-resize]')) return;

    const evEl = findClosest('[data-ev-id]');
    if (evEl && isolatedExperimentId && evEl.dataset.popId === isolatedExperimentId) {
      onRenameEvent(evEl.dataset.evId!, evEl.dataset.popId!);
      return;
    }

    const popEl = findClosest('[data-pop-id]');
    if (popEl) {
      // Don't trigger details when double-clicking the interior of an isolated bar
      // (that area is reserved for event creation).
      if (isolatedExperimentId && popEl.dataset.popId === isolatedExperimentId) return;
      onOpenPopDetails(popEl.dataset.popId!);
      return;
    }

    if (isolatedExperimentId) {
      // Empty area outside the isolated bar → exit isolation.
      onExitIsolation();
      return;
    }
    const dh = clientToDH(e.clientX, e.clientY);
    if (!dh) return;
    onCreatePop(dh.date, dh.date);
  }, [clientToDH, isolatedExperimentId, onCreatePop, onExitIsolation, onRenameEvent, onOpenPopDetails]);

  // --- Pixel layout helpers ---
  const dateHourToPx = useCallback((date: string, hour: number) => {
    return daysBetween(origin, date) * geom.dayPx + (hour * geom.dayPx) / 24;
  }, [origin, geom.dayPx]);

  const dateRangeToPx = useCallback((startDate: string, startHour: number, endDate: string, endHour: number) => {
    const start = dateHourToPx(startDate, startHour);
    const end = dateHourToPx(endDate, endHour) + geom.dayPx / 24; // include endHour
    return { start, length: Math.max(8, end - start) };
  }, [dateHourToPx, geom.dayPx]);

  // --- Render ---
  const todayPx = daysBetween(origin, todayStr) * geom.dayPx;
  const todayInRange = daysBetween(origin, todayStr) >= 0 && daysBetween(origin, todayStr) < dayCount;

  // Day-tick labels along the time axis. Show day-of-month and day-of-week; emphasize first-of-month.
  const dayTicks = useMemo(() => {
    const arr: { date: string; px: number; isMonthStart: boolean; dayOfMonth: number; dayOfWeek: string; isToday: boolean; isWeekend: boolean }[] = [];
    for (let i = 0; i < dayCount; i++) {
      const date = addDays(origin, i);
      const [y, m, d] = date.split('-').map(Number);
      const jsDate = new Date(y, m - 1, d);
      arr.push({
        date,
        px: i * geom.dayPx,
        isMonthStart: d === 1,
        dayOfMonth: d,
        dayOfWeek: DAY_NAMES[(jsDate.getDay() + 6) % 7],
        isToday: date === todayStr,
        isWeekend: jsDate.getDay() === 0 || jsDate.getDay() === 6,
      });
    }
    return arr;
  }, [origin, dayCount, geom.dayPx, todayStr]);

  // Compute isolated experiment range in pixels (for dimming overlays)
  const isolatedRange = useMemo(() => {
    if (!isolatedExperimentId) return null;
    const pop = populations.find(p => p.id === isolatedExperimentId);
    if (!pop) return null;
    const start = dateHourToPx(pop.startDate, 0);
    const end = dateHourToPx(pop.endDate, 23) + geom.dayPx / 24;
    return { start, end };
  }, [isolatedExperimentId, populations, dateHourToPx, geom.dayPx]);

  // ----- styles per axis -----
  const isHoriz = axis === 'horizontal';

  return (
    <div className="flex-1 relative overflow-hidden bg-slate-50">
      {/* Floating month label */}
      <div className="absolute top-2 left-2 z-30 bg-white/90 backdrop-blur px-3 py-1.5 rounded-full shadow-sm border border-slate-200 text-xs font-bold text-slate-700 uppercase tracking-wider pointer-events-none">
        {floatingLabel}
      </div>

      {/* Per-axis zoom */}
      <ZoomControls zoomX={zoomX} zoomY={zoomY} onZoomX={stepZoomX} onZoomY={stepZoomY} />

      <div
        ref={scrollerRef}
        className="absolute inset-0 overflow-auto"
        // Allow native single-finger panning along BOTH axes so the user can drag to
        // scroll through time *and* across lanes. Restricting to one axis (pan-x/pan-y)
        // left the orthogonal direction unscrollable by touch — in landscape the blocked
        // vertical drag chained to the document and revealed the browser chrome.
        // `overscroll-contain` keeps that chaining from happening at the scroll boundary.
        style={{ touchAction: 'pan-x pan-y', overscrollBehavior: 'contain' }}
      >
        {/* Inner content: time axis × cross axis. */}
        <div
          className="relative"
          style={{
            width: isHoriz ? timeAxisPx : '100%',
            height: isHoriz ? '100%' : timeAxisPx,
            minHeight: isHoriz ? geom.headerPx + crossAxisPx : undefined,
            minWidth: isHoriz ? undefined : geom.headerPx + crossAxisPx,
          }}
        >
          {/* Date header strip */}
          <div
            className="sticky bg-white/95 backdrop-blur border-slate-200 z-20"
            style={
              isHoriz
                ? { top: 0, left: 0, height: geom.headerPx, width: timeAxisPx, borderBottom: '1px solid rgb(226 232 240)' }
                : { left: 0, top: 0, width: geom.headerPx, height: timeAxisPx, borderRight: '1px solid rgb(226 232 240)' }
            }
          >
            {dayTicks.map(t => (
              <div
                key={t.date}
                className={`absolute flex ${isHoriz ? 'flex-col items-center justify-center' : 'flex-row items-center justify-center gap-1.5'} ${t.isToday ? 'text-indigo-700' : t.isWeekend ? 'text-slate-400' : 'text-slate-600'} ${t.isMonthStart ? 'border-l-2 border-indigo-300' : ''}`}
                style={
                  isHoriz
                    ? { left: t.px, top: 0, width: geom.dayPx, height: geom.headerPx }
                    : { top: t.px, left: 0, height: geom.dayPx, width: geom.headerPx }
                }
              >
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-70">{t.dayOfWeek}</span>
                <span className={`text-sm font-bold ${t.isToday ? 'bg-indigo-600 text-white w-7 h-7 leading-7 text-center rounded-full' : ''}`}>
                  {t.dayOfMonth}
                </span>
                {t.isMonthStart && (
                  <span className="text-[9px] font-bold uppercase text-indigo-600 tracking-wider">{MONTH_SHORT[parseInt(t.date.slice(5, 7), 10) - 1]}</span>
                )}
              </div>
            ))}
          </div>

          {/* Lane area — extends to the far edge of the viewport so grid lines aren't
              clipped at the last populated lane. */}
          <div
            ref={laneAreaRef}
            className="absolute select-none"
            style={
              isHoriz
                ? { top: geom.headerPx, left: 0, width: timeAxisPx, bottom: 0, minHeight: crossAxisPx }
                : { left: geom.headerPx, top: 0, height: timeAxisPx, right: 0, minWidth: crossAxisPx }
            }
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onDoubleClick={onDoubleClick}
          >
            {/* Day grid lines */}
            {dayTicks.map(t => (
              <div
                key={t.date}
                className={`absolute ${t.isWeekend ? 'bg-slate-200/55' : ''}`}
                style={(() => {
                  // Keep the border fully in the shorthand (width + style + color in one
                  // property). Mixing `borderLeft: '2px solid'` with a separate `borderColor`
                  // is a shorthand/longhand conflict that React re-applies to every gridline
                  // on each re-render — a flood that janks (and can crash) mobile on zoom.
                  const edge = t.isMonthStart
                    ? '2px solid rgb(129 140 248 / 0.55)'
                    : '1px solid rgb(203 213 225 / 0.85)';
                  return isHoriz
                    ? { left: t.px, top: 0, width: geom.dayPx, height: '100%', borderLeft: edge }
                    : { top: t.px, left: 0, height: geom.dayPx, width: '100%', borderTop: edge };
                })()}
              />
            ))}

            {/* Today indicator */}
            {todayInRange && (
              <div
                className="absolute z-10 pointer-events-none"
                style={
                  isHoriz
                    ? { left: todayPx, top: 0, bottom: 0, width: 2, backgroundColor: 'rgb(99 102 241)' }
                    : { top: todayPx, left: 0, right: 0, height: 2, backgroundColor: 'rgb(99 102 241)' }
                }
              />
            )}

            {/* Outside-of-isolation dim overlays */}
            {isolatedRange && (
              <>
                {/* Pre-range dim */}
                <div
                  className="absolute bg-slate-900/35 pointer-events-auto"
                  style={
                    isHoriz
                      ? { left: 0, top: 0, width: isolatedRange.start, height: '100%' }
                      : { top: 0, left: 0, height: isolatedRange.start, width: '100%' }
                  }
                />
                {/* Post-range dim */}
                <div
                  className="absolute bg-slate-900/35 pointer-events-auto"
                  style={
                    isHoriz
                      ? { left: isolatedRange.end, top: 0, right: 0, height: '100%' }
                      : { top: isolatedRange.end, left: 0, bottom: 0, width: '100%' }
                  }
                />
              </>
            )}

            {/* Bars */}
            {populations.map(pop => {
              const lane = laneByPop.get(pop.id) ?? 0;
              const range = dateRangeToPx(pop.startDate, pop.startHour, pop.endDate, pop.endHour);
              const isSel = selectedPopId === pop.id && !selectedEventId && !isolatedExperimentId;
              const isMulti = selectedPopIds.includes(pop.id);
              const isIsolated = isolatedExperimentId === pop.id;
              const isDimmed = isolatedExperimentId !== null && !isIsolated;
              const popEvents = events.filter(ev => ev.populationId === pop.id);

              const barStyle: React.CSSProperties = isHoriz
                ? {
                    left: range.start + 2,
                    width: Math.max(8, range.length - 4),
                    top: lane * (geom.lanePx + geom.laneGap) + geom.laneGap,
                    height: geom.lanePx,
                  }
                : {
                    top: range.start + 2,
                    height: Math.max(8, range.length - 4),
                    left: lane * (geom.lanePx + geom.laneGap) + geom.laneGap,
                    width: geom.lanePx,
                  };

              return (
                <div
                  key={pop.id}
                  data-pop-id={pop.id}
                  className={`absolute rounded-xl overflow-visible transition-opacity ${isSel ? 'ring-2 ring-offset-2 ring-indigo-500 shadow-lg z-20' : isMulti ? 'ring-2 ring-offset-2 ring-indigo-400 shadow-lg z-20' : 'z-10'} ${isDimmed ? 'opacity-25 pointer-events-none' : ''} ${isIsolated ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
                  style={{
                    ...barStyle,
                    backgroundColor: pop.color + '15',
                    border: `2px solid ${pop.color}90`,
                    touchAction: 'none',
                  }}
                >
                  {/* Bar label */}
                  <div className={`flex flex-col justify-center gap-0.5 ${isHoriz ? 'px-3' : 'px-1.5 py-1.5 text-center'} h-full pointer-events-none overflow-hidden`}>
                    {/* Line 1: plate abbreviation · cell line */}
                    <span className={`${isHoriz ? 'text-[13px]' : 'text-[11px]'} font-bold truncate leading-tight`} style={{ color: pop.color }}>
                      {platesAbbrev(pop.plateType, pop.plateCount)}
                      {pop.cellLine && (
                        <span className="font-semibold opacity-70"> · {pop.cellLine}</span>
                      )}
                    </span>
                    {/* Line 2: experiment ID · name */}
                    <span className={`${isHoriz ? 'text-[12px]' : 'text-[10px]'} font-semibold truncate leading-tight opacity-80`} style={{ color: pop.color }}>
                      {pop.experimentLabel && (
                        <span className="font-bold opacity-100">{pop.experimentLabel} · </span>
                      )}
                      {pop.name}
                    </span>
                  </div>

                  {/* Resize handles. Active in isolation too, so the experiment's own
                      boundaries can be dragged while editing its events. When isolated they
                      sit above the sub-events (z-20) so the very-edge handles stay grabbable;
                      the interior still starts an event-creation drag. */}
                  <>
                    <div
                      data-resize="pop-start"
                      className={`absolute ${isIsolated ? 'z-20 ' : ''}${isHoriz ? 'left-0 top-0 bottom-0 w-2 cursor-col-resize' : 'top-0 left-0 right-0 h-2 cursor-row-resize'} hover:bg-black/10 rounded-l-xl`}
                      style={{ touchAction: 'none' }}
                    />
                    <div
                      data-resize="pop-end"
                      className={`absolute ${isIsolated ? 'z-20 ' : ''}${isHoriz ? 'right-0 top-0 bottom-0 w-2 cursor-col-resize' : 'bottom-0 left-0 right-0 h-2 cursor-row-resize'} hover:bg-black/10 rounded-r-xl`}
                      style={{ touchAction: 'none' }}
                    />
                  </>

                  {/* Sub-events */}
                  {popEvents.map(ev => {
                    const evRange = dateRangeToPx(ev.startDate, ev.startHour, ev.endDate, ev.endHour);
                    const barStart = dateHourToPx(pop.startDate, pop.startHour);
                    const barEnd = dateHourToPx(pop.endDate, pop.endHour) + geom.dayPx / 24;
                    const barLength = barEnd - barStart;
                    if (barLength <= 0) return null;
                    const evStartFromBar = evRange.start - barStart;
                    const evEndFromBar = evRange.start + evRange.length - barStart;
                    const startPct = Math.max(0, (evStartFromBar / barLength) * 100);
                    const endPct = Math.min(100, (evEndFromBar / barLength) * 100);
                    const widthPct = Math.max(0, endPct - startPct);
                    if (widthPct <= 0) return null;
                    const isEvSelected = selectedEventId === ev.id;
                    const interactive = isIsolated;
                    // Outside isolation, events still accept pointer events so cmd-drag
                    // can grab them — but only events on the iso bar (in iso mode) get
                    // visible resize handles.
                    const pointerActive = !isolatedExperimentId || isIsolated;

                    const evStyle: React.CSSProperties = isHoriz
                      ? { left: `${startPct}%`, width: `${widthPct}%`, top: 4, bottom: 4 }
                      : { top: `${startPct}%`, height: `${widthPct}%`, left: 4, right: 4 };

                    return (
                      <div
                        key={ev.id}
                        data-ev-id={ev.id}
                        data-pop-id={pop.id}
                        className={`absolute rounded-md flex items-center justify-center cursor-grab active:cursor-grabbing ${isEvSelected ? 'ring-2 ring-white ring-offset-1 shadow-lg' : 'shadow'} ${pointerActive ? '' : 'pointer-events-none'}`}
                        style={{
                          ...evStyle,
                          backgroundColor: ev.color + (interactive ? 'e0' : 'b0'),
                          touchAction: 'none',
                        }}
                      >
                        <span className={`${isHoriz ? 'text-[11px]' : 'text-[10px]'} font-bold text-white truncate px-2 drop-shadow-sm pointer-events-none`}>{displayEventLabel(ev)}</span>
                        {interactive && (
                          <>
                            <div data-resize="ev-start" className={`absolute ${isHoriz ? 'left-0 top-0 bottom-0 w-1.5 cursor-col-resize' : 'top-0 left-0 right-0 h-1.5 cursor-row-resize'} rounded-l-md hover:bg-white/30`} style={{ touchAction: 'none' }} />
                            <div data-resize="ev-end" className={`absolute ${isHoriz ? 'right-0 top-0 bottom-0 w-1.5 cursor-col-resize' : 'bottom-0 left-0 right-0 h-1.5 cursor-row-resize'} rounded-r-md hover:bg-white/30`} style={{ touchAction: 'none' }} />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* Live drag preview rectangle */}
            {dragPreview && (() => {
              const r = dateRangeToPx(dragPreview.startDate, dragPreview.startHour, dragPreview.endDate, dragPreview.endHour);
              const previewStyle: React.CSSProperties = isHoriz
                ? { left: r.start, width: Math.max(8, r.length), top: geom.laneGap, height: Math.max(geom.lanePx, totalLanes * (geom.lanePx + geom.laneGap)) }
                : { top: r.start, height: Math.max(8, r.length), left: geom.laneGap, width: Math.max(geom.lanePx, totalLanes * (geom.lanePx + geom.laneGap)) };
              if (dragPreview.kind === 'event' && dragPreview.popId) {
                const popLane = laneByPop.get(dragPreview.popId) ?? 0;
                if (isHoriz) {
                  previewStyle.top = popLane * (geom.lanePx + geom.laneGap) + geom.laneGap + 6;
                  previewStyle.height = geom.lanePx - 12;
                } else {
                  previewStyle.left = popLane * (geom.lanePx + geom.laneGap) + geom.laneGap + 6;
                  previewStyle.width = geom.lanePx - 12;
                }
              }
              return (
                <div
                  className="absolute z-30 pointer-events-none rounded-lg bg-indigo-500/15 border-2 border-dashed border-indigo-500"
                  style={previewStyle}
                />
              );
            })()}

            {/* Drag-to-select marquee rectangle */}
            {marquee && (
              <div
                className="absolute z-30 pointer-events-none rounded-md bg-indigo-500/10 border-2 border-indigo-400"
                style={marquee}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
