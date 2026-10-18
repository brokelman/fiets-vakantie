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
  Copy,
  Check,
  ArrowRight,
  User,
  Mail,
} from 'lucide-react';
import { firebaseConfig, signInWithApple, signInWithGoogle, VALIDATION_CONSTRAINTS } from '../firebase';

export interface DirectMemberSession {
  uid: string;
  name: string;
  email: string;
  provider: 'google' | 'apple' | 'group';
}

interface LoginPageProps {
  onDirectLogin: (session: DirectMemberSession) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onDirectLogin }) => {
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [isLoadingApple, setIsLoadingApple] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showDomainHelp, setShowDomainHelp] = useState(false);
  const [showAppleSetupGuide, setShowAppleSetupGuide] = useState(false);
  const [copiedDomain, setCopiedDomain] = useState<string | null>(null);

  const currentHostname =
    typeof window !== 'undefined' ? window.location.hostname : 'ais-pre-zc3aqv5carxpgdk7w2vaw4-81023049844.europe-west2.run.app';

  const handleCopyDomain = async (domain: string) => {
    try {
      await navigator.clipboard.writeText(domain);
      setCopiedDomain(domain);
      window.setTimeout(() => setCopiedDomain(null), 2500);
    } catch {
      // Ignore clipboard failure
    }
  };

  const handleQuickMemberSubmit = (
    e: React.FormEvent,
    providerType: 'google' | 'apple' | 'group' = 'group'
  ) => {
    e.preventDefault();
    const cleanName = memberName.trim().slice(0, VALIDATION_CONSTRAINTS.NAME_MAX);
    const cleanEmail = memberEmail.trim().toLowerCase();
    if (!cleanName) {
      setAuthError('Vul je voornaam in (bijv. Erik of Jasper) om in te loggen.');
      return;
    }

    const uidSlug = (cleanEmail || cleanName)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 64);

    onDirectLogin({
      uid: `lid-${uidSlug || 'vriend'}`,
      name: cleanName,
      email: cleanEmail || `${cleanName.toLowerCase()}@kopgroep27.nl`,
      provider: providerType,
    });
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setShowDomainHelp(false);
    setShowAppleSetupGuide(false);
    setIsLoadingGoogle(true);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('unauthorized-domain')) {
        setShowDomainHelp(true);
        setAuthError(
          'Dit webadres staat nog niet in de "Authorized domains" lijst van Firebase voor de Google pop-up. Gebruik hieronder direct je naam & Google e-mailadres om meteen in te loggen op de centrale groepslijst, of voeg het domein toe in Firebase.'
        );
      } else if (msg.includes('popup-closed-by-user')) {
        setAuthError('Het inlogvenster is gesloten voordat het inloggen was afgerond.');
      } else if (msg.includes('popup-blocked')) {
        setAuthError('Je browser blokkeerde het pop-upvenster. Gebruik het directe inlogveld hieronder.');
      } else {
        setAuthError(`Google pop-up melding: gebruik hieronder je naam om direct door te gaan.`);
      }
    } finally {
      setIsLoadingGoogle(false);
    }
  };

  const handleAppleLogin = async () => {
    setAuthError(null);
    setShowDomainHelp(false);
    setShowAppleSetupGuide(false);
    setIsLoadingApple(true);
    try {
      await signInWithApple();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('unauthorized-domain')) {
        setShowDomainHelp(true);
        setAuthError(
          'Dit webadres staat nog niet bij de "Authorized domains" in Firebase. Gebruik hieronder direct je naam & Apple ID e-mailadres om meteen in te loggen op de centrale groepslijst.'
        );
      } else if (
        msg.includes('operation-not-allowed') ||
        msg.includes('configuration-not-found') ||
        msg.includes('invalid-credential')
      ) {
        setShowAppleSetupGuide(true);
        setAuthError(
          'Apple ID pop-up vereist een Apple Developer koppeling in Firebase. Je kunt hieronder direct met je naam & Apple e-mailadres inloggen!'
        );
      } else if (msg.includes('popup-closed-by-user')) {
        setAuthError('Het Apple ID inlogvenster is voortijdig gesloten.');
      } else {
        setAuthError('Gebruik hieronder je naam & e-mailadres om direct in te loggen.');
      }
    } finally {
      setIsLoadingApple(false);
    }
  };

  const firebaseAuthSettingsUrl = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/settings`;
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
      <main className="relative z-10 max-w-6xl w-full mx-auto px-4 sm:px-8 py-6 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center my-auto">
        {/* Left Column: Event Context & Why Login */}
        <div className="lg:col-span-7 space-y-6">
          <div className="inline-flex items-center gap-2 text-xs font-semibold tracking-wider uppercase text-[#FC4C02]">
            <span>Centrale Groepsplanner · Ardennen / Zuid-Limburg / Eifel</span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold font-display uppercase tracking-tight leading-[1.03] text-white">
            Racefiets Weekend 2027 — Samen het perfecte huisje kiezen
          </h1>

          <p className="text-sm sm:text-base text-slate-300 leading-relaxed max-w-xl">
            Iedereen die hier inlogt kijkt naar <strong className="text-white">exact dezelfde centrale groepsdatabase</strong> op de server. Als jij de standaardlijst verwijdert en zelf een huisje toevoegt, ziet Erik direct precies datzelfde huisje.
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
          <div className="bg-white text-slate-900 rounded-2xl border border-slate-200 shadow-2xl p-6 sm:p-7 space-y-5">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[#FC4C02]">
                  Toegang Vriendengroep
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  100% Gedeelde Lijst
                </span>
              </div>
              <h2 className="text-2xl font-bold tracking-tight text-slate-900">
                Inloggen bij Kopgroep ’27
              </h2>
              <p className="text-xs text-slate-500 leading-relaxed">
                Log direct in met je naam & Google/Apple e-mailadres, of gebruik de OAuth-knoppen hieronder.
              </p>
            </div>

            {/* Direct Member Login Form (Always works immediately without domain restrictions!) */}
            <form
              onSubmit={(e) => handleQuickMemberSubmit(e, 'group')}
              className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3"
            >
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Jouw voornaam in de groep *
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    required
                    maxLength={VALIDATION_CONSTRAINTS.NAME_MAX}
                    value={memberName}
                    onChange={(e) => setMemberName(e.target.value)}
                    placeholder="Bijv. Jasper of Erik"
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-white border border-slate-300 text-sm text-slate-900 focus:border-[#FC4C02] focus:outline-hidden"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Google of Apple ID e-mailadres (optioneel)
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="email"
                    value={memberEmail}
                    onChange={(e) => setMemberEmail(e.target.value)}
                    placeholder="naam@gmail.com of @icloud.com"
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-white border border-slate-300 text-xs text-slate-900 focus:border-[#FC4C02] focus:outline-hidden"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#FC4C02] hover:bg-[#E04300] text-white font-semibold text-sm transition-colors cursor-pointer shadow-xs"
              >
                <span>Open Centrale Groepslijst</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="relative flex py-1 items-center">
              <div className="grow border-t border-slate-200"></div>
              <span className="shrink-0 mx-3 text-[11px] font-medium text-slate-400 uppercase">
                Of via pop-up venster
              </span>
              <div className="grow border-t border-slate-200"></div>
            </div>

            {authError && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2.5">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <span className="font-medium leading-relaxed">{authError}</span>
                </div>

                {showDomainHelp && (
                  <div className="pl-6 space-y-2 text-[11px] text-slate-700 border-t border-amber-200/70 pt-2">
                    <p className="font-semibold text-slate-900">
                      Wil je de Google/Apple pop-up gebruiken? Voeg dit domein toe in Firebase:
                    </p>
                    <div className="flex items-center justify-between gap-2 bg-white px-2.5 py-1.5 rounded border border-amber-300 font-mono-num text-[11px]">
                      <span className="truncate">{currentHostname}</span>
                      <button
                        type="button"
                        onClick={() => handleCopyDomain(currentHostname)}
                        className="inline-flex items-center gap-1 text-[#FC4C02] font-semibold shrink-0 cursor-pointer"
                      >
                        {copiedDomain === currentHostname ? (
                          <>
                            <Check className="w-3 h-3" /> Gekopieerd
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" /> Kopieer
                          </>
                        )}
                      </button>
                    </div>
                    <a
                      href={firebaseAuthSettingsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-[#FC4C02] hover:underline"
                    >
                      Open Firebase Authorized Domains
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}

                {showAppleSetupGuide && (
                  <div className="pl-6 space-y-1.5 text-[11px] text-slate-700 border-t border-amber-200/70 pt-2">
                    <a
                      href={firebaseProvidersUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-[#FC4C02] hover:underline"
                    >
                      Open Firebase Authentication Providers
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Google Login Button */}
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isLoadingGoogle || isLoadingApple}
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
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
                <span>{isLoadingGoogle ? 'Bezig...' : 'Google Pop-up'}</span>
              </button>

              {/* Apple ID Login Button */}
              <button
                type="button"
                onClick={handleAppleLogin}
                disabled={isLoadingGoogle || isLoadingApple}
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-[#0F172A] hover:bg-slate-800 text-white font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                <svg
                  className="w-4 h-4 shrink-0 fill-current"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                </svg>
                <span>{isLoadingApple ? 'Bezig...' : 'Apple ID Pop-up'}</span>
              </button>
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
