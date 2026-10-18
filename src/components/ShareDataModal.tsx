import React, { useState } from 'react';
import { X, Copy, Download, Upload, Check, Database, RefreshCw } from 'lucide-react';
import { GeneralIdeaRecord, HouseRecord } from '../types';

interface ShareDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  houses: HouseRecord[];
  ideas: GeneralIdeaRecord[];
  onImportData: (payload: { houses: HouseRecord[]; ideas: GeneralIdeaRecord[] }) => Promise<void>;
  onResetToStarterData: () => Promise<void>;
  isCloudConnected: boolean;
}

export const ShareDataModal: React.FC<ShareDataModalProps> = ({
  isOpen,
  onClose,
  houses,
  ideas,
  onImportData,
  onResetToStarterData,
  isCloudConnected,
}) => {
  const [copied, setCopied] = useState(false);
  const [importText, setImportText] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  if (!isOpen) return null;

  const exportPayload = JSON.stringify(
    {
      event: 'Racefiets Weekend 2027',
      dates: '2027-05-27/2027-05-30',
      exportedAt: new Date().toISOString(),
      houses,
      ideas,
    },
    null,
    2
  );

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(exportPayload);
      setCopied(true);
      setStatusMessage('JSON gekopieerd naar klembord! Je kunt dit direct delen in jullie WhatsApp-groep.');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setStatusMessage('Kopiëren mislukt, gebruik de Download JSON-knop.');
    }
  };

  const handleDownloadJson = () => {
    const blob = new Blob([exportPayload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kopgroep-2027-selectie-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusMessage('JSON-bestand gedownload.');
  };

  const handleImportSubmit = async () => {
    if (!importText.trim()) {
      setStatusMessage('Plak eerst een geëxporteerd JSON-blok in het tekstveld.');
      return;
    }
    setIsImporting(true);
    try {
      const parsed = JSON.parse(importText);
      if (!parsed || !Array.isArray(parsed.houses)) {
        throw new Error('Ongeldig JSON-formaat: geen "houses" lijst gevonden.');
      }
      await onImportData({
        houses: parsed.houses,
        ideas: Array.isArray(parsed.ideas) ? parsed.ideas : [],
      });
      setStatusMessage(`Succesvol ${parsed.houses.length} huisjes geïmporteerd!`);
      setImportText('');
    } catch (err) {
      setStatusMessage(
        err instanceof Error ? err.message : 'Ongeldige JSON-tekst. Controleer of alles is gekopieerd.'
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result === 'string') {
        setImportText(event.target.result);
        setStatusMessage(`Bestand "${file.name}" geladen. Klik op "Importeer JSON" om toe te passen.`);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="relative w-full max-w-xl bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden my-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <Database className="w-5 h-5 text-[#FC4C02]" />
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Data Synchronisatie & 1-Klik JSON Delen
              </h2>
              <p className="text-xs text-slate-500">
                {isCloudConnected
                  ? 'Gekoppeld aan centrale Firebase Firestore database + JSON Backup'
                  : 'Lokale opslag actief — log in met Google voor live cloud sync of deel via JSON'}
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

        <div className="p-6 space-y-5 text-sm">
          {statusMessage && (
            <div className="p-3 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-800 font-medium">
              {statusMessage}
            </div>
          )}

          {/* Export section */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-bold text-slate-800">
              1. Deel huidige selectie met de WhatsApp-groep ({houses.length} huisjes, {ideas.length} ideeën)
            </h3>
            <p className="text-xs text-slate-600">
              Kopieer met 1 klik de volledige stand van zaken (inclusief stemmen en reacties) of download het JSON-bestand.
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleCopyJson}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#FC4C02] text-white text-xs font-semibold hover:bg-[#E04300] transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Gekopieerd!' : 'Kopieer JSON (1-klik)'}
              </button>
              <button
                type="button"
                onClick={handleDownloadJson}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Download .json bestand
              </button>
            </div>
          </div>

          {/* Import section */}
          <div className="pt-4 border-t border-slate-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-800">
                2. Importeer JSON van een vriend
              </h3>
              <label className="text-xs font-semibold text-[#FC4C02] hover:underline cursor-pointer">
                Of kies .json bestand
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
            <textarea
              rows={4}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='Plak hier de JSON van een groepsgenoot (begint met {"event": "Racefiets Weekend 2027"...})'
              className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono-num text-xs text-slate-800 focus:border-[#FC4C02] focus:outline-hidden"
            />
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={onResetToStarterData}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Herstel 4 voorbeeld-huisjes
              </button>
              <button
                type="button"
                onClick={handleImportSubmit}
                disabled={isImporting}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Upload className="w-4 h-4" />
                {isImporting ? 'Bezig...' : 'Importeer JSON'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
