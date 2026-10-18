import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import {
  X,
  Search,
  MapPin,
  Euro,
  BedDouble,
  Bath,
  ShieldCheck,
  Droplets,
  Flame,
  Route,
  User,
  ExternalLink,
  Check,
  AlertCircle,
} from 'lucide-react';
import { HouseRecord } from '../types';
import { VALIDATION_CONSTRAINTS } from '../firebase';

interface AddHouseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddHouse: (newHouseData: Omit<HouseRecord, 'id' | 'tripId' | 'ownerId' | 'voteScore' | 'voteCount' | 'status' | 'createdAt' | 'updatedAt' | 'votes' | 'comments'>) => Promise<void>;
  cyclistCount: number;
  defaultUserName: string;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

export const AddHouseModal: React.FC<AddHouseModalProps> = ({
  isOpen,
  onClose,
  onAddHouse,
  cyclistCount,
  defaultUserName,
}) => {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [locationName, setLocationName] = useState('');
  const [lat, setLat] = useState<number>(50.395);
  const [lng, setLng] = useState<number>(5.9312);
  const [totalPrice, setTotalPrice] = useState<string>('1600');
  const [bedrooms, setBedrooms] = useState<string>('5');
  const [bathrooms, setBathrooms] = useState<string>('3');
  const [hasBikeStorage, setHasBikeStorage] = useState<boolean>(true);
  const [hasBikeWash, setHasBikeWash] = useState<boolean>(true);
  const [hasSaunaJacuzzi, setHasSaunaJacuzzi] = useState<boolean>(false);
  const [routeUrl, setRouteUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [addedBy, setAddedBy] = useState(defaultUserName || 'Jasper');

  const [isSearchingGeo, setIsSearchingGeo] = useState(false);
  const [geoResults, setGeoResults] = useState<NominatimResult[]>([]);
  const [geoMessage, setGeoMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const miniMapContainerRef = useRef<HTMLDivElement | null>(null);
  const miniMapRef = useRef<L.Map | null>(null);
  const pinMarkerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (defaultUserName && !addedBy) {
      setAddedBy(defaultUserName);
    }
  }, [defaultUserName, addedBy]);

  // Initialize interactive mini-map for clicking/dragging pin inside the modal
  useEffect(() => {
    if (!isOpen) {
      if (miniMapRef.current) {
        miniMapRef.current.remove();
        miniMapRef.current = null;
        pinMarkerRef.current = null;
      }
      return;
    }

    const timer = window.setTimeout(() => {
      if (!miniMapContainerRef.current || miniMapRef.current) return;

      const map = L.map(miniMapContainerRef.current, {
        center: [lat, lng],
        zoom: 9,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap',
        maxZoom: 18,
      }).addTo(map);

      const pinIcon = L.divIcon({
        className: 'modal-pin-icon',
        html: `
          <div style="
            display:flex;
            align-items:center;
            justify-content:center;
            width:32px;
            height:32px;
            border-radius:9999px;
            background:#FC4C02;
            color:#FFFFFF;
            border:3px solid #FFFFFF;
            box-shadow:0 6px 14px rgba(252,76,2,0.45);
            font-weight:700;
            font-size:14px;
          ">📍</div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const marker = L.marker([lat, lng], { icon: pinIcon }).addTo(map);
      pinMarkerRef.current = marker;

      map.on('click', (e: L.LeafletMouseEvent) => {
        const clickedLat = Number(e.latlng.lat.toFixed(5));
        const clickedLng = Number(e.latlng.lng.toFixed(5));
        setLat(clickedLat);
        setLng(clickedLng);
        marker.setLatLng([clickedLat, clickedLng]);
        setGeoMessage(`Pin handmatig geplaatst op ${clickedLat}, ${clickedLng}`);
      });

      miniMapRef.current = map;
    }, 60);

    return () => window.clearTimeout(timer);
  }, [isOpen]);

  // Keep marker synced when lat/lng updates from Nominatim search
  useEffect(() => {
    if (miniMapRef.current && pinMarkerRef.current) {
      pinMarkerRef.current.setLatLng([lat, lng]);
    }
  }, [lat, lng]);

  if (!isOpen) return null;

  const handleNominatimSearch = async () => {
    const queryText = locationName.trim();
    if (queryText.length < 2) {
      setGeoMessage('Voer eerst een plaatsnaam, dorp of adres in (bijv. "Houffalize" of "Valkenburg").');
      return;
    }

    setIsSearchingGeo(true);
    setGeoMessage(null);
    setGeoResults([]);

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=4&q=${encodeURIComponent(queryText)}`,
        {
          headers: {
            'Accept-Language': 'nl',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Nominatim zoekopdracht mislukt');
      }

      const data: NominatimResult[] = await response.json();
      if (!data || data.length === 0) {
        setGeoMessage('Geen locatie gevonden. Probeer een ander dorp of klik direct op de kaart hieronder.');
      } else {
        const first = data[0];
        const parsedLat = Number(parseFloat(first.lat).toFixed(5));
        const parsedLng = Number(parseFloat(first.lon).toFixed(5));
        setLat(parsedLat);
        setLng(parsedLng);
        setGeoResults(data);
        setGeoMessage(`Gevonden: ${first.display_name.split(',').slice(0, 2).join(', ')}`);

        if (miniMapRef.current) {
          miniMapRef.current.flyTo([parsedLat, parsedLng], 12, { duration: 0.5 });
        }
      }
    } catch {
      setGeoMessage('Zoeken via OpenStreetMap tijdelijk niet bereikbaar. Klik op de kaart om handmatig een pin te zetten.');
    } finally {
      setIsSearchingGeo(false);
    }
  };

  const handleSelectGeoResult = (res: NominatimResult) => {
    const parsedLat = Number(parseFloat(res.lat).toFixed(5));
    const parsedLng = Number(parseFloat(res.lon).toFixed(5));
    setLat(parsedLat);
    setLng(parsedLng);
    const shortName = res.display_name.split(',').slice(0, 2).join(',').trim();
    setLocationName(shortName.slice(0, VALIDATION_CONSTRAINTS.LOCATION_MAX));
    setGeoResults([]);
    setGeoMessage(`Locatie ingesteld op ${shortName}`);
    if (miniMapRef.current) {
      miniMapRef.current.flyTo([parsedLat, parsedLng], 12, { duration: 0.5 });
    }
  };

  const numericPrice = Math.max(0, Number(totalPrice) || 0);
  const previewPerPerson = Math.round(numericPrice / Math.max(1, cyclistCount));
  const previewPerNightPP = Math.round(previewPerPerson / 3);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanTitle = title.trim().slice(0, VALIDATION_CONSTRAINTS.TITLE_MAX);
    let cleanUrl = url.trim().slice(0, VALIDATION_CONSTRAINTS.URL_MAX);
    if (cleanUrl && !/^https?:\/\//i.test(cleanUrl)) {
      cleanUrl = `https://${cleanUrl}`;
    }

    let cleanPhotoUrl = photoUrl.trim().slice(0, VALIDATION_CONSTRAINTS.URL_MAX);
    if (cleanPhotoUrl && !/^https?:\/\//i.test(cleanPhotoUrl)) {
      cleanPhotoUrl = `https://${cleanPhotoUrl}`;
    }

    let cleanRouteUrl = routeUrl.trim().slice(0, VALIDATION_CONSTRAINTS.URL_MAX);
    if (cleanRouteUrl && !/^https?:\/\//i.test(cleanRouteUrl)) {
      cleanRouteUrl = `https://${cleanRouteUrl}`;
    }

    const cleanLoc = locationName.trim().slice(0, VALIDATION_CONSTRAINTS.LOCATION_MAX);
    const cleanAddedBy = (addedBy.trim() || defaultUserName || 'Groepslid').slice(
      0,
      VALIDATION_CONSTRAINTS.NAME_MAX
    );
    const cleanNotes = notes.trim().slice(0, VALIDATION_CONSTRAINTS.NOTES_MAX);

    const parsedPrice = Number(totalPrice);
    const parsedBeds = Math.round(Number(bedrooms));
    const parsedBaths = Math.round(Number(bathrooms));

    if (cleanTitle.length < VALIDATION_CONSTRAINTS.TITLE_MIN) {
      setFormError('Geef het vakantiehuis een duidelijke naam (minimaal 2 tekens).');
      return;
    }
    if (!VALIDATION_CONSTRAINTS.URL_PATTERN.test(cleanUrl)) {
      setFormError('Voer een geldige link in naar Airbnb, Booking, Belvilla of de website.');
      return;
    }
    if (cleanLoc.length < VALIDATION_CONSTRAINTS.LOCATION_MIN) {
      setFormError('Vul het dorp, de regio of het adres van het huisje in.');
      return;
    }
    if (!parsedPrice || parsedPrice <= 0 || parsedPrice > 50000) {
      setFormError('Vul een realistische totaalprijs in voor het hele weekend (€1 – €50.000).');
      return;
    }
    if (!parsedBeds || parsedBeds < 1 || parsedBeds > 50) {
      setFormError('Vul het aantal slaapkamers in (1 t/m 50).');
      return;
    }
    if (!parsedBaths || parsedBaths < 1 || parsedBaths > 50) {
      setFormError('Vul het aantal badkamers in (1 t/m 50).');
      return;
    }

    setIsSubmitting(true);
    try {
      await onAddHouse({
        title: cleanTitle,
        url: cleanUrl,
        photoUrl: cleanPhotoUrl,
        locationName: cleanLoc,
        lat: Number(lat),
        lng: Number(lng),
        totalPrice: Math.round(parsedPrice),
        bedrooms: parsedBeds,
        bathrooms: parsedBaths,
        hasBikeStorage,
        hasBikeWash,
        hasSaunaJacuzzi,
        routeUrl: cleanRouteUrl,
        notes: cleanNotes,
        addedBy: cleanAddedBy,
      });
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Opslaan mislukt, probeer het opnieuw.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white rounded-xl border border-slate-200 shadow-xl my-auto max-h-[92vh] flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50/70">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">
              Nieuw Vakantiehuis Aandragen
            </h2>
            <p className="text-xs text-slate-500">
              Donderdag 27 mei t/m zondag 30 mei 2027 (3 nachten)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 transition-colors cursor-pointer"
            aria-label="Sluiten"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5 text-sm">
          {formError && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          {/* Row 1: Title & Added By */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Naam / Titel van het huisje *
              </label>
              <input
                type="text"
                required
                maxLength={VALIDATION_CONSTRAINTS.TITLE_MAX}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Bijv. Chalet La Redoute in Remouchamps"
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 focus:border-[#FC4C02] focus:outline-hidden text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Toegevoegd door *
              </label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  required
                  maxLength={VALIDATION_CONSTRAINTS.NAME_MAX}
                  value={addedBy}
                  onChange={(e) => setAddedBy(e.target.value)}
                  placeholder="Jouw naam"
                  className="w-full pl-9 pr-3.5 py-2 rounded-lg border border-slate-300 focus:border-[#FC4C02] focus:outline-hidden text-slate-900"
                />
              </div>
            </div>
          </div>

          {/* Row 2: Accommodation Link & Photo URL */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Link naar accommodatie (Airbnb, Booking, Belvilla) *
              </label>
              <div className="relative">
                <ExternalLink className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  required
                  maxLength={VALIDATION_CONSTRAINTS.URL_MAX}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://www.airbnb.nl/rooms/..."
                  className="w-full pl-9 pr-3.5 py-2 rounded-lg border border-slate-300 focus:border-[#FC4C02] focus:outline-hidden text-slate-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Foto URL (optioneel — anders racefiets/chalet illustratie)
              </label>
              <input
                type="text"
                maxLength={VALIDATION_CONSTRAINTS.URL_MAX}
                value={photoUrl}
                onChange={(e) => setPhotoUrl(e.target.value)}
                placeholder="https://.../foto.jpg (optioneel)"
                className="w-full px-3.5 py-2 rounded-lg border border-slate-300 focus:border-[#FC4C02] focus:outline-hidden text-slate-900"
              />
            </div>
          </div>

          {/* Row 3: Location / Nominatim Geocoder + Mini Map Pin Picker */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-end gap-2.5">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Locatie / Dorp / Adres *
                </label>
                <div className="relative">
                  <MapPin className="w-4 h-4 text-[#FC4C02] absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    maxLength={VALIDATION_CONSTRAINTS.LOCATION_MAX}
                    value={locationName}
                    onChange={(e) => setLocationName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleNominatimSearch();
                      }
                    }}
                    placeholder="Bijv. Houffalize, Valkenburg of Malmedy"
                    className="w-full pl-9 pr-3.5 py-2 bg-white rounded-lg border border-slate-300 focus:border-[#FC4C02] focus:outline-hidden text-slate-900"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={handleNominatimSearch}
                disabled={isSearchingGeo}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#0F172A] text-white text-xs font-semibold hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
              >
                <Search className="w-3.5 h-3.5" />
                {isSearchingGeo ? 'Zoeken...' : 'Zoek op kaart'}
              </button>
            </div>

            {/* Nominatim search suggestions */}
            {geoResults.length > 1 && (
              <div className="bg-white rounded-lg border border-slate-200 divide-y divide-slate-100 text-xs">
                {geoResults.map((res) => (
                  <button
                    key={res.place_id}
                    type="button"
                    onClick={() => handleSelectGeoResult(res)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between gap-2 cursor-pointer"
                  >
                    <span className="truncate text-slate-700">{res.display_name}</span>
                    <span className="text-[#FC4C02] font-mono-num shrink-0">Kies pin</span>
                  </button>
                ))}
              </div>
            )}

            {geoMessage && (
              <p className="text-xs text-slate-600 flex items-center justify-between">
                <span>{geoMessage}</span>
                <span className="font-mono-num text-slate-500">
                  {lat.toFixed(4)}°N, {lng.toFixed(4)}°E
                </span>
              </p>
            )}

            {/* Mini interactive map for manual pin placement */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-500">
                <span>Klik direct op de kaart om handmatig de pin te verplaatsen:</span>
                <span className="font-mono-num">
                  GPS: {lat.toFixed(4)}, {lng.toFixed(4)}
                </span>
              </div>
              <div
                ref={miniMapContainerRef}
                className="w-full h-44 rounded-lg border border-slate-300 overflow-hidden"
              />
            </div>
          </div>

          {/* Row 4: Price, Bedrooms, Bathrooms + Live Calculator Preview */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Totaalprijs weekend (€) *
              </label>
              <div className="relative">
                <Euro className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="number"
                  required
                  min={1}
                  max={50000}
                  value={totalPrice}
                  onChange={(e) => setTotalPrice(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2 rounded-lg border border-slate-300 focus:border-[#FC4C02] focus:outline-hidden font-mono-num text-slate-900"
                />
              </div>
              <p className="text-[11px] font-mono-num text-[#FC4C02] mt-1">
                ≈ €{previewPerPerson} p.p. (€{previewPerNightPP}/nacht bij {cyclistCount} pers.)
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Aantal slaapkamers *
              </label>
              <div className="relative">
                <BedDouble className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="number"
                  required
                  min={1}
                  max={50}
                  value={bedrooms}
                  onChange={(e) => setBedrooms(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2 rounded-lg border border-slate-300 focus:border-[#FC4C02] focus:outline-hidden font-mono-num text-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Aantal badkamers *
              </label>
              <div className="relative">
                <Bath className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="number"
                  required
                  min={1}
                  max={50}
                  value={bathrooms}
                  onChange={(e) => setBathrooms(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2 rounded-lg border border-slate-300 focus:border-[#FC4C02] focus:outline-hidden font-mono-num text-slate-900"
                />
              </div>
            </div>
          </div>

          {/* Row 5: Racefiets-checklists (Booleans) */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Racefiets-checklists & Faciliteiten
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setHasBikeStorage((v) => !v)}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  hasBikeStorage
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <ShieldCheck className="w-4 h-4 text-[#FC4C02] shrink-0" />
                  <span className="truncate">Afsluitbare stalling</span>
                </span>
                {hasBikeStorage && <Check className="w-4 h-4 shrink-0" />}
              </button>

              <button
                type="button"
                onClick={() => setHasBikeWash((v) => !v)}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  hasBikeWash
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <Droplets className="w-4 h-4 text-[#FC4C02] shrink-0" />
                  <span className="truncate">Afspuitplek / slang</span>
                </span>
                {hasBikeWash && <Check className="w-4 h-4 shrink-0" />}
              </button>

              <button
                type="button"
                onClick={() => setHasSaunaJacuzzi((v) => !v)}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                  hasSaunaJacuzzi
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className="flex items-center gap-2 truncate">
                  <Flame className="w-4 h-4 text-[#FC4C02] shrink-0" />
                  <span className="truncate">Sauna / Jacuzzi</span>
                </span>
                {hasSaunaJacuzzi && <Check className="w-4 h-4 shrink-0" />}
              </button>
            </div>
          </div>

          {/* Row 6: Route URL & Notes */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Link naar een fietsroute in de buurt (optioneel — Strava of Komoot)
            </label>
            <div className="relative">
              <Route className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                maxLength={VALIDATION_CONSTRAINTS.URL_MAX}
                value={routeUrl}
                onChange={(e) => setRouteUrl(e.target.value)}
                placeholder="https://www.strava.com/routes/... of https://www.komoot.com/..."
                className="w-full pl-9 pr-3.5 py-2 rounded-lg border border-slate-300 focus:border-[#FC4C02] focus:outline-hidden text-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Toelichting / Opmerkingen & Beklimmingen in de buurt
            </label>
            <textarea
              rows={3}
              maxLength={VALIDATION_CONSTRAINTS.NOTES_MAX}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Bijv. Ligt aan de voet van La Redoute, grote garage voor 10 fietsen, 8 losse bedden..."
              className="w-full px-3.5 py-2 rounded-lg border border-slate-300 focus:border-[#FC4C02] focus:outline-hidden text-slate-900"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Annuleren
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-lg bg-[#FC4C02] text-white text-xs font-semibold hover:bg-[#E04300] transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? 'Bezig met opslaan...' : 'Huisje Toevoegen aan Kaart'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
