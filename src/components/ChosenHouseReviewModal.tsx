import React, { useEffect, useState } from 'react';
import { Trophy, Star, X, MapPin, BedDouble, Bath, CheckCircle2 } from 'lucide-react';
import { HouseRecord, RepositoryHouseRecord } from '../types';

interface ChosenHouseReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  house: HouseRecord | null;
  activeGroupName: string;
  existingRepoEntry: RepositoryHouseRecord | null;
  defaultReviewerName: string;
  onSaveChosenAndReview: (payload: {
    house: HouseRecord;
    ratingStars: number;
    reviewText: string;
    reviewerName: string;
  }) => Promise<void>;
}

export const ChosenHouseReviewModal: React.FC<ChosenHouseReviewModalProps> = ({
  isOpen,
  onClose,
  house,
  activeGroupName,
  existingRepoEntry,
  defaultReviewerName,
  onSaveChosenAndReview,
}) => {
  const [ratingStars, setRatingStars] = useState<number>(5);
  const [reviewText, setReviewText] = useState<string>('');
  const [reviewerName, setReviewerName] = useState<string>(defaultReviewerName);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  useEffect(() => {
    if (house && isOpen) {
      setRatingStars(existingRepoEntry ? existingRepoEntry.ratingStars : 5);
      setReviewText(
        existingRepoEntry
          ? existingRepoEntry.reviewText
          : house.notes
          ? `Top uitvalsbasis voor ${activeGroupName}! ${house.notes}`
          : `Gekozen als ons huisje voor ${activeGroupName}!`
      );
      setReviewerName(
        existingRepoEntry
          ? existingRepoEntry.reviewerName
          : defaultReviewerName || 'Groepslid'
      );
      setError(null);
    }
  }, [house, isOpen, existingRepoEntry, activeGroupName, defaultReviewerName]);

  if (!isOpen || !house) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanReview =
      reviewText.trim() || `Gekozen als ons huisje voor ${activeGroupName}!`;
    const cleanReviewer = reviewerName.trim() || defaultReviewerName || 'Groepslid';

    setError(null);
    setIsSaving(true);
    try {
      await onSaveChosenAndReview({
        house,
        ratingStars,
        reviewText: cleanReview.slice(0, 1200),
        reviewerName: cleanReviewer.slice(0, 60),
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Opslaan van gekozen huisje & review is niet gelukt.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-xl w-full shadow-2xl border border-slate-200 overflow-hidden my-8">
        <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-orange-600 px-6 py-5 text-white flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
              <Trophy className="w-6 h-6 text-white" />
            </div>
            <div>
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-100 block">
                Definitieve keuze & Centrale Repository
              </span>
              <h3 className="text-lg font-extrabold leading-tight">
                Dit huisje is het geworden voor {activeGroupName}!
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition"
            aria-label="Sluiten"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="bg-amber-50/80 border border-amber-200/80 rounded-2xl p-4 flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-extrabold text-slate-900 text-base">{house.title}</h4>
              <span className="text-xs font-extrabold px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900">
                €{house.totalPrice.toLocaleString('nl-NL')} / weekend
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 font-medium">
              <span className="inline-flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-orange-600" />
                {house.locationName}
              </span>
              <span className="inline-flex items-center gap-1">
                <BedDouble className="w-3.5 h-3.5 text-slate-500" />
                {house.bedrooms} slaapkamers
              </span>
              <span className="inline-flex items-center gap-1">
                <Bath className="w-3.5 h-3.5 text-slate-500" />
                {house.bathrooms} badkamers
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
              Eindbeoordeling door jullie groep (1 t/m 5 sterren)
            </label>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => {
                const active = star <= ratingStars;
                return (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRatingStars(star)}
                    className={`flex-1 py-2.5 px-3 rounded-xl border font-extrabold text-sm flex items-center justify-center gap-1.5 transition cursor-pointer ${
                      active
                        ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                        : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Star className={`w-4 h-4 ${active ? 'fill-white text-white' : 'text-slate-400'}`} />
                    {star}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Jullie groepsreview & ervaringen voor andere fietsgroepen
            </label>
            <textarea
              rows={4}
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder="Hoe beviel het huisje? Denk aan veilige fietsenstalling, afspuitplek, bedden, sfeer, BBQ en mooie beklimmingen in de omgeving..."
              className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
              required
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Dit huisje en jullie review worden gepubliceerd in de <strong>Centrale Repository</strong>, zodat alle groepen erin kunnen bladeren en het met één klik aan hun lijst kunnen toevoegen.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">
              Ingediend namens {activeGroupName} door
            </label>
            <input
              type="text"
              value={reviewerName}
              onChange={(e) => setReviewerName(e.target.value)}
              placeholder="Jouw naam"
              className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
              required
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 transition cursor-pointer"
            >
              Annuleren
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-extrabold bg-amber-500 hover:bg-amber-600 text-white shadow-sm transition cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              {isSaving
                ? 'Bezig met opslaan...'
                : existingRepoEntry
                ? 'Keuze & review bijwerken'
                : 'Markeer als gekozen huisje & publiceer review'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
