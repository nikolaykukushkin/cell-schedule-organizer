'use client';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

interface CalendarHeaderProps {
  year: number;
  month: number;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

export default function CalendarHeader({ year, month, onPrev, onNext, onToday }: CalendarHeaderProps) {
  return (
    <div className="flex items-center gap-5 max-md:gap-2 px-6 max-md:px-3 py-3.5 max-md:py-2.5 w-full">
      <h2 className="text-2xl max-md:text-lg font-bold text-slate-800 tracking-tight">
        <span className="max-md:hidden">{MONTH_NAMES[month]}</span>
        <span className="md:hidden">{MONTH_SHORT[month]}</span>
        {' '}<span className="text-slate-400 font-normal">{year}</span>
      </h2>
      <div className="flex items-center gap-0.5 bg-slate-100 rounded-lg p-0.5">
        <button onClick={onPrev} className="w-9 h-9 max-md:w-8 max-md:h-8 flex items-center justify-center rounded-md hover:bg-white hover:shadow-sm text-slate-500 transition-all">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <button onClick={onToday} className="px-4 max-md:px-2.5 h-9 max-md:h-8 rounded-md hover:bg-white hover:shadow-sm text-sm max-md:text-xs font-semibold text-slate-600 transition-all">
          Today
        </button>
        <button onClick={onNext} className="w-9 h-9 max-md:w-8 max-md:h-8 flex items-center justify-center rounded-md hover:bg-white hover:shadow-sm text-slate-500 transition-all">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>
    </div>
  );
}
