import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { HouseRecord } from '../types';
import { Compass, Crosshair } from 'lucide-react';

interface LeafletMapProps {
  houses: HouseRecord[];
  cyclistCount: number;
  selectedHouseId: string | null;
  favoriteHouseId: string | null;
  onSelectHouse: (houseId: string) => void;
  pickingMode?: boolean;
  pickedCoords?: { lat: number; lng: number } | null;
  onPickCoords?: (coords: { lat: number; lng: number }) => void;
}

const REGION_PRESETS = [
  { label: 'Overzicht Benelux', lat: 50.48, lng: 5.82, zoom: 8 },
  { label: 'Zuid-Limburg', lat: 50.81, lng: 5.88, zoom: 11 },
  { label: 'Ardennen', lat: 50.28, lng: 5.75, zoom: 10 },
  { label: 'Eifel', lat: 50.56, lng: 6.28, zoom: 10 },
];

export const LeafletMap: React.FC<LeafletMapProps> = ({
  houses,
  cyclistCount,
  selectedHouseId,
  favoriteHouseId,
  onSelectHouse,
  pickingMode = false,
  pickedCoords = null,
  onPickCoords,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});
  const pickMarkerRef = useRef<L.Marker | null>(null);

  // Initialize Leaflet map once
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [50.48, 5.82],
      zoom: 8,
      zoomControl: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(map);

    mapInstanceRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Handle click on map when picking coordinates
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const handleMapClick = (e: L.LeafletMouseEvent) => {
      if (onPickCoords) {
        onPickCoords({
          lat: Number(e.latlng.lat.toFixed(5)),
          lng: Number(e.latlng.lng.toFixed(5)),
        });
      }
    };

    map.on('click', handleMapClick);
    return () => {
      map.off('click', handleMapClick);
    };
  }, [onPickCoords]);

  // Render picked coordinate pin if present
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (pickMarkerRef.current) {
      pickMarkerRef.current.remove();
      pickMarkerRef.current = null;
    }

    if (pickedCoords) {
      const pickIcon = L.divIcon({
        className: 'custom-pick-pin',
        html: `
          <div style="
            display:flex;
            align-items:center;
            justify-content:center;
            width:34px;
            height:34px;
            border-radius:9999px;
            background:#FC4C02;
            color:#FFFFFF;
            border:3px solid #FFFFFF;
            box-shadow:0 6px 16px rgba(252,76,2,0.45);
            font-weight:700;
            font-size:14px;
          ">+</div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      });

      pickMarkerRef.current = L.marker([pickedCoords.lat, pickedCoords.lng], {
        icon: pickIcon,
      }).addTo(map);
    }
  }, [pickedCoords]);

  // Render house markers & popups
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear existing markers
    Object.values(markersRef.current).forEach((m) => m.remove());
    markersRef.current = {};

    houses.forEach((house) => {
      const pricePerPerson = Math.round(house.totalPrice / Math.max(1, cyclistCount));
      const pricePerNightPP = Math.round(pricePerPerson / 3);
      const isFavorite = house.id === favoriteHouseId && house.voteScore > 0;
      const isSelected = house.id === selectedHouseId;

      const bgColor = isSelected ? '#FC4C02' : isFavorite ? '#0F172A' : '#FFFFFF';
      const textColor = isSelected || isFavorite ? '#FFFFFF' : '#0F172A';
      const borderColor = isSelected ? '#FFFFFF' : isFavorite ? '#FC4C02' : '#0F172A';

      const markerHtml = `
        <div style="
          display:inline-flex;
          align-items:center;
          gap:5px;
          padding:5px 10px;
          border-radius:8px;
          background:${bgColor};
          color:${textColor};
          border:2px solid ${borderColor};
          box-shadow:0 6px 16px rgba(15,23,42,0.22);
          font-family:'JetBrains Mono', monospace;
          font-size:12px;
          font-weight:700;
          white-space:nowrap;
          transform:${isSelected ? 'scale(1.08)' : 'scale(1)'};
          transition:transform 150ms ease;
        ">
          ${isFavorite ? '<span style="color:#F59E0B;">★</span>' : ''}
          <span>€${pricePerPerson} p.p.</span>
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'custom-house-marker',
        html: markerHtml,
        iconSize: [96, 32],
        iconAnchor: [48, 16],
        popupAnchor: [0, -18],
      });

      const marker = L.marker([house.lat, house.lng], { icon: customIcon }).addTo(map);

      const safeTitle = house.title.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeLoc = house.locationName.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const safeAddedBy = house.addedBy.replace(/</g, '&lt;').replace(/>/g, '&gt;');

      const extrasList: string[] = [];
      if (house.hasBbq) extrasList.push('BBQ plaats');
      if (house.hasFireplace) extrasList.push('Open haard');
      if (house.hasJacuzzi) extrasList.push('Jacuzzi');
      if (house.hasSauna) extrasList.push('Sauna');
      const extrasText = extrasList.length > 0 ? extrasList.join(' · ') : 'Geen extra’s opgegeven';

      const popupContent = document.createElement('div');
      popupContent.className = 'p-4 bg-white text-slate-900';
      popupContent.innerHTML = `
        <div class="text-[11px] font-medium text-slate-500 mb-1 flex items-center justify-between">
          <span>${safeLoc}</span>
          ${isFavorite ? '<span class="text-[#D97706] font-semibold">★ Groepsfavoriet</span>' : ''}
        </div>
        <h4 class="text-sm font-bold text-slate-900 leading-snug mb-2">${safeTitle}</h4>
        <div class="grid grid-cols-2 gap-2 py-2 px-2.5 bg-slate-50 rounded-md border border-slate-200 mb-2.5 font-mono-num">
          <div>
            <div class="text-[10px] text-slate-500">Prijs p.p. (${cyclistCount} pers.)</div>
            <div class="text-sm font-bold text-[#FC4C02]">€${pricePerPerson} <span class="text-[10px] font-normal text-slate-500">(€${pricePerNightPP}/n)</span></div>
          </div>
          <div>
            <div class="text-[10px] text-slate-500">Totaal weekend</div>
            <div class="text-sm font-semibold text-slate-900">€${house.totalPrice}</div>
          </div>
        </div>
        <div class="flex items-center justify-between text-xs text-slate-600 mb-2">
          <span>${house.bedrooms} slaapkamers · ${house.bathrooms} badkamers</span>
          <span class="font-mono-num font-semibold text-slate-900">${house.voteScore} pt</span>
        </div>
        <div class="text-[11px] text-slate-500 mb-3">
          Extra’s: ${extrasText}
        </div>
        <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <span class="text-[11px] text-slate-500">Door ${safeAddedBy}</span>
          <a
            href="${house.url}"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-[#0F172A] text-white text-xs font-semibold hover:bg-slate-800 transition-colors"
          >
            Bekijk op site ↗
          </a>
        </div>
      `;

      marker.bindPopup(popupContent);

      marker.on('click', () => {
        onSelectHouse(house.id);
      });

      markersRef.current[house.id] = marker;
    });
  }, [houses, cyclistCount, selectedHouseId, favoriteHouseId, onSelectHouse]);

  // Fly to selected house when selectedHouseId changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !selectedHouseId) return;

    const targetHouse = houses.find((h) => h.id === selectedHouseId);
    const marker = markersRef.current[selectedHouseId];
    if (targetHouse && marker) {
      map.flyTo([targetHouse.lat, targetHouse.lng], Math.max(map.getZoom(), 11), {
        duration: 0.6,
      });
      marker.openPopup();
    }
  }, [selectedHouseId, houses]);

  const handleFlyToRegion = (lat: number, lng: number, zoom: number) => {
    if (!mapInstanceRef.current) return;
    mapInstanceRef.current.flyTo([lat, lng], zoom, { duration: 0.6 });
  };

  return (
    <div className="relative w-full h-full flex flex-col bg-slate-100 rounded-xl overflow-hidden border border-slate-200">
      {/* Top map toolbar: Region presets & coordinate picking hint */}
      <div className="z-20 flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="flex items-center gap-1 overflow-x-auto">
          <span className="text-xs font-medium text-slate-500 mr-1.5 flex items-center gap-1 whitespace-nowrap shrink-0">
            <Compass className="w-3.5 h-3.5 text-[#FC4C02]" />
            Regio:
          </span>
          {REGION_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => handleFlyToRegion(preset.lat, preset.lng, preset.zoom)}
              className="px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {preset.label}
            </button>
          ))}
        </div>

        {pickingMode && (
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#FC4C02] whitespace-nowrap shrink-0">
            <Crosshair className="w-3.5 h-3.5" />
            <span>Klik op de kaart om een pin te plaatsen</span>
          </div>
        )}
      </div>

      {/* Map canvas */}
      <div ref={mapContainerRef} className="w-full flex-1 min-h-[240px] sm:min-h-[360px]" />
    </div>
  );
};
