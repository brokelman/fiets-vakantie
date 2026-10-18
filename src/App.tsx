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
import { INITIAL_HOUSES, INITIAL_PARTICIPANTS } from './data/initialData';
import { HouseIllustration } from './components/HouseIllustration';
import { LeafletMap } from './components/LeafletMap';
import { AddHouseModal, HouseFormData } from './components/AddHouseModal';
import { LoginPage } from './components/LoginPage';
import { ErrorBoundary } from './components/ErrorBoundary';

const STORAGE_KEY_HOUSES = 'kopgroep27_houses_v2';
const STORAGE_KEY_PARTICIPANTS = 'kopgroep27_participants_v1';
const STORAGE_KEY_CYCLISTS = 'kopgroep27_cyclists_v1';
const STORAGE_KEY_USERNAME = 'kopgroep27_username_v1';
const STORAGE_KEY_MIGRATED = 'kopgroep27_cloud_migrated_v2';

const DEMO_HOUSE_IDS = new Set(INITIAL_HOUSES.map((h) => h.id));
const DEMO_PARTICIPANT_IDS = new Set(INITIAL_PARTICIPANTS.map((p) => p.id));

function MainApplication() {
  // User & Auth state
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
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

  // Central Cloud Firestore state (Single Source of Truth for everyone in the group)
  const [cloudHouses, setCloudHouses] = useState<HouseRecord[] | null>(null);
  const [cloudVotesByHouse, setCloudVotesByHouse] = useState<Record<string, HouseVoteRecord[]>>({});
  const [cloudCommentsByHouse, setCloudCommentsByHouse] = useState<Record<string, HouseCommentRecord[]>>({});
  const [cloudIdeas, setCloudIdeas] = useState<GeneralIdeaRecord[] | null>(null);
  const [cloudParticipants, setCloudParticipants] = useState<ParticipantRecord[] | null>(null);

  // Navigation & UI state
  const [activeView, setActiveView] = useState<'vergelijken' | 'beheren' | 'deelnemers' | 'ideeen'>('vergelijken');
  const [listDisplayMode, setListDisplayMode] = useState<'kaarten' | 'tabel'>('kaarten');
  const [mobilePane, setMobilePane] = useState<'beide' | 'kaart' | 'lijst'>('beide');
  const [selectedHouseId, setSelectedHouseId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('populariteit');
  const [facilityFilter, setFacilityFilter] = useState<FacilityFilter>('alle');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  // Participant form state
  const [participantName, setParticipantName] = useState('');
  const [participantIsDriver, setParticipantIsDriver] = useState(true);
  const [participantCarSeats, setParticipantCarSeats] = useState<number>(3);
  const [participantBikeSpots, setParticipantBikeSpots] = useState<number>(3);
  const [participantNotes, setParticipantNotes] = useState('');

  // Idea board form state
  const [ideaCategory, setIdeaCategory] = useState<GeneralIdeaRecord['category']>('regio');
  const [ideaText, setIdeaText] = useState('');

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingHouse, setEditingHouse] = useState<HouseRecord | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3500);
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
        const fallbackName =
          user.displayName?.split(' ')[0] ||
          user.email?.split('@')[0] ||
          'Groepslid';
        const cleanFallback = fallbackName.slice(0, VALIDATION_CONSTRAINTS.NAME_MAX);
        setFriendName((prev) => {
          if (!prev.trim() || prev === 'Jasper') {
            return cleanFallback;
          }
          return prev;
        });
      }
    });
    return () => unsub();
  }, []);

  // Attach Firestore listeners when authenticated
  useEffect(() => {
    if (!isAuthReady || !currentUser) {
      setCloudHouses(null);
      setCloudIdeas(null);
      setCloudParticipants(null);
      return;
    }

    const housesQuery = query(
      collection(db, 'houses'),
      where('tripId', '==', VALIDATION_CONSTRAINTS.TRIP_ID)
    );

    const unsubHouses = onSnapshot(
      housesQuery,
      (snapshot) => {
        const items: HouseRecord[] = snapshot.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            tripId: d.tripId || VALIDATION_CONSTRAINTS.TRIP_ID,
            ownerId: d.ownerId || '',
            title: d.title || '',
            url: d.url || '',
            photoUrl: d.photoUrl || '',
            locationName: d.locationName || '',
            lat: Number(d.lat) || 50.4,
            lng: Number(d.lng) || 5.8,
            totalPrice: Number(d.totalPrice) || 1000,
            bedrooms: Number(d.bedrooms) || 4,
            bathrooms: Number(d.bathrooms) || 2,
            hasBbq: Boolean(d.hasBbq),
            hasFireplace: Boolean(d.hasFireplace),
            hasJacuzzi: Boolean(d.hasJacuzzi ?? d.hasSaunaJacuzzi),
            hasSauna: Boolean(d.hasSauna ?? d.hasSaunaJacuzzi),
            routeUrl: d.routeUrl || '',
            notes: d.notes || '',
            addedBy: d.addedBy || 'Groepslid',
            voteScore: Number(d.voteScore) || 0,
            voteCount: Number(d.voteCount) || 0,
            status: d.status === 'archived' ? 'archived' : 'active',
            createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString(),
            updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
          };
        });
        setCloudHouses(items);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'houses');
      }
    );

    const ideasQuery = query(
      collection(db, 'ideas'),
      where('tripId', '==', VALIDATION_CONSTRAINTS.TRIP_ID)
    );

    const unsubIdeas = onSnapshot(
      ideasQuery,
      (snapshot) => {
        const items: GeneralIdeaRecord[] = snapshot.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            tripId: d.tripId || VALIDATION_CONSTRAINTS.TRIP_ID,
            authorId: d.authorId || '',
            authorName: d.authorName || 'Groepslid',
            category: d.category || 'overig',
            text: d.text || '',
            likesCount: Number(d.likesCount) || 0,
            status: d.status === 'resolved' ? 'resolved' : 'open',
            createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString(),
            updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
          };
        });
        setCloudIdeas(items);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'ideas');
      }
    );

    const participantsQuery = query(
      collection(db, 'participants'),
      where('tripId', '==', VALIDATION_CONSTRAINTS.TRIP_ID)
    );

    const unsubParticipants = onSnapshot(
      participantsQuery,
      (snapshot) => {
        const items: ParticipantRecord[] = snapshot.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            tripId: d.tripId || VALIDATION_CONSTRAINTS.TRIP_ID,
            ownerId: d.ownerId || '',
            name: d.name || 'Deelnemer',
            isDriver: Boolean(d.isDriver),
            carSeats: Number(d.carSeats) || 0,
            bikeSpots: Number(d.bikeSpots) || 0,
            notes: d.notes || '',
            createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString(),
            updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
          };
        });
        setCloudParticipants(items);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'participants');
      }
    );

    return () => {
      unsubHouses();
      unsubIdeas();
      unsubParticipants();
    };
  }, [isAuthReady, currentUser]);

  // Automatic one-time migration: if a user previously removed the default houses and added their own house
  // in localStorage before logging in, rescue their custom house(s) into the central Cloud database
  // and remove any leftover default demo houses so everyone sees the exact same list!
  useEffect(() => {
    if (!currentUser || cloudHouses === null) return;
    if (localStorage.getItem(STORAGE_KEY_MIGRATED) === 'done') return;

    const migrateLocalChangesToCloud = async () => {
      try {
        localStorage.setItem(STORAGE_KEY_MIGRATED, 'done');

        const rawLocalHouses = localStorage.getItem(STORAGE_KEY_HOUSES);
        if (rawLocalHouses) {
          const parsedHouses: HouseRecord[] = JSON.parse(rawLocalHouses);
          if (Array.isArray(parsedHouses)) {
            const localIds = new Set(parsedHouses.map((h) => h.id));
            const customHouses = parsedHouses.filter((h) => !DEMO_HOUSE_IDS.has(h.id));
            const cloudIds = new Set(cloudHouses.map((h) => h.id));

            // 1. Upload any custom houses the user added locally that aren't in Firestore yet
            for (const h of customHouses) {
              const docId = sanitizeId(h.id);
              if (!cloudIds.has(docId)) {
                await setDoc(doc(db, 'houses', docId), {
                  tripId: VALIDATION_CONSTRAINTS.TRIP_ID,
                  ownerId: currentUser.uid,
                  title: (h.title || 'Vakantiehuis').slice(0, VALIDATION_CONSTRAINTS.TITLE_MAX),
                  url: (h.url || 'https://www.airbnb.nl').slice(0, VALIDATION_CONSTRAINTS.URL_MAX),
                  photoUrl: (h.photoUrl || '').slice(0, VALIDATION_CONSTRAINTS.URL_MAX),
                  locationName: (h.locationName || 'Ardennen').slice(0, VALIDATION_CONSTRAINTS.LOCATION_MAX),
                  lat: Number(h.lat) || 50.4,
                  lng: Number(h.lng) || 5.8,
                  totalPrice: Math.max(1, Math.round(Number(h.totalPrice) || 1500)),
                  bedrooms: Math.max(1, Math.round(Number(h.bedrooms) || 4)),
                  bathrooms: Math.max(1, Math.round(Number(h.bathrooms) || 2)),
                  hasBbq: Boolean(h.hasBbq),
                  hasFireplace: Boolean(h.hasFireplace),
                  hasJacuzzi: Boolean(h.hasJacuzzi),
                  hasSauna: Boolean(h.hasSauna),
                  routeUrl: (h.routeUrl || '').slice(0, VALIDATION_CONSTRAINTS.URL_MAX),
                  notes: (h.notes || '').slice(0, VALIDATION_CONSTRAINTS.NOTES_MAX),
                  addedBy: (h.addedBy || friendName || 'Groepslid').slice(0, VALIDATION_CONSTRAINTS.NAME_MAX),
                  voteScore: Math.round(Number(h.voteScore) || 5),
                  voteCount: Math.round(Number(h.voteCount) || 1),
                  status: 'active',
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
              }
            }

            // 2. If the user had deleted the default demo houses locally, also remove them from Firestore
            for (const cloudHouse of cloudHouses) {
              if (DEMO_HOUSE_IDS.has(cloudHouse.id) && !localIds.has(cloudHouse.id)) {
                await deleteDoc(doc(db, 'houses', cloudHouse.id));
              }
            }
          }
        }

        // Also rescue any custom participants added locally
        const rawLocalParticipants = localStorage.getItem(STORAGE_KEY_PARTICIPANTS);
        if (rawLocalParticipants && cloudParticipants !== null) {
          const parsedParticipants: ParticipantRecord[] = JSON.parse(rawLocalParticipants);
          if (Array.isArray(parsedParticipants)) {
            const customParticipants = parsedParticipants.filter(
              (p) => !DEMO_PARTICIPANT_IDS.has(p.id)
            );
            const cloudPIds = new Set(cloudParticipants.map((p) => p.id));
            for (const p of customParticipants) {
              const pId = sanitizeId(p.id);
              if (!cloudPIds.has(pId)) {
                await setDoc(doc(db, 'participants', pId), {
                  tripId: VALIDATION_CONSTRAINTS.TRIP_ID,
                  ownerId: currentUser.uid,
                  name: (p.name || 'Deelnemer').slice(0, VALIDATION_CONSTRAINTS.NAME_MAX),
                  isDriver: Boolean(p.isDriver),
                  carSeats: Math.max(0, Math.min(15, Math.round(Number(p.carSeats) || 0))),
                  bikeSpots: Math.max(0, Math.min(15, Math.round(Number(p.bikeSpots) || 0))),
                  notes: (p.notes || '').slice(0, 300),
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
              }
            }
          }
        }
      } catch {
        // Ignore migration errors silently
      }
    };

    migrateLocalChangesToCloud();
  }, [currentUser, cloudHouses, cloudParticipants, friendName]);

  // Attach subcollection listeners for votes and comments of cloud houses
  useEffect(() => {
    if (!currentUser || !cloudHouses || cloudHouses.length === 0) return;

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
              value: Number(d.value) || 1,
              createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString(),
              updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
            };
          });
          setCloudVotesByHouse((prev) => ({ ...prev, [house.id]: votes }));
        },
        (error) => {
          handleFirestoreError(error, OperationType.LIST, `houses/${house.id}/votes`);
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
          handleFirestoreError(error, OperationType.LIST, `houses/${house.id}/comments`);
        }
      );

      unsubs.push(unsubVotes, unsubComments);
    });

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [currentUser, cloudHouses]);

  // 100% Central Cloud Data: Everyone in the friend group sees the exact same Firestore records!
  const activeHouses: HouseRecord[] = useMemo(() => {
    if (!cloudHouses) return [];
    return cloudHouses.map((h) => ({
      ...h,
      votes: cloudVotesByHouse[h.id] || [],
      comments: cloudCommentsByHouse[h.id] || [],
    }));
  }, [cloudHouses, cloudVotesByHouse, cloudCommentsByHouse]);

  const activeIdeas: GeneralIdeaRecord[] = useMemo(() => {
    return cloudIdeas || [];
  }, [cloudIdeas]);

  const activeParticipants: ParticipantRecord[] = useMemo(() => {
    return cloudParticipants || [];
  }, [cloudParticipants]);

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

  // Save (Create or Edit) a house directly in central Firestore database
  const handleSaveHouse = async (houseData: HouseFormData, editingHouseId?: string) => {
    if (!currentUser) return;

    if (editingHouseId) {
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
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `houses/${editingHouseId}`);
      }
      setEditingHouse(null);
      showToast(`Wijzigingen aan "${houseData.title}" zijn opgeslagen voor de hele groep!`);
      return;
    }

    // Create new house in central Firestore database
    const newId = sanitizeId(`huis-${Date.now()}`);
    setSelectedHouseId(newId);

    try {
      await setDoc(doc(db, 'houses', newId), {
        tripId: VALIDATION_CONSTRAINTS.TRIP_ID,
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
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `houses/${newId}`);
    }

    showToast(`"${houseData.title}" staat nu live op de gedeelde lijst en kaart!`);
  };

  // Vote on a house (-1 or 1..5) in central Firestore database
  const handleVoteHouse = async (house: HouseRecord, voteValue: number) => {
    if (!currentUser) return;
    const cleanVoterName = (friendName.trim() || 'Groepslid').slice(0, VALIDATION_CONSTRAINTS.NAME_MAX);
    const nowIso = new Date().toISOString();

    const existingVotes = house.votes || [];
    const existingVote = existingVotes.find((v) => v.userId === currentUser.uid);

    let updatedVotes: HouseVoteRecord[];
    if (existingVote) {
      updatedVotes = existingVotes.map((v) =>
        v.userId === currentUser.uid
          ? { ...v, value: voteValue, voterName: cleanVoterName, updatedAt: nowIso }
          : v
      );
    } else {
      updatedVotes = [
        ...existingVotes,
        {
          id: currentUser.uid,
          houseId: house.id,
          userId: currentUser.uid,
          voterName: cleanVoterName,
          value: voteValue,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ];
    }

    const newScore = updatedVotes.reduce((acc, v) => acc + v.value, 0);
    const newCount = updatedVotes.length;

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
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `houses/${house.id}/votes/${currentUser.uid}`);
    }

    showToast(
      voteValue > 0
        ? `Stem (+${voteValue}★) van ${cleanVoterName} opgeslagen voor ${house.title}`
        : `Twijfelstem (-1) van ${cleanVoterName} geregistreerd`
    );
  };

  // Add a comment to a house in central Firestore database
  const handleAddComment = async (house: HouseRecord) => {
    if (!currentUser) return;
    const rawDraft = commentDrafts[house.id] || '';
    const cleanText = rawDraft.trim().slice(0, VALIDATION_CONSTRAINTS.COMMENT_MAX);
    if (!cleanText) return;

    const cleanAuthor = (friendName.trim() || 'Groepslid').slice(0, VALIDATION_CONSTRAINTS.NAME_MAX);
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

  // Delete a house from central Firestore database (with undo capability)
  const handleDeleteHouse = async (house: HouseRecord) => {
    if (!currentUser) return;
    setLastDeletedHouse(house);
    if (selectedHouseId === house.id) {
      setSelectedHouseId(null);
    }

    try {
      await deleteDoc(doc(db, 'houses', house.id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `houses/${house.id}`);
    }
    showToast(`"${house.title}" is verwijderd uit de centrale groepslijst.`);
  };

  // Undo last deleted house in central Firestore database
  const handleUndoDeleteHouse = async () => {
    if (!lastDeletedHouse || !currentUser) return;
    const restored = lastDeletedHouse;
    setLastDeletedHouse(null);

    try {
      await setDoc(doc(db, 'houses', restored.id), {
        tripId: VALIDATION_CONSTRAINTS.TRIP_ID,
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
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `houses/${restored.id}`);
    }
    showToast(`"${restored.title}" is weer teruggezet in de centrale lijst!`);
  };

  // Clear all houses in central Firestore database
  const handleClearAllHouses = async () => {
    if (!currentUser) return;
    const currentList = [...activeHouses];
    setSelectedHouseId(null);

    try {
      for (const h of currentList) {
        await deleteDoc(doc(db, 'houses', h.id));
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'houses');
    }
    showToast('De centrale lijst met huisjes is voor iedereen leeggemaakt.');
  };

  // Restore the 4 example houses into central Firestore database
  const handleRestoreStarterHouses = async () => {
    if (!currentUser) return;
    try {
      for (const h of INITIAL_HOUSES) {
        const docId = sanitizeId(h.id);
        await setDoc(doc(db, 'houses', docId), {
          tripId: VALIDATION_CONSTRAINTS.TRIP_ID,
          ownerId: currentUser.uid,
          title: h.title.slice(0, VALIDATION_CONSTRAINTS.TITLE_MAX),
          url: h.url.slice(0, VALIDATION_CONSTRAINTS.URL_MAX),
          photoUrl: (h.photoUrl || '').slice(0, VALIDATION_CONSTRAINTS.URL_MAX),
          locationName: h.locationName.slice(0, VALIDATION_CONSTRAINTS.LOCATION_MAX),
          lat: Number(h.lat),
          lng: Number(h.lng),
          totalPrice: Math.round(Number(h.totalPrice)),
          bedrooms: Math.round(Number(h.bedrooms)),
          bathrooms: Math.round(Number(h.bathrooms)),
          hasBbq: Boolean(h.hasBbq),
          hasFireplace: Boolean(h.hasFireplace),
          hasJacuzzi: Boolean(h.hasJacuzzi),
          hasSauna: Boolean(h.hasSauna),
          routeUrl: (h.routeUrl || '').slice(0, VALIDATION_CONSTRAINTS.URL_MAX),
          notes: (h.notes || '').slice(0, VALIDATION_CONSTRAINTS.NOTES_MAX),
          addedBy: h.addedBy.slice(0, VALIDATION_CONSTRAINTS.NAME_MAX),
          voteScore: Math.round(Number(h.voteScore) || 0),
          voteCount: Math.round(Number(h.voteCount) || 0),
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      showToast('De 4 voorbeeld-huisjes staan nu in de centrale lijst.');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'houses');
    }
  };

  // Open edit modal for a house
  const handleOpenEditHouse = (house: HouseRecord) => {
    setEditingHouse(house);
    setIsAddModalOpen(true);
  };

  // PARTICIPANTS & CARPOOL MANAGEMENT (Central Firestore)
  const handleAddParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    const cleanName = participantName.trim().slice(0, VALIDATION_CONSTRAINTS.NAME_MAX);
    if (!cleanName) return;

    const pId = sanitizeId(`deelnemer-${Date.now()}`);
    const seats = participantIsDriver ? Math.max(1, Math.min(15, Number(participantCarSeats) || 1)) : 0;
    const bikes = participantIsDriver ? Math.max(0, Math.min(15, Number(participantBikeSpots) || 0)) : 0;
    const cleanNotes = participantNotes.trim().slice(0, 300);

    setParticipantName('');
    setParticipantNotes('');

    try {
      await setDoc(doc(db, 'participants', pId), {
        tripId: VALIDATION_CONSTRAINTS.TRIP_ID,
        ownerId: currentUser.uid,
        name: cleanName,
        isDriver: participantIsDriver,
        carSeats: seats,
        bikeSpots: bikes,
        notes: cleanNotes,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `participants/${pId}`);
    }

    showToast(`${cleanName} is toegevoegd aan de centrale deelnemerslijst!`);
  };

  const handleUpdateParticipant = async (
    participant: ParticipantRecord,
    updates: Partial<Pick<ParticipantRecord, 'isDriver' | 'carSeats' | 'bikeSpots' | 'notes'>>
  ) => {
    if (!currentUser) return;
    const nextDriver = updates.isDriver !== undefined ? updates.isDriver : participant.isDriver;
    const nextSeats = nextDriver
      ? Math.max(1, Math.min(15, updates.carSeats !== undefined ? updates.carSeats : participant.carSeats || 3))
      : 0;
    const nextBikes = nextDriver
      ? Math.max(0, Math.min(15, updates.bikeSpots !== undefined ? updates.bikeSpots : participant.bikeSpots))
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
    if (!currentUser) return;
    try {
      await deleteDoc(doc(db, 'participants', participant.id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `participants/${participant.id}`);
    }
    showToast(`${participant.name} verwijderd van de deelnemerslijst.`);
  };

  // Delete an idea from central Firestore
  const handleDeleteIdea = async (idea: GeneralIdeaRecord) => {
    if (!currentUser) return;
    try {
      await deleteDoc(doc(db, 'ideas', idea.id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `ideas/${idea.id}`);
    }
    showToast('Idee verwijderd.');
  };

  // Add a general idea to central Firestore
  const handleAddIdea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    const cleanText = ideaText.trim().slice(0, VALIDATION_CONSTRAINTS.IDEA_MAX);
    if (cleanText.length < VALIDATION_CONSTRAINTS.IDEA_MIN) return;

    const cleanAuthor = (friendName.trim() || 'Groepslid').slice(0, VALIDATION_CONSTRAINTS.NAME_MAX);
    const ideaId = sanitizeId(`idee-${Date.now()}`);

    setIdeaText('');

    try {
      await setDoc(doc(db, 'ideas', ideaId), {
        tripId: VALIDATION_CONSTRAINTS.TRIP_ID,
        authorId: currentUser.uid,
        authorName: cleanAuthor,
        category: ideaCategory,
        text: cleanText,
        likesCount: 0,
        status: 'open',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `ideas/${ideaId}`);
    }
    showToast('Idee toegevoegd aan het centrale ideeënbord!');
  };

  // Upvote a general idea in central Firestore
  const handleLikeIdea = async (idea: GeneralIdeaRecord) => {
    if (!currentUser) return;
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

  // 2. Mandatory Login Gate (Google or Apple ID) so everyone always sees the exact same central cloud list
  if (!currentUser) {
    return <LoginPage />;
  }

  // 3. Initial Cloud Data Loading State
  if (cloudHouses === null) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 rounded-xl bg-[#FC4C02] flex items-center justify-center mx-auto animate-pulse">
            <Cloud className="w-5 h-5 text-white" />
          </div>
          <p className="text-sm font-semibold text-slate-800">
            Centrale groepslijst met vakantiehuizen ophalen...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A]">
      {/* Top Bar Contract: Strictly 3 zones separated by gap-8 */}
      <header className="flex items-center justify-between gap-8 px-4 sm:px-6 py-3.5 bg-white border-b border-slate-200 sticky top-0 z-30">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveView('vergelijken');
          }}
          className="text-xl font-bold tracking-tight text-slate-900 font-display uppercase whitespace-nowrap shrink-0"
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
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              setEditingHouse(null);
              setIsAddModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#FC4C02] rounded-lg hover:bg-[#E04300] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Nieuw Huisje
          </button>
        </div>
      </header>

      {/* Prominent Event Context Header Banner */}
      <section className="bg-[#0F172A] text-white border-b border-slate-800">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300">
              <span className="font-semibold text-[#FC4C02]">EVENEMENT</span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5 text-white font-medium">
                <Calendar className="w-3.5 h-3.5 text-[#FC4C02]" />
                Donderdag 27 mei t/m zondag 30 mei 2027 (3 nachten)
              </span>
              <span aria-hidden="true">·</span>
              <span>Ardennen / Zuid-Limburg / Eifel</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight font-display uppercase text-white">
              Racefiets Weekend 2027 — Accommodatie & Route Planner
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-3xl">
              Samen vakantiehuizen aandragen, vergelijken op de kaart, auto- en fietsindeling afstemmen en stemmen op de groepsfavoriet.
            </p>
          </div>

          {/* Collaborator Identity & Quick Action Controls */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <div className="flex items-center gap-2 bg-slate-800/90 border border-slate-700 rounded-lg px-3 py-1.5">
              <span className="text-[11px] text-slate-400 whitespace-nowrap">Jouw naam:</span>
              <input
                type="text"
                maxLength={VALIDATION_CONSTRAINTS.NAME_MAX}
                value={friendName}
                onChange={(e) => setFriendName(e.target.value)}
                aria-label="Jouw naam in de vriendengroep"
                className="w-24 sm:w-28 bg-transparent text-xs font-semibold text-white focus:outline-hidden border-b border-transparent focus:border-[#FC4C02]"
              />
            </div>

            <button
              type="button"
              onClick={() => setActiveView('deelnemers')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Car className="w-3.5 h-3.5 text-[#FC4C02]" />
              Deelnemers & Auto’s ({activeParticipants.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveView('beheren')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ListChecks className="w-3.5 h-3.5 text-[#FC4C02]" />
              Lijst Beheren ({activeHouses.length})
            </button>

            <button
              type="button"
              onClick={() => logOutUser()}
              title={`Ingelogd als ${currentUser.email || friendName} — klik om uit te loggen`}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{currentUser.email || 'Ingelogd'}</span>
              <LogOut className="w-3.5 h-3.5 text-slate-400 ml-1" />
            </button>
          </div>
        </div>
      </section>

      {/* Undo Delete Banner when a house was just deleted */}
      {lastDeletedHouse && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-2.5">
          <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-4 text-xs">
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
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-lg border border-slate-700 text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#FC4C02] shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Mobile View Switcher */}
      <div className="flex lg:hidden flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-white border-b border-slate-200">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveView('vergelijken')}
            className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'vergelijken' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Huisjes ({activeHouses.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveView('beheren')}
            className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'beheren' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Beheren
          </button>
          <button
            type="button"
            onClick={() => setActiveView('deelnemers')}
            className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'deelnemers' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Auto’s ({activeParticipants.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveView('ideeen')}
            className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'ideeen' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Ideeën ({activeIdeas.length})
          </button>
        </div>

        {activeView === 'vergelijken' && (
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setMobilePane('beide')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mobilePane === 'beide' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Split
            </button>
            <button
              type="button"
              onClick={() => setMobilePane('kaart')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mobilePane === 'kaart' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Kaart
            </button>
            <button
              type="button"
              onClick={() => setMobilePane('lijst')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                mobilePane === 'lijst' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              Lijst
            </button>
          </div>
        )}
      </div>

      {/* VIEW 1: Kaart & Huisjes Vergelijken */}
      {activeView === 'vergelijken' && (
        <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT COLUMN (Desktop 5 cols): Sticky Interactive Leaflet Map + Quick Teasers */}
          <div
            className={`lg:col-span-5 lg:sticky lg:top-20 space-y-4 ${
              mobilePane === 'lijst' ? 'hidden lg:block' : 'block'
            }`}
          >
            <div className="h-[380px] sm:h-[460px] lg:h-[calc(100vh-190px)] min-h-[380px]">
              <LeafletMap
                houses={displayedHouses}
                cyclistCount={cyclistCount}
                selectedHouseId={selectedHouseId}
                favoriteHouseId={favoriteHouseId}
                onSelectHouse={(id) => setSelectedHouseId(id)}
              />
            </div>

            {/* Compact Deelnemers & Auto's Teaser Box below map */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                  <Car className="w-4 h-4 text-[#FC4C02] shrink-0" />
                  <span>
                    Deelnemers & Auto’s: {totalParticipantsCount} fietsers · {totalDriversCount} chauffeurs
                  </span>
                </div>
                <p className="text-xs text-slate-500 truncate mt-0.5 font-mono-num">
                  Capaciteit: {totalCarSeats} zitplaatsen in auto’s · {totalBikeSpots} fietsplekken
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveView('deelnemers')}
                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-900 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                Indeling →
              </button>
            </div>
          </div>

          {/* RIGHT COLUMN (Desktop 7 cols): Calculator, Filters & House Cards / Compact List */}
          <div
            className={`lg:col-span-7 space-y-5 ${
              mobilePane === 'kaart' ? 'hidden lg:block' : 'block'
            }`}
          >
            {/* Interactive Price-per-Person Calculator & Cyclist Counter */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4">
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
                    className="w-8 h-8 rounded-lg border border-slate-300 hover:bg-slate-100 font-mono-num font-bold text-slate-700 cursor-pointer"
                    aria-label="Minder fietsers"
                  >
                    −
                  </button>
                  <div className="px-3.5 py-1 rounded-lg bg-slate-900 text-white font-mono-num text-sm font-bold min-w-[88px] text-center">
                    {cyclistCount} fietsers
                  </div>
                  <button
                    type="button"
                    onClick={() => setCyclistCount((c) => Math.min(20, c + 1))}
                    className="w-8 h-8 rounded-lg border border-slate-300 hover:bg-slate-100 font-mono-num font-bold text-slate-700 cursor-pointer"
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
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
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
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
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
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    aria-label="Sorteer vakantiehuizen"
                    className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800 focus:border-[#FC4C02] focus:outline-hidden cursor-pointer"
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
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
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
                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
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
                  placeholder="Zoek op plaatsnaam, beklimming (bijv. Stockeu, Cauberg, Haussire) of naam..."
                  className="w-full pl-9 pr-3.5 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-[#FC4C02] focus:outline-hidden text-xs text-slate-900"
                />
              </div>
            </div>

            {/* Empty State */}
            {displayedHouses.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-10 text-center space-y-3">
                <Bike className="w-8 h-8 text-slate-400 mx-auto" />
                <h3 className="text-base font-bold text-slate-900">
                  Geen vakantiehuizen gevonden
                </h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Voeg jullie eerste eigen gevonden huisje toe, of zet de 4 voorbeeld-huisjes in de Ardennen en Zuid-Limburg terug.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                  {(facilityFilter !== 'alle' || searchQuery.trim()) && (
                    <button
                      type="button"
                      onClick={() => {
                        setFacilityFilter('alle');
                        setSearchQuery('');
                      }}
                      className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Filters wissen
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingHouse(null);
                      setIsAddModalOpen(true);
                    }}
                    className="px-4 py-2 rounded-lg bg-[#FC4C02] text-white text-xs font-semibold hover:bg-[#E04300] cursor-pointer"
                  >
                    + Nieuw Huisje Toevoegen
                  </button>
                  {activeHouses.length === 0 && (
                    <button
                      type="button"
                      onClick={handleRestoreStarterHouses}
                      className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Zet 4 voorbeeld-huisjes terug
                    </button>
                  )}
                </div>
              </div>
            ) : listDisplayMode === 'tabel' ? (
              /* COMPACT LIST / TABLE MODE right inside the main view */
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800">
                    Overzichtslijst ({displayedHouses.length} huisjes)
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveView('beheren')}
                    className="text-xs font-semibold text-[#FC4C02] hover:underline cursor-pointer"
                  >
                    Volledig lijstbeheer openen →
                  </button>
                </div>
                <div className="divide-y divide-slate-200">
                  {displayedHouses.map((house) => {
                    const pricePerPerson = Math.round(house.totalPrice / Math.max(1, cyclistCount));
                    const isFavorite = house.id === favoriteHouseId && house.voteScore > 0;
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
                            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-800 cursor-pointer"
                          >
                            Op kaart
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenEditHouse(house)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-xs font-medium text-slate-700 cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            Bewerk
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteHouse(house)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-semibold cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Verwijder
                          </button>
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

                  const currentUserVote = votesList.find(
                    (v) =>
                      (currentUser && v.userId === currentUser.uid) ||
                      v.voterName.toLowerCase() === friendName.trim().toLowerCase()
                  );

                  return (
                    <article
                      key={house.id}
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
                        <div className="bg-amber-500/10 border-b border-amber-300/60 px-4 py-2 flex items-center justify-between text-xs">
                          <span className="font-bold text-amber-900 flex items-center gap-1.5">
                            <Trophy className="w-4 h-4 text-amber-600 shrink-0" />
                            Groepsfavoriet 🏆 — Meeste stemmen in de groep
                          </span>
                          <span className="font-mono-num font-semibold text-amber-800">
                            {house.voteScore} punten ({house.voteCount} stemmen)
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
                        <div className="md:col-span-7 p-4 sm:p-5 flex flex-col justify-between space-y-3.5">
                          <div>
                            {/* Unboxed metadata kicker + clear Edit & Delete buttons */}
                            <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1.5">
                              <span className="truncate">
                                Toegevoegd door <strong className="text-slate-700">{house.addedBy}</strong>
                                {' · '}
                                {house.locationName}
                              </span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditHouse(house)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer text-[11px] font-medium"
                                >
                                  <Pencil className="w-3 h-3" />
                                  Bewerken
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteHouse(house)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-200 bg-red-50/70 text-red-700 hover:bg-red-100 transition-colors cursor-pointer text-[11px] font-medium"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  Verwijderen
                                </button>
                              </div>
                            </div>

                            <h3 className="text-lg font-bold text-slate-900 leading-snug">
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
                              <p className="text-xs text-slate-600 leading-relaxed mt-2.5 line-clamp-3">
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
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleShowOnMap(house.id)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                              >
                                <MapPin className="w-3.5 h-3.5 text-[#FC4C02]" />
                                Toon op kaart
                              </button>

                              {house.routeUrl && (
                                <a
                                  href={house.routeUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors whitespace-nowrap shrink-0"
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
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
                            >
                              <span>Accommodatie</span>
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>
                      </div>

                      {/* Bottom Collaborative Footer: Voting System & Collapsible Comments */}
                      <div className="bg-slate-50 border-t border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
                        {/* Rating / Upvote & Star Buttons */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-slate-700 font-mono-num">
                            Score: {house.voteScore} pt ({house.voteCount} stemmen)
                          </span>
                          <span className="text-slate-300" aria-hidden="true">|</span>
                          <div className="flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map((starVal) => {
                              const active = currentUserVote && currentUserVote.value >= starVal;
                              return (
                                <button
                                  key={starVal}
                                  type="button"
                                  onClick={() => handleVoteHouse(house, starVal)}
                                  title={`Geef ${starVal} sterren namens ${friendName}`}
                                  className={`p-1 rounded transition-colors cursor-pointer ${
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
                            onClick={() => handleVoteHouse(house, 5)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
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
                            onClick={() => handleVoteHouse(house, -1)}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
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
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer whitespace-nowrap shrink-0"
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
                                  <p className="text-slate-700">{c.text}</p>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Add comment input */}
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
                              placeholder={`Plaats een opmerking als ${friendName || 'Groepslid'} (bijv. "Zijn dat losse bedden?")...`}
                              className="flex-1 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-900 focus:border-[#FC4C02] focus:outline-hidden"
                            />
                            <button
                              type="button"
                              onClick={() => handleAddComment(house)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <Send className="w-3.5 h-3.5" />
                              Plaats
                            </button>
                          </div>
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

      {/* VIEW 2: Lijst Beheren (Dedicated Management Overview Table to Find, Edit & Delete Houses) */}
      {activeView === 'beheren' && (
        <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 font-display uppercase">
                Huisjes & Lijst Beheren ({activeHouses.length})
              </h2>
              <p className="text-xs sm:text-sm text-slate-600">
                Overzichtelijke lijst van alle aangedragen huisjes. Hier kun je eenvoudig huisjes terugvinden, aanpassen of verwijderen.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setActiveView('vergelijken')}
                className="px-3.5 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
              >
                ← Terug naar Kaart
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingHouse(null);
                  setIsAddModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FC4C02] text-white text-xs font-semibold hover:bg-[#E04300] cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Nieuw Huisje Toevoegen
              </button>
            </div>
          </div>

          {/* Houses Management Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-bold text-slate-800">
                Alle vakantiehuizen in de lijst ({activeHouses.length})
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleRestoreStarterHouses}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Herstel 4 voorbeeld-huisjes
                </button>
                {activeHouses.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearAllHouses}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 bg-red-50 text-xs font-semibold text-red-700 hover:bg-red-100 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Maak hele lijst leeg
                  </button>
                )}
              </div>
            </div>

            {activeHouses.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <p className="text-sm font-semibold text-slate-800">De lijst met huisjes is momenteel leeg.</p>
                <p className="text-xs text-slate-500">
                  Voeg zelf een eerste huisje toe of zet de 4 voorbeeld-huisjes terug.
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
                                className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold cursor-pointer"
                              >
                                Toon op kaart
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenEditHouse(house)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                Bewerken
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteHouse(house)}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Verwijderen
                              </button>
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
        <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
          {/* Header Card */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 font-display uppercase">
                Deelnemers, Chauffeurs & Auto-indeling
              </h2>
              <p className="text-xs sm:text-sm text-slate-600">
                Zet je naam op de lijst en geef aan of je chauffeur wilt zijn, hoeveel mensen er mee kunnen in je auto en hoeveel racefietsen je kunt vervoeren.
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
                  className="px-3.5 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 cursor-pointer"
                >
                  Zet prijscalculator op {totalParticipantsCount} fietsers
                </button>
              )}
              <button
                type="button"
                onClick={() => setActiveView('vergelijken')}
                className="px-3.5 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
              >
                ← Terug naar Kaart & Huisjes
              </button>
            </div>
          </div>

          {/* Live Capacity Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
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
              className="lg:col-span-4 bg-white rounded-xl border border-slate-200 p-5 space-y-4"
            >
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Car className="w-4 h-4 text-[#FC4C02]" />
                Deelnemer Toevoegen aan Lijst
              </h3>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Naam deelnemer *
                </label>
                <input
                  type="text"
                  required
                  maxLength={VALIDATION_CONSTRAINTS.NAME_MAX}
                  value={participantName}
                  onChange={(e) => setParticipantName(e.target.value)}
                  placeholder="Bijv. Martijn"
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:border-[#FC4C02] focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Wil je chauffeur zijn (met eigen auto rijden)?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setParticipantIsDriver(true);
                      if (participantCarSeats === 0) setParticipantCarSeats(3);
                      if (participantBikeSpots === 0) setParticipantBikeSpots(2);
                    }}
                    className={`py-2 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                      participantIsDriver
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    Ja, ik kan rijden 🚗
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setParticipantIsDriver(false);
                      setParticipantCarSeats(0);
                      setParticipantBikeSpots(0);
                    }}
                    className={`py-2 px-3 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
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
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Mensen in de auto (incl. jijzelf)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={9}
                      value={participantCarSeats}
                      onChange={(e) => setParticipantCarSeats(Number(e.target.value))}
                      className="w-full px-3 py-1.5 bg-white rounded-lg border border-slate-300 font-mono-num text-xs text-slate-900 focus:border-[#FC4C02] focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Aantal fietsen dat mee kan
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={10}
                      value={participantBikeSpots}
                      onChange={(e) => setParticipantBikeSpots(Number(e.target.value))}
                      className="w-full px-3 py-1.5 bg-white rounded-lg border border-slate-300 font-mono-num text-xs text-slate-900 focus:border-[#FC4C02] focus:outline-hidden"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Opmerking / Vertrekplaats (optioneel)
                </label>
                <input
                  type="text"
                  maxLength={300}
                  value={participantNotes}
                  onChange={(e) => setParticipantNotes(e.target.value)}
                  placeholder="Bijv. Fietsendrager voor 3 fietsen, vertrek uit Utrecht"
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:border-[#FC4C02] focus:outline-hidden"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-lg bg-[#FC4C02] hover:bg-[#E04300] text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                + Deelnemer Toevoegen
              </button>
            </form>

            {/* Right 8 cols: Interactive Participants Table */}
            <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800">
                  Deelnemerslijst ({activeParticipants.length} personen) — Klik op getallen om direct aan te passen
                </span>
              </div>

              {activeParticipants.length === 0 ? (
                <div className="p-10 text-center space-y-2">
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
                      {activeParticipants.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3.5 px-4 font-bold text-slate-900 text-sm whitespace-nowrap">
                            {p.name}
                          </td>

                          {/* Toggle Driver status directly */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateParticipant(p, {
                                  isDriver: !p.isDriver,
                                  carSeats: !p.isDriver ? 3 : 0,
                                  bikeSpots: !p.isDriver ? 2 : 0,
                                })
                              }
                              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
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
                                  onClick={() =>
                                    handleUpdateParticipant(p, {
                                      carSeats: Math.max(1, p.carSeats - 1),
                                    })
                                  }
                                  className="w-6 h-6 rounded border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 cursor-pointer"
                                >
                                  −
                                </button>
                                <span className="w-12 text-center font-bold text-slate-900">
                                  {p.carSeats} pers.
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateParticipant(p, {
                                      carSeats: Math.min(9, p.carSeats + 1),
                                    })
                                  }
                                  className="w-6 h-6 rounded border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-400">–</span>
                            )}
                          </td>

                          {/* Bike spots counter */}
                          <td className="py-3.5 px-4 text-center whitespace-nowrap">
                            {p.isDriver ? (
                              <div className="inline-flex items-center gap-1.5 font-mono-num">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateParticipant(p, {
                                      bikeSpots: Math.max(0, p.bikeSpots - 1),
                                    })
                                  }
                                  className="w-6 h-6 rounded border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 cursor-pointer"
                                >
                                  −
                                </button>
                                <span className="w-14 text-center font-bold text-[#FC4C02]">
                                  {p.bikeSpots} fietsen
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleUpdateParticipant(p, {
                                      bikeSpots: Math.min(10, p.bikeSpots + 1),
                                    })
                                  }
                                  className="w-6 h-6 rounded border border-slate-300 hover:bg-slate-100 font-bold text-slate-700 cursor-pointer"
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
                            <button
                              type="button"
                              onClick={() => handleDeleteParticipant(p)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-red-600 hover:bg-red-50 font-medium cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Verwijder
                            </button>
                          </td>
                        </tr>
                      ))}
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
        <main className="flex-1 max-w-[1140px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 font-display uppercase">
                Algemene Ideeën, Regio’s & Logistiek
              </h2>
              <p className="text-xs sm:text-sm text-slate-600">
                Plek voor suggesties die nog niet aan één specifiek huisje hangen: regio-voorkeuren, beklimmingen, GPX-routes en afspraken.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveView('vergelijken')}
              className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 cursor-pointer self-start sm:self-auto"
            >
              ← Terug naar Kaart & Huisjes
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* New Idea Form */}
            <form
              onSubmit={handleAddIdea}
              className="lg:col-span-4 bg-white rounded-xl border border-slate-200 p-5 space-y-4"
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
                  maxLength={VALIDATION_CONSTRAINTS.NAME_MAX}
                  value={friendName}
                  onChange={(e) => setFriendName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:border-[#FC4C02] focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Onderwerp
                </label>
                <select
                  value={ideaCategory}
                  onChange={(e) => setIdeaCategory(e.target.value as GeneralIdeaRecord['category'])}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-900 focus:border-[#FC4C02] focus:outline-hidden"
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
                  maxLength={VALIDATION_CONSTRAINTS.IDEA_MAX}
                  value={ideaText}
                  onChange={(e) => setIdeaText(e.target.value)}
                  placeholder="Bijv. Zullen we dit jaar naar de Vogezen gaan? Of: Wie maakt vrijdag de pasta?"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:border-[#FC4C02] focus:outline-hidden"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-lg bg-[#FC4C02] hover:bg-[#E04300] text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Plaats op Ideeënbord
              </button>
            </form>

            {/* Ideas List */}
            <div className="lg:col-span-8 space-y-3">
              {activeIdeas.map((idea) => (
                <div
                  key={idea.id}
                  className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex items-start justify-between gap-4"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
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
                    <p className="text-sm text-slate-900 leading-relaxed">{idea.text}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleLikeIdea(idea)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-mono-num font-semibold transition-colors cursor-pointer"
                    >
                      <ThumbsUp className="w-3.5 h-3.5 text-[#FC4C02]" />
                      <span>+{idea.likesCount}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteIdea(idea)}
                      title="Verwijder idee"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>
      )}

      {/* Quiet Footer */}
      <footer className="bg-white border-t border-slate-200 mt-12">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>Kopgroep ’27 — Racefiets Weekend Planner (Do 27 mei t/m zo 30 mei 2027)</span>
          <div className="flex items-center gap-4">
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
