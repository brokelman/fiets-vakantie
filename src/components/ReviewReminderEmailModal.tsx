import React, { useEffect, useState } from 'react';
import {
  Mail,
  Send,
  X,
  Calendar,
  Trophy,
  Users,
  CheckCircle2,
  AlertCircle,
  BellRing,
} from 'lucide-react';
import { GroupRecord, UserAccountRecord } from '../types';
import {
  formatIsoDateDutch,
  getReviewReminderDueDate,
} from '../utils/dateUtils';

interface ReviewReminderEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  group: GroupRecord;
  groupMembers: UserAccountRecord[];
  onConfirmSendEmail: (payload: {
    groupId: string;
    toEmails: string[];
    subject: string;
    bodyText: string;
  }) => Promise<void>;
}

export const ReviewReminderEmailModal: React.FC<ReviewReminderEmailModalProps> = ({
  isOpen,
  onClose,
  group,
  groupMembers,
  onConfirmSendEmail,
}) => {
  const validMemberEmails = Array.from(
    new Set(
      groupMembers
        .map((m) => (m.email || '').trim().toLowerCase())
        .filter((e) => e.includes('@') && !e.endsWith('@kopgroep27.nl'))
    )
  );

  const appUrl =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://supermannen.netlify.app';

  const houseName = group.chosenHouseTitle || 'ons gekozen vakantiehuis';
  const dueDateYmd = getReviewReminderDueDate(group.startDate, group.endDate);
  const dueDateLabel = formatIsoDateDutch(dueDateYmd, true);

  const defaultSubject = `Oproep aan ${group.name}: Schrijf je review & sterrenbeoordeling voor ${houseName}!`;
  const defaultBody = `Hoi allemaal van ${group.name},

Ons fietsweekend (${group.periodLabel}) zit er inmiddels een week op! We verbleven dit keer in ons gekozen huisje: "${houseName}".

Om onze ervaringen te bewaren voor volgende jaren én te delen in de Centrale Repository voor alle fietsgroepen, roepen we iedereen op om een korte review en sterrenbeoordeling (1 t/m 5 sterren) achter te laten:

1. Ga naar de app: ${appUrl}
2. Log in bij onze groep "${group.name}"
3. Klik bij "${houseName}" op "Gekozen & Review" (of bekijk de Centrale Repository) en deel jouw beoordeling over het huisje, de fietsenstalling, bedden en faciliteiten.

Alvast bedankt voor je review!

Sportieve groet,
${group.name}`;

  const [recipientsInput, setRecipientsInput] = useState(validMemberEmails.join(', '));
  const [subject, setSubject] = useState(defaultSubject);
  const [bodyText, setBodyText] = useState(defaultBody);
  const [isSending, setIsSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setRecipientsInput(validMemberEmails.join(', '));
      setSubject(defaultSubject);
      setBodyText(defaultBody);
      setErrorMsg(null);
      setIsSending(false);
    }
  }, [isOpen, group.tripId, group.chosenHouseTitle, validMemberEmails.join(',')]);

  if (!isOpen) return null;

  const parsedEmails = Array.from(
    new Set(
      recipientsInput
        .split(/[,;\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes('@'))
    )
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedEmails.length === 0) {
      setErrorMsg('Vul minimaal één geldig e-mailadres van een groepslid in.');
      return;
    }
    if (!subject.trim() || !bodyText.trim()) {
      setErrorMsg('Onderwerp en berichttekst mogen niet leeg zijn.');
      return;
    }

    setErrorMsg(null);
    setIsSending(true);
    try {
      await onConfirmSendEmail({
        groupId: group.tripId,
        toEmails: parsedEmails,
        subject: subject.trim(),
        bodyText: bodyText.trim(),
      });
      onClose();
    } catch (err: any) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Het versturen van de review-herinneringsmail via Gmail is niet gelukt.'
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-reminder-modal-title"
    >
      <div className="bg-white rounded-3xl max-w-2xl w-full border border-slate-200 shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white px-6 py-5 flex items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-orange-500/20 border border-orange-400/30 text-orange-300 text-[11px] font-extrabold uppercase tracking-wider">
              <BellRing className="w-3.5 h-3.5" />
              Review-oproep (1 week na vakantie)
            </div>
            <h2
              id="review-reminder-modal-title"
              className="text-lg sm:text-xl font-extrabold tracking-tight"
            >
              Bevestig verzending review-mail naar {group.name}
            </h2>
            <p className="text-xs text-slate-300">
              Controleer de ontvangers en inhoud voordat de e-mail namens jouw Google-account via Gmail wordt verzonden.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-slate-200 transition cursor-pointer shrink-0"
            aria-label="Sluiten"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Context summary pill */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-slate-50 border border-slate-200 rounded-2xl p-3.5 text-xs">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-500 shrink-0" />
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Gekozen huisje
                </span>
                <span className="font-extrabold text-slate-900 truncate block">
                  {houseName}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-orange-600 shrink-0" />
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  1 week na afloop
                </span>
                <span className="font-extrabold text-slate-900 truncate block">
                  {dueDateLabel || group.periodLabel}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-600 shrink-0" />
              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Groepsleden
                </span>
                <span className="font-extrabold text-slate-900 truncate block">
                  {parsedEmails.length} ontvanger(s)
                </span>
              </div>
            </div>
          </div>

          {/* Recipients */}
          <div>
            <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-600 mb-1">
              Aan (alle groepsleden van {group.name}, gescheiden door komma) *
            </label>
            <input
              type="text"
              value={recipientsInput}
              onChange={(e) => setRecipientsInput(e.target.value)}
              placeholder="lid1@voorbeeld.nl, lid2@voorbeeld.nl"
              className="w-full px-3.5 py-2.5 text-xs font-semibold bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white"
              required
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Gevonden leden in {group.name}:{' '}
              {groupMembers.map((m) => `${m.displayName} (${m.email})`).join(' · ') || 'Geen'}
            </p>
          </div>

          {/* Subject */}
          <div>
            <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-600 mb-1">
              Onderwerp *
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs font-bold bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white"
              required
            />
          </div>

          {/* Message Body */}
          <div>
            <label className="block text-xs font-extrabold uppercase tracking-wider text-slate-600 mb-1">
              E-mailbericht (oproep om review & sterren te geven) *
            </label>
            <textarea
              rows={9}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs leading-relaxed bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white"
              required
            />
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSending}
              className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
            >
              Annuleren
            </button>
            <button
              type="submit"
              disabled={isSending}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-extrabold bg-[#FC4C02] hover:bg-[#E04300] text-white shadow-sm transition cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              {isSending
                ? 'Bezig met versturen via Gmail...'
                : `Bevestig & Verstuur e-mail naar ${parsedEmails.length} groepsleden`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
