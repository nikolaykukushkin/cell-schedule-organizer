'use client';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
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
    <div className="flex items-center gap-4 px-5 py-3">
      <h2 className="text-xl font-bold text-gray-900 min-w-[220px]">
        {MONTH_NAMES[month]} {year}
      </h2>
      <div className="flex items-center gap-1">
        <button onClick={onPrev} className="px-3 py-1.5 rounded-lg hover:bg-gray-100 text-gray-600 text-base font-medium">
          &larr;
        </button>
        <button onClick={onToday} className="px-4 py-1.5 rounded-lg hover:bg-gray-100 text-sm font-semibold text-gray-600">
          Today
        </button>
        <button onClick={onNext} className="px-3 py-1.5 rounded-lg hover:bg-gray-100 text-gray-600 text-base font-medium">
          &rarr;
        </button>
      </div>
    </div>
  );
}
