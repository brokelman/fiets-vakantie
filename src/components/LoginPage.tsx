import React, { useEffect, useState } from 'react';
import {
  Bike,
  Calendar,
  MapPin,
  Users,
  Car,
  AlertCircle,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';
import {
  checkAuthRedirectResult,
  ClassifiedAuthError,
  classifyAuthError,
  firebaseConfig,
  signInWithApple,
  signInWithGoogle,
} from '../firebase';

interface LoginPageProps {
  onEnterGuestReadOnly?: () => void;
  isTestEnvironment?: boolean;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  isTestEnvironment = false,
}) => {
  const [isSigningInGoogle, setIsSigningInGoogle] = useState(false);
  const [isSigningInApple, setIsSigningInApple] = useState(false);
  const [authError, setAuthError] = useState<ClassifiedAuthError | null>(null);
  const [copiedDomain, setCopiedDomain] = useState(false);

  const currentDomain =
    typeof window !== 'undefined' ? window.location.hostname : 'supermannen.netlify.app';

  // Only check redirect result if a mobile redirect was actually initiated
  useEffect(() => {
    let active = true;
    checkAuthRedirectResult().catch((err) => {
      if (!active) return;
      setAuthError(classifyAuthError(err, 'Google'));
    });
    return () => {
      active = false;
    };
  }, []);

  const handleCopyDomain = async () => {
    try {
      await navigator.clipboard.writeText(currentDomain);
      setCopiedDomain(true);
      window.setTimeout(() => setCopiedDomain(false), 2500);
    } catch {
      // Ignore clipboard errors
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setIsSigningInGoogle(true);
    try {
      await signInWithGoogle();
    } catch (err: unknown) {
      setAuthError(classifyAuthError(err, 'Google'));
    } finally {
      setIsSigningInGoogle(false);
    }
  };

  const handleAppleLogin = async () => {
    setAuthError(null);
    setIsSigningInApple(true);
    try {
      await signInWithApple();
    } catch (err: unknown) {
      setAuthError(classifyAuthError(err, 'Apple'));
    } finally {
      setIsSigningInApple(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0F172A] text-white flex flex-col justify-between overflow-x-hidden">
      {/* Top Bar */}
      <header className="border-b border-slate-800 bg-[#0F172A]/90 backdrop-blur-md">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#FC4C02] flex items-center justify-center shrink-0">
              <Bike className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg sm:text-xl font-bold tracking-tight font-display uppercase text-white truncate">
              Kopgroep ’27
            </span>
          </div>
          <span className="text-[11px] sm:text-xs text-slate-400 font-mono-num shrink-0">
            {isTestEnvironment ? 'TESTOMGEVING' : '27 – 30 mei 2027'}
          </span>
        </div>
      </header>

      {/* Main Split Login Layout */}
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-8 sm:py-12">
        <div className="max-w-[980px] w-full grid grid-cols-1 lg:grid-cols-12 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
          {/* Left Column: Event Context */}
          <div className="lg:col-span-6 p-6 sm:p-8 lg:p-10 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 flex flex-col justify-between space-y-6 border-b lg:border-b-0 lg:border-r border-slate-800">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#FC4C02] uppercase tracking-wider">
                <Calendar className="w-3.5 h-3.5 shrink-0" />
                <span>Donderdag 27 mei t/m zondag 30 mei 2027</span>
              </div>

              <h1 className="text-2xl sm:text-4xl font-bold font-display uppercase tracking-tight text-white leading-none">
                Racefiets Weekend 2027 — Gezamenlijke Huisjes & Auto-indeling
              </h1>

              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                Samen vakantiehuizen aandragen, vergelijken op de kaart, stemmen op jullie favoriet en de auto- en fietsindeling afstemmen.
              </p>

              <div className="space-y-3 pt-1">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-[#FC4C02]/15 text-[#FC4C02] flex items-center justify-center shrink-0 mt-0.5">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-white">
                      Eén centrale groepslijst voor iedereen
                    </h3>
                    <p className="text-xs text-slate-400">
                      Elke wijziging of nieuw huisje is direct voor de hele groep zichtbaar.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-[#FC4C02]/15 text-[#FC4C02] flex items-center justify-center shrink-0 mt-0.5">
                    <Car className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-white">
                      Deelnemers, Chauffeurs & Fietsplekken
                    </h3>
                    <p className="text-xs text-slate-400">
                      Overzicht van wie er rijdt, hoeveel zitplaatsen er zijn en hoeveel fietsen er mee kunnen.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-[#FC4C02]/15 text-[#FC4C02] flex items-center justify-center shrink-0 mt-0.5">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-white">
                      Stemmen & Ideeënbord
                    </h3>
                    <p className="text-xs text-slate-400">
                      Geef je stem per accommodatie en deel routes en regio-ideeën.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800/80 text-[11px] text-slate-400">
              3 nachten · Ardennen / Zuid-Limburg / Eifel
            </div>
          </div>

          {/* Right Column: Clean 2-Button Login (Google + Apple ID) */}
          <div className="lg:col-span-6 p-6 sm:p-8 lg:p-10 bg-white text-slate-900 flex flex-col justify-center">
            <div className="max-w-sm mx-auto w-full space-y-6">
              <div className="space-y-1.5">
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 font-display uppercase">
                  Inloggen bij Kopgroep ’27
                </h2>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  Log in met je Google-account of Apple ID om huisjes toe te voegen, te stemmen en de deelnemerslijst bij te werken.
                </p>
              </div>

              {/* Strictly 2 Login Buttons: Google & Apple */}
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={isSigningInGoogle || isSigningInApple}
                  data-testid="login-google-btn"
                  className="w-full min-h-[48px] flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-[#FC4C02] hover:bg-[#E04300] text-white text-sm font-bold transition-colors shadow-xs cursor-pointer disabled:opacity-60"
                >
                  <svg className="w-4 h-4 shrink-0 bg-white rounded-full p-0.5" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
                    />
                  </svg>
                  <span>
                    {isSigningInGoogle ? 'Bezig met inloggen...' : 'Inloggen met Google'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleAppleLogin}
                  disabled={isSigningInGoogle || isSigningInApple}
                  data-testid="login-apple-btn"
                  className="w-full min-h-[48px] flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold transition-colors shadow-xs cursor-pointer disabled:opacity-60"
                >
                  <svg className="w-4 h-4 fill-current shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                  </svg>
                  <span>
                    {isSigningInApple ? 'Bezig met inloggen...' : 'Inloggen met Apple ID'}
                  </span>
                </button>
              </div>

              {/* Error feedback (only shown if user clicked a button and an error occurred) */}
              {authError && (
                <div
                  role="alert"
                  className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-950 space-y-2.5"
                >
                  <div className="flex items-start gap-2 font-bold text-amber-950">
                    <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                    <span>{authError.title}</span>
                  </div>
                  <p className="text-amber-900 leading-relaxed">{authError.message}</p>

                  {authError.code === 'unauthorized-domain' && (
                    <div className="pt-1 space-y-2">
                      <div className="flex items-center justify-between gap-2 bg-white border border-amber-200 rounded-lg px-2.5 py-1.5">
                        <code className="text-[11px] font-mono text-slate-900 truncate">
                          {currentDomain}
                        </code>
                        <button
                          type="button"
                          onClick={handleCopyDomain}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-semibold shrink-0 cursor-pointer"
                        >
                          {copiedDomain ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600" /> Gekopieerd
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" /> Kopieer domein
                            </>
                          )}
                        </button>
                      </div>
                      <a
                        href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/settings`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-bold text-[#FC4C02] hover:underline"
                      >
                        <span>Open Firebase Console → Authorized domains</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-3.5 px-4 sm:px-6 text-center text-xs text-slate-500">
        Kopgroep ’27 — Racefiets Weekend Planner
      </footer>
    </div>
  );
};
