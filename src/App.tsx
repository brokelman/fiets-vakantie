/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Bike,
  Calendar,
  MapPin,
  Plus,
  Users,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  ExternalLink,
  Route,
  Flame,
  Waves,
  ThermometerSun,
  UtensilsCrossed,
  Trophy,
  BedDouble,
  Bath,
  Send,
  Lightbulb,
  LogOut,
  LogIn,
  Cloud,
  CheckCircle2,
  Search,
  ChevronDown,
  ChevronUp,
  Trash2,
  Star,
  Pencil,
  ListChecks,
  LayoutGrid,
  List,
  RotateCcw,
  Car,
  AlertCircle,
  Eye,
  UploadCloud,
} from 'lucide-react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  logOutUser,
  OperationType,
  sanitizeId,
  VALIDATION_CONSTRAINTS,
} from './firebase';
import {
  FacilityFilter,
  GeneralIdeaRecord,
  HouseCommentRecord,
  HouseRecord,
  HouseVoteRecord,
  ParticipantRecord,
  SortOption,
} from './types';
import { INITIAL_HOUSES } from './data/initialData';
import { HouseIllustration } from './components/HouseIllustration';
import { LeafletMap } from './components/LeafletMap';
import { AddHouseModal, HouseFormData } from './components/AddHouseModal';
import { LoginPage } from './components/LoginPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  extractCustomLocalHousesToMigrate,
  normalizeStoredBikeSpots,
  normalizeStoredCarSeats,
  parseBikeSpotsInput,
  parseCarSeatsInput,
  resolveTripId,
} from './utils/validation';

const LEGACY_STORAGE_KEY_HOUSES = 'kopgroep27_houses_v2';
const STORAGE_KEY_CYCLISTS = 'kopgroep27_cyclists_v1';
const STORAGE_KEY_USERNAME = 'kopgroep27_username_v1';
const STORAGE_KEY_GUEST_MODE = 'kopgroep27_guest_readonly_v1';

function getCloudCacheKey(collectionName: string, tripId: string): string {
  return `kopgroep27_cache_v3_${tripId}_${collectionName}`;
}

function readCachedArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeCachedArray<T>(key: string, items: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
}

function MainApplication() {
  // Determine Production ('racefiets-2027') vs Isolated Test Environment ('racefiets-2027-test')
  const [isTestEnvironment, setIsTestEnvironment] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return resolveTripId(window.location.search) === 'racefiets-2027-test';
  });

  const activeTripId = useMemo(
    () => resolveTripId(typeof window !== 'undefined' ? window.location.search : '', isTestEnvironment),
    [isTestEnvironment]
  );

  // Verified Firebase Auth state + Explicit Read-Only Guest state
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [isGuestReadOnly, setIsGuestReadOnly] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY_GUEST_MODE) === '1';
    } catch {
      return false;
    }
  });
  const [isAuthReady, setIsAuthReady] = useState(false);

  const [friendName, setFriendName] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY_USERNAME) || '';
  });

  // Cyclist count calculator state (default 8)
  const [cyclistCount, setCyclistCount] = useState<number>(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY_CYCLISTS));
    return saved >= 2 && saved <= 24 ? saved : 8;
  });

  // Undo last deleted house
  const [lastDeletedHouse, setLastDeletedHouse] = useState<HouseRecord | null>(null);

  // Authoritative Firestore State (with local read-only cache for instant render before first snapshot)
  const [cloudHouses, setCloudHouses] = useState<HouseRecord[] | null>(null);
  const [cloudVotesByHouse, setCloudVotesByHouse] = useState<Record<string, HouseVoteRecord[]>>({});
  const [cloudCommentsByHouse, setCloudCommentsByHouse] = useState<Record<string, HouseCommentRecord[]>>({});
  const [cloudIdeas, setCloudIdeas] = useState<GeneralIdeaRecord[] | null>(null);
  const [cloudParticipants, setCloudParticipants] = useState<ParticipantRecord[] | null>(null);
  const [firestoreLoadError, setFirestoreLoadError] = useState<string | null>(null);

  // Navigation & UI state
  // IMPORTANT FOR MOBILE: Default mobilePane to 'lijst' so the houses list is immediately visible on phones!
  const [activeView, setActiveView] = useState<'vergelijken' | 'beheren' | 'deelnemers' | 'ideeen'>('vergelijken');
  const [listDisplayMode, setListDisplayMode] = useState<'kaarten' | 'tabel'>('kaarten');
  const [mobilePane, setMobilePane] = useState<'lijst' | 'kaart' | 'beide'>('lijst');
  const [selectedHouseId, setSelectedHouseId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('populariteit');
  const [facilityFilter, setFacilityFilter] = useState<FacilityFilter>('alle');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  // Participant form state — string inputs so '0', '', negative, and invalid inputs are accurately distinguished!
  const [participantName, setParticipantName] = useState('');
  const [participantIsDriver, setParticipantIsDriver] = useState(true);
  const [participantCarSeatsInput, setParticipantCarSeatsInput] = useState<string>('3');
  const [participantBikeSpotsInput, setParticipantBikeSpotsInput] = useState<string>('0');
  const [participantNotes, setParticipantNotes] = useState('');
  const [participantFormError, setParticipantFormError] = useState<string | null>(null);

  // Idea board form state
  const [ideaCategory, setIdeaCategory] = useState<GeneralIdeaRecord['category']>('regio');
  const [ideaText, setIdeaText] = useState('');

  // Modals & Toasts
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingHouse, setEditingHouse] = useState<HouseRecord | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isMigratingLocal, setIsMigratingLocal] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4000);
  };

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_CYCLISTS, String(cyclistCount));
  }, [cyclistCount]);

  useEffect(() => {
    if (friendName.trim()) {
      localStorage.setItem(STORAGE_KEY_USERNAME, friendName.trim());
    }
  }, [friendName]);

  // Listen to Firebase Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setIsAuthReady(true);
      if (user) {
        setIsGuestReadOnly(false);
        try {
          sessionStorage.removeItem(STORAGE_KEY_GUEST_MODE);
        } catch {
          // Ignore
        }
        const fallbackName =
          user.displayName?.split(' ')[0] ||
          user.email?.split('@')[0] ||
          'Groepslid';
        const cleanFallback = fallbackName.slice(0, VALIDATION_CONSTRAINTS.NAME_MAX);
        setFriendName((prev) => {
          if (!prev.trim() || prev === 'Jasper' || prev === 'Gast') {
            return cleanFallback;
          }
          return prev;
        });
      }
    });
    return () => unsub();
  }, []);

  // Authenticated member check: confirmed Firebase Auth users via Google or Email/Password can mutate shared group data
  const isVerifiedMember = Boolean(
    currentUser &&
      !currentUser.isAnonymous &&
      (currentUser.emailVerified ||
        currentUser.providerData.some((p) => p.providerId === 'password'))
  );
  const isAdminUser = Boolean(
    currentUser &&
      currentUser.emailVerified &&
      currentUser.email?.toLowerCase() === 'brokelman@gmail.com'
  );
  const canViewApp = Boolean(currentUser || isGuestReadOnly);

  const canModifyRecord = (ownerOrAuthorId: string): boolean => {
    if (!isVerifiedMember || !currentUser) return false;
    return currentUser.uid === ownerOrAuthorId || isAdminUser;
  };

  const handleEnterGuestReadOnly = () => {
    setIsGuestReadOnly(true);
    try {
      sessionStorage.setItem(STORAGE_KEY_GUEST_MODE, '1');
    } catch {
      // Ignore
    }
  };

  const handleLogoutOrExitGuest = async () => {
    setIsGuestReadOnly(false);
    try {
      sessionStorage.removeItem(STORAGE_KEY_GUEST_MODE);
    } catch {
      // Ignore
    }
    if (currentUser) {
      await logOutUser();
    }
  };

  // Attach real-time Firestore listeners for activeTripId whenever the user is viewing the app (Verified or Read-Only Guest)
  useEffect(() => {
    if (!isAuthReady || !canViewApp) {
      setCloudHouses(null);
      setCloudIdeas(null);
      setCloudParticipants(null);
      return;
    }

    setFirestoreLoadError(null);

    const housesQuery = query(
      collection(db, 'houses'),
      where('tripId', '==', activeTripId)
    );

    const unsubHouses = onSnapshot(
      housesQuery,
      (snapshot) => {
        const items: HouseRecord[] = snapshot.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            tripId: d.tripId || activeTripId,
            ownerId: d.ownerId || '',
            title: d.title || '',
            url: d.url || '',
            photoUrl: d.photoUrl || '',
            locationName: d.locationName || '',
            lat: typeof d.lat === 'number' ? d.lat : Number(d.lat) || 50.4,
            lng: typeof d.lng === 'number' ? d.lng : Number(d.lng) || 5.8,
            totalPrice: typeof d.totalPrice === 'number' ? d.totalPrice : Number(d.totalPrice) || 1000,
            bedrooms: typeof d.bedrooms === 'number' ? d.bedrooms : Number(d.bedrooms) || 4,
            bathrooms: typeof d.bathrooms === 'number' ? d.bathrooms : Number(d.bathrooms) || 2,
            hasBbq: Boolean(d.hasBbq),
            hasFireplace: Boolean(d.hasFireplace),
            hasJacuzzi: Boolean(d.hasJacuzzi ?? d.hasSaunaJacuzzi),
            hasSauna: Boolean(d.hasSauna ?? d.hasSaunaJacuzzi),
            routeUrl: d.routeUrl || '',
            notes: d.notes || '',
            addedBy: d.addedBy || 'Groepslid',
            voteScore: typeof d.voteScore === 'number' ? d.voteScore : Number(d.voteScore) || 0,
            voteCount: typeof d.voteCount === 'number' ? d.voteCount : Number(d.voteCount) || 0,
            status: d.status === 'archived' ? 'archived' : 'active',
            createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString(),
            updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
          };
        });
        setCloudHouses(items);
        writeCachedArray(getCloudCacheKey('houses', activeTripId), items);
      },
      (error) => {
        console.error('Error loading houses from Firestore:', error);
        setFirestoreLoadError(error instanceof Error ? error.message : String(error));
        setCloudHouses((prev) => prev ?? readCachedArray<HouseRecord>(getCloudCacheKey('houses', activeTripId)));
      }
    );

    const ideasQuery = query(
      collection(db, 'ideas'),
      where('tripId', '==', activeTripId)
    );

    const unsubIdeas = onSnapshot(
      ideasQuery,
      (snapshot) => {
        const items: GeneralIdeaRecord[] = snapshot.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            tripId: d.tripId || activeTripId,
            authorId: d.authorId || '',
            authorName: d.authorName || 'Groepslid',
            category: d.category || 'overig',
            text: d.text || '',
            likesCount: typeof d.likesCount === 'number' ? d.likesCount : Number(d.likesCount) || 0,
            status: d.status === 'resolved' ? 'resolved' : 'open',
            createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString(),
            updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
          };
        });
        setCloudIdeas(items);
        writeCachedArray(getCloudCacheKey('ideas', activeTripId), items);
      },
      (error) => {
        console.error('Error loading ideas from Firestore:', error);
        setCloudIdeas((prev) => prev ?? readCachedArray<GeneralIdeaRecord>(getCloudCacheKey('ideas', activeTripId)));
      }
    );

    const participantsQuery = query(
      collection(db, 'participants'),
      where('tripId', '==', activeTripId)
    );

    const unsubParticipants = onSnapshot(
      participantsQuery,
      (snapshot) => {
        const items: ParticipantRecord[] = snapshot.docs.map((docSnap) => {
          const d = docSnap.data();
          const isDriver = Boolean(d.isDriver);
          return {
            id: docSnap.id,
            tripId: d.tripId || activeTripId,
            ownerId: d.ownerId || '',
            name: d.name || 'Deelnemer',
            isDriver,
            carSeats: normalizeStoredCarSeats(d.carSeats, isDriver),
            // CRITICAL FIX: Never use `Number(d.bikeSpots) || 3` — preserve 0 explicitly!
            bikeSpots: isDriver ? normalizeStoredBikeSpots(d.bikeSpots) : 0,
            notes: d.notes || '',
            createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString(),
            updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
          };
        });
        setCloudParticipants(items);
        writeCachedArray(getCloudCacheKey('participants', activeTripId), items);
      },
      (error) => {
        console.error('Error loading participants from Firestore:', error);
        setCloudParticipants(
          (prev) => prev ?? readCachedArray<ParticipantRecord>(getCloudCacheKey('participants', activeTripId))
        );
      }
    );

    return () => {
      unsubHouses();
      unsubIdeas();
      unsubParticipants();
    };
  }, [isAuthReady, canViewApp, activeTripId]);

  // Attach subcollection listeners for votes and comments of cloud houses
  useEffect(() => {
    if (!canViewApp || !cloudHouses || cloudHouses.length === 0) return;

    const unsubs: (() => void)[] = [];

    cloudHouses.forEach((house) => {
      const votesQuery = query(
        collection(db, 'houses', house.id, 'votes'),
        where('houseId', '==', house.id)
      );
      const unsubVotes = onSnapshot(
        votesQuery,
        (snap) => {
          const votes: HouseVoteRecord[] = snap.docs.map((dSnap) => {
            const d = dSnap.data();
            return {
              id: dSnap.id,
              houseId: d.houseId,
              userId: d.userId,
              voterName: d.voterName,
              value: typeof d.value === 'number' ? d.value : Number(d.value) || 1,
              createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString(),
              updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
            };
          });
          setCloudVotesByHouse((prev) => ({ ...prev, [house.id]: votes }));
        },
        (error) => {
          console.error(`Error loading votes for ${house.id}:`, error);
        }
      );

      const commentsQuery = query(
        collection(db, 'houses', house.id, 'comments'),
        where('houseId', '==', house.id)
      );
      const unsubComments = onSnapshot(
        commentsQuery,
        (snap) => {
          const comments: HouseCommentRecord[] = snap.docs.map((dSnap) => {
            const d = dSnap.data();
            return {
              id: dSnap.id,
              houseId: d.houseId,
              authorId: d.authorId,
              authorName: d.authorName,
              text: d.text,
              createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString(),
            };
          });
          comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          setCloudCommentsByHouse((prev) => ({ ...prev, [house.id]: comments }));
        },
        (error) => {
          console.error(`Error loading comments for ${house.id}:`, error);
        }
      );

      unsubs.push(unsubVotes, unsubComments);
    });

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [canViewApp, cloudHouses]);

  // Authoritative Shared Lists (localStorage is strictly a read-cache while Firestore connects; NEVER auto-seeds INITIAL_HOUSES!)
  const activeHouses: HouseRecord[] = useMemo(() => {
    const base =
      cloudHouses !== null
        ? cloudHouses
        : readCachedArray<HouseRecord>(getCloudCacheKey('houses', activeTripId));
    return base
      .filter((h) => h.status !== 'archived')
      .map((h) => ({
        ...h,
        votes: cloudVotesByHouse[h.id] || h.votes || [],
        comments: cloudCommentsByHouse[h.id] || h.comments || [],
      }));
  }, [cloudHouses, cloudVotesByHouse, cloudCommentsByHouse, activeTripId]);

  const activeIdeas: GeneralIdeaRecord[] = useMemo(() => {
    return cloudIdeas !== null
      ? cloudIdeas
      : readCachedArray<GeneralIdeaRecord>(getCloudCacheKey('ideas', activeTripId));
  }, [cloudIdeas, activeTripId]);

  const activeParticipants: ParticipantRecord[] = useMemo(() => {
    return cloudParticipants !== null
      ? cloudParticipants
      : readCachedArray<ParticipantRecord>(getCloudCacheKey('participants', activeTripId));
  }, [cloudParticipants, activeTripId]);

  // Check if this browser has custom (non-demo) houses in legacy localStorage that haven't been synced to Firestore yet
  const pendingLocalCustomHouses = useMemo(() => {
    if (isTestEnvironment || cloudHouses === null) return [];
    const rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY_HOUSES);
    return extractCustomLocalHousesToMigrate(rawLegacy, cloudHouses);
  }, [isTestEnvironment, cloudHouses]);

  // Safe migration handler: uploads only custom non-demo houses from browser localStorage to Firestore
  const handleMigrateLocalCustomHouses = async () => {
    if (!isVerifiedMember || !currentUser || pendingLocalCustomHouses.length === 0) return;
    setIsMigratingLocal(true);
    try {
      for (const h of pendingLocalCustomHouses) {
        const docId = sanitizeId(h.id);
        await setDoc(doc(db, 'houses', docId), {
          tripId: activeTripId,
          ownerId: currentUser.uid,
          title: h.title.slice(0, VALIDATION_CONSTRAINTS.TITLE_MAX),
          url: h.url.slice(0, VALIDATION_CONSTRAINTS.URL_MAX),
          photoUrl: (h.photoUrl || '').slice(0, VALIDATION_CONSTRAINTS.URL_MAX),
          locationName: h.locationName.slice(0, VALIDATION_CONSTRAINTS.LOCATION_MAX),
          lat: Number(h.lat) || 50.4,
          lng: Number(h.lng) || 5.8,
          totalPrice: Math.max(1, Math.min(50000, Math.round(Number(h.totalPrice) || 1000))),
          bedrooms: Math.max(1, Math.min(50, Math.round(Number(h.bedrooms) || 4))),
          bathrooms: Math.max(1, Math.min(50, Math.round(Number(h.bathrooms) || 2))),
          hasBbq: Boolean(h.hasBbq),
          hasFireplace: Boolean(h.hasFireplace),
          hasJacuzzi: Boolean(h.hasJacuzzi),
          hasSauna: Boolean(h.hasSauna),
          routeUrl: (h.routeUrl || '').slice(0, VALIDATION_CONSTRAINTS.URL_MAX),
          notes: (h.notes || '').slice(0, VALIDATION_CONSTRAINTS.NOTES_MAX),
          addedBy: (h.addedBy || friendName || 'Groepslid').slice(0, VALIDATION_CONSTRAINTS.NAME_MAX),
          voteScore: Math.max(-1000, Math.min(1000, Math.round(Number(h.voteScore) || 5))),
          voteCount: Math.max(0, Math.min(1000, Math.round(Number(h.voteCount) || 1))),
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      localStorage.removeItem(LEGACY_STORAGE_KEY_HOUSES);
      showToast(
        `${pendingLocalCustomHouses.length} lokaal opgeslagen huisje(s) veilig overgezet naar de centrale Firestore-lijst!`
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'houses');
    } finally {
      setIsMigratingLocal(false);
    }
  };

  // Determine the single Group Favorite house (highest voteScore > 0)
  const favoriteHouseId = useMemo(() => {
    if (activeHouses.length === 0) return null;
    const sorted = [...activeHouses].sort((a, b) => {
      if (b.voteScore !== a.voteScore) return b.voteScore - a.voteScore;
      return a.totalPrice - b.totalPrice;
    });
    return sorted[0].voteScore > 0 ? sorted[0].id : null;
  }, [activeHouses]);

  // Filtered and sorted houses
  const displayedHouses = useMemo(() => {
    return activeHouses
      .filter((h) => {
        if (facilityFilter === 'bbq' && !h.hasBbq) return false;
        if (facilityFilter === 'openhaard' && !h.hasFireplace) return false;
        if (facilityFilter === 'jacuzzi' && !h.hasJacuzzi) return false;
        if (facilityFilter === 'sauna' && !h.hasSauna) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const match =
            h.title.toLowerCase().includes(q) ||
            h.locationName.toLowerCase().includes(q) ||
            h.notes.toLowerCase().includes(q) ||
            h.addedBy.toLowerCase().includes(q);
          if (!match) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'populariteit') {
          if (b.voteScore !== a.voteScore) return b.voteScore - a.voteScore;
          return a.totalPrice - b.totalPrice;
        }
        if (sortBy === 'prijs_oplopend') {
          return a.totalPrice - b.totalPrice;
        }
        if (sortBy === 'slaapkamers') {
          if (b.bedrooms !== a.bedrooms) return b.bedrooms - a.bedrooms;
          return b.bathrooms - a.bathrooms;
        }
        return 0;
      });
  }, [activeHouses, facilityFilter, searchQuery, sortBy]);

  const requireVerifiedLogin = (actionLabel: string): boolean => {
    if (!isVerifiedMember || !currentUser) {
      showToast(`Log eerst in met je Google-account of e-mailadres om ${actionLabel}.`);
      return false;
    }
    return true;
  };

  // Save (Create or Edit) a house in Firestore
  const handleSaveHouse = async (houseData: HouseFormData, editingHouseId?: string) => {
    if (!requireVerifiedLogin('een huisje op te slaan')) return;
    if (!currentUser) return;

    if (editingHouseId) {
      const target = activeHouses.find((h) => h.id === editingHouseId);
      if (target && !canModifyRecord(target.ownerId)) {
        showToast('Alleen de eigenaar die dit huisje heeft toegevoegd (of de beheerder) kan het wijzigen.');
        return;
      }

      try {
        await updateDoc(doc(db, 'houses', editingHouseId), {
          title: houseData.title,
          url: houseData.url,
          photoUrl: houseData.photoUrl,
          locationName: houseData.locationName,
          lat: houseData.lat,
          lng: houseData.lng,
          totalPrice: houseData.totalPrice,
          bedrooms: houseData.bedrooms,
          bathrooms: houseData.bathrooms,
          hasBbq: houseData.hasBbq,
          hasFireplace: houseData.hasFireplace,
          hasJacuzzi: houseData.hasJacuzzi,
          hasSauna: houseData.hasSauna,
          routeUrl: houseData.routeUrl,
          notes: houseData.notes,
          addedBy: houseData.addedBy,
          updatedAt: serverTimestamp(),
        });
        setEditingHouse(null);
        showToast(`Wijzigingen aan "${houseData.title}" zijn opgeslagen in Firestore!`);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `houses/${editingHouseId}`);
      }
      return;
    }

    // Create new house in Firestore + initial +5 vote by creator
    const newId = sanitizeId(`huis-${Date.now()}`);
    const houseDocRef = doc(db, 'houses', newId);
    const voteDocRef = doc(db, 'houses', newId, 'votes', currentUser.uid);

    try {
      const batch = writeBatch(db);
      batch.set(houseDocRef, {
        tripId: activeTripId,
        ownerId: currentUser.uid,
        title: houseData.title,
        url: houseData.url,
        photoUrl: houseData.photoUrl,
        locationName: houseData.locationName,
        lat: houseData.lat,
        lng: houseData.lng,
        totalPrice: houseData.totalPrice,
        bedrooms: houseData.bedrooms,
        bathrooms: houseData.bathrooms,
        hasBbq: houseData.hasBbq,
        hasFireplace: houseData.hasFireplace,
        hasJacuzzi: houseData.hasJacuzzi,
        hasSauna: houseData.hasSauna,
        routeUrl: houseData.routeUrl,
        notes: houseData.notes,
        addedBy: houseData.addedBy,
        voteScore: 5,
        voteCount: 1,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(voteDocRef, {
        houseId: newId,
        userId: currentUser.uid,
        voterName: houseData.addedBy,
        value: 5,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      setSelectedHouseId(newId);
      showToast(`"${houseData.title}" staat nu live op de gedeelde lijst!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `houses/${newId}`);
    }
  };

  // Vote on a house (-1 or 1..5) in Firestore
  const handleVoteHouse = async (house: HouseRecord, voteValue: number) => {
    if (!requireVerifiedLogin('te stemmen')) return;
    if (!currentUser) return;

    const cleanVoterName = (friendName.trim() || currentUser.displayName || 'Groepslid').slice(
      0,
      VALIDATION_CONSTRAINTS.NAME_MAX
    );

    const existingVotes = house.votes || [];
    const existingVote = existingVotes.find((v) => v.userId === currentUser.uid);

    let newScore = house.voteScore;
    let newCount = house.voteCount;

    if (existingVote) {
      newScore = house.voteScore - existingVote.value + voteValue;
    } else {
      newScore = house.voteScore + voteValue;
      newCount = house.voteCount + 1;
    }

    const voteDocRef = doc(db, 'houses', house.id, 'votes', currentUser.uid);
    const houseDocRef = doc(db, 'houses', house.id);

    try {
      const batch = writeBatch(db);
      if (existingVote) {
        batch.update(voteDocRef, {
          voterName: cleanVoterName,
          value: voteValue,
          updatedAt: serverTimestamp(),
        });
      } else {
        batch.set(voteDocRef, {
          houseId: house.id,
          userId: currentUser.uid,
          voterName: cleanVoterName,
          value: voteValue,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      batch.update(houseDocRef, {
        voteScore: newScore,
        voteCount: newCount,
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      showToast(
        voteValue > 0
          ? `Stem (+${voteValue}★) van ${cleanVoterName} opgeslagen voor ${house.title}`
          : `Twijfelstem (-1) van ${cleanVoterName} geregistreerd`
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `houses/${house.id}/votes/${currentUser.uid}`);
    }
  };

  // Add a comment to a house in Firestore
  const handleAddComment = async (house: HouseRecord) => {
    if (!requireVerifiedLogin('een reactie te plaatsen')) return;
    if (!currentUser) return;

    const rawDraft = commentDrafts[house.id] || '';
    const cleanText = rawDraft.trim().slice(0, VALIDATION_CONSTRAINTS.COMMENT_MAX);
    if (!cleanText) return;

    const cleanAuthor = (friendName.trim() || currentUser.displayName || 'Groepslid').slice(
      0,
      VALIDATION_CONSTRAINTS.NAME_MAX
    );
    const commentId = sanitizeId(`reactie-${Date.now()}`);

    setCommentDrafts((prev) => ({ ...prev, [house.id]: '' }));

    try {
      await setDoc(doc(db, 'houses', house.id, 'comments', commentId), {
        houseId: house.id,
        authorId: currentUser.uid,
        authorName: cleanAuthor,
        text: cleanText,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `houses/${house.id}/comments/${commentId}`);
    }
  };

  // Delete a house from Firestore (only owner or admin)
  const handleDeleteHouse = async (house: HouseRecord) => {
    if (!requireVerifiedLogin('een huisje te verwijderen')) return;
    if (!canModifyRecord(house.ownerId)) {
      showToast('Alleen degene die dit huisje heeft toegevoegd (of de beheerder) kan het verwijderen.');
      return;
    }

    setLastDeletedHouse(house);
    if (selectedHouseId === house.id) {
      setSelectedHouseId(null);
    }

    try {
      await deleteDoc(doc(db, 'houses', house.id));
      showToast(`"${house.title}" is verwijderd uit de centrale lijst.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `houses/${house.id}`);
    }
  };

  // Undo last deleted house in Firestore
  const handleUndoDeleteHouse = async () => {
    if (!lastDeletedHouse || !currentUser || !isVerifiedMember) return;
    const restored = lastDeletedHouse;
    setLastDeletedHouse(null);

    try {
      await setDoc(doc(db, 'houses', restored.id), {
        tripId: activeTripId,
        ownerId: currentUser.uid,
        title: restored.title,
        url: restored.url,
        photoUrl: restored.photoUrl || '',
        locationName: restored.locationName,
        lat: restored.lat,
        lng: restored.lng,
        totalPrice: restored.totalPrice,
        bedrooms: restored.bedrooms,
        bathrooms: restored.bathrooms,
        hasBbq: Boolean(restored.hasBbq),
        hasFireplace: Boolean(restored.hasFireplace),
        hasJacuzzi: Boolean(restored.hasJacuzzi),
        hasSauna: Boolean(restored.hasSauna),
        routeUrl: restored.routeUrl || '',
        notes: restored.notes || '',
        addedBy: restored.addedBy,
        voteScore: restored.voteScore,
        voteCount: restored.voteCount,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showToast(`"${restored.title}" is weer teruggezet in de centrale lijst!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `houses/${restored.id}`);
    }
  };

  // Clear owned houses (or all houses if admin) in the active environment
  const handleClearHousesInEnvironment = async () => {
    if (!requireVerifiedLogin('huizen te wissen')) return;
    const deletableHouses = activeHouses.filter((h) => canModifyRecord(h.ownerId));
    if (deletableHouses.length === 0) {
      showToast('Je kunt alleen huisjes verwijderen die door jouw account zijn toegevoegd.');
      return;
    }

    setSelectedHouseId(null);
    try {
      for (const h of deletableHouses) {
        await deleteDoc(doc(db, 'houses', h.id));
      }
      showToast(`${deletableHouses.length} huisje(s) verwijderd uit de lijst.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'houses');
    }
  };

  // Open edit modal for a house
  const handleOpenEditHouse = (house: HouseRecord) => {
    if (!requireVerifiedLogin('een huisje te bewerken')) return;
    if (!canModifyRecord(house.ownerId)) {
      showToast('Alleen degene die dit huisje heeft toegevoegd (of de beheerder) kan het bewerken.');
      return;
    }
    setEditingHouse(house);
    setIsAddModalOpen(true);
  };

  // PARTICIPANTS & CARPOOL MANAGEMENT — Strictly preserves 0 bikes!
  const handleAddParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    setParticipantFormError(null);

    if (!requireVerifiedLogin('je aan te melden op de deelnemerslijst')) return;
    if (!currentUser) return;

    const cleanName = participantName.trim().slice(0, VALIDATION_CONSTRAINTS.NAME_MAX);
    if (!cleanName) {
      setParticipantFormError('Vul de naam van de deelnemer in.');
      return;
    }

    let seats = 0;
    let bikes = 0;

    if (participantIsDriver) {
      const parsedSeats = parseCarSeatsInput(participantCarSeatsInput);
      if (!parsedSeats.valid || parsedSeats.value === null) {
        setParticipantFormError(parsedSeats.error || 'Ongeldig aantal zitplaatsen.');
        return;
      }
      const parsedBikes = parseBikeSpotsInput(participantBikeSpotsInput);
      if (!parsedBikes.valid || parsedBikes.value === null) {
        setParticipantFormError(parsedBikes.error || 'Ongeldig aantal fietsen.');
        return;
      }
      seats = parsedSeats.value;
      // CRITICAL: parsedBikes.value is 0 when user typed '0' — NEVER fallback to 3!
      bikes = parsedBikes.value;
    }

    const pId = sanitizeId(`deelnemer-${Date.now()}`);
    const cleanNotes = participantNotes.trim().slice(0, 300);

    try {
      await setDoc(doc(db, 'participants', pId), {
        tripId: activeTripId,
        ownerId: currentUser.uid,
        name: cleanName,
        isDriver: participantIsDriver,
        carSeats: seats,
        bikeSpots: bikes,
        notes: cleanNotes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setParticipantName('');
      setParticipantNotes('');
      setParticipantFormError(null);
      showToast(
        participantIsDriver
          ? `${cleanName} toegevoegd als chauffeur (${seats} pers., ${bikes} fietsen)!`
          : `${cleanName} toegevoegd als meerijder!`
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `participants/${pId}`);
    }
  };

  const handleUpdateParticipant = async (
    participant: ParticipantRecord,
    updates: Partial<Pick<ParticipantRecord, 'isDriver' | 'carSeats' | 'bikeSpots' | 'notes'>>
  ) => {
    if (!requireVerifiedLogin('deelnemergegevens aan te passen')) return;
    if (!canModifyRecord(participant.ownerId)) {
      showToast('Je kunt alleen je eigen deelnemer-inschrijving wijzigen.');
      return;
    }

    const nextDriver = updates.isDriver !== undefined ? updates.isDriver : participant.isDriver;
    const nextSeats = nextDriver
      ? updates.carSeats !== undefined
        ? normalizeStoredCarSeats(updates.carSeats, true)
        : normalizeStoredCarSeats(participant.carSeats, true)
      : 0;
    // CRITICAL: Preserve 0 bikes when toggling or updating! Never replace 0 with 2 or 3.
    const nextBikes = nextDriver
      ? updates.bikeSpots !== undefined
        ? normalizeStoredBikeSpots(updates.bikeSpots)
        : normalizeStoredBikeSpots(participant.bikeSpots)
      : 0;
    const nextNotes = updates.notes !== undefined ? updates.notes.slice(0, 300) : participant.notes;

    try {
      await updateDoc(doc(db, 'participants', participant.id), {
        isDriver: nextDriver,
        carSeats: nextSeats,
        bikeSpots: nextBikes,
        notes: nextNotes,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `participants/${participant.id}`);
    }
  };

  const handleDeleteParticipant = async (participant: ParticipantRecord) => {
    if (!requireVerifiedLogin('een deelnemer te verwijderen')) return;
    if (!canModifyRecord(participant.ownerId)) {
      showToast('Je kunt alleen je eigen deelnemer-inschrijving verwijderen.');
      return;
    }

    try {
      await deleteDoc(doc(db, 'participants', participant.id));
      showToast(`${participant.name} verwijderd van de deelnemerslijst.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `participants/${participant.id}`);
    }
  };

  // Delete an idea from Firestore
  const handleDeleteIdea = async (idea: GeneralIdeaRecord) => {
    if (!requireVerifiedLogin('een idee te verwijderen')) return;
    if (!canModifyRecord(idea.authorId)) {
      showToast('Alleen de auteur van dit idee (of de beheerder) kan het verwijderen.');
      return;
    }

    try {
      await deleteDoc(doc(db, 'ideas', idea.id));
      showToast('Idee verwijderd.');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `ideas/${idea.id}`);
    }
  };

  // Add a general idea to Firestore
  const handleAddIdea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requireVerifiedLogin('een idee te plaatsen')) return;
    if (!currentUser) return;

    const cleanText = ideaText.trim().slice(0, VALIDATION_CONSTRAINTS.IDEA_MAX);
    if (cleanText.length < VALIDATION_CONSTRAINTS.IDEA_MIN) return;

    const cleanAuthor = (friendName.trim() || currentUser.displayName || 'Groepslid').slice(
      0,
      VALIDATION_CONSTRAINTS.NAME_MAX
    );
    const ideaId = sanitizeId(`idee-${Date.now()}`);

    setIdeaText('');

    try {
      await setDoc(doc(db, 'ideas', ideaId), {
        tripId: activeTripId,
        authorId: currentUser.uid,
        authorName: cleanAuthor,
        category: ideaCategory,
        text: cleanText,
        likesCount: 0,
        status: 'open',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showToast('Idee toegevoegd aan het centrale ideeënbord!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `ideas/${ideaId}`);
    }
  };

  // Upvote a general idea in Firestore
  const handleLikeIdea = async (idea: GeneralIdeaRecord) => {
    if (!requireVerifiedLogin('een idee te liken')) return;
    const nextLikes = Math.min(1000, idea.likesCount + 1);

    try {
      await updateDoc(doc(db, 'ideas', idea.id), {
        likesCount: nextLikes,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `ideas/${idea.id}`);
    }
  };

  const handleShowOnMap = (houseId: string) => {
    setSelectedHouseId(houseId);
    setActiveView('vergelijken');
    if (window.innerWidth < 1024) {
      setMobilePane('kaart');
    }
  };

  const categoryLabels: Record<GeneralIdeaRecord['category'], string> = {
    regio: 'Regio & Klimmen',
    route: 'Routes & GPX',
    logistiek: 'Vervoer & Fietsendrager',
    overig: 'Eten & Overig',
  };

  // Totals for Participants & Cars
  const totalParticipantsCount = activeParticipants.length;
  const totalDriversCount = activeParticipants.filter((p) => p.isDriver).length;
  const totalCarSeats = activeParticipants.reduce((sum, p) => sum + (p.isDriver ? p.carSeats : 0), 0);
  const totalBikeSpots = activeParticipants.reduce((sum, p) => sum + (p.isDriver ? p.bikeSpots : 0), 0);

  // 1. Auth Loading State
  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#0F172A] text-white flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 rounded-xl bg-[#FC4C02] flex items-center justify-center mx-auto animate-pulse">
            <Bike className="w-5 h-5 text-white" />
          </div>
          <p className="text-sm font-semibold text-slate-200">
            Verbinding maken met Kopgroep ’27...
          </p>
        </div>
      </div>
    );
  }

  // 2. Login Gate (Google or Email/Password Auth)
  if (!canViewApp) {
    return (
      <LoginPage
        onEnterGuestReadOnly={handleEnterGuestReadOnly}
        isTestEnvironment={isTestEnvironment}
        onUserDisplayNameChosen={(chosenName) => {
          const clean = chosenName.trim().slice(0, VALIDATION_CONSTRAINTS.NAME_MAX);
          if (clean) {
            setFriendName(clean);
            localStorage.setItem(STORAGE_KEY_USERNAME, clean);
          }
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A] overflow-x-hidden">
      {/* Top Bar Contract: Strictly 3 zones separated by gap-4 sm:gap-8 */}
      <header className="flex items-center justify-between gap-3 sm:gap-8 px-3 sm:px-6 py-3 bg-white border-b border-slate-200 sticky top-0 z-30">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('vergelijken');
            setMobilePane('lijst');
          }}
          className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 font-display uppercase whitespace-nowrap shrink-0"
        >
          Kopgroep ’27
        </a>

        {/* Zone 2: 4 concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <button
            type="button"
            onClick={() => setActiveView('vergelijken')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'vergelijken'
                ? 'text-slate-900 underline decoration-[#FC4C02] decoration-2 underline-offset-8 font-semibold'
                : ''
            }`}
          >
            Kaart & Huisjes ({activeHouses.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveView('beheren')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'beheren'
                ? 'text-slate-900 underline decoration-[#FC4C02] decoration-2 underline-offset-8 font-semibold'
                : ''
            }`}
          >
            Lijst Beheren
          </button>
          <button
            type="button"
            onClick={() => setActiveView('deelnemers')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'deelnemers'
                ? 'text-slate-900 underline decoration-[#FC4C02] decoration-2 underline-offset-8 font-semibold'
                : ''
            }`}
          >
            Deelnemers & Auto’s ({activeParticipants.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveView('ideeen')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'ideeen'
                ? 'text-slate-900 underline decoration-[#FC4C02] decoration-2 underline-offset-8 font-semibold'
                : ''
            }`}
          >
            Ideeënbord ({activeIdeas.length})
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-2 shrink-0">
          {isVerifiedMember ? (
            <button
              type="button"
              onClick={() => {
                setEditingHouse(null);
                setIsAddModalOpen(true);
              }}
              data-testid="add-house-header-btn"
              className="min-h-[40px] inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 text-xs font-semibold text-white bg-[#FC4C02] rounded-lg hover:bg-[#E04300] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" />
              <span>Nieuw Huisje</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleLogoutOrExitGuest}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 text-xs font-semibold text-white bg-[#FC4C02] rounded-lg hover:bg-[#E04300] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <LogIn className="w-4 h-4 shrink-0" />
              <span>Inloggen</span>
            </button>
          )}
        </div>
      </header>

      {/* Isolated Test Environment Banner when active */}
      {isTestEnvironment && (
        <div className="bg-indigo-950 text-indigo-100 border-b border-indigo-800 px-3 sm:px-6 py-2 text-xs">
          <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>TESTOMGEVING ACTIEF ({activeTripId})</strong> — Wijzigingen hier raken de productiegegevens (racefiets-2027) niet.
            </span>
            <button
              type="button"
              onClick={() => setIsTestEnvironment(false)}
              className="px-2.5 py-1 rounded bg-indigo-800 hover:bg-indigo-700 text-white font-semibold cursor-pointer"
            >
              Schakel naar Productie
            </button>
          </div>
        </div>
      )}

      {/* Explicit Read-Only Guest Mode Banner */}
      {!isVerifiedMember && (
        <div
          role="status"
          data-testid="guest-readonly-banner"
          className="bg-amber-50 border-b border-amber-200 px-3 sm:px-6 py-2.5 text-xs text-amber-950"
        >
          <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <Eye className="w-4 h-4 text-amber-700 shrink-0" />
              <span>
                <strong>Gastmodus (Alleen-lezen — onbevestigde identiteit):</strong> Je bekijkt de live groepslijst, maar kunt als gast geen huisjes, stemmen of deelnemers toevoegen of wijzigen.
              </span>
            </span>
            <button
              type="button"
              onClick={handleLogoutOrExitGuest}
              className="px-3 py-1.5 rounded-lg bg-[#FC4C02] hover:bg-[#E04300] text-white font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              Inloggen met Google / E-mail →
            </button>
          </div>
        </div>
      )}

      {/* Safe One-Time Migration Banner if Hermen has custom houses in legacy localStorage */}
      {isVerifiedMember && pendingLocalCustomHouses.length > 0 && (
        <div className="bg-emerald-950 text-emerald-100 border-b border-emerald-800 px-3 sm:px-6 py-3 text-xs">
          <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <UploadCloud className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>
                Er staan nog <strong>{pendingLocalCustomHouses.length} eerder lokaal ingevoerde huisje(s)</strong> in deze browser ({pendingLocalCustomHouses.map((h) => h.title).join(', ')}). Zet ze nu veilig over naar de centrale Firestore-lijst zodat Erik en de groep ze ook zien:
              </span>
            </div>
            <button
              type="button"
              onClick={handleMigrateLocalCustomHouses}
              disabled={isMigratingLocal}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              {isMigratingLocal
                ? 'Bezig met overzetten...'
                : `Zet ${pendingLocalCustomHouses.length} huisje(s) over naar centrale lijst`}
            </button>
          </div>
        </div>
      )}

      {/* Prominent Event Context Header Banner */}
      <section className="bg-[#0F172A] text-white border-b border-slate-800">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-300">
              <span className="font-semibold text-[#FC4C02]">EVENEMENT</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5 text-white font-medium">
                <Calendar className="w-3.5 h-3.5 text-[#FC4C02] shrink-0" />
                <span>Do 27 mei t/m zo 30 mei 2027 (3 nachten)</span>
              </span>
              <span aria-hidden="true">·</span>
              <span>Ardennen / Zuid-Limburg / Eifel</span>
            </div>
            <h1 className="text-xl sm:text-3xl font-bold tracking-tight font-display uppercase text-white">
              Racefiets Weekend 2027 — Accommodatie & Route Planner
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-3xl">
              Samen vakantiehuizen aandragen, vergelijken op de kaart, auto- en fietsindeling afstemmen en stemmen op de groepsfavoriet.
            </p>
          </div>

          {/* Collaborator Identity & Quick Action Controls */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {isVerifiedMember && currentUser ? (
              <div className="flex items-center gap-2 bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-1.5 min-h-[38px]">
                <span className="text-[11px] text-slate-400 whitespace-nowrap">Weergavenaam:</span>
                <input
                  type="text"
                  maxLength={VALIDATION_CONSTRAINTS.NAME_MAX}
                  value={friendName}
                  onChange={(e) => setFriendName(e.target.value)}
                  aria-label="Jouw weergavenaam"
                  className="w-24 sm:w-28 bg-transparent text-xs font-semibold text-white focus:outline-hidden border-b border-transparent focus:border-[#FC4C02]"
                />
              </div>
            ) : (
              <span className="text-xs text-amber-300 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 font-medium">
                Gast (Alleen-lezen)
              </span>
            )}

            <button
              type="button"
              onClick={() => setActiveView('deelnemers')}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Car className="w-3.5 h-3.5 text-[#FC4C02] shrink-0" />
              <span>Auto’s ({activeParticipants.length})</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveView('beheren')}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ListChecks className="w-3.5 h-3.5 text-[#FC4C02] shrink-0" />
              <span>Beheren ({activeHouses.length})</span>
            </button>

            <button
              type="button"
              onClick={handleLogoutOrExitGuest}
              title={
                currentUser
                  ? `Geverifieerd ingelogd als ${currentUser.email} (UID: ${currentUser.uid.slice(0, 8)}...) — klik om uit te loggen`
                  : 'Gastmodus verlaten en inloggen'
              }
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isVerifiedMember ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="max-w-[140px] truncate">{currentUser?.email}</span>
                  <LogOut className="w-3.5 h-3.5 text-slate-400 ml-0.5 shrink-0" />
                </>
              ) : (
                <>
                  <LogIn className="w-3.5 h-3.5 text-[#FC4C02] shrink-0" />
                  <span>Inloggen</span>
                </>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* Undo Delete Banner when a house was just deleted */}
      {lastDeletedHouse && isVerifiedMember && (
        <div className="bg-amber-50 border-b border-amber-200 px-3 sm:px-6 py-2.5">
          <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
            <span className="text-amber-900">
              Huisje <strong>“{lastDeletedHouse.title}”</strong> is verwijderd.
            </span>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={handleUndoDeleteHouse}
                className="inline-flex items-center gap-1 font-bold text-[#FC4C02] hover:underline cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Ongedaan maken (Zet terug)
              </button>
              <button
                type="button"
                onClick={() => setLastDeletedHouse(null)}
                className="text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                Sluiten
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Feedback Banner */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-5 sm:max-w-md z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg border border-slate-700 text-xs font-medium flex items-center gap-2.5"
        >
          <CheckCircle2 className="w-4 h-4 text-[#FC4C02] shrink-0" />
          <span className="leading-snug">{toastMessage}</span>
        </div>
      )}

      {/* Mobile Navigation & View Switcher (Responsive down to 320px without horizontal overflow) */}
      <div className="flex lg:hidden flex-col gap-2 px-3 py-2.5 bg-white border-b border-slate-200">
        {/* Row 1: Primary 4 sections */}
        <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveView('vergelijken')}
            className={`min-h-[40px] px-1.5 py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors truncate cursor-pointer ${
              activeView === 'vergelijken' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Huisjes ({activeHouses.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveView('beheren')}
            className={`min-h-[40px] px-1.5 py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors truncate cursor-pointer ${
              activeView === 'beheren' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Beheren
          </button>
          <button
            type="button"
            onClick={() => setActiveView('deelnemers')}
            className={`min-h-[40px] px-1.5 py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors truncate cursor-pointer ${
              activeView === 'deelnemers' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Auto’s ({activeParticipants.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveView('ideeen')}
            className={`min-h-[40px] px-1.5 py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors truncate cursor-pointer ${
              activeView === 'ideeen' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Ideeën ({activeIdeas.length})
          </button>
        </div>

        {/* Row 2: Explicit List vs Map Switcher on mobile so Huisjeslijst is always prominent */}
        {activeView === 'vergelijken' && (
          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setMobilePane('lijst')}
              data-testid="mobile-pane-lijst-btn"
              className={`min-h-[38px] px-2 py-1 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors truncate cursor-pointer ${
                mobilePane === 'lijst'
                  ? 'bg-[#FC4C02] text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              Huisjeslijst ({displayedHouses.length})
            </button>
            <button
              type="button"
              onClick={() => setMobilePane('kaart')}
              data-testid="mobile-pane-kaart-btn"
              className={`min-h-[38px] px-2 py-1 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors truncate cursor-pointer ${
                mobilePane === 'kaart'
                  ? 'bg-[#FC4C02] text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              Kaartweergave
            </button>
            <button
              type="button"
              onClick={() => setMobilePane('beide')}
              data-testid="mobile-pane-beide-btn"
              className={`min-h-[38px] px-2 py-1 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors truncate cursor-pointer ${
                mobilePane === 'beide'
                  ? 'bg-[#FC4C02] text-white shadow-xs'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              Lijst + Kaart
            </button>
          </div>
        )}
      </div>

      {/* VIEW 1: Kaart & Huisjes Vergelijken */}
      {activeView === 'vergelijken' && (
        <main className="flex-1 max-w-[1440px] w-full mx-auto px-3 sm:px-6 py-4 sm:py-5 grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-start">
          {/* LEFT COLUMN (Desktop 5 cols, Mobile order-2 so Houses List is ALWAYS first in 'beide' mode!) */}
          <div
            className={`lg:col-span-5 order-2 lg:order-1 lg:sticky lg:top-20 space-y-4 ${
              mobilePane === 'lijst' ? 'hidden lg:block' : 'block'
            }`}
          >
            {/* On mobile when viewing map only, provide a direct 1-tap button back to the houses list */}
            {mobilePane === 'kaart' && (
              <div className="flex lg:hidden items-center justify-between gap-2 bg-white p-3 rounded-xl border border-slate-200">
                <span className="text-xs font-bold text-slate-800 truncate">
                  Kaartweergave ({displayedHouses.length} huisjes)
                </span>
                <button
                  type="button"
                  onClick={() => setMobilePane('lijst')}
                  className="min-h-[38px] px-3 py-1.5 rounded-lg bg-[#FC4C02] text-white text-xs font-bold whitespace-nowrap shrink-0 cursor-pointer"
                >
                  ← Terug naar Huisjeslijst
                </button>
              </div>
            )}

            <div className="h-[300px] sm:h-[440px] lg:h-[calc(100vh-190px)] min-h-[260px]">
              <LeafletMap
                houses={displayedHouses}
                cyclistCount={cyclistCount}
                selectedHouseId={selectedHouseId}
                favoriteHouseId={favoriteHouseId}
                onSelectHouse={(id) => setSelectedHouseId(id)}
              />
            </div>

            {/* Compact Deelnemers & Auto's Teaser Box below map */}
            <div className="bg-white rounded-xl border border-slate-200 p-3.5 sm:p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                  <Car className="w-4 h-4 text-[#FC4C02] shrink-0" />
                  <span className="truncate">
                    Auto’s: {totalParticipantsCount} fietsers · {totalDriversCount} chauffeurs
                  </span>
                </div>
                <p className="text-xs text-slate-500 truncate mt-0.5 font-mono-num">
                  Capaciteit: {totalCarSeats} zitplaatsen · {totalBikeSpots} fietsplekken
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveView('deelnemers')}
                className="min-h-[38px] px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-900 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                Indeling →
              </button>
            </div>
          </div>

          {/* RIGHT COLUMN (Desktop 7 cols, Mobile order-1 so Huisjeslijst is always immediately visible!) */}
          <div
            data-testid="houses-list-column"
            className={`lg:col-span-7 order-1 lg:order-2 space-y-4 sm:space-y-5 min-w-0 ${
              mobilePane === 'kaart' ? 'hidden lg:block' : 'block'
            }`}
          >
            {/* Interactive Price-per-Person Calculator & Cyclist Counter */}
            <div className="bg-white rounded-xl border border-slate-200 p-3.5 sm:p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-lg bg-[#FC4C02]/10 text-[#FC4C02] flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <label
                      htmlFor="cyclist-slider"
                      className="text-sm font-bold text-slate-900 block"
                    >
                      Aantal fietsers dat meegaat
                    </label>
                    <p className="text-xs text-slate-500">
                      Berekent direct de prijs p.p. én prijs p.p. per nacht (3 nachten)
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => setCyclistCount((c) => Math.max(2, c - 1))}
                    className="w-9 h-9 rounded-lg border border-slate-300 hover:bg-slate-100 font-mono-num font-bold text-slate-700 cursor-pointer"
                    aria-label="Minder fietsers"
                  >
                    −
                  </button>
                  <div className="px-3.5 py-1.5 rounded-lg bg-slate-900 text-white font-mono-num text-sm font-bold min-w-[92px] text-center">
                    {cyclistCount} fietsers
                  </div>
                  <button
                    type="button"
                    onClick={() => setCyclistCount((c) => Math.min(20, c + 1))}
                    className="w-9 h-9 rounded-lg border border-slate-300 hover:bg-slate-100 font-mono-num font-bold text-slate-700 cursor-pointer"
                    aria-label="Meer fietsers"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-mono-num text-slate-400">2</span>
                <input
                  id="cyclist-slider"
                  type="range"
                  min={2}
                  max={20}
                  value={cyclistCount}
                  onChange={(e) => setCyclistCount(Number(e.target.value))}
                  className="w-full accent-[#FC4C02] cursor-pointer h-2 bg-slate-200 rounded-lg"
                />
                <span className="text-xs font-mono-num text-slate-400">20</span>
              </div>

              {/* Filter & Sort Controls Bar */}
              <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                {/* Extra's filter segmented buttons */}
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
                  {(
                    [
                      { id: 'alle', label: 'Alle huisjes' },
                      { id: 'bbq', label: 'BBQ plaats' },
                      { id: 'openhaard', label: 'Open haard' },
                      { id: 'jacuzzi', label: 'Jacuzzi' },
                      { id: 'sauna', label: 'Sauna' },
                    ] as { id: FacilityFilter; label: string }[]
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setFacilityFilter(tab.id)}
                      className={`min-h-[34px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        facilityFilter === tab.id
                          ? 'bg-white text-slate-900 shadow-xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Sort & Display Mode selector */}
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    aria-label="Sorteer vakantiehuizen"
                    className="min-h-[36px] px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 focus:border-[#FC4C02] focus:outline-hidden cursor-pointer"
                  >
                    <option value="populariteit">Populariteit (meeste stemmen)</option>
                    <option value="prijs_oplopend">Prijs (laag naar hoog)</option>
                    <option value="slaapkamers">Meeste slaapkamers</option>
                  </select>

                  {/* Switch between Cards and Compact List Table */}
                  <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setListDisplayMode('kaarten')}
                      title="Kaartweergave met foto's"
                      className={`min-h-[32px] inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                        listDisplayMode === 'kaarten'
                          ? 'bg-white text-slate-900 shadow-xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Kaarten</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setListDisplayMode('tabel')}
                      title="Compacte beheerlijst"
                      className={`min-h-[32px] inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                        listDisplayMode === 'tabel'
                          ? 'bg-white text-slate-900 shadow-xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <List className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Compacte lijst</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Search input */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Zoek op plaatsnaam, beklimming of naam..."
                  className="w-full pl-9 pr-3.5 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-[#FC4C02] focus:outline-hidden text-xs text-slate-900"
                />
              </div>
            </div>

            {/* Firestore Error Banner if any */}
            {firestoreLoadError && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-xs text-red-900 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Fout bij ophalen van Firestore-gegevens</div>
                  <p className="mt-0.5">{firestoreLoadError}</p>
                </div>
              </div>
            )}

            {/* Loading / Empty / Populated States */}
            {cloudHouses === null ? (
              <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-2">
                <Cloud className="w-6 h-6 text-[#FC4C02] mx-auto animate-pulse" />
                <p className="text-xs font-semibold text-slate-700">
                  Bezig met synchroniseren van de centrale groepslijst...
                </p>
              </div>
            ) : displayedHouses.length === 0 ? (
              <div
                data-testid="empty-houses-state"
                className="bg-white rounded-xl border border-slate-200 p-8 sm:p-10 text-center space-y-3"
              >
                <Bike className="w-8 h-8 text-slate-400 mx-auto" />
                <h3 className="text-base font-bold text-slate-900">
                  Nog geen vakantiehuizen in deze centrale lijst
                </h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  {activeHouses.length === 0
                    ? 'De centrale groepslijst is momenteel leeg (voorbeeldhuisjes worden nooit automatisch teruggezet). Voeg het eerste echte voorstel toe!'
                    : 'Geen huisjes gevonden met de huidige zoekopdracht of filter.'}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                  {(facilityFilter !== 'alle' || searchQuery.trim()) && (
                    <button
                      type="button"
                      onClick={() => {
                        setFacilityFilter('alle');
                        setSearchQuery('');
                      }}
                      className="min-h-[40px] px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Filters wissen
                    </button>
                  )}
                  {isVerifiedMember ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingHouse(null);
                        setIsAddModalOpen(true);
                      }}
                      className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FC4C02] text-white text-xs font-semibold hover:bg-[#E04300] cursor-pointer"
                    >
                      + Nieuw Huisje Toevoegen
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleLogoutOrExitGuest}
                      className="min-h-[40px] px-4 py-2 rounded-lg bg-[#FC4C02] text-white text-xs font-semibold hover:bg-[#E04300] cursor-pointer"
                    >
                      Log in met Google / Apple om een huisje toe te voegen
                    </button>
                  )}
                </div>
              </div>
            ) : listDisplayMode === 'tabel' ? (
              /* COMPACT LIST / TABLE MODE right inside the main view */
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800">
                    Overzichtslijst ({displayedHouses.length} huisjes)
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveView('beheren')}
                    className="text-xs font-semibold text-[#FC4C02] hover:underline cursor-pointer"
                  >
                    Volledig lijstbeheer →
                  </button>
                </div>
                <div className="divide-y divide-slate-200">
                  {displayedHouses.map((house) => {
                    const pricePerPerson = Math.round(house.totalPrice / Math.max(1, cyclistCount));
                    const isFavorite = house.id === favoriteHouseId && house.voteScore > 0;
                    const isOwnerOrAdmin = canModifyRecord(house.ownerId);
                    return (
                      <div
                        key={house.id}
                        className="p-4 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            {isFavorite && (
                              <span className="text-amber-600 text-xs font-bold shrink-0">★ Favoriet</span>
                            )}
                            <h4 className="text-sm font-bold text-slate-900 truncate">
                              {house.title}
                            </h4>
                          </div>
                          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span>{house.locationName}</span>
                            <span>·</span>
                            <span>{house.bedrooms} slpk / {house.bathrooms} badk</span>
                            <span>·</span>
                            <span>Door {house.addedBy}</span>
                            <span>·</span>
                            <span className="font-mono-num font-semibold text-slate-800">
                              {house.voteScore} pt
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <div className="text-right font-mono-num mr-2">
                            <div className="text-sm font-bold text-[#FC4C02]">€{pricePerPerson} p.p.</div>
                            <div className="text-[11px] text-slate-500">€{house.totalPrice} tot.</div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleShowOnMap(house.id)}
                            className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-800 cursor-pointer"
                          >
                            Op kaart
                          </button>
                          {isOwnerOrAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenEditHouse(house)}
                                className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-xs font-medium text-slate-700 cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                Bewerk
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteHouse(house)}
                                className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-semibold cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Verwijder
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* DETAILED HOUSE CARDS */
              <div className="space-y-4">
                {displayedHouses.map((house) => {
                  const isFavorite = house.id === favoriteHouseId && house.voteScore > 0;
                  const isSelected = house.id === selectedHouseId;
                  const pricePerPerson = Math.round(house.totalPrice / Math.max(1, cyclistCount));
                  const pricePerNightPP = Math.round(pricePerPerson / 3);
                  const commentsList = house.comments || [];
                  const votesList = house.votes || [];
                  const isCommentsOpen = Boolean(expandedComments[house.id]);
                  const isOwnerOrAdmin = canModifyRecord(house.ownerId);

                  const currentUserVote = currentUser
                    ? votesList.find((v) => v.userId === currentUser.uid)
                    : undefined;

                  return (
                    <article
                      key={house.id}
                      data-testid={`house-card-${house.id}`}
                      className={`group bg-white rounded-xl border transition-colors overflow-hidden ${
                        isSelected
                          ? 'border-[#FC4C02] ring-2 ring-[#FC4C02]/20'
                          : isFavorite
                          ? 'border-amber-400'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {/* Top Groepsfavoriet banner if #1 */}
                      {isFavorite && (
                        <div className="bg-amber-500/10 border-b border-amber-300/60 px-4 py-2 flex items-center justify-between gap-2 text-xs">
                          <span className="font-bold text-amber-900 flex items-center gap-1.5">
                            <Trophy className="w-4 h-4 text-amber-600 shrink-0" />
                            <span>Groepsfavoriet 🏆 — Meeste stemmen</span>
                          </span>
                          <span className="font-mono-num font-semibold text-amber-800 shrink-0">
                            {house.voteScore} pt ({house.voteCount})
                          </span>
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-12">
                        {/* Left Visual Column */}
                        <div className="md:col-span-5 relative">
                          <HouseIllustration
                            id={house.id}
                            title={house.title}
                            locationName={house.locationName}
                            photoUrl={house.photoUrl}
                            isFavorite={isFavorite}
                            lat={house.lat}
                            lng={house.lng}
                          />
                        </div>

                        {/* Right Content Column */}
                        <div className="md:col-span-7 p-4 sm:p-5 flex flex-col justify-between space-y-3.5 min-w-0">
                          <div>
                            {/* Unboxed metadata kicker + Owner/Admin Edit & Delete buttons */}
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 mb-1.5">
                              <span className="truncate">
                                Toegevoegd door <strong className="text-slate-700">{house.addedBy}</strong>
                                {' · '}
                                {house.locationName}
                              </span>
                              {isOwnerOrAdmin && (
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditHouse(house)}
                                    data-testid={`edit-house-${house.id}`}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer text-[11px] font-medium"
                                  >
                                    <Pencil className="w-3 h-3" />
                                    Bewerken
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteHouse(house)}
                                    data-testid={`delete-house-${house.id}`}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-200 bg-red-50/70 text-red-700 hover:bg-red-100 transition-colors cursor-pointer text-[11px] font-medium"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    Verwijderen
                                  </button>
                                </div>
                              )}
                            </div>

                            <h3 className="text-base sm:text-lg font-bold text-slate-900 leading-snug break-words">
                              {house.title}
                            </h3>

                            {/* Kamers & Extra's metadata line (clean unboxed text with separators) */}
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 mt-2">
                              <span className="inline-flex items-center gap-1 font-medium text-slate-800">
                                <BedDouble className="w-3.5 h-3.5 text-slate-500" />
                                <span className="tabular-nums">{house.bedrooms}</span> slaapkamers
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1 font-medium text-slate-800">
                                <Bath className="w-3.5 h-3.5 text-slate-500" />
                                <span className="tabular-nums">{house.bathrooms}</span> badkamers
                              </span>

                              {house.hasBbq && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                    <UtensilsCrossed className="w-3.5 h-3.5" />
                                    BBQ plaats
                                  </span>
                                </>
                              )}
                              {house.hasFireplace && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                    <Flame className="w-3.5 h-3.5" />
                                    Open haard
                                  </span>
                                </>
                              )}
                              {house.hasJacuzzi && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                    <Waves className="w-3.5 h-3.5" />
                                    Jacuzzi
                                  </span>
                                </>
                              )}
                              {house.hasSauna && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                                    <ThermometerSun className="w-3.5 h-3.5" />
                                    Sauna
                                  </span>
                                </>
                              )}
                            </div>

                            {/* Notes & Known Climbs */}
                            {house.notes && (
                              <p className="text-xs text-slate-600 leading-relaxed mt-2.5 line-clamp-3 break-words">
                                {house.notes}
                              </p>
                            )}
                          </div>

                          {/* Live Price Calculator Strip */}
                          <div className="grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 font-mono-num">
                            <div>
                              <span className="block text-[10px] text-slate-500 uppercase">
                                Prijs p.p. ({cyclistCount}p)
                              </span>
                              <span className="text-base font-bold text-[#FC4C02]">
                                €{pricePerPerson}
                              </span>
                            </div>
                            <div>
                              <span className="block text-[10px] text-slate-500 uppercase">
                                Per p.p. / nacht
                              </span>
                              <span className="text-sm font-semibold text-slate-800">
                                €{pricePerNightPP}
                              </span>
                            </div>
                            <div>
                              <span className="block text-[10px] text-slate-500 uppercase">
                                Totaal (3n)
                              </span>
                              <span className="text-sm font-semibold text-slate-800">
                                €{house.totalPrice}
                              </span>
                            </div>
                          </div>

                          {/* Action Buttons Row: Map Focus, Route Link, External Site */}
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleShowOnMap(house.id)}
                                className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <MapPin className="w-3.5 h-3.5 text-[#FC4C02]" />
                                Toon op kaart
                              </button>

                              {house.routeUrl && (
                                <a
                                  href={house.routeUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
                                >
                                  <Route className="w-3.5 h-3.5 text-[#FC4C02]" />
                                  Fietsroute ↗
                                </a>
                              )}
                            </div>

                            <a
                              href={house.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="min-h-[36px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                            >
                              <span>Accommodatie</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>
                      </div>

                      {/* Bottom Collaborative Footer: Voting System & Collapsible Comments */}
                      <div className="bg-slate-50 border-t border-slate-200 px-3 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
                        {/* Rating / Upvote & Star Buttons */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-slate-700 font-mono-num">
                            Score: {house.voteScore} pt ({house.voteCount} stemmen)
                          </span>
                          <span className="text-slate-300 hidden sm:inline" aria-hidden="true">|</span>
                          <div className="flex items-center gap-0.5">
                            {[1, 2, 3, 4, 5].map((starVal) => {
                              const active = currentUserVote && currentUserVote.value >= starVal;
                              return (
                                <button
                                  key={starVal}
                                  type="button"
                                  disabled={!isVerifiedMember}
                                  onClick={() => handleVoteHouse(house, starVal)}
                                  title={
                                    isVerifiedMember
                                      ? `Geef ${starVal} sterren`
                                      : 'Log in met Google of Apple om te stemmen'
                                  }
                                  className={`p-1.5 rounded transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                                    active
                                      ? 'text-amber-500 hover:text-amber-600'
                                      : 'text-slate-300 hover:text-amber-400'
                                  }`}
                                >
                                  <Star className="w-4 h-4 fill-current" />
                                </button>
                              );
                            })}
                          </div>
                          <button
                            type="button"
                            disabled={!isVerifiedMember}
                            onClick={() => handleVoteHouse(house, 5)}
                            className={`min-h-[32px] inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                              currentUserVote?.value === 5
                                ? 'bg-[#FC4C02] text-white'
                                : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                            }`}
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                            Topkeuze (+5)
                          </button>
                          <button
                            type="button"
                            disabled={!isVerifiedMember}
                            onClick={() => handleVoteHouse(house, -1)}
                            className={`min-h-[32px] inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                              currentUserVote?.value === -1
                                ? 'bg-slate-800 text-white'
                                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            <ThumbsDown className="w-3.5 h-3.5" />
                            −1
                          </button>
                        </div>

                        {/* Toggle Comments Button */}
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedComments((prev) => ({
                              ...prev,
                              [house.id]: !prev[house.id],
                            }))
                          }
                          className="min-h-[32px] inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer whitespace-nowrap shrink-0"
                        >
                          <MessageSquare className="w-3.5 h-3.5 text-[#FC4C02]" />
                          <span>Reacties ({commentsList.length})</span>
                          {isCommentsOpen ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>

                      {/* Collapsible Comments Section */}
                      {isCommentsOpen && (
                        <div className="bg-slate-50/70 border-t border-slate-200 px-4 py-3.5 space-y-3">
                          {/* Voter breakdown line */}
                          {votesList.length > 0 && (
                            <div className="text-[11px] text-slate-500">
                              Stemmen:{' '}
                              {votesList.map((v, idx) => (
                                <span key={v.id}>
                                  {idx > 0 && ' · '}
                                  <strong className="text-slate-700">{v.voterName}</strong> (
                                  {v.value > 0 ? `+${v.value}★` : v.value})
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Existing comments */}
                          {commentsList.length === 0 ? (
                            <p className="text-xs text-slate-500 italic">
                              Nog geen opmerkingen. Laat als eerste weten wat je van dit huisje vindt!
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {commentsList.map((c) => (
                                <div
                                  key={c.id}
                                  className="bg-white rounded-lg border border-slate-200 px-3 py-2 text-xs"
                                >
                                  <div className="flex items-center justify-between text-[11px] text-slate-400 mb-0.5">
                                    <span className="font-bold text-slate-800">{c.authorName}</span>
                                    <span className="font-mono-num">
                                      {new Date(c.createdAt).toLocaleDateString('nl-NL', {
                                        day: 'numeric',
                                        month: 'short',
                                      })}
                                    </span>
                                  </div>
                                  <p className="text-slate-700 break-words">{c.text}</p>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Add comment input (Verified users only) */}
                          {isVerifiedMember ? (
                            <div className="flex items-center gap-2 pt-1">
                              <input
                                type="text"
                                maxLength={VALIDATION_CONSTRAINTS.COMMENT_MAX}
                                value={commentDrafts[house.id] || ''}
                                onChange={(e) =>
                                  setCommentDrafts((prev) => ({
                                    ...prev,
                                    [house.id]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleAddComment(house);
                                  }
                                }}
                                placeholder={`Plaats een opmerking als ${friendName || 'Groepslid'}...`}
                                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 focus:border-[#FC4C02] focus:outline-hidden"
                              />
                              <button
                                type="button"
                                onClick={() => handleAddComment(house)}
                                className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <Send className="w-3.5 h-3.5" />
                                Plaats
                              </button>
                            </div>
                          ) : (
                            <p className="text-[11px] text-amber-800">
                              Log in met Google of Apple om een reactie te plaatsen.
                            </p>
                          )}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </main>
      )}

      {/* VIEW 2: Lijst Beheren */}
      {activeView === 'beheren' && (
        <main className="flex-1 max-w-[1280px] w-full mx-auto px-3 sm:px-6 py-6 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 font-display uppercase">
                Huisjes & Lijst Beheren ({activeHouses.length})
              </h2>
              <p className="text-xs sm:text-sm text-slate-600">
                Overzicht van alle aangedragen huisjes in de centrale database ({activeTripId}). Eigenaars kunnen hun eigen ingevoerde huisjes aanpassen of verwijderen.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setActiveView('vergelijken')}
                className="min-h-[40px] px-3.5 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
              >
                ← Terug naar Kaart & Huisjes
              </button>
              {isVerifiedMember && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingHouse(null);
                    setIsAddModalOpen(true);
                  }}
                  className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FC4C02] text-white text-xs font-semibold hover:bg-[#E04300] cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Nieuw Huisje Toevoegen
                </button>
              )}
            </div>
          </div>

          {/* Houses Management Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-bold text-slate-800">
                Alle vakantiehuizen in de lijst ({activeHouses.length})
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsTestEnvironment((prev) => !prev)}
                  className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  {isTestEnvironment
                    ? 'Naar Productieomgeving (racefiets-2027)'
                    : 'Open Testomgeving (racefiets-2027-test)'}
                </button>
                {isVerifiedMember && activeHouses.some((h) => canModifyRecord(h.ownerId)) && (
                  <button
                    type="button"
                    onClick={handleClearHousesInEnvironment}
                    className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-xs font-semibold text-red-700 hover:bg-red-100 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Wis mijn huisjes
                  </button>
                )}
              </div>
            </div>

            {activeHouses.length === 0 ? (
              <div className="p-8 sm:p-10 text-center space-y-3">
                <p className="text-sm font-semibold text-slate-800">
                  De centrale lijst met huisjes is momenteel leeg.
                </p>
                <p className="text-xs text-slate-500">
                  Er worden geen standaard voorbeeldhuisjes geladen. Voeg een nieuw vakantiehuis toe om te starten.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/50">
                      <th className="py-3 px-4 font-semibold">Naam & Locatie</th>
                      <th className="py-3 px-4 font-semibold">Door</th>
                      <th className="py-3 px-4 font-semibold">Kamers & Extra’s</th>
                      <th className="py-3 px-4 font-semibold text-right">Totaalprijs</th>
                      <th className="py-3 px-4 font-semibold text-right">Prijs p.p. ({cyclistCount}p)</th>
                      <th className="py-3 px-4 font-semibold text-right">Stemmen</th>
                      <th className="py-3 px-4 font-semibold text-right">Acties (Beheren)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {activeHouses.map((house) => {
                      const pp = Math.round(house.totalPrice / Math.max(1, cyclistCount));
                      const isFav = house.id === favoriteHouseId && house.voteScore > 0;
                      const isOwnerOrAdmin = canModifyRecord(house.ownerId);
                      const extras: string[] = [];
                      if (house.hasBbq) extras.push('BBQ');
                      if (house.hasFireplace) extras.push('Open haard');
                      if (house.hasJacuzzi) extras.push('Jacuzzi');
                      if (house.hasSauna) extras.push('Sauna');

                      return (
                        <tr key={house.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                              {isFav && <span className="text-amber-500">★</span>}
                              <span>{house.title}</span>
                            </div>
                            <div className="text-slate-500 mt-0.5 flex items-center gap-2">
                              <span>{house.locationName}</span>
                              <span>·</span>
                              <a
                                href={house.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#FC4C02] hover:underline inline-flex items-center gap-0.5"
                              >
                                Bekijk site <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 font-medium text-slate-700 whitespace-nowrap">
                            {house.addedBy}
                          </td>
                          <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap">
                            <div className="font-mono-num">{house.bedrooms} slpk · {house.bathrooms} badk</div>
                            {extras.length > 0 && (
                              <div className="text-[11px] text-emerald-700">{extras.join(' · ')}</div>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono-num font-semibold text-slate-900 whitespace-nowrap">
                            €{house.totalPrice}
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono-num font-bold text-[#FC4C02] whitespace-nowrap">
                            €{pp} p.p.
                          </td>
                          <td className="py-3.5 px-4 text-right font-mono-num text-slate-700 whitespace-nowrap">
                            {house.voteScore} pt ({house.voteCount})
                          </td>
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleShowOnMap(house.id)}
                                className="min-h-[34px] px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold cursor-pointer"
                              >
                                Toon op kaart
                              </button>
                              {isOwnerOrAdmin && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditHouse(house)}
                                    className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                    Bewerken
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteHouse(house)}
                                    className="min-h-[34px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    Verwijderen
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      )}

      {/* VIEW 3: Deelnemers, Chauffeurs & Auto-indeling */}
      {activeView === 'deelnemers' && (
        <main className="flex-1 max-w-[1280px] w-full mx-auto px-3 sm:px-6 py-6 space-y-6">
          {/* Header Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 font-display uppercase">
                Deelnemers, Chauffeurs & Auto-indeling
              </h2>
              <p className="text-xs sm:text-sm text-slate-600">
                Zet je naam op de lijst en geef aan of je chauffeur wilt zijn, hoeveel mensen er mee kunnen in je auto en hoeveel racefietsen je kunt vervoeren (0 t/m 15).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {totalParticipantsCount >= 2 && totalParticipantsCount !== cyclistCount && (
                <button
                  type="button"
                  onClick={() => {
                    setCyclistCount(totalParticipantsCount);
                    showToast(`Prijs-calculator ingesteld op ${totalParticipantsCount} deelnemers!`);
                  }}
                  className="min-h-[40px] px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer"
                >
                  Zet prijscalculator op {totalParticipantsCount} fietsers
                </button>
              )}
              <button
                type="button"
                onClick={() => setActiveView('vergelijken')}
                className="min-h-[40px] px-3.5 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
              >
                ← Terug naar Kaart & Huisjes
              </button>
            </div>
          </div>

          {/* Live Capacity Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-xs text-slate-500 font-medium">Aangemelde deelnemers</div>
              <div className="text-2xl font-bold font-mono-num text-slate-900 mt-1">
                {totalParticipantsCount} personen
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                {totalDriversCount} chauffeurs · {Math.max(0, totalParticipantsCount - totalDriversCount)} meerijders
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-xs text-slate-500 font-medium">Aantal auto’s (Chauffeurs)</div>
              <div className="text-2xl font-bold font-mono-num text-slate-900 mt-1">
                {totalDriversCount} auto’s
              </div>
              <div className="text-[11px] text-slate-500 mt-1">
                Chauffeurs die kunnen rijden
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-xs text-slate-500 font-medium">Zitplaatsen in auto’s</div>
              <div className="text-2xl font-bold font-mono-num mt-1 flex items-center gap-2">
                <span
                  className={
                    totalCarSeats >= totalParticipantsCount ? 'text-emerald-700' : 'text-amber-600'
                  }
                >
                  {totalCarSeats} / {totalParticipantsCount} plekken
                </span>
              </div>
              <div className="text-[11px] mt-1 flex items-center gap-1">
                {totalCarSeats >= totalParticipantsCount ? (
                  <span className="text-emerald-700 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Iedereen kan mee in de auto!
                  </span>
                ) : (
                  <span className="text-amber-700 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> Nog {totalParticipantsCount - totalCarSeats} zitplaats(en) nodig
                  </span>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="text-xs text-slate-500 font-medium">Plek voor racefietsen</div>
              <div className="text-2xl font-bold font-mono-num mt-1 flex items-center gap-2">
                <span
                  className={
                    totalBikeSpots >= totalParticipantsCount ? 'text-emerald-700' : 'text-amber-600'
                  }
                >
                  {totalBikeSpots} / {totalParticipantsCount} fietsen
                </span>
              </div>
              <div className="text-[11px] mt-1 flex items-center gap-1">
                {totalBikeSpots >= totalParticipantsCount ? (
                  <span className="text-emerald-700 font-medium flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Alle racefietsen passen mee!
                  </span>
                ) : (
                  <span className="text-amber-700 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> Nog {totalParticipantsCount - totalBikeSpots} fietsplek(ken) nodig
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Main Grid: Add Participant Form + Participants Table */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left 4 cols: Add Participant Form */}
            <form
              onSubmit={handleAddParticipant}
              noValidate
              data-testid="add-participant-form"
              className="lg:col-span-4 bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4"
            >
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Car className="w-4 h-4 text-[#FC4C02]" />
                Deelnemer Toevoegen aan Lijst
              </h3>

              <div>
                <label
                  htmlFor="participant-name-input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Naam deelnemer *
                </label>
                <input
                  id="participant-name-input"
                  data-testid="participant-name-input"
                  type="text"
                  required
                  disabled={!isVerifiedMember}
                  maxLength={VALIDATION_CONSTRAINTS.NAME_MAX}
                  value={participantName}
                  onChange={(e) => {
                    setParticipantName(e.target.value);
                    setParticipantFormError(null);
                  }}
                  placeholder="Bijv. Hermen of Erik"
                  className="w-full min-h-[40px] px-3.5 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:border-[#FC4C02] focus:outline-hidden disabled:bg-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Wil je chauffeur zijn (met eigen auto rijden)?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!isVerifiedMember}
                    onClick={() => {
                      setParticipantIsDriver(true);
                      // CRITICAL: Never overwrite a valid '0' in participantBikeSpotsInput!
                      if (participantCarSeatsInput.trim() === '' || participantCarSeatsInput === '0') {
                        setParticipantCarSeatsInput('3');
                      }
                      if (participantBikeSpotsInput.trim() === '') {
                        setParticipantBikeSpotsInput('0');
                      }
                      setParticipantFormError(null);
                    }}
                    className={`min-h-[40px] py-2 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                      participantIsDriver
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Ja, ik kan rijden 🚗
                  </button>
                  <button
                    type="button"
                    disabled={!isVerifiedMember}
                    onClick={() => {
                      setParticipantIsDriver(false);
                      setParticipantFormError(null);
                    }}
                    className={`min-h-[40px] py-2 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 ${
                      !participantIsDriver
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Nee, ik rijd mee
                  </button>
                </div>
              </div>

              {participantIsDriver && (
                <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div>
                    <label
                      htmlFor="participant-seats-input"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      Mensen in auto (incl. jij)
                    </label>
                    <input
                      id="participant-seats-input"
                      data-testid="participant-seats-input"
                      type="text"
                      inputMode="numeric"
                      disabled={!isVerifiedMember}
                      value={participantCarSeatsInput}
                      onChange={(e) => {
                        setParticipantCarSeatsInput(e.target.value);
                        setParticipantFormError(null);
                      }}
                      placeholder="Bijv. 3"
                      className="w-full min-h-[38px] px-3 py-1.5 bg-white rounded-lg border border-slate-300 font-mono-num text-xs text-slate-900 focus:border-[#FC4C02] focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="participant-bikes-input"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      Aantal fietsen (0 t/m 15)
                    </label>
                    <input
                      id="participant-bikes-input"
                      data-testid="participant-bikes-input"
                      type="text"
                      inputMode="numeric"
                      disabled={!isVerifiedMember}
                      value={participantBikeSpotsInput}
                      onChange={(e) => {
                        setParticipantBikeSpotsInput(e.target.value);
                        setParticipantFormError(null);
                      }}
                      placeholder="0, 1, 2, 3..."
                      className="w-full min-h-[38px] px-3 py-1.5 bg-white rounded-lg border border-slate-300 font-mono-num text-xs text-slate-900 focus:border-[#FC4C02] focus:outline-hidden"
                    />
                  </div>
                </div>
              )}

              <div>
                <label
                  htmlFor="participant-notes-input"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Opmerking / Vertrekplaats (optioneel)
                </label>
                <input
                  id="participant-notes-input"
                  type="text"
                  disabled={!isVerifiedMember}
                  maxLength={300}
                  value={participantNotes}
                  onChange={(e) => setParticipantNotes(e.target.value)}
                  placeholder="Bijv. Alleen bagage (0 fietsen) of Thule drager"
                  className="w-full min-h-[40px] px-3.5 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:border-[#FC4C02] focus:outline-hidden disabled:bg-slate-100"
                />
              </div>

              {participantFormError && (
                <div
                  role="alert"
                  data-testid="participant-form-error"
                  className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{participantFormError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={!isVerifiedMember}
                data-testid="participant-submit-btn"
                className="w-full min-h-[42px] py-2.5 rounded-lg bg-[#FC4C02] hover:bg-[#E04300] text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isVerifiedMember ? '+ Deelnemer Toevoegen' : 'Log in om deelnemer toe te voegen'}
              </button>
            </form>

            {/* Right 8 cols: Interactive Participants Table */}
            <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">
                  Deelnemerslijst ({activeParticipants.length} personen)
                </span>
              </div>

              {activeParticipants.length === 0 ? (
                <div className="p-8 sm:p-10 text-center space-y-2">
                  <p className="text-sm font-semibold text-slate-800">Nog geen deelnemers op de lijst.</p>
                  <p className="text-xs text-slate-500">Voeg hiernaast je naam toe om de auto-indeling te maken.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/50">
                        <th className="py-3 px-4 font-semibold">Naam deelnemer</th>
                        <th className="py-3 px-4 font-semibold">Chauffeur?</th>
                        <th className="py-3 px-4 font-semibold text-center">Mensen in auto</th>
                        <th className="py-3 px-4 font-semibold text-center">Fietsen mee</th>
                        <th className="py-3 px-4 font-semibold">Opmerking</th>
                        <th className="py-3 px-4 font-semibold text-right">Actie</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {activeParticipants.map((p) => {
                        const isOwnerOrAdmin = canModifyRecord(p.ownerId);
                        return (
                          <tr
                            key={p.id}
                            data-testid={`participant-row-${p.id}`}
                            className="hover:bg-slate-50 transition-colors"
                          >
                            <td className="py-3.5 px-4 font-bold text-slate-900 text-sm whitespace-nowrap">
                              {p.name}
                            </td>

                            {/* Toggle Driver status directly */}
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <button
                                type="button"
                                disabled={!isOwnerOrAdmin}
                                onClick={() =>
                                  handleUpdateParticipant(p, {
                                    isDriver: !p.isDriver,
                                    carSeats: !p.isDriver ? Math.max(1, p.carSeats || 3) : 0,
                                    // Preserve 0 bikes when toggling to driver!
                                    bikeSpots: !p.isDriver ? p.bikeSpots : 0,
                                  })
                                }
                                className={`min-h-[32px] px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                                  p.isDriver
                                    ? 'bg-slate-900 text-white'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                              >
                                {p.isDriver ? 'Ja, chauffeur 🚗' : 'Nee, meerijder'}
                              </button>
                            </td>

                            {/* Car seats counter */}
                            <td className="py-3.5 px-4 text-center whitespace-nowrap">
                              {p.isDriver ? (
                                <div className="inline-flex items-center gap-1.5 font-mono-num">
                                  <button
                                    type="button"
                                    disabled={!isOwnerOrAdmin}
                                    onClick={() =>
                                      handleUpdateParticipant(p, {
                                        carSeats: Math.max(1, p.carSeats - 1),
                                      })
                                    }
                                    className="w-7 h-7 rounded border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 cursor-pointer disabled:opacity-40"
                                  >
                                    −
                                  </button>
                                  <span className="w-12 text-center font-bold text-slate-900">
                                    {p.carSeats} pers.
                                  </span>
                                  <button
                                    type="button"
                                    disabled={!isOwnerOrAdmin}
                                    onClick={() =>
                                      handleUpdateParticipant(p, {
                                        carSeats: Math.min(9, p.carSeats + 1),
                                      })
                                    }
                                    className="w-7 h-7 rounded border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 cursor-pointer disabled:opacity-40"
                                  >
                                    +
                                  </button>
                                </div>
                              ) : (
                                <span className="text-slate-400">–</span>
                              )}
                            </td>

                            {/* Bike spots counter (0 is explicitly displayed as "0 fietsen") */}
                            <td className="py-3.5 px-4 text-center whitespace-nowrap">
                              {p.isDriver ? (
                                <div className="inline-flex items-center gap-1.5 font-mono-num">
                                  <button
                                    type="button"
                                    disabled={!isOwnerOrAdmin}
                                    onClick={() =>
                                      handleUpdateParticipant(p, {
                                        bikeSpots: Math.max(0, p.bikeSpots - 1),
                                      })
                                    }
                                    className="w-7 h-7 rounded border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 cursor-pointer disabled:opacity-40"
                                  >
                                    −
                                  </button>
                                  <span
                                    data-testid={`participant-bikes-value-${p.id}`}
                                    className="w-16 text-center font-bold text-[#FC4C02]"
                                  >
                                    {p.bikeSpots} fietsen
                                  </span>
                                  <button
                                    type="button"
                                    disabled={!isOwnerOrAdmin}
                                    onClick={() =>
                                      handleUpdateParticipant(p, {
                                        bikeSpots: Math.min(15, p.bikeSpots + 1),
                                      })
                                    }
                                    className="w-7 h-7 rounded border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 cursor-pointer disabled:opacity-40"
                                  >
                                    +
                                  </button>
                                </div>
                              ) : (
                                <span className="text-slate-400">–</span>
                              )}
                            </td>

                            <td className="py-3.5 px-4 text-slate-600 max-w-[220px] truncate">
                              {p.notes || <span className="text-slate-400">–</span>}
                            </td>

                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                              {isOwnerOrAdmin && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteParticipant(p)}
                                  className="min-h-[32px] inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-red-600 hover:bg-red-50 font-medium cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  Verwijder
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </main>
      )}

      {/* VIEW 4: Algemene Ideeën & Regio's Board */}
      {activeView === 'ideeen' && (
        <main className="flex-1 max-w-[1140px] w-full mx-auto px-3 sm:px-6 py-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 sm:p-5 rounded-xl border border-slate-200">
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 font-display uppercase">
                Algemene Ideeën, Regio’s & Logistiek
              </h2>
              <p className="text-xs sm:text-sm text-slate-600">
                Plek voor suggesties die nog niet aan één specifiek huisje hangen: regio-voorkeuren, beklimmingen, GPX-routes en afspraken.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveView('vergelijken')}
              className="min-h-[40px] px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-auto"
            >
              ← Terug naar Kaart & Huisjes
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* New Idea Form */}
            <form
              onSubmit={handleAddIdea}
              className="lg:col-span-4 bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4"
            >
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-[#FC4C02]" />
                Nieuw Idee of Voorstel Droppen
              </h3>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Jouw naam
                </label>
                <input
                  type="text"
                  required
                  disabled={!isVerifiedMember}
                  maxLength={VALIDATION_CONSTRAINTS.NAME_MAX}
                  value={friendName}
                  onChange={(e) => setFriendName(e.target.value)}
                  className="w-full min-h-[40px] px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:border-[#FC4C02] focus:outline-hidden disabled:bg-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Onderwerp
                </label>
                <select
                  disabled={!isVerifiedMember}
                  value={ideaCategory}
                  onChange={(e) => setIdeaCategory(e.target.value as GeneralIdeaRecord['category'])}
                  className="w-full min-h-[40px] px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-900 focus:border-[#FC4C02] focus:outline-hidden disabled:bg-slate-100"
                >
                  <option value="regio">Regio & Klimmen (bijv. Vogezen, Ardennen)</option>
                  <option value="route">Routes & Etappes (Strava / Komoot)</option>
                  <option value="logistiek">Vervoer & Fietsendragers</option>
                  <option value="overig">Eten, Drinken & Overig</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Jouw idee of vraag aan de groep *
                </label>
                <textarea
                  rows={4}
                  required
                  disabled={!isVerifiedMember}
                  maxLength={VALIDATION_CONSTRAINTS.IDEA_MAX}
                  value={ideaText}
                  onChange={(e) => setIdeaText(e.target.value)}
                  placeholder="Bijv. Zullen we dit jaar naar de Vogezen gaan?"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:border-[#FC4C02] focus:outline-hidden disabled:bg-slate-100"
                />
              </div>

              <button
                type="submit"
                disabled={!isVerifiedMember}
                className="w-full min-h-[42px] py-2.5 rounded-lg bg-[#FC4C02] hover:bg-[#E04300] text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
              >
                {isVerifiedMember ? 'Plaats op Ideeënbord' : 'Log in om een idee te plaatsen'}
              </button>
            </form>

            {/* Ideas List */}
            <div className="lg:col-span-8 space-y-3">
              {activeIdeas.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-xs text-slate-500">
                  Nog geen algemene ideeën geplaatst.
                </div>
              ) : (
                activeIdeas.map((idea) => {
                  const isOwnerOrAdmin = canModifyRecord(idea.authorId);
                  return (
                    <div
                      key={idea.id}
                      className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex items-start justify-between gap-4"
                    >
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="font-semibold text-[#FC4C02]">
                            {categoryLabels[idea.category]}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            Door <strong className="text-slate-800">{idea.authorName}</strong>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-num">
                            {new Date(idea.createdAt).toLocaleDateString('nl-NL', {
                              day: 'numeric',
                              month: 'short',
                            })}
                          </span>
                        </div>
                        <p className="text-sm text-slate-900 leading-relaxed break-words">{idea.text}</p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={!isVerifiedMember}
                          onClick={() => handleLikeIdea(idea)}
                          className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-mono-num font-semibold transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <ThumbsUp className="w-3.5 h-3.5 text-[#FC4C02]" />
                          <span>+{idea.likesCount}</span>
                        </button>
                        {isOwnerOrAdmin && (
                          <button
                            type="button"
                            onClick={() => handleDeleteIdea(idea)}
                            title="Verwijder idee"
                            className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </main>
      )}

      {/* Quiet Footer */}
      <footer className="bg-white border-t border-slate-200 mt-12">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>Kopgroep ’27 — Racefiets Weekend Planner (Do 27 mei t/m zo 30 mei 2027)</span>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setActiveView('beheren')}
              className="hover:text-slate-900 underline cursor-pointer"
            >
              Huisjeslijst beheren
            </button>
            <button
              type="button"
              onClick={() => setActiveView('deelnemers')}
              className="hover:text-slate-900 underline cursor-pointer"
            >
              Deelnemers & Auto’s
            </button>
            {isVerifiedMember && (
              <button
                type="button"
                onClick={() => {
                  setEditingHouse(null);
                  setIsAddModalOpen(true);
                }}
                className="hover:text-slate-900 underline cursor-pointer"
              >
                Nieuw huisje toevoegen
              </button>
            )}
          </div>
        </div>
      </footer>

      {/* Modal */}
      <AddHouseModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setEditingHouse(null);
        }}
        onSaveHouse={handleSaveHouse}
        cyclistCount={cyclistCount}
        defaultUserName={friendName}
        editingHouse={editingHouse}
      />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApplication />
    </ErrorBoundary>
  );
}
