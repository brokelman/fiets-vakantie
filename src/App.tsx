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
  ShieldCheck,
  Droplets,
  Flame,
  Trophy,
  BedDouble,
  Bath,
  Send,
  Lightbulb,
  Share2,
  LogIn,
  LogOut,
  Cloud,
  CheckCircle2,
  Search,
  ChevronDown,
  ChevronUp,
  Trash2,
  Star,
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
  signInWithGoogle,
  VALIDATION_CONSTRAINTS,
} from './firebase';
import {
  FacilityFilter,
  GeneralIdeaRecord,
  HouseCommentRecord,
  HouseRecord,
  HouseVoteRecord,
  SortOption,
} from './types';
import { INITIAL_HOUSES, INITIAL_IDEAS } from './data/initialData';
import { HouseIllustration } from './components/HouseIllustration';
import { LeafletMap } from './components/LeafletMap';
import { AddHouseModal } from './components/AddHouseModal';
import { ShareDataModal } from './components/ShareDataModal';
import { ErrorBoundary } from './components/ErrorBoundary';

const STORAGE_KEY_HOUSES = 'kopgroep27_houses_v1';
const STORAGE_KEY_IDEAS = 'kopgroep27_ideas_v1';
const STORAGE_KEY_CYCLISTS = 'kopgroep27_cyclists_v1';
const STORAGE_KEY_USERNAME = 'kopgroep27_username_v1';

function MainApplication() {
  // User & Auth state
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [friendName, setFriendName] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY_USERNAME) || 'Jasper';
  });

  // Cyclist count calculator state (default 8)
  const [cyclistCount, setCyclistCount] = useState<number>(() => {
    const saved = Number(localStorage.getItem(STORAGE_KEY_CYCLISTS));
    return saved >= 2 && saved <= 24 ? saved : 8;
  });

  // Houses & Ideas state (initialized with realistic Ardennes/Limburg/Eifel data)
  const [localHouses, setLocalHouses] = useState<HouseRecord[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_HOUSES);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback to starter data
    }
    return INITIAL_HOUSES;
  });

  const [localIdeas, setLocalIdeas] = useState<GeneralIdeaRecord[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_IDEAS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback to starter ideas
    }
    return INITIAL_IDEAS;
  });

  // Cloud Firestore state (active when signed in with Google)
  const [cloudHouses, setCloudHouses] = useState<HouseRecord[] | null>(null);
  const [cloudVotesByHouse, setCloudVotesByHouse] = useState<Record<string, HouseVoteRecord[]>>({});
  const [cloudCommentsByHouse, setCloudCommentsByHouse] = useState<Record<string, HouseCommentRecord[]>>({});
  const [cloudIdeas, setCloudIdeas] = useState<GeneralIdeaRecord[] | null>(null);

  // Navigation & UI state
  const [activeView, setActiveView] = useState<'vergelijken' | 'ideeen'>('vergelijken');
  const [mobilePane, setMobilePane] = useState<'beide' | 'kaart' | 'lijst'>('beide');
  const [selectedHouseId, setSelectedHouseId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('populariteit');
  const [facilityFilter, setFacilityFilter] = useState<FacilityFilter>('alle');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({
    'chalet-col-du-haussire-laroche': true,
  });
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  // Idea board form state
  const [ideaCategory, setIdeaCategory] = useState<GeneralIdeaRecord['category']>('regio');
  const [ideaText, setIdeaText] = useState('');

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3200);
  };

  // Persist local state
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_HOUSES, JSON.stringify(localHouses));
    } catch {
      // Ignore storage quota errors
    }
  }, [localHouses]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_IDEAS, JSON.stringify(localIdeas));
    } catch {
      // Ignore storage quota errors
    }
  }, [localIdeas]);

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
      if (user?.displayName) {
        const firstName = user.displayName.split(' ')[0].slice(0, VALIDATION_CONSTRAINTS.NAME_MAX);
        setFriendName((prev) => (prev === 'Jasper' ? firstName : prev));
      }
    });
    return () => unsub();
  }, []);

  // Attach Firestore listeners when authenticated
  useEffect(() => {
    if (!isAuthReady || !currentUser) {
      setCloudHouses(null);
      setCloudIdeas(null);
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
            hasBikeStorage: Boolean(d.hasBikeStorage),
            hasBikeWash: Boolean(d.hasBikeWash),
            hasSaunaJacuzzi: Boolean(d.hasSaunaJacuzzi),
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

    return () => {
      unsubHouses();
      unsubIdeas();
    };
  }, [isAuthReady, currentUser]);

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

  // Combine cloud data (when logged in and populated) or local data
  const isUsingCloud = Boolean(currentUser && cloudHouses !== null && cloudHouses.length > 0);

  const activeHouses: HouseRecord[] = useMemo(() => {
    if (isUsingCloud && cloudHouses) {
      return cloudHouses.map((h) => ({
        ...h,
        votes: cloudVotesByHouse[h.id] || [],
        comments: cloudCommentsByHouse[h.id] || [],
      }));
    }
    return localHouses;
  }, [isUsingCloud, cloudHouses, cloudVotesByHouse, cloudCommentsByHouse, localHouses]);

  const activeIdeas: GeneralIdeaRecord[] = useMemo(() => {
    if (currentUser && cloudIdeas && cloudIdeas.length > 0) {
      return cloudIdeas;
    }
    return localIdeas;
  }, [currentUser, cloudIdeas, localIdeas]);

  // Seed initial houses & ideas to Firestore when signed in
  const handleSyncStarterDataToCloud = async () => {
    if (!currentUser) return;
    try {
      for (const h of localHouses) {
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
          hasBikeStorage: Boolean(h.hasBikeStorage),
          hasBikeWash: Boolean(h.hasBikeWash),
          hasSaunaJacuzzi: Boolean(h.hasSaunaJacuzzi),
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

      for (const idea of localIdeas) {
        const ideaId = sanitizeId(idea.id);
        await setDoc(doc(db, 'ideas', ideaId), {
          tripId: VALIDATION_CONSTRAINTS.TRIP_ID,
          authorId: currentUser.uid,
          authorName: idea.authorName.slice(0, VALIDATION_CONSTRAINTS.NAME_MAX),
          category: idea.category,
          text: idea.text.slice(0, VALIDATION_CONSTRAINTS.IDEA_MAX),
          likesCount: Math.round(Number(idea.likesCount) || 0),
          status: 'open',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      showToast('Alle huisjes en ideeën staan nu live in de gedeelde Firebase database!');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'houses');
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
        if (facilityFilter === 'stalling' && !h.hasBikeStorage) return false;
        if (facilityFilter === 'afspuitplek' && !h.hasBikeWash) return false;
        if (facilityFilter === 'wellness' && !h.hasSaunaJacuzzi) return false;
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

  // Add a new house
  const handleAddHouse = async (
    newHouseData: Omit<
      HouseRecord,
      'id' | 'tripId' | 'ownerId' | 'voteScore' | 'voteCount' | 'status' | 'createdAt' | 'updatedAt' | 'votes' | 'comments'
    >
  ) => {
    const newId = sanitizeId(`huis-${Date.now()}`);
    const nowIso = new Date().toISOString();

    const newRecord: HouseRecord = {
      ...newHouseData,
      id: newId,
      tripId: VALIDATION_CONSTRAINTS.TRIP_ID,
      ownerId: currentUser?.uid || 'local-user',
      voteScore: 5,
      voteCount: 1,
      status: 'active',
      createdAt: nowIso,
      updatedAt: nowIso,
      votes: [
        {
          id: `vote-${Date.now()}`,
          houseId: newId,
          userId: currentUser?.uid || 'local-user',
          voterName: newHouseData.addedBy,
          value: 5,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ],
      comments: [],
    };

    setLocalHouses((prev) => [newRecord, ...prev]);
    setSelectedHouseId(newId);

    if (currentUser) {
      try {
        await setDoc(doc(db, 'houses', newId), {
          tripId: VALIDATION_CONSTRAINTS.TRIP_ID,
          ownerId: currentUser.uid,
          title: newRecord.title,
          url: newRecord.url,
          photoUrl: newRecord.photoUrl,
          locationName: newRecord.locationName,
          lat: newRecord.lat,
          lng: newRecord.lng,
          totalPrice: newRecord.totalPrice,
          bedrooms: newRecord.bedrooms,
          bathrooms: newRecord.bathrooms,
          hasBikeStorage: newRecord.hasBikeStorage,
          hasBikeWash: newRecord.hasBikeWash,
          hasSaunaJacuzzi: newRecord.hasSaunaJacuzzi,
          routeUrl: newRecord.routeUrl,
          notes: newRecord.notes,
          addedBy: newRecord.addedBy,
          voteScore: 5,
          voteCount: 1,
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, `houses/${newId}`);
      }
    }

    showToast(`"${newRecord.title}" is toegevoegd aan de kaart!`);
  };

  // Vote on a house (-1 or 1..5)
  const handleVoteHouse = async (house: HouseRecord, voteValue: number) => {
    const cleanVoterName = (friendName.trim() || 'Groepslid').slice(0, VALIDATION_CONSTRAINTS.NAME_MAX);
    const voterKey = currentUser?.uid || `local-${cleanVoterName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user'}`;
    const nowIso = new Date().toISOString();

    const existingVotes = house.votes || [];
    const existingVote = existingVotes.find((v) => v.userId === voterKey || v.voterName === cleanVoterName);

    let updatedVotes: HouseVoteRecord[];
    if (existingVote) {
      updatedVotes = existingVotes.map((v) =>
        v.id === existingVote.id ? { ...v, value: voteValue, voterName: cleanVoterName, updatedAt: nowIso } : v
      );
    } else {
      updatedVotes = [
        ...existingVotes,
        {
          id: voterKey,
          houseId: house.id,
          userId: voterKey,
          voterName: cleanVoterName,
          value: voteValue,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ];
    }

    const newScore = updatedVotes.reduce((acc, v) => acc + v.value, 0);
    const newCount = updatedVotes.length;

    setLocalHouses((prev) =>
      prev.map((h) =>
        h.id === house.id
          ? {
              ...h,
              voteScore: newScore,
              voteCount: newCount,
              votes: updatedVotes,
              updatedAt: nowIso,
            }
          : h
      )
    );

    if (currentUser && isUsingCloud) {
      const voteDocRef = doc(db, 'houses', house.id, 'votes', currentUser.uid);
      const houseDocRef = doc(db, 'houses', house.id);
      try {
        const batch = writeBatch(db);
        batch.set(voteDocRef, {
          houseId: house.id,
          userId: currentUser.uid,
          voterName: cleanVoterName,
          value: voteValue,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        batch.update(houseDocRef, {
          voteScore: newScore,
          voteCount: newCount,
          updatedAt: serverTimestamp(),
        });
        await batch.commit();
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `houses/${house.id}/votes/${currentUser.uid}`);
      }
    }

    showToast(
      voteValue > 0
        ? `Stem (+${voteValue}★) van ${cleanVoterName} opgeslagen voor ${house.title}`
        : `Twijfelstem (-1) van ${cleanVoterName} geregistreerd`
    );
  };

  // Add a comment to a house
  const handleAddComment = async (house: HouseRecord) => {
    const rawDraft = commentDrafts[house.id] || '';
    const cleanText = rawDraft.trim().slice(0, VALIDATION_CONSTRAINTS.COMMENT_MAX);
    if (!cleanText) return;

    const cleanAuthor = (friendName.trim() || 'Groepslid').slice(0, VALIDATION_CONSTRAINTS.NAME_MAX);
    const commentId = sanitizeId(`reactie-${Date.now()}`);
    const nowIso = new Date().toISOString();

    const newComment: HouseCommentRecord = {
      id: commentId,
      houseId: house.id,
      authorId: currentUser?.uid || 'local-user',
      authorName: cleanAuthor,
      text: cleanText,
      createdAt: nowIso,
    };

    setLocalHouses((prev) =>
      prev.map((h) =>
        h.id === house.id
          ? {
              ...h,
              comments: [...(h.comments || []), newComment],
            }
          : h
      )
    );
    setCommentDrafts((prev) => ({ ...prev, [house.id]: '' }));

    if (currentUser && isUsingCloud) {
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
    }
  };

  // Delete a house (owner or local)
  const handleDeleteHouse = async (house: HouseRecord) => {
    setLocalHouses((prev) => prev.filter((h) => h.id !== house.id));
    if (selectedHouseId === house.id) {
      setSelectedHouseId(null);
    }

    if (currentUser && isUsingCloud && house.ownerId === currentUser.uid) {
      try {
        await deleteDoc(doc(db, 'houses', house.id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `houses/${house.id}`);
      }
    }
    showToast(`"${house.title}" verwijderd.`);
  };

  // Add a general idea to the Idea Board
  const handleAddIdea = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanText = ideaText.trim().slice(0, VALIDATION_CONSTRAINTS.IDEA_MAX);
    if (cleanText.length < VALIDATION_CONSTRAINTS.IDEA_MIN) return;

    const cleanAuthor = (friendName.trim() || 'Groepslid').slice(0, VALIDATION_CONSTRAINTS.NAME_MAX);
    const ideaId = sanitizeId(`idee-${Date.now()}`);
    const nowIso = new Date().toISOString();

    const newIdea: GeneralIdeaRecord = {
      id: ideaId,
      tripId: VALIDATION_CONSTRAINTS.TRIP_ID,
      authorId: currentUser?.uid || 'local-user',
      authorName: cleanAuthor,
      category: ideaCategory,
      text: cleanText,
      likesCount: 1,
      status: 'open',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    setLocalIdeas((prev) => [newIdea, ...prev]);
    setIdeaText('');

    if (currentUser) {
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
    }
    showToast('Idee toegevoegd aan het ideeënbord!');
  };

  // Upvote a general idea
  const handleLikeIdea = async (idea: GeneralIdeaRecord) => {
    const nextLikes = Math.min(1000, idea.likesCount + 1);
    setLocalIdeas((prev) =>
      prev.map((item) => (item.id === idea.id ? { ...item, likesCount: nextLikes } : item))
    );

    if (currentUser && cloudIdeas && cloudIdeas.some((i) => i.id === idea.id)) {
      try {
        await updateDoc(doc(db, 'ideas', idea.id), {
          likesCount: nextLikes,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `ideas/${idea.id}`);
      }
    }
  };

  const handleShowOnMap = (houseId: string) => {
    setSelectedHouseId(houseId);
    setActiveView('vergelijken');
    if (window.innerWidth < 1024) {
      setMobilePane('kaart');
    }
  };

  const handleImportData = async (payload: { houses: HouseRecord[]; ideas: GeneralIdeaRecord[] }) => {
    setLocalHouses(payload.houses);
    if (payload.ideas.length > 0) {
      setLocalIdeas(payload.ideas);
    }
    showToast('Selectie succesvol bijgewerkt!');
  };

  const handleResetStarterData = async () => {
    setLocalHouses(INITIAL_HOUSES);
    setLocalIdeas(INITIAL_IDEAS);
    showToast('Voorbeeld-huisjes in Ardennen, Zuid-Limburg en Eifel hersteld.');
  };

  const categoryLabels: Record<GeneralIdeaRecord['category'], string> = {
    regio: 'Regio & Klimmen',
    route: 'Routes & GPX',
    logistiek: 'Vervoer & Fietsendrager',
    overig: 'Eten & Overig',
  };

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
            onClick={() => setActiveView('ideeen')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'ideeen'
                ? 'text-slate-900 underline decoration-[#FC4C02] decoration-2 underline-offset-8 font-semibold'
                : ''
            }`}
          >
            Ideeënbord ({activeIdeas.length})
          </button>
          <button
            type="button"
            onClick={() => setIsShareModalOpen(true)}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Deel / Importeer JSON
          </button>
          <button
            type="button"
            onClick={() => {
              if (favoriteHouseId) handleShowOnMap(favoriteHouseId);
            }}
            className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Groepsfavoriet
          </button>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
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
              Samen vakantiehuizen aandragen, vergelijken op de kaart, live de kosten per fietser berekenen, stemmen op de groepsfavoriet en klimroutes uitwisselen.
            </p>
          </div>

          {/* Collaborator Identity & Cloud / Share Controls */}
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
              onClick={() => setIsShareModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Share2 className="w-3.5 h-3.5 text-[#FC4C02]" />
              JSON Backup / WhatsApp
            </button>

            {currentUser ? (
              <div className="flex items-center gap-2">
                {cloudHouses && cloudHouses.length === 0 && (
                  <button
                    type="button"
                    onClick={handleSyncStarterDataToCloud}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#FC4C02] text-white text-xs font-semibold hover:bg-[#E04300] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Cloud className="w-3.5 h-3.5" />
                    Zet 4 voorbeeld-huisjes in Cloud
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => logOutUser()}
                  title={`Ingelogd als ${currentUser.email}`}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-slate-700 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Cloud Sync Actief</span>
                  <LogOut className="w-3.5 h-3.5 text-slate-400 ml-1" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => signInWithGoogle()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white text-slate-900 hover:bg-slate-100 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogIn className="w-3.5 h-3.5 text-[#FC4C02]" />
                Log in voor Cloud Sync
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Toast Feedback Banner */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-lg border border-slate-700 text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#FC4C02] shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Mobile View Switcher (Kaart & Huisjes vs Ideeënbord) */}
      <div className="flex lg:hidden items-center justify-between gap-2 px-4 py-2.5 bg-white border-b border-slate-200">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveView('vergelijken')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'vergelijken' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Huisjes ({activeHouses.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveView('ideeen')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeView === 'ideeen' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Ideeënbord ({activeIdeas.length})
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

      {/* Main Content Area */}
      {activeView === 'vergelijken' ? (
        <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT COLUMN (Desktop 5 cols): Sticky Interactive Leaflet Map + Quick Idea Preview */}
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

            {/* Compact Algemene Ideeën & Regio's Teaser Box below map */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                  <Lightbulb className="w-4 h-4 text-[#FC4C02] shrink-0" />
                  <span>Algemene Ideeën & Regio’s ({activeIdeas.length})</span>
                </div>
                <p className="text-xs text-slate-500 truncate mt-0.5">
                  {activeIdeas[0]?.text || 'Deel losse ideeën over routes, fietsendragers of regio’s.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveView('ideeen')}
                className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-900 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
              >
                Open Ideeënbord →
              </button>
            </div>
          </div>

          {/* RIGHT COLUMN (Desktop 7 cols): Calculator, Filters & House Cards List */}
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
                {/* Facility filter segmented buttons */}
                <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
                  {(
                    [
                      { id: 'alle', label: 'Alle huisjes' },
                      { id: 'stalling', label: 'Fietsenstalling' },
                      { id: 'afspuitplek', label: 'Afspuitplek' },
                      { id: 'wellness', label: 'Sauna / Jacuzzi' },
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

                {/* Sort selector */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-slate-500 whitespace-nowrap">Sorteer op:</span>
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
                </div>
              </div>

              {/* Search input */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter op plaatsnaam, beklimming (bijv. Stockeu, Cauberg, Haussire) of naam..."
                  className="w-full pl-9 pr-3.5 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-[#FC4C02] focus:outline-hidden text-xs text-slate-900"
                />
              </div>
            </div>

            {/* Houses List */}
            {displayedHouses.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-10 text-center space-y-3">
                <Bike className="w-8 h-8 text-slate-400 mx-auto" />
                <h3 className="text-base font-bold text-slate-900">
                  Geen vakantiehuizen gevonden met deze filters
                </h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Pas je filter aan of voeg direct een nieuw gevonden accommodatie toe op de kaart.
                </p>
                <div className="flex items-center justify-center gap-2 pt-2">
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
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(true)}
                    className="px-4 py-2 rounded-lg bg-[#FC4C02] text-white text-xs font-semibold hover:bg-[#E04300] cursor-pointer"
                  >
                    + Nieuw Huisje Toevoegen
                  </button>
                </div>
              </div>
            ) : (
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
                            {/* Unboxed metadata kicker */}
                            <div className="flex items-center justify-between gap-2 text-xs text-slate-500 mb-1">
                              <span className="truncate">
                                Toegevoegd door <strong className="text-slate-700">{house.addedBy}</strong>
                                {' · '}
                                {house.locationName}
                              </span>
                              {(!currentUser || house.ownerId === currentUser.uid || !isUsingCloud) && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteHouse(house)}
                                  title="Verwijder huisje"
                                  className="text-slate-400 hover:text-red-600 transition-colors p-1 cursor-pointer shrink-0"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>

                            <h3 className="text-lg font-bold text-slate-900 leading-snug">
                              {house.title}
                            </h3>

                            {/* Facility metadata line (clean unboxed text with separators) */}
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
                              <span aria-hidden="true">·</span>
                              <span
                                className={`inline-flex items-center gap-1 ${
                                  house.hasBikeStorage ? 'text-emerald-700 font-medium' : 'text-slate-400 line-through'
                                }`}
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                Fietsenstalling
                              </span>
                              <span aria-hidden="true">·</span>
                              <span
                                className={`inline-flex items-center gap-1 ${
                                  house.hasBikeWash ? 'text-emerald-700 font-medium' : 'text-slate-400 line-through'
                                }`}
                              >
                                <Droplets className="w-3.5 h-3.5" />
                                Afspuitplek
                              </span>
                              <span aria-hidden="true">·</span>
                              <span
                                className={`inline-flex items-center gap-1 ${
                                  house.hasSaunaJacuzzi ? 'text-emerald-700 font-medium' : 'text-slate-400 line-through'
                                }`}
                              >
                                <Flame className="w-3.5 h-3.5" />
                                Sauna/Jacuzzi
                              </span>
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
      ) : (
        /* VIEW 2: Algemene Ideeën & Regio's Board */
        <main className="flex-1 max-w-[1140px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 font-display uppercase">
                Algemene Ideeën, Regio’s & Logistiek
              </h2>
              <p className="text-xs sm:text-sm text-slate-600">
                Plek voor suggesties die nog niet aan één specifiek huisje hangen: regio-voorkeuren, beklimmingen, GPX-routes, auto-indeling en fietsendragers.
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
                  placeholder="Bijv. Zullen we dit jaar naar de Vogezen gaan? Of: Wie neemt de fietsendrager mee?"
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

                  <button
                    type="button"
                    onClick={() => handleLikeIdea(idea)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-mono-num font-semibold shrink-0 transition-colors cursor-pointer"
                  >
                    <ThumbsUp className="w-3.5 h-3.5 text-[#FC4C02]" />
                    <span>+{idea.likesCount}</span>
                  </button>
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
              onClick={() => setIsShareModalOpen(true)}
              className="hover:text-slate-900 underline cursor-pointer"
            >
              Exporteer / Importeer JSON
            </button>
            <button
              type="button"
              onClick={() => setIsAddModalOpen(true)}
              className="hover:text-slate-900 underline cursor-pointer"
            >
              Nieuw huisje toevoegen
            </button>
          </div>
        </div>
      </footer>

      {/* Modals */}
      <AddHouseModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddHouse={handleAddHouse}
        cyclistCount={cyclistCount}
        defaultUserName={friendName}
      />

      <ShareDataModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        houses={activeHouses}
        ideas={activeIdeas}
        onImportData={handleImportData}
        onResetToStarterData={handleResetStarterData}
        isCloudConnected={Boolean(currentUser)}
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
