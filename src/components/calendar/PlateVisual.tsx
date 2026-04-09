'use client';

import Image from 'next/image';
import { PlateType } from '@/types';

interface PlateVisualProps {
  plateType: PlateType;
  count: number;
  size?: number;
}

function getImageSrc(plateType: PlateType): string {
  if (plateType.endsWith('well')) return '/plates/well-plate.svg';
  if (plateType.startsWith('T')) return '/plates/flask.svg';
  return '/plates/petri-dish.svg';
}

export default function PlateVisual({ plateType, count, size = 36 }: PlateVisualProps) {
  const maxShow = Math.min(count, 6);
  const remaining = count - maxShow;
  const src = getImageSrc(plateType);

  return (
    <span className="inline-flex items-center gap-0.5 flex-wrap flex-shrink-0">
      {Array.from({ length: maxShow }).map((_, i) => (
        <Image
          key={i}
          src={src}
          alt={plateType}
          width={size}
          height={size}
          className="inline-block flex-shrink-0"
          draggable={false}
        />
      ))}
      {remaining > 0 && (
        <span className="text-sm font-semibold opacity-70 ml-0.5">+{remaining}</span>
      )}
    </span>
  );
}
