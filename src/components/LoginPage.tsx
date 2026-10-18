import React, { useEffect, useState } from 'react';
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
  Eye,
  Smartphone,
} from 'lucide-react';
import {
  checkAuthRedirectResult,
  ClassifiedAuthError,
  classifyAuthError,
  firebaseConfig,
  signInWithApplePopup,
  signInWithAppleRedirect,
  signInWithGooglePopup,
  signInWithGoogleRedirect,
} from '../firebase';

interface LoginPageProps {
  onEnterGuestReadOnly: () => void;
  isTestEnvironment: boolean;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onEnterGuestReadOnly,
  isTestEnvironment,
}) => {
  const [isSigningInGoogle, setIsSigningInGoogle] = useState(false);
  const [isSigningInGoogleRedirect, setIsSigningInGoogleRedirect] = useState(false);
  const [isSigningInApple, setIsSigningInApple] = useState(false);
  const [authError, setAuthError] = useState<ClassifiedAuthError | null>(null);
  const [copiedDomain, setCopiedDomain] = useState<string | null>(null);
  const [showAdminDomainGuide, setShowAdminDomainGuide] = useState(false);

  const currentDomain =
    typeof window !== 'undefined' ? window.location.hostname : 'supermannen.netlify.app';
  const netlifyDomain = 'supermannen.netlify.app';

  // Check if returning from a mobile OAuth redirect (signInWithRedirect)
  useEffect(() => {
    let active = true;
    checkAuthRedirectResult().catch((err) => {
      if (!active) return;
      const classified = classifyAuthError(err, 'Google');
      setAuthError(classified);
      if (classified.code === 'unauthorized-domain') {
        setShowAdminDomainGuide(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const handleCopyDomain = async (domain: string) => {
    try {
      await navigator.clipboard.writeText(domain);
      setCopiedDomain(domain);
      window.setTimeout(() => setCopiedDomain(null), 2500);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleGooglePopup = async () => {
    setAuthError(null);
    setIsSigningInGoogle(true);
    try {
      await signInWithGooglePopup();
    } catch (err: unknown) {
      const classified = classifyAuthError(err, 'Google');
      setAuthError(classified);
      if (classified.code === 'unauthorized-domain') {
        setShowAdminDomainGuide(true);
      }
    } finally {
      setIsSigningInGoogle(false);
    }
  };

  const handleGoogleRedirect = async () => {
    setAuthError(null);
    setIsSigningInGoogleRedirect(true);
    try {
      await signInWithGoogleRedirect();
    } catch (err: unknown) {
      const classified = classifyAuthError(err, 'Google');
      setAuthError(classified);
      if (classified.code === 'unauthorized-domain') {
        setShowAdminDomainGuide(true);
      }
      setIsSigningInGoogleRedirect(false);
    }
  };

  const handleApplePopup = async () => {
    setAuthError(null);
    setIsSigningInApple(true);
    try {
      await signInWithApplePopup();
    } catch (err: unknown) {
      const classified = classifyAuthError(err, 'Apple');
      setAuthError(classified);
      if (classified.code === 'unauthorized-domain') {
        setShowAdminDomainGuide(true);
      }
    } finally {
      setIsSigningInApple(false);
    }
  };

  const handleAppleRedirect = async () => {
    setAuthError(null);
    setIsSigningInApple(true);
    try {
      await signInWithAppleRedirect();
    } catch (err: unknown) {
      const classified = classifyAuthError(err, 'Apple');
      setAuthError(classified);
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
            {isTestEnvironment ? 'TESTOMGEVING (racefiets-2027-test)' : '27 – 30 mei 2027'}
          </span>
        </div>
      </header>

      {/* Main Split Login Layout */}
      <main className="flex-1 flex items-center justify-center px-3 sm:px-6 py-6 sm:py-10">
        <div className="max-w-[1060px] w-full grid grid-cols-1 lg:grid-cols-12 bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
          {/* Left Column: Event Context & Why Verified Auth */}
          <div className="lg:col-span-6 p-5 sm:p-8 lg:p-10 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-950 flex flex-col justify-between space-y-6 border-b lg:border-b-0 lg:border-r border-slate-800">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#FC4C02] uppercase tracking-wider">
                <Calendar className="w-3.5 h-3.5 shrink-0" />
                <span>Donderdag 27 mei t/m zondag 30 mei 2027</span>
              </div>

              <h1 className="text-2xl sm:text-4xl font-bold font-display uppercase tracking-tight text-white leading-none">
                Racefiets Weekend 2027 — Gezamenlijke Huisjes & Auto-indeling
              </h1>

              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                Log in met je geverifieerde Google- of Apple-account zodat iedereen in de groep (Hermen, Erik en de rest) altijd exact dezelfde realtime lijst in Firebase Firestore ziet en bewerkt.
              </p>

              <div className="space-y-3 pt-1">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-[#FC4C02]/15 text-[#FC4C02] flex items-center justify-center shrink-0 mt-0.5">
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-white">
                      Eén centrale Firestore-lijst voor iedereen
                    </h3>
                    <p className="text-xs text-slate-400">
                      Geen losse browser-lijsten of automatische voorbeeldhuisjes meer: elke toevoeging of verwijdering is direct voor iedereen zichtbaar.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-[#FC4C02]/15 text-[#FC4C02] flex items-center justify-center shrink-0 mt-0.5">
                    <Car className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-white">
                      Deelnemers, Chauffeurs & Fietsplekken (incl. 0 fietsen)
                    </h3>
                    <p className="text-xs text-slate-400">
                      Geef per auto het exacte aantal zitplaatsen en racefietsen op (ook 0 fietsen voor een bagage-/passagiersauto blijft exact 0).
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-[#FC4C02]/15 text-[#FC4C02] flex items-center justify-center shrink-0 mt-0.5">
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-white">
                      Geverifieerd eigenaarschap (UID)
                    </h3>
                    <p className="text-xs text-slate-400">
                      Wijzigingen, stemmen en reacties zijn gekoppeld aan je geverifieerde account-UID. Onbevestigde gasten hebben uitsluitend alleen-lezen toegang.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                Firestore Project: {firebaseConfig.projectId}
              </span>
              <span>3 nachten · Ardennen / Limburg / Eifel</span>
            </div>
          </div>

          {/* Right Column: Verified Google / Apple Login + Explicit Read-Only Guest Option */}
          <div className="lg:col-span-6 p-5 sm:p-8 lg:p-10 bg-white text-slate-900 flex flex-col justify-center">
            <div className="max-w-md mx-auto w-full space-y-5">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#FC4C02] uppercase tracking-wider">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>Geverifieerde Groepslogin</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 font-display uppercase">
                  Inloggen bij Kopgroep ’27
                </h2>
                <p className="text-xs text-slate-600">
                  Log in met je Google-account of Apple ID om huisjes toe te voegen, te stemmen en de deelnemerslijst bij te werken.
                </p>
              </div>

              {/* Primary Verified Login Buttons */}
              <div className="space-y-2.5">
                {/* 1. Google Sign-In (Pop-up) */}
                <button
                  type="button"
                  onClick={handleGooglePopup}
                  disabled={isSigningInGoogle || isSigningInGoogleRedirect || isSigningInApple}
                  data-testid="login-google-popup-btn"
                  className="w-full min-h-[46px] flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-xl bg-[#FC4C02] hover:bg-[#E04300] text-white text-xs sm:text-sm font-bold transition-colors shadow-xs cursor-pointer disabled:opacity-60"
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
                    {isSigningInGoogle ? 'Bezig met Google Pop-up...' : 'Inloggen met Google (Pop-up)'}
                  </span>
                </button>

                {/* 2. Google Sign-In (Redirect — ideal for iPhone Safari & mobile browsers) */}
                <button
                  type="button"
                  onClick={handleGoogleRedirect}
                  disabled={isSigningInGoogle || isSigningInGoogleRedirect || isSigningInApple}
                  data-testid="login-google-redirect-btn"
                  className="w-full min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-900 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60"
                >
                  <Smartphone className="w-4 h-4 text-[#FC4C02] shrink-0" />
                  <span>
                    {isSigningInGoogleRedirect
                      ? 'Doorsturen naar Google...'
                      : 'Inloggen met Google via Redirect (iPhone Safari / Mobiel)'}
                  </span>
                </button>

                {/* 3. Apple ID Sign-In (Pop-up + Redirect fallback) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleApplePopup}
                    disabled={isSigningInGoogle || isSigningInGoogleRedirect || isSigningInApple}
                    className="w-full min-h-[44px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60"
                  >
                    <svg className="w-4 h-4 fill-current shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
                    </svg>
                    <span>Apple ID (Pop-up)</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleAppleRedirect}
                    disabled={isSigningInGoogle || isSigningInGoogleRedirect || isSigningInApple}
                    className="w-full min-h-[44px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60"
                  >
                    <span>Apple ID (Redirect)</span>
                  </button>
                </div>
              </div>

              {/* Error feedback + Firebase Authorized Domains helper */}
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

                  {authError.code === 'popup-blocked' && (
                    <button
                      type="button"
                      onClick={handleGoogleRedirect}
                      className="w-full min-h-[40px] py-2 px-3 rounded-lg bg-[#FC4C02] text-white font-semibold hover:bg-[#E04300] transition-colors cursor-pointer"
                    >
                      Nu inloggen via Redirect (zonder pop-up) →
                    </button>
                  )}
                </div>
              )}

              {/* Collapsible Admin Instructions for supermannen.netlify.app */}
              <div className="border border-slate-200 rounded-xl bg-slate-50 p-3.5 space-y-2.5 text-xs">
                <button
                  type="button"
                  onClick={() => setShowAdminDomainGuide((prev) => !prev)}
                  className="w-full flex items-center justify-between text-left font-bold text-slate-800 cursor-pointer"
                >
                  <span>Beheerder: Domein vrijgeven in Firebase (tegen unauthorized-domain)</span>
                  <span className="text-[#FC4C02] ml-2">{showAdminDomainGuide ? 'Sluiten' : 'Stappenplan'}</span>
                </button>

                {showAdminDomainGuide && (
                  <div className="pt-2 border-t border-slate-200 space-y-2.5 text-slate-700">
                    <p className="leading-relaxed">
                      Voeg eenmalig <strong>{netlifyDomain}</strong> (en eventueel dit preview-domein) toe in Firebase project{' '}
                      <code className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200">
                        {firebaseConfig.projectId}
                      </code>
                      :
                    </p>
                    <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-700">
                      <li>Open Firebase Console → <strong>Authentication</strong> → tabblad <strong>Settings</strong>.</li>
                      <li>Klik in het linker submenu op <strong>Authorized domains</strong>.</li>
                      <li>Klik op <strong>Add domain</strong> en plak exact onderstaand domein (zonder <code>https://</code> of slash):</li>
                    </ol>

                    {/* Copy supermannen.netlify.app */}
                    <div className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
                      <code className="text-[11px] font-mono text-slate-900 truncate">{netlifyDomain}</code>
                      <button
                        type="button"
                        onClick={() => handleCopyDomain(netlifyDomain)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-semibold shrink-0 cursor-pointer"
                      >
                        {copiedDomain === netlifyDomain ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" /> Gekopieerd
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" /> Kopieer
                          </>
                        )}
                      </button>
                    </div>

                    {/* Copy current hostname if different */}
                    {currentDomain !== netlifyDomain && (
                      <div className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5">
                        <code className="text-[11px] font-mono text-slate-900 truncate">{currentDomain}</code>
                        <button
                          type="button"
                          onClick={() => handleCopyDomain(currentDomain)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-800 text-[11px] font-semibold shrink-0 cursor-pointer"
                        >
                          {copiedDomain === currentDomain ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600" /> Gekopieerd
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" /> Kopieer huidig
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    <a
                      href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/settings`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-bold text-[#FC4C02] hover:underline pt-0.5"
                    >
                      <span>Open Firebase Authorized Domains ({firebaseConfig.projectId})</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
              </div>

              {/* Divider for Explicit Read-Only Guest Mode */}
              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-slate-200" />
                <span className="shrink-0 px-3 text-[11px] font-medium text-slate-400">
                  Alleen meekijken zonder account?
                </span>
                <div className="flex-grow border-t border-slate-200" />
              </div>

              {/* Explicit Read-Only Guest Button (Strictly No Write Permissions & No Impersonation) */}
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={onEnterGuestReadOnly}
                  data-testid="enter-guest-readonly-btn"
                  className="w-full min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold transition-colors cursor-pointer"
                >
                  <Eye className="w-4 h-4 text-slate-600 shrink-0" />
                  <span>Bekijk als Gast (Alleen-lezen — geen wijzigingsrechten)</span>
                </button>
                <p className="text-[11px] text-slate-500 text-center leading-normal">
                  Als onbevestigde gast kun je de actuele groepslijst en kaart bekijken, maar geen huisjes, stemmen of deelnemers toevoegen of wijzigen.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800/80 py-3.5 px-4 sm:px-6 text-center text-xs text-slate-500">
        Kopgroep ’27 — Racefiets Weekend Planner · Firebase Firestore ({firebaseConfig.firestoreDatabaseId})
      </footer>
    </div>
  );
};
