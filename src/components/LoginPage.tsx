import React, { useState } from 'react';
import {
  Bike,
  Calendar,
  MapPin,
  Users,
  Car,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import { firebaseConfig, signInWithApple, signInWithGoogle } from '../firebase';

export const LoginPage: React.FC = () => {
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [isLoadingApple, setIsLoadingApple] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showAppleSetupGuide, setShowAppleSetupGuide] = useState(false);

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setShowAppleSetupGuide(false);
    setIsLoadingGoogle(true);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('popup-closed-by-user')) {
        setAuthError('Het inlogvenster is gesloten voordat het inloggen was afgerond.');
      } else if (msg.includes('popup-blocked')) {
        setAuthError('Je browser blokkeerde het pop-upvenster. Sta pop-ups toe voor deze pagina.');
      } else {
        setAuthError(`Inloggen met Google is niet gelukt: ${msg}`);
      }
    } finally {
      setIsLoadingGoogle(false);
    }
  };

  const handleAppleLogin = async () => {
    setAuthError(null);
    setShowAppleSetupGuide(false);
    setIsLoadingApple(true);
    try {
      await signInWithApple();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('operation-not-allowed') ||
        msg.includes('configuration-not-found') ||
        msg.includes('invalid-credential')
      ) {
        setShowAppleSetupGuide(true);
        setAuthError(
          'Inloggen met Apple ID moet nog eenmalig worden aangezet in de Firebase Console (Google Login werkt al direct).'
        );
      } else if (msg.includes('popup-closed-by-user')) {
        setAuthError('Het Apple ID inlogvenster is voortijdig gesloten.');
      } else {
        setAuthError(`Inloggen met Apple ID is niet gelukt: ${msg}`);
      }
    } finally {
      setIsLoadingApple(false);
    }
  };

  const firebaseProvidersUrl = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/providers`;

  return (
    <div className="min-h-screen bg-[#0F172A] text-white flex flex-col justify-between relative overflow-hidden">
      {/* Subtle topographic background lines */}
      <svg
        viewBox="0 0 1200 800"
        className="absolute inset-0 w-full h-full object-cover opacity-15 pointer-events-none"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <g fill="none" stroke="#94A3B8" strokeWidth="1.2">
          <path d="M-100,180 C250,90 550,290 900,150 C1050,90 1180,140 1300,110" />
          <path d="M-100,280 C220,190 540,390 880,250 C1040,185 1170,240 1300,210" />
          <path d="M-100,380 C200,290 530,490 860,350 C1030,280 1160,340 1300,310" />
          <path d="M-100,480 C180,390 520,590 840,450 C1020,375 1150,440 1300,410" />
          <path d="M-100,580 C160,490 510,690 820,550 C1010,470 1140,540 1300,510" />
        </g>
        <path
          d="M0,720 L180,640 L340,665 L540,510 L710,560 L920,370 L1090,420 L1200,330"
          fill="none"
          stroke="#FC4C02"
          strokeWidth="2.5"
          strokeDasharray="6 6"
        />
      </svg>

      {/* Top Header Bar */}
      <header className="relative z-10 max-w-6xl w-full mx-auto px-4 sm:px-8 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-[#FC4C02] flex items-center justify-center text-white">
            <Bike className="w-5 h-5" />
          </div>
          <span className="text-xl font-bold tracking-tight font-display uppercase text-white">
            Kopgroep ’27
          </span>
        </div>
        <div className="text-xs font-mono-num text-slate-300 flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5 text-[#FC4C02]" />
          <span>Do 27 mei t/m zo 30 mei 2027 (3 nachten)</span>
        </div>
      </header>

      {/* Main Content Split */}
      <main className="relative z-10 max-w-6xl w-full mx-auto px-4 sm:px-8 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center my-auto">
        {/* Left Column: Event Context & Why Login */}
        <div className="lg:col-span-7 space-y-6">
          <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-wider uppercase text-[#FC4C02]">
            <span>Centrale Groepsplanner · Ardennen / Zuid-Limburg / Eifel</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold font-display uppercase tracking-tight leading-[1.03] text-white">
            Racefiets Weekend 2027 — Samen het perfecte huisje kiezen
          </h1>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl">
            Log in zodat iedereen in de vriendengroep naar <strong className="text-white">exact dezelfde centrale lijst</strong> kijkt. Wanneer jij of Erik een huisje toevoegt, verwijdert, stemt of zich aanmeldt als chauffeur, ziet de hele groep dit direct live.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="bg-slate-800/70 border border-slate-700/80 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <MapPin className="w-4 h-4 text-[#FC4C02] shrink-0" />
                <span>1 Centrale Huisjeslijst</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Geen losse lijsten meer per telefoon of laptop. Wat je toevoegt of verwijdert geldt direct voor iedereen.
              </p>
            </div>

            <div className="bg-slate-800/70 border border-slate-700/80 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <Car className="w-4 h-4 text-[#FC4C02] shrink-0" />
                <span>Chauffeurs & Fietsen</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Zet je naam op de lijst en geef aan hoeveel personen en racefietsen er mee kunnen in je auto.
              </p>
            </div>

            <div className="bg-slate-800/70 border border-slate-700/80 rounded-xl p-4 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <Users className="w-4 h-4 text-[#FC4C02] shrink-0" />
                <span>Live Stemmen & Prijzen</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Bereken direct de prijs per fietser voor 3 nachten en stem samen op jullie groepsfavoriet.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Login Card */}
        <div className="lg:col-span-5">
          <div className="bg-white text-slate-900 rounded-2xl border border-slate-200 shadow-2xl p-6 sm:p-8 space-y-6">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[#FC4C02]">
                  Toegang Vriendengroep
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Live Cloud Sync
                </span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                Inloggen bij Kopgroep ’27
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                Kies je Google-account of Apple ID om de gedeelde lijst met vakantiehuizen en deelnemers te openen.
              </p>
            </div>

            {authError && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span className="font-medium leading-relaxed">{authError}</span>
                </div>

                {showAppleSetupGuide && (
                  <div className="pl-6 space-y-1.5 text-[11px] text-slate-700 border-t border-amber-200/70 pt-2">
                    <p className="font-semibold text-slate-900">
                      Zo zet je Apple ID inloggen aan in Firebase (voor de beheerder):
                    </p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Open de Firebase Console via onderstaande knop.</li>
                      <li>
                        Klik op <strong>Add new provider</strong> → kies <strong>Apple</strong> en zet de schakelaar op <strong>Enable</strong>.
                      </li>
                      <li>
                        Voeg het domein van deze app toe onder <em>Authorized domains</em>.
                      </li>
                    </ol>
                    <a
                      href={firebaseProvidersUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-[#FC4C02] hover:underline pt-1"
                    >
                      Open Firebase Authentication Providers
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-3">
              {/* Google Login Button */}
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isLoadingGoogle || isLoadingApple}
                className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-xl bg-white hover:bg-slate-50 text-slate-900 border-2 border-slate-300 hover:border-slate-400 font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
              >
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
                  />
                </svg>
                <span>
                  {isLoadingGoogle ? 'Bezig met inloggen...' : 'Inloggen met Google Account'}
                </span>
              </button>

              {/* Apple ID Login Button */}
              <button
                type="button"
                onClick={handleAppleLogin}
                disabled={isLoadingGoogle || isLoadingApple}
                className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
              >
                <svg
                  className="w-5 h-5 shrink-0 fill-current"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                </svg>
                <span>
                  {isLoadingApple ? 'Bezig met inloggen...' : 'Inloggen met Apple ID'}
                </span>
              </button>
            </div>

            <div className="pt-4 border-t border-slate-100 space-y-2 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Iedereen ziet altijd direct dezelfde actuele lijst</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Je naam wordt automatisch ingevuld bij je stemmen & reacties</span>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Bottom Footer */}
      <footer className="relative z-10 max-w-6xl w-full mx-auto px-4 sm:px-8 py-5 text-xs text-slate-400 flex flex-col sm:flex-row items-center justify-between gap-2 border-t border-slate-800/80">
        <span>Kopgroep ’27 — Racefiets Weekend Planner</span>
        <span>Donderdag 27 mei t/m zondag 30 mei 2027</span>
      </footer>
    </div>
  );
};
