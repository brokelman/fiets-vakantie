import React, { useState } from 'react';
import { X, Copy, Check, MessageCircle, Link2, Sparkles } from 'lucide-react';
import { HouseRecord } from '../types';

interface ShareDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  houses: HouseRecord[];
  cyclistCount: number;
}

export const ShareDataModal: React.FC<ShareDataModalProps> = ({
  isOpen,
  onClose,
  houses,
  cyclistCount,
}) => {
  const [copiedWhatsApp, setCopiedWhatsApp] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  if (!isOpen) return null;

  const sortedHouses = [...houses].sort((a, b) => {
    if (b.voteScore !== a.voteScore) return b.voteScore - a.voteScore;
    return a.totalPrice - b.totalPrice;
  });

  const appUrl = window.location.href;

  const buildWhatsAppSummary = () => {
    const lines: string[] = [
      `🚴 *Tussenstand Racefiets Weekend 2027*`,
      `📅 Do 27 mei t/m zo 30 mei 2027 (3 nachten · ${cyclistCount} fietsers)`,
      ``,
    ];

    if (sortedHouses.length === 0) {
      lines.push(`Er staan nog geen huisjes op de lijst. Voeg jouw favoriet toe via de planner!`);
    } else {
      sortedHouses.forEach((h, idx) => {
        const pp = Math.round(h.totalPrice / Math.max(1, cyclistCount));
        const badge = idx === 0 && h.voteScore > 0 ? '🏆 *Groepsfavoriet:* ' : `${idx + 1}. `;
        lines.push(
          `${badge}*${h.title}* (${h.locationName})`,
          `   💶 €${pp} p.p. (€${h.totalPrice} totaal) · 🛏️ ${h.bedrooms} slpk · ⭐ ${h.voteScore} pt`,
          `   🔗 ${h.url}`,
          ``
        );
      });
    }

    lines.push(`👉 Bekijk de kaart & stem mee: ${appUrl}`);
    return lines.join('\n');
  };

  const whatsappText = buildWhatsAppSummary();

  const handleCopyWhatsApp = async () => {
    try {
      await navigator.clipboard.writeText(whatsappText);
      setCopiedWhatsApp(true);
      setTimeout(() => setCopiedWhatsApp(false), 2500);
    } catch {
      // Fallback
    }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(appUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="relative w-full max-w-lg bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <MessageCircle className="w-5 h-5 text-[#FC4C02]" />
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Deel Tussenstand in jullie WhatsApp-groep
              </h2>
              <p className="text-xs text-slate-500">
                Stuur een kant-en-klare samenvatting van de huisjes en prijzen naar je vrienden
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 text-sm">
          {/* Quick Link Copy */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 text-[#FC4C02]" />
                <span>Directe link naar deze planner</span>
              </div>
              <p className="text-xs text-slate-500 truncate mt-0.5">{appUrl}</p>
            </div>
            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedLink ? 'Link gekopieerd!' : 'Kopieer link'}
            </button>
          </div>

          {/* WhatsApp Summary Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#FC4C02]" />
                <span>Kant-en-klaar bericht voor in de groepsapp:</span>
              </label>
              <span className="text-[11px] text-slate-500">
                Berekend op {cyclistCount} fietsers
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-[#F8FAFC] border border-slate-200 text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed max-h-60 overflow-y-auto">
              {whatsappText}
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
            >
              Sluiten
            </button>
            <button
              type="button"
              onClick={handleCopyWhatsApp}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#FC4C02] text-white text-xs font-semibold hover:bg-[#E04300] transition-colors cursor-pointer"
            >
              {copiedWhatsApp ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedWhatsApp
                ? 'Bericht gekopieerd! Plak nu in WhatsApp'
                : 'Kopieer bericht voor WhatsApp'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
