import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signOut,
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

export async function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}

export async function signInWithApple() {
  return signInWithPopup(auth, appleProvider);
}

export async function logOutUser() {
  return signOut(auth);
}

// Validation & sanitization helpers synchronized verbatim with firebase-blueprint.json & firestore.rules
export const VALIDATION_CONSTRAINTS = {
  TRIP_ID: 'racefiets-2027',
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  URL_PATTERN: /^https?:\/\/.+/,
  TITLE_MIN: 2,
  TITLE_MAX: 120,
  URL_MIN: 8,
  URL_MAX: 500,
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
