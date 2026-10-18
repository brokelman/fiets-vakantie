import { initializeApp } from 'firebase/app';
import {
  getAuth,
  getRedirectResult,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  UserCredential,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseAppletConfig from '../firebase-applet-config.json';

export const firebaseConfig = firebaseAppletConfig;

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const appleProvider = new OAuthProvider('apple.com');
appleProvider.addScope('email');
appleProvider.addScope('name');

const REDIRECT_PENDING_KEY = 'kopgroep27_oauth_redirect_pending';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: boolean | string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

testConnection();

export async function signInWithGooglePopup(): Promise<UserCredential> {
  return signInWithPopup(auth, googleProvider);
}

export async function signInWithGoogleRedirect(): Promise<void> {
  try {
    sessionStorage.setItem(REDIRECT_PENDING_KEY, 'Google');
  } catch {
    // Ignore storage errors
  }
  return signInWithRedirect(auth, googleProvider);
}

export async function signInWithApplePopup(): Promise<UserCredential> {
  return signInWithPopup(auth, appleProvider);
}

export async function signInWithAppleRedirect(): Promise<void> {
  try {
    sessionStorage.setItem(REDIRECT_PENDING_KEY, 'Apple');
  } catch {
    // Ignore storage errors
  }
  return signInWithRedirect(auth, appleProvider);
}

/**
 * Unified Google Sign-In: tries pop-up first and automatically falls back to redirect if pop-up is blocked.
 */
export async function signInWithGoogle(): Promise<UserCredential | null> {
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('auth/popup-blocked')) {
      await signInWithGoogleRedirect();
      return null;
    }
    throw err;
  }
}

/**
 * Unified Apple Sign-In: tries pop-up first and automatically falls back to redirect if pop-up is blocked.
 */
export async function signInWithApple(): Promise<UserCredential | null> {
  try {
    return await signInWithPopup(auth, appleProvider);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('auth/popup-blocked')) {
      await signInWithAppleRedirect();
      return null;
    }
    throw err;
  }
}

/**
 * Only checks getRedirectResult when a redirect login was actually initiated in this tab.
 * Prevents _validateOrigin from firing on initial page load and showing premature errors.
 */
export async function checkAuthRedirectResult(): Promise<{
  credential: UserCredential | null;
  providerLabel: 'Google' | 'Apple';
}> {
  let pendingProvider: 'Google' | 'Apple' | null = null;
  try {
    const raw = sessionStorage.getItem(REDIRECT_PENDING_KEY);
    if (raw === 'Google' || raw === 'Apple') {
      pendingProvider = raw;
    }
    sessionStorage.removeItem(REDIRECT_PENDING_KEY);
  } catch {
    // Ignore
  }

  if (!pendingProvider) {
    return { credential: null, providerLabel: 'Google' };
  }

  const credential = await getRedirectResult(auth);
  return { credential, providerLabel: pendingProvider };
}

export async function logOutUser(): Promise<void> {
  return signOut(auth);
}

export interface ClassifiedAuthError {
  code:
    | 'unauthorized-domain'
    | 'popup-closed'
    | 'popup-blocked'
    | 'operation-not-allowed'
    | 'network-error'
    | 'unknown';
  title: string;
  message: string;
  rawMessage: string;
}

export function classifyAuthError(err: unknown, providerLabel: 'Google' | 'Apple'): ClassifiedAuthError {
  const rawMessage = err instanceof Error ? err.message : String(err);

  if (rawMessage.includes('auth/unauthorized-domain')) {
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'supermannen.netlify.app';
    return {
      code: 'unauthorized-domain',
      title: `Voeg "${hostname}" eenmalig toe in je Firebase Console`,
      message: `Omdat deze app op een extern domein (${hostname}) draait, moet je dit domein eenmalig toevoegen in jouw eigen Firebase Console onder Authentication → Settings → Authorized domains (project: ${firebaseConfig.projectId}). Daarna werkt inloggen direct.`,
      rawMessage,
    };
  }

  if (
    rawMessage.includes('auth/popup-closed-by-user') ||
    rawMessage.includes('auth/cancelled-popup-request')
  ) {
    return {
      code: 'popup-closed',
      title: 'Inlogvenster gesloten',
      message: `Het ${providerLabel}-inlogvenster is gesloten voordat het inloggen was afgerond. Klik opnieuw op de knop om in te loggen.`,
      rawMessage,
    };
  }

  if (rawMessage.includes('auth/popup-blocked')) {
    return {
      code: 'popup-blocked',
      title: 'Pop-up geblokkeerd door je browser',
      message: 'Je browser heeft het pop-upvenster geblokkeerd. Probeer het opnieuw of sta pop-ups toe.',
      rawMessage,
    };
  }

  if (rawMessage.includes('auth/operation-not-allowed')) {
    return {
      code: 'operation-not-allowed',
      title: `${providerLabel} Sign-In is nog niet geactiveerd in Firebase`,
      message: `Schakel ${providerLabel} in via Firebase Console → Authentication → Sign-in method (project: ${firebaseConfig.projectId}).`,
      rawMessage,
    };
  }

  if (rawMessage.includes('auth/network-request-failed')) {
    return {
      code: 'network-error',
      title: 'Geen netwerkverbinding met Firebase Authentication',
      message: 'Controleer je internetverbinding en probeer het opnieuw.',
      rawMessage,
    };
  }

  return {
    code: 'unknown',
    title: `Inloggen met ${providerLabel} niet gelukt`,
    message: rawMessage,
    rawMessage,
  };
}

// Validation & sanitization helpers synchronized verbatim with firebase-blueprint.json & firestore.rules
export const VALIDATION_CONSTRAINTS = {
  TRIP_ID: 'racefiets-2027',
  TEST_TRIP_ID: 'racefiets-2027-test',
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  URL_PATTERN: /^https?:\/\/.+/,
  TITLE_MIN: 2,
  TITLE_MAX: 120,
  URL_MIN: 8,
  URL_MAX: 2000,
  LOCATION_MIN: 2,
  LOCATION_MAX: 160,
  NOTES_MAX: 1000,
  NAME_MIN: 1,
  NAME_MAX: 60,
  COMMENT_MIN: 1,
  COMMENT_MAX: 600,
  IDEA_MIN: 2,
  IDEA_MAX: 600,
} as const;

export function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, 120);
  return cleaned.length > 0 ? cleaned : `id-${Date.now()}`;
}
