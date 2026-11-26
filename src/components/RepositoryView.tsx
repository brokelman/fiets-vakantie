import React, { useMemo, useState } from 'react';
import {
  Trophy,
  Star,
  MapPin,
  BedDouble,
  Bath,
  ExternalLink,
  Plus,
  CheckCircle2,
  Search,
  Flame,
  Waves,
  ThermometerSun,
  UtensilsCrossed,
  Route,
  Users,
  Sparkles,
  Bookmark,
} from 'lucide-react';
import {
  FacilityFilter,
  GroupRecord,
  HouseRecord,
  RepoSortOption,
  RepositoryHouseRecord,
} from '../types';
import { HouseIllustration } from './HouseIllustration';

interface RepositoryViewProps {
  repositoryHouses: RepositoryHouseRecord[];
  allGroups: GroupRecord[];
  activeGroupHouses: HouseRecord[];
  activeGroupId: string;
  activeGroupName: string;
  cyclistCount: number;
  canWrite: boolean;
  onAddRepoHouseToGroup: (repoHouse: RepositoryHouseRecord) => Promise<void>;
  onRequireLogin: () => void;
}

export const RepositoryView: React.FC<RepositoryViewProps> = ({
  repositoryHouses,
  allGroups,
  activeGroupHouses,
  activeGroupName,
  cyclistCount,
  canWrite,
  onAddRepoHouseToGroup,
  onRequireLogin,
}) => {
  const [repoSortBy, setRepoSortBy] = useState<RepoSortOption>('rating_desc');
  const [facilityFilter, setFacilityFilter] = useState<FacilityFilter>('alle');
  const [chosenFilter, setChosenFilter] = useState<'alle' | 'alleen_uitverkozen'>('alle');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [addingId, setAddingId] = useState<string | null>(null);

  // Determine whether a repository house is currently the chosen winner of its source group
  const isHouseChosenByGroup = (item: RepositoryHouseRecord): boolean => {
    const groupObj = allGroups.find(
      (g) => g.tripId === item.sourceGroupId || g.id === item.sourceGroupId
    );
    if (groupObj && groupObj.chosenHouseId) {
      return groupObj.chosenHouseId === item.sourceHouseId;
    }
    return Boolean(item.isChosen);
  };

  const chosenCount = useMemo(() => {
    return repositoryHouses.filter((item) => isHouseChosenByGroup(item)).length;
  }, [repositoryHouses, allGroups]);

  const filteredAndSortedRepoHouses = useMemo(() => {
    return repositoryHouses
      .filter((item) => {
        const isChosen = isHouseChosenByGroup(item);
        if (chosenFilter === 'alleen_uitverkozen' && !isChosen) return false;
        if (facilityFilter === 'bbq' && !item.hasBbq) return false;
        if (facilityFilter === 'openhaard' && !item.hasFireplace) return false;
        if (facilityFilter === 'jacuzzi' && !item.hasJacuzzi) return false;
        if (facilityFilter === 'sauna' && !item.hasSauna) return false;

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchTitle = item.title.toLowerCase().includes(q);
          const matchLoc = item.locationName.toLowerCase().includes(q);
          const matchGroup = item.sourceGroupName.toLowerCase().includes(q);
          const matchReview = item.reviewText.toLowerCase().includes(q);
          const matchNotes = item.notes.toLowerCase().includes(q);
          if (!matchTitle && !matchLoc && !matchGroup && !matchReview && !matchNotes) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const chosenA = isHouseChosenByGroup(a) ? 1 : 0;
        const chosenB = isHouseChosenByGroup(b) ? 1 : 0;

        if (repoSortBy === 'rating_desc') {
          if (chosenB !== chosenA) return chosenB - chosenA;
          if (b.ratingStars !== a.ratingStars) return b.ratingStars - a.ratingStars;
          return a.totalPrice - b.totalPrice;
        }
        if (repoSortBy === 'prijs_oplopend') {
          return a.totalPrice - b.totalPrice;
        }
        if (repoSortBy === 'prijs_aflopend') {
          return b.totalPrice - a.totalPrice;
        }
        if (repoSortBy === 'slaapkamers_desc') {
          if (b.bedrooms !== a.bedrooms) return b.bedrooms - a.bedrooms;
          return b.ratingStars - a.ratingStars;
        }
        // 'nieuwste'
        return (b.updatedAt || '').localeCompare(a.updatedAt || '');
      });
  }, [repositoryHouses, allGroups, repoSortBy, facilityFilter, chosenFilter, searchQuery]);

  const isAlreadyInActiveGroup = (repoHouse: RepositoryHouseRecord): boolean => {
    return activeGroupHouses.some(
      (h) =>
        h.id === repoHouse.sourceHouseId ||
        (h.url.trim().toLowerCase() === repoHouse.url.trim().toLowerCase() &&
          h.title.trim().toLowerCase() === repoHouse.title.trim().toLowerCase())
    );
  };

  const handleImportClick = async (repoHouse: RepositoryHouseRecord) => {
    if (!canWrite) {
      onRequireLogin();
      return;
    }
    setAddingId(repoHouse.id);
    try {
      await onAddRepoHouseToGroup(repoHouse);
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-lg border border-slate-700/80">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-400/30 text-amber-300 text-xs font-extrabold uppercase tracking-wider">
              <Trophy className="w-3.5 h-3.5" />
              Alle Gevonden & Uitverkozen Huisjes van Alle Fietsgroepen
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Centrale Huisjes-Repository ({repositoryHouses.length})
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              Hier staan <strong>alle bij elkaar gezochte vakantiehuizen van alle groepen</strong> verzameld. Huisjes die door een groep daadwerkelijk zijn gekozen hebben de gouden indicator{' '}
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/30 text-amber-200 font-bold text-xs">
                🏆 Uitverkozen door groep
              </span>
              . Voeg elk huisje met één klik toe aan de lijst van{' '}
              <strong className="text-white">{activeGroupName}</strong>.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2.5 shrink-0">
            <div className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl px-3.5 py-3 text-center">
              <span className="text-2xl font-extrabold text-white block">
                {repositoryHouses.length}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
                Totaal in repo
              </span>
            </div>
            <div className="bg-amber-500/20 backdrop-blur-sm border border-amber-400/30 rounded-2xl px-3.5 py-3 text-center">
              <span className="text-2xl font-extrabold text-amber-300 block">
                {chosenCount}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-200">
                🏆 Uitverkozen
              </span>
            </div>
            <div className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl px-3.5 py-3 text-center">
              <span className="text-2xl font-extrabold text-emerald-400 block">
                {repositoryHouses.length > 0
                  ? (
                      repositoryHouses.reduce((acc, h) => acc + h.ratingStars, 0) /
                      repositoryHouses.length
                    ).toFixed(1)
                  : '—'}{' '}
                ★
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
                Gem. score
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter & Multi-Sort Toolbar */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Zoek op naam, regio, groep of trefwoord in reviews..."
              className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Chosen vs All Filter */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setChosenFilter('alle')}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                  chosenFilter === 'alle'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Alle huisjes ({repositoryHouses.length})
              </button>
              <button
                type="button"
                onClick={() => setChosenFilter('alleen_uitverkozen')}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                  chosenFilter === 'alleen_uitverkozen'
                    ? 'bg-amber-500 text-white shadow-2xs'
                    : 'text-amber-800 hover:text-amber-950'
                }`}
              >
                <Trophy className="w-3.5 h-3.5" />
                Alleen uitverkozen ({chosenCount})
              </button>
            </div>

            <select
              value={repoSortBy}
              onChange={(e) => setRepoSortBy(e.target.value as RepoSortOption)}
              className="text-xs font-bold bg-slate-100 text-slate-800 border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500 cursor-pointer"
            >
              <option value="rating_desc">Uitverkozen & hoogste sterren eerst (★ 5 → 1)</option>
              <option value="prijs_oplopend">Prijs: laag naar hoog (€)</option>
              <option value="prijs_aflopend">Prijs: hoog naar laag (€)</option>
              <option value="slaapkamers_desc">Meeste slaapkamers</option>
              <option value="nieuwste">Nieuwste toevoegingen eerst</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="text-xs font-semibold text-slate-400 mr-1 shrink-0">Faciliteiten:</span>
          {[
            { id: 'alle', label: 'Alle faciliteiten' },
            { id: 'bbq', label: 'BBQ plaats' },
            { id: 'openhaard', label: 'Open haard' },
            { id: 'jacuzzi', label: 'Jacuzzi' },
            { id: 'sauna', label: 'Sauna' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFacilityFilter(f.id as FacilityFilter)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition cursor-pointer shrink-0 ${
                facilityFilter === f.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Repository Cards Grid */}
      {filteredAndSortedRepoHouses.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-10 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto">
            <Trophy className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-extrabold text-slate-900">
            {repositoryHouses.length === 0
              ? 'Nog geen huisjes in de Centrale Repository'
              : 'Geen huisjes gevonden met deze filter'}
          </h3>
          <p className="text-sm text-slate-600 max-w-lg mx-auto">
            {repositoryHouses.length === 0
              ? 'Alle bij elkaar gezochte huisjes van alle groepen worden hier automatisch verzameld.'
              : 'Pas je zoekopdracht of filter aan om alle verzamelde groepshuisjes te zien.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filteredAndSortedRepoHouses.map((repoHouse) => {
            const alreadyInGroup = isAlreadyInActiveGroup(repoHouse);
            const isChosenWinner = isHouseChosenByGroup(repoHouse);
            const perPersonWeekend = Math.round(repoHouse.totalPrice / Math.max(1, cyclistCount));

            return (
              <div
                key={repoHouse.id}
                className={`bg-white rounded-3xl border transition overflow-hidden flex flex-col ${
                  isChosenWinner
                    ? 'border-2 border-amber-500 ring-2 ring-amber-400/20 shadow-md'
                    : 'border-slate-200/90 shadow-xs hover:shadow-md'
                }`}
              >
                {/* Top Chosen Winner Ribbon if chosen by the group */}
                {isChosenWinner && (
                  <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white px-4 py-2 text-xs font-extrabold flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Trophy className="w-4 h-4 text-white shrink-0" />
                      <span>UITVERKOZEN DOOR {repoHouse.sourceGroupName.toUpperCase()} 🏆</span>
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-white/20 text-[10px] uppercase tracking-wider">
                      Winnend groepshuisje
                    </span>
                  </div>
                )}

                {/* Illustration / Photo Top */}
                <div className="relative h-48 bg-slate-100 overflow-hidden">
                  <HouseIllustration
                    id={repoHouse.sourceHouseId}
                    title={repoHouse.title}
                    locationName={repoHouse.locationName}
                    photoUrl={repoHouse.photoUrl}
                    isFavorite={isChosenWinner}
                    lat={repoHouse.lat}
                    lng={repoHouse.lng}
                  />

                  {/* Top Badges */}
                  <div className="absolute top-3 left-3 right-3 flex items-center justify-between gap-2">
                    {isChosenWinner ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-extrabold bg-amber-500 text-white shadow-sm">
                        <Trophy className="w-3.5 h-3.5 text-white" />
                        Uitverkozen door: {repoHouse.sourceGroupName}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-900/80 text-slate-100 backdrop-blur-md shadow-sm">
                        <Bookmark className="w-3.5 h-3.5 text-orange-400" />
                        Gevonden door: {repoHouse.sourceGroupName}
                      </span>
                    )}

                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-extrabold bg-slate-900/85 text-amber-400 backdrop-blur-md shadow-sm">
                      {Array.from({ length: repoHouse.ratingStars }).map((_, idx) => (
                        <Star key={idx} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      ))}
                      <span className="ml-1 text-white">{repoHouse.ratingStars}/5</span>
                    </span>
                  </div>

                  {/* Price overlay */}
                  <div className="absolute bottom-3 right-3 bg-white/95 backdrop-blur-md px-3 py-1.5 rounded-xl shadow-sm border border-slate-200/80 text-right">
                    <span className="text-sm font-extrabold text-slate-900 block">
                      €{repoHouse.totalPrice.toLocaleString('nl-NL')}{' '}
                      <span className="text-[11px] font-semibold text-slate-500">/ weekend</span>
                    </span>
                    <span className="text-[11px] font-bold text-orange-600 block">
                      ≈ €{perPersonWeekend} p.p. (bij {cyclistCount} renners)
                    </span>
                  </div>
                </div>

                {/* Card Body */}
                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-lg font-extrabold text-slate-900 leading-snug">
                          {repoHouse.title}
                        </h3>
                        <a
                          href={repoHouse.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-bold text-orange-600 hover:text-orange-700 shrink-0"
                        >
                          Bekijk site
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                      <p className="text-xs font-semibold text-slate-500 flex items-center gap-1 mt-0.5">
                        <MapPin className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                        {repoHouse.locationName}
                      </p>
                    </div>

                    {/* Specs & Facilities */}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-bold">
                        <BedDouble className="w-3.5 h-3.5 text-slate-500" />
                        {repoHouse.bedrooms} slaapkamers
                      </span>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-bold">
                        <Bath className="w-3.5 h-3.5 text-slate-500" />
                        {repoHouse.bathrooms} badkamers
                      </span>
                      {repoHouse.hasBbq && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-50 text-orange-800 font-bold">
                          <UtensilsCrossed className="w-3.5 h-3.5" /> BBQ
                        </span>
                      )}
                      {repoHouse.hasFireplace && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-800 font-bold">
                          <Flame className="w-3.5 h-3.5" /> Open haard
                        </span>
                      )}
                      {repoHouse.hasJacuzzi && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 text-sky-800 font-bold">
                          <Waves className="w-3.5 h-3.5" /> Jacuzzi
                        </span>
                      )}
                      {repoHouse.hasSauna && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 text-rose-800 font-bold">
                          <ThermometerSun className="w-3.5 h-3.5" /> Sauna
                        </span>
                      )}
                    </div>

                    {/* Group Review or Proposal Context Box */}
                    <div
                      className={`rounded-2xl p-3.5 space-y-1.5 border ${
                        isChosenWinner
                          ? 'bg-amber-50/80 border-amber-300'
                          : 'bg-slate-50 border-slate-200/80'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-[11px] font-extrabold uppercase tracking-wider flex items-center gap-1 ${
                            isChosenWinner ? 'text-amber-900' : 'text-slate-700'
                          }`}
                        >
                          <Sparkles
                            className={`w-3.5 h-3.5 ${
                              isChosenWinner ? 'text-amber-600' : 'text-slate-500'
                            }`}
                          />
                          {isChosenWinner
                            ? `Uitverkozen door ${repoHouse.sourceGroupName}`
                            : `Voorstel uit groepslijst ${repoHouse.sourceGroupName}`}
                        </span>
                        <span
                          className={`text-[11px] font-semibold ${
                            isChosenWinner ? 'text-amber-800' : 'text-slate-500'
                          }`}
                        >
                          Door {repoHouse.reviewerName}
                        </span>
                      </div>
                      <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-line">
                        “{repoHouse.reviewText}”
                      </p>
                    </div>

                    {repoHouse.notes && (
                      <p className="text-xs text-slate-500 line-clamp-2">
                        <strong className="text-slate-700">Klimmen & Omgeving:</strong>{' '}
                        {repoHouse.notes}
                      </p>
                    )}
                  </div>

                  {/* Bottom Action Bar: 1-Click Add to Own Group List */}
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                    {repoHouse.routeUrl ? (
                      <a
                        href={repoHouse.routeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900"
                      >
                        <Route className="w-3.5 h-3.5 text-orange-600" />
                        Fietsroute
                      </a>
                    ) : (
                      <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
                        <Users className="w-3.5 h-3.5" />
                        {isChosenWinner ? 'Uitverkozen huisje' : 'Kandidaat-huisje'}
                      </span>
                    )}

                    {alreadyInGroup ? (
                      <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        Staat al in lijst van {activeGroupName}
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={addingId === repoHouse.id}
                        onClick={() => handleImportClick(repoHouse)}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-extrabold bg-orange-600 hover:bg-orange-500 text-white shadow-xs transition cursor-pointer disabled:opacity-50"
                      >
                        <Plus className="w-4 h-4" />
                        {addingId === repoHouse.id
                          ? 'Toevoegen...'
                          : `Toevoegen aan ${activeGroupName}`}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

