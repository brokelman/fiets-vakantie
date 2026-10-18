import React, { useState } from 'react';
import { Bike, Mountain, Compass } from 'lucide-react';

interface HouseIllustrationProps {
  id: string;
  title: string;
  locationName: string;
  photoUrl?: string;
  isFavorite?: boolean;
  lat?: number;
  lng?: number;
}

/**
 * Resilient architectural & topographic cycling illustration component.
 * Renders user photoUrl if provided (with referrerPolicy="no-referrer" and automatic fallback on error),
 * or a bespoke Rapha/Strava-inspired topographic elevation & chalet illustration tailored to the house region.
 */
export const HouseIllustration: React.FC<HouseIllustrationProps> = ({
  id,
  title,
  locationName,
  photoUrl,
  lat,
  lng,
}) => {
  const [imageError, setImageError] = useState(false);

  const hasValidPhoto = Boolean(photoUrl && photoUrl.trim().length > 7 && !imageError);

  // Pick a distinct topographic & architectural theme based on region or house id
  const lowerLoc = `${id} ${locationName} ${title}`.toLowerCase();
  const isLimburg = lowerLoc.includes('limburg') || lowerLoc.includes('epen') || lowerLoc.includes('valkenburg');
  const isEifel = lowerLoc.includes('eifel') || lowerLoc.includes('monschau') || lowerLoc.includes('rursee');
  const isStavelot = lowerLoc.includes('stavelot') || lowerLoc.includes('stockeu') || lowerLoc.includes('redoute');

  const gradientClass = isLimburg
    ? 'from-[#1E293B] via-[#27374D] to-[#334155]'
    : isEifel
    ? 'from-[#0F172A] via-[#1E3A3A] to-[#1E293B]'
    : isStavelot
    ? 'from-[#18181B] via-[#27272A] to-[#3F3F46]'
    : 'from-[#0F172A] via-[#1E293B] to-[#334155]';

  const elevationLabel = isLimburg
    ? 'HEUVELLAND · MAX 19% (KEUTENBERG)'
    : isEifel
    ? 'HOHE EIFEL · RURSEE PANORAMA'
    : isStavelot
    ? 'CÔTE DE STOCKEU · 12.5% GEM.'
    : 'COL DE HAUSSIRE · 498M ALT.';

  return (
    <div className={`relative w-full h-48 overflow-hidden bg-gradient-to-br ${gradientClass} select-none`}>
      {hasValidPhoto ? (
        <img
          src={photoUrl}
          alt={title}
          referrerPolicy="no-referrer"
          onError={() => setImageError(true)}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <svg
          viewBox="0 0 600 320"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full object-cover"
          aria-hidden="true"
        >
          {/* Topographic contour lines */}
          <path
            d="M-40 90 C 120 40, 260 130, 420 70 C 510 35, 580 80, 650 55"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1.5"
          />
          <path
            d="M-40 130 C 140 70, 280 165, 440 95 C 520 60, 580 110, 650 85"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1.5"
          />
          <path
            d="M-40 175 C 110 115, 290 195, 450 130 C 530 95, 590 140, 650 120"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="1.5"
          />

          {/* Distant mountain / hill ridge */}
          <path
            d="M0 240 L110 155 L215 205 L350 115 L485 185 L600 130 L600 320 L0 320 Z"
            fill="rgba(15, 23, 42, 0.45)"
          />

          {/* Winding Strava-orange Col / Climb road ribbon */}
          <path
            d="M 75 320 C 135 275, 210 275, 255 245 C 295 218, 225 198, 275 175 C 325 152, 390 168, 435 142"
            stroke="#FC4C02"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray="1 0"
            opacity="0.85"
          />

          {/* Architectural Chalet / Farmhouse Silhouette */}
          <g transform="translate(380, 108)">
            {/* Roof & Gable */}
            <path
              d="M10 58 L65 12 L120 58 L108 58 L108 106 L22 106 L22 58 Z"
              fill="#0F172A"
              stroke="rgba(255,255,255,0.28)"
              strokeWidth="2"
            />
            {/* Warm lit chalet windows */}
            <rect x="38" y="62" width="18" height="16" rx="2" fill="#FDBA74" fillOpacity="0.85" />
            <rect x="64" y="62" width="24" height="16" rx="2" fill="#FDBA74" fillOpacity="0.65" />
            <rect x="52" y="36" width="22" height="14" rx="2" fill="#FED7AA" fillOpacity="0.75" />
            {/* Bike shed annex */}
            <path
              d="M108 72 L148 72 L156 106 L108 106 Z"
              fill="#0F172A"
              stroke="rgba(255,255,255,0.22)"
              strokeWidth="1.5"
            />
          </g>

          {/* Elevation Profile Sparkline in bottom foreground */}
          <path
            d="M 0 295 L 65 288 L 130 264 L 185 274 L 255 232 L 325 250 L 410 198 L 485 224 L 555 204 L 600 215 L 600 320 L 0 320 Z"
            fill="rgba(252, 76, 2, 0.14)"
          />
          <path
            d="M 0 295 L 65 288 L 130 264 L 185 274 L 255 232 L 325 250 L 410 198 L 485 224 L 555 204 L 600 215"
            stroke="rgba(255, 255, 255, 0.3)"
            strokeWidth="1.5"
          />
        </svg>
      )}

      {/* Measured contrast scrim for text legibility */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />

      {/* Topographic telemetry line (unboxed clean metadata) */}
      <div className="absolute top-3 left-3.5 right-3.5 flex items-center justify-between text-[11px] font-mono-num text-white/85 pointer-events-none">
        <span className="flex items-center gap-1.5 truncate">
          <Mountain className="w-3.5 h-3.5 text-[#FC4C02] shrink-0" />
          <span className="truncate">{elevationLabel}</span>
        </span>
        {typeof lat === 'number' && typeof lng === 'number' && (
          <span className="hidden sm:inline-flex items-center gap-1 text-white/75 shrink-0">
            <Compass className="w-3 h-3" />
            {lat.toFixed(3)}°N, {lng.toFixed(3)}°E
          </span>
        )}
      </div>

      {/* Bottom location & cyclist icon overlay */}
      <div className="absolute bottom-3 left-3.5 right-3.5 flex items-end justify-between gap-2 pointer-events-none">
        <div className="min-w-0">
          <p className="text-xs text-white/80 truncate">{locationName}</p>
        </div>
        <div className="flex items-center gap-1 text-xs font-mono-num text-white/90 shrink-0">
          <Bike className="w-3.5 h-3.5 text-[#FC4C02]" />
          <span>3 nachten</span>
        </div>
      </div>
    </div>
  );
};
