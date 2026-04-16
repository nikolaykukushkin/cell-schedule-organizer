'use client';

import Image from 'next/image';
import { PlateType } from '@/types';

interface PlateVisualProps {
  plateType: PlateType;
  count: number;
  size?: number;
}

const WELL_PLATE_SVGS: Record<string, string> = {
  '6': '/plates/well-plate-6.svg',
  '8': '/plates/well-plate-8.svg',
  '12': '/plates/well-plate-12.svg',
  '24': '/plates/well-plate-24.svg',
};

function getImageSrc(plateType: PlateType): string {
  if (plateType.endsWith('well')) {
    const n = plateType.replace('-well', '');
    return WELL_PLATE_SVGS[n] || '/plates/well-plate.svg';
  }
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
