'use client';

import { useState } from 'react';

/** Integer input that can be cleared while typing (and still uses the native up/down
 *  steppers). Only commits valid values ≥ min; reverts to the last valid value on blur. */
export default function CountInput({
  value, onChange, min = 1, max, className,
}: { value: number; onChange: (n: number) => void; min?: number; max?: number; className?: string }) {
  const [text, setText] = useState(String(value));
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    if (parseInt(text, 10) !== value) setText(String(value));
  }
  return (
    <input
      type="number"
      inputMode="numeric"
      autoComplete="off"
      min={min}
      max={max}
      value={text}
      onChange={e => {
        const t = e.target.value;
        setText(t);
        const n = parseInt(t, 10);
        if (!Number.isNaN(n) && n >= min && (max === undefined || n <= max)) onChange(n);
      }}
      onBlur={() => {
        const n = parseInt(text, 10);
        if (Number.isNaN(n) || n < min || (max !== undefined && n > max)) setText(String(value));
      }}
      className={className}
    />
  );
}
