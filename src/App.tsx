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
  ShieldCheck,
  Building2,
  BellRing,
  Mail,
} from 'lucide-react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
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
  clearCachedAccessToken,
  db,
  handleFirestoreError,
  logOutUser,
  OperationType,
  sanitizeId,
  sendGroupReviewReminderEmailViaGmail,
  VALIDATION_CONSTRAINTS,
} from './firebase';
import {
  FacilityFilter,
  GeneralIdeaRecord,
  GroupRecord,
  HouseCommentRecord,
  HouseRecord,
  HouseVoteRecord,
  ParticipantRecord,
  RepositoryHouseRecord,
  SortOption,
  UserAccountRecord,
  UserRole,
  VoteFilter,
} from './types';
import { INITIAL_HOUSES } from './data/initialData';
import { HouseIllustration } from './components/HouseIllustration';
import { LeafletMap } from './components/LeafletMap';
import { AddHouseModal, HouseFormData } from './components/AddHouseModal';
import { ChosenHouseReviewModal } from './components/ChosenHouseReviewModal';
import { ReviewReminderEmailModal } from './components/ReviewReminderEmailModal';
import { RepositoryView } from './components/RepositoryView';
import {
  getUserGroupIds,
  userBelongsToGroup,
  UserGroupAdminView,
} from './components/UserGroupAdminView';
import { LoginPage } from './components/LoginPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  extractCustomLocalHousesToMigrate,
  getHouseRatingSummary,
  normalizeStoredBikeSpots,
  normalizeStoredCarSeats,
  parseBikeSpotsInput,
  parseCarSeatsInput,
  resolveTripId,
} from './utils/validation';
import { isReviewReminderDueNow } from './utils/dateUtils';

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

  // Multi-group state & User Hierarchy state
  const [selectedGroupId, setSelectedGroupId] = useState<string>('racefiets-2027');
  const [currentUserAccount, setCurrentUserAccount] = useState<UserAccountRecord | null>(null);
  const [cloudGroups, setCloudGroups] = useState<GroupRecord[]>([]);
  const [cloudUsers, setCloudUsers] = useState<UserAccountRecord[]>([]);
  const [cloudRepositoryHouses, setCloudRepositoryHouses] = useState<RepositoryHouseRecord[]>([]);
  const [allGroupsHouses, setAllGroupsHouses] = useState<HouseRecord[]>([]);
  const [expandedBackupHouses, setExpandedBackupHouses] = useState<Record<string, boolean>>({});
  const [expandedLongListHouses, setExpandedLongListHouses] = useState<Record<string, boolean>>({});
  const [shortlistViewFilter, setShortlistViewFilter] = useState<'alle' | 'shortlist' | 'longlist'>('alle');

  const activeTripId = useMemo(() => {
    if (isTestEnvironment) return 'racefiets-2027-test';
    return selectedGroupId || 'racefiets-2027';
  }, [isTestEnvironment, selectedGroupId]);

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
  const [activeView, setActiveView] = useState<
    'vergelijken' | 'beheren' | 'deelnemers' | 'ideeen' | 'repository' | 'administratie'
  >('vergelijken');
  const [listDisplayMode, setListDisplayMode] = useState<'kaarten' | 'tabel'>('kaarten');
  const [mobilePane, setMobilePane] = useState<'lijst' | 'kaart' | 'beide'>('lijst');
  const [selectedHouseId, setSelectedHouseId] = useState<string | null>(null);
  // Default sort is 'prijs_oplopend' so the list order never jumps around while voting and gives price context
  const [sortBy, setSortBy] = useState<SortOption>('prijs_oplopend');
  const [facilityFilter, setFacilityFilter] = useState<FacilityFilter>('alle');
  const [voteFilter, setVoteFilter] = useState<VoteFilter>('alle');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({});
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  // Participant form state — string inputs so '0', '', negative, and invalid inputs are accurately distinguished!
  const [editingParticipantId, setEditingParticipantId] = useState<string | null>(null);
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
  const [reviewingHouse, setReviewingHouse] = useState<HouseRecord | null>(null);
  const [reminderTargetGroup, setReminderTargetGroup] = useState<GroupRecord | null>(null);
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
      } else {
        clearCachedAccessToken();
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
  const isSuperAdmin = Boolean(
    currentUser &&
      isVerifiedMember &&
      (currentUser.email?.toLowerCase() === 'brokelman@gmail.com' ||
        currentUserAccount?.role === 'super_admin')
  );
  const isGroupAdmin = Boolean(
    isVerifiedMember &&
      currentUserAccount &&
      currentUserAccount.role === 'group_admin' &&
      userBelongsToGroup(currentUserAccount, activeTripId)
  );
  const isAdminUser = isSuperAdmin || isGroupAdmin;
  const canAccessAdminView = isSuperAdmin || Boolean(currentUserAccount?.role === 'group_admin');
  const canViewApp = Boolean(currentUser || isGuestReadOnly);

  const canModifyRecord = (ownerOrAuthorId: string): boolean => {
    if (!isVerifiedMember || !currentUser) return false;
    return currentUser.uid === ownerOrAuthorId || isAdminUser;
  };

  // Bootstrap default group 'racefiets-2027' + current user's /user_accounts/{uid} document on login
  useEffect(() => {
    if (!isAuthReady || !currentUser || !isVerifiedMember) {
      setCurrentUserAccount(null);
      return;
    }

    let isCancelled = false;
    const emailLower = (currentUser.email || '').toLowerCase();
    const isBrokelman = emailLower === 'brokelman@gmail.com';
    const defaultName = (
      friendName.trim() ||
      currentUser.displayName?.split(' ')[0] ||
      emailLower.split('@')[0] ||
      'Groepslid'
    ).slice(0, VALIDATION_CONSTRAINTS.NAME_MAX);

    const ensureUserAndDefaultGroup = async () => {
      try {
        // 1. Ensure default group 'racefiets-2027' exists so Kopgroep '27 data is always registered
        const defaultGroupRef = doc(db, 'groups', 'racefiets-2027');
        const defaultGroupSnap = await getDoc(defaultGroupRef);
        if (!defaultGroupSnap.exists()) {
          await setDoc(defaultGroupRef, {
            tripId: 'racefiets-2027',
            name: 'Kopgroep ’27',
            periodLabel: 'Do 27 mei t/m zo 30 mei 2027 (3 nachten)',
            startDate: '2027-05-27',
            endDate: '2027-05-30',
            regionLabel: 'Ardennen / Zuid-Limburg / Eifel',
            chosenHouseId: '',
            chosenHouseTitle: '',
            createdBy: currentUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }

        // 2. Check if user already has a /user_accounts/{uid} document
        const userRef = doc(db, 'user_accounts', currentUser.uid);
        const userSnap = await getDoc(userRef);

        // Also check if there is a synced participant record (`lid-...`) or pre-registration (`invite-...`) matching this user's UID, email, or name
        try {
          const allGroupUsersSnap = await getDocs(
            query(
              collection(db, 'user_accounts'),
              where('groupId', '==', 'racefiets-2027')
            )
          );
          for (const d of allGroupUsersSnap.docs) {
            if (d.id === currentUser.uid) continue;
            const dData = d.data();
            const dEmail = (dData.email || '').toLowerCase();
            const dName = (dData.displayName || '').trim().toLowerCase();
            const isPlaceholder = dEmail.endsWith('@kopgroep27.nl');
            const matchesUid = dData.uid === currentUser.uid;
            const matchesName =
              dName &&
              (dName === defaultName.toLowerCase() ||
                dName === (currentUser.displayName || '').trim().toLowerCase());

            if (isPlaceholder && (matchesUid || matchesName) && emailLower) {
              await updateDoc(doc(db, 'user_accounts', d.id), {
                uid: currentUser.uid,
                email: emailLower,
                updatedAt: serverTimestamp(),
              });
            }
          }
        } catch {
          // Ignore sync lookup errors
        }

        if (userSnap.exists()) {
          const data = userSnap.data();
          const needsRoleFix = isBrokelman && data.role !== 'super_admin';
          const needsEmailFix =
            emailLower &&
            (!data.email ||
              data.email.endsWith('@kopgroep27.nl') ||
              data.email === 'onbekend@kopgroep27.nl');

          if (needsRoleFix || needsEmailFix) {
            await updateDoc(userRef, {
              ...(needsRoleFix ? { role: 'super_admin' } : {}),
              ...(needsEmailFix ? { email: emailLower } : {}),
              updatedAt: serverTimestamp(),
            });
          }
          if (!isCancelled) {
            const primaryGroup = data.groupId || 'racefiets-2027';
            const rawGroupIds = Array.isArray(data.groupIds)
              ? data.groupIds.filter(Boolean)
              : [];
            const assignedGroups = Array.from(new Set([primaryGroup, ...rawGroupIds]));
            setSelectedGroupId((prev) =>
              isBrokelman || assignedGroups.includes(prev) ? prev : primaryGroup
            );
          }
        } else {
          // Check if an admin pre-registered this user by email or if a synced participant record exists
          let initialGroupId = 'racefiets-2027';
          let initialGroupIds: string[] = ['racefiets-2027'];
          let initialRole: UserRole = isBrokelman ? 'super_admin' : 'member';
          let initialName = defaultName;

          try {
            const preRegSnap = await getDocs(
              query(
                collection(db, 'user_accounts'),
                where('groupId', '==', 'racefiets-2027')
              )
            );
            const matchedDocs = preRegSnap.docs.filter((d) => {
              const dData = d.data();
              const dEmail = (dData.email || '').toLowerCase();
              const dName = (dData.displayName || '').trim().toLowerCase();
              return (
                (dEmail === emailLower && d.id.startsWith('invite-')) ||
                dData.uid === currentUser.uid ||
                (d.id.startsWith('lid-') &&
                  (dName === defaultName.toLowerCase() ||
                    dName === (currentUser.displayName || '').trim().toLowerCase()))
              );
            });
            if (matchedDocs.length > 0) {
              const md = matchedDocs[0].data();
              initialGroupId = md.groupId || 'racefiets-2027';
              const mergedGroups = new Set<string>([initialGroupId]);
              matchedDocs.forEach((docItem) => {
                const itemData = docItem.data();
                if (itemData.groupId) mergedGroups.add(itemData.groupId);
                if (Array.isArray(itemData.groupIds)) {
                  itemData.groupIds.forEach((gid: string) => {
                    if (gid) mergedGroups.add(gid);
                  });
                }
              });
              initialGroupIds = Array.from(mergedGroups);
              initialRole = isBrokelman ? 'super_admin' : (md.role as UserRole) || 'member';
              initialName = md.displayName || defaultName;
            }
          } catch {
            // Ignore pre-registration lookup errors
          }

          await setDoc(userRef, {
            uid: currentUser.uid,
            email: emailLower || 'onbekend@kopgroep27.nl',
            displayName: initialName,
            groupId: initialGroupId,
            groupIds: initialGroupIds,
            role: initialRole,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          if (!isCancelled) {
            setSelectedGroupId(initialGroupId);
          }
        }
      } catch (err) {
        console.error('Error bootstrapping user account / default group:', err);
      }
    };

    ensureUserAndDefaultGroup();

    // Real-time listener on current user's own account record
    const unsubSelf = onSnapshot(
      doc(db, 'user_accounts', currentUser.uid),
      (snap) => {
        if (!snap.exists()) return;
        const d = snap.data();
        const role: UserRole =
          emailLower === 'brokelman@gmail.com'
            ? 'super_admin'
            : (d.role as UserRole) || 'member';
        const primaryGroup = d.groupId || 'racefiets-2027';
        const rawGroupIds = Array.isArray(d.groupIds) ? d.groupIds.filter(Boolean) : [];
        const normalizedGroupIds = Array.from(new Set([primaryGroup, ...rawGroupIds]));

        const acc: UserAccountRecord = {
          id: snap.id,
          uid: d.uid || snap.id,
          email: d.email || emailLower,
          displayName: d.displayName || defaultName,
          groupId: primaryGroup,
          groupIds: normalizedGroupIds,
          role,
          hasPaid: Boolean(d.hasPaid),
          amountPaid:
            typeof d.amountPaid === 'number' ? d.amountPaid : Number(d.amountPaid) || 0,
          createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString(),
          updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
        };
        setCurrentUserAccount(acc);
        // Ensure non-super_admin users only view a group that is in their allowed groupIds list!
        if (role !== 'super_admin') {
          setSelectedGroupId((prev) =>
            normalizedGroupIds.includes(prev) ? prev : acc.groupId
          );
        }
      },
      (err) => {
        console.error('Error listening to user_accounts self doc:', err);
      }
    );

    return () => {
      isCancelled = true;
      unsubSelf();
    };
  }, [isAuthReady, currentUser, isVerifiedMember]);

  // Listen to /groups and /repository_houses and scoped /user_accounts
  useEffect(() => {
    if (!isAuthReady || !canViewApp) {
      setCloudGroups([]);
      setCloudRepositoryHouses([]);
      setCloudUsers([]);
      return;
    }

    const unsubGroups = onSnapshot(
      query(collection(db, 'groups'), where('tripId', '>=', '')),
      (snap) => {
        const list: GroupRecord[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          const tripId = d.tripId || docSnap.id;
          const isDefaultGroup = tripId === 'racefiets-2027' || docSnap.id === 'racefiets-2027';
          return {
            id: docSnap.id,
            tripId,
            name: d.name || 'Kopgroep ’27',
            periodLabel: d.periodLabel || 'Do 27 mei t/m zo 30 mei 2027 (3 nachten)',
            startDate: d.startDate || (isDefaultGroup ? '2027-05-27' : ''),
            endDate: d.endDate || (isDefaultGroup ? '2027-05-30' : ''),
            reviewReminderSentAt: d.reviewReminderSentAt || '',
            regionLabel: d.regionLabel || 'Ardennen / Zuid-Limburg / Eifel',
            chosenHouseId: d.chosenHouseId || '',
            chosenHouseTitle: d.chosenHouseTitle || '',
            createdBy: d.createdBy || '',
            createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString(),
            updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
          };
        });
        setCloudGroups(list);
      },
      (err) => {
        console.error('Error loading groups:', err);
      }
    );

    const unsubRepo = onSnapshot(
      query(collection(db, 'repository_houses'), where('ratingStars', 'in', [1, 2, 3, 4, 5])),
      (snap) => {
        const list: RepositoryHouseRecord[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            id: docSnap.id,
            sourceHouseId: d.sourceHouseId || docSnap.id,
            sourceGroupId: d.sourceGroupId || 'racefiets-2027',
            sourceGroupName: d.sourceGroupName || 'Kopgroep ’27',
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
            hasJacuzzi: Boolean(d.hasJacuzzi),
            hasSauna: Boolean(d.hasSauna),
            routeUrl: d.routeUrl || '',
            notes: d.notes || '',
            ratingStars: typeof d.ratingStars === 'number' ? d.ratingStars : Number(d.ratingStars) || 5,
            reviewText: d.reviewText || '',
            reviewerName: d.reviewerName || 'Groepslid',
            reviewerId: d.reviewerId || '',
            createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString(),
            updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
          };
        });
        setCloudRepositoryHouses(list);
      },
      (err) => {
        console.error('Error loading repository_houses:', err);
      }
    );

    const unsubAllHouses = onSnapshot(
      query(collection(db, 'houses'), where('tripId', '>=', '')),
      (snap) => {
        const list: HouseRecord[] = snap.docs
          .map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              tripId: d.tripId || 'racefiets-2027',
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
              isShortlisted: Boolean(d.isShortlisted),
              routeUrl: d.routeUrl || '',
              notes: d.notes || '',
              addedBy: d.addedBy || 'Groepslid',
              voteScore: typeof d.voteScore === 'number' ? d.voteScore : Number(d.voteScore) || 0,
              voteCount: typeof d.voteCount === 'number' ? d.voteCount : Number(d.voteCount) || 0,
              status: (d.status === 'archived' ? 'archived' : 'active') as 'active' | 'archived',
              createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString(),
              updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
            };
          })
          .filter((h) => h.status !== 'archived' && h.tripId !== 'racefiets-2027-test');
        setAllGroupsHouses(list);
      },
      (err) => {
        console.error('Error loading all houses for repository:', err);
      }
    );

    let unsubUsers: (() => void) | null = null;
    if (isVerifiedMember && currentUser) {
      // Super Admin loads all users across all groups; Group Admin or Member queries users in their active group
      const usersQuery = isSuperAdmin
        ? collection(db, 'user_accounts')
        : query(collection(db, 'user_accounts'), where('groupId', '==', activeTripId));

      unsubUsers = onSnapshot(
        usersQuery,
        (snap) => {
          const list: UserAccountRecord[] = snap.docs.map((docSnap) => {
            const d = docSnap.data();
            const primaryGroup = d.groupId || 'racefiets-2027';
            const rawGroupIds = Array.isArray(d.groupIds) ? d.groupIds.filter(Boolean) : [];
            const groupIds = Array.from(new Set([primaryGroup, ...rawGroupIds]));
            return {
              id: docSnap.id,
              uid: d.uid || docSnap.id,
              email: d.email || '',
              displayName: d.displayName || 'Groepslid',
              groupId: primaryGroup,
              groupIds,
              role: (d.role as UserRole) || 'member',
              hasPaid: Boolean(d.hasPaid),
              amountPaid:
                typeof d.amountPaid === 'number'
                  ? d.amountPaid
                  : Number(d.amountPaid) || 0,
              createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString(),
              updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
            };
          });
          setCloudUsers(list);
        },
        (err) => {
          console.error('Error loading user_accounts:', err);
        }
      );
    }

    return () => {
      unsubGroups();
      unsubRepo();
      unsubAllHouses();
      if (unsubUsers) unsubUsers();
    };
  }, [isAuthReady, canViewApp, isVerifiedMember, currentUser, isSuperAdmin, activeTripId]);

  // Active Group Record (with safe fallback for 'racefiets-2027')
  const activeGroupRecord: GroupRecord = useMemo(() => {
    const found = cloudGroups.find(
      (g) => g.tripId === activeTripId || g.id === activeTripId
    );
    if (found) return found;
    return {
      id: activeTripId,
      tripId: activeTripId,
      name: activeTripId === 'racefiets-2027' ? 'Kopgroep ’27' : activeTripId,
      periodLabel: 'Do 27 mei t/m zo 30 mei 2027 (3 nachten)',
      startDate: '2027-05-27',
      endDate: '2027-05-30',
      reviewReminderSentAt: '',
      regionLabel: 'Ardennen / Zuid-Limburg / Eifel',
      chosenHouseId: '',
      chosenHouseTitle: '',
      createdBy: currentUser?.uid || 'system',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }, [cloudGroups, activeTripId, currentUser]);

  const allGroupsWithDefault: GroupRecord[] = useMemo(() => {
    const hasDefault = cloudGroups.some(
      (g) => g.tripId === 'racefiets-2027' || g.id === 'racefiets-2027'
    );
    if (hasDefault) return cloudGroups;
    return [
      {
        id: 'racefiets-2027',
        tripId: 'racefiets-2027',
        name: 'Kopgroep ’27',
        periodLabel: 'Do 27 mei t/m zo 30 mei 2027 (3 nachten)',
        startDate: '2027-05-27',
        endDate: '2027-05-30',
        reviewReminderSentAt: '',
        regionLabel: 'Ardennen / Zuid-Limburg / Eifel',
        chosenHouseId: '',
        chosenHouseTitle: '',
        createdBy: currentUser?.uid || 'system',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      ...cloudGroups,
    ];
  }, [cloudGroups, currentUser]);

  // Groups that the currently logged-in user belongs to (Super User has access to all groups; multi-group users have access to all their assigned groupIds)
  const userAccessibleGroups: GroupRecord[] = useMemo(() => {
    if (isSuperAdmin) return allGroupsWithDefault;
    const allowedIds = currentUserAccount
      ? getUserGroupIds(currentUserAccount)
      : ['racefiets-2027'];
    const filtered = allGroupsWithDefault.filter((g) => allowedIds.includes(g.tripId));
    return filtered.length > 0 ? filtered : [activeGroupRecord];
  }, [isSuperAdmin, allGroupsWithDefault, currentUserAccount, activeGroupRecord]);

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
            isShortlisted: Boolean(d.isShortlisted),
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

  // Unified Central Repository list: combines all non-archived houses found by all groups + explicit repository reviews, marking chosen houses
  const combinedRepositoryHouses: RepositoryHouseRecord[] = useMemo(() => {
    const groupById = new Map<string, GroupRecord>();
    allGroupsWithDefault.forEach((g) => {
      groupById.set(g.tripId, g);
      groupById.set(g.id, g);
    });

    const repoBySourceKey = new Map<string, RepositoryHouseRecord>();
    cloudRepositoryHouses.forEach((r) => {
      const key = `${r.sourceGroupId}::${r.sourceHouseId}`;
      repoBySourceKey.set(key, r);
      repoBySourceKey.set(r.id, r);
    });

    // Combine allGroupsHouses with current activeHouses in case local snapshot is ahead
    const mergedHousesMap = new Map<string, HouseRecord>();
    allGroupsHouses.forEach((h) => mergedHousesMap.set(`${h.tripId}::${h.id}`, h));
    activeHouses.forEach((h) => {
      if (h.tripId !== 'racefiets-2027-test') {
        mergedHousesMap.set(`${h.tripId}::${h.id}`, h);
      }
    });

    const result: RepositoryHouseRecord[] = [];
    const seenRepoIds = new Set<string>();

    mergedHousesMap.forEach((house) => {
      const grp = groupById.get(house.tripId);
      const groupName =
        grp?.name || (house.tripId === 'racefiets-2027' ? 'Kopgroep ’27' : house.tripId);
      const isChosenByGroup = Boolean(
        grp &&
          ((grp.chosenHouseId && grp.chosenHouseId === house.id) ||
            (grp.chosenHouseTitle &&
              grp.chosenHouseTitle.trim().toLowerCase() === house.title.trim().toLowerCase()))
      );

      const sourceKey = `${house.tripId}::${house.id}`;
      const existingRepo =
        repoBySourceKey.get(sourceKey) ||
        repoBySourceKey.get(`repo-${house.tripId}-${house.id}`);

      if (existingRepo) {
        seenRepoIds.add(existingRepo.id);
        result.push({
          ...existingRepo,
          sourceGroupName: groupName,
          title: house.title || existingRepo.title,
          url: house.url || existingRepo.url,
          photoUrl: house.photoUrl || existingRepo.photoUrl,
          locationName: house.locationName || existingRepo.locationName,
          lat: house.lat || existingRepo.lat,
          lng: house.lng || existingRepo.lng,
          totalPrice: house.totalPrice || existingRepo.totalPrice,
          bedrooms: house.bedrooms || existingRepo.bedrooms,
          bathrooms: house.bathrooms || existingRepo.bathrooms,
          hasBbq: house.hasBbq,
          hasFireplace: house.hasFireplace,
          hasJacuzzi: house.hasJacuzzi,
          hasSauna: house.hasSauna,
          routeUrl: house.routeUrl || existingRepo.routeUrl,
          notes: house.notes || existingRepo.notes,
          isChosen: isChosenByGroup,
        });
      } else {
        const ratingSummary = getHouseRatingSummary(house);
        const derivedStars =
          ratingSummary.count > 0 && ratingSummary.average > 0
            ? Math.max(1, Math.min(5, Math.round(ratingSummary.average)))
            : 4;

        result.push({
          id: `repo-${house.tripId}-${house.id}`,
          sourceHouseId: house.id,
          sourceGroupId: house.tripId,
          sourceGroupName: groupName,
          title: house.title,
          url: house.url,
          photoUrl: house.photoUrl || '',
          locationName: house.locationName,
          lat: house.lat,
          lng: house.lng,
          totalPrice: house.totalPrice,
          bedrooms: house.bedrooms,
          bathrooms: house.bathrooms,
          hasBbq: house.hasBbq,
          hasFireplace: house.hasFireplace,
          hasJacuzzi: house.hasJacuzzi,
          hasSauna: house.hasSauna,
          routeUrl: house.routeUrl || '',
          notes: house.notes || '',
          ratingStars: derivedStars,
          reviewText:
            house.notes ||
            (isChosenByGroup
              ? `Uitverkozen als groepshuisje door ${groupName}.`
              : `Aangedragen als kandidaat-huisje door ${house.addedBy} (${groupName}).`),
          reviewerName: house.addedBy || 'Groepslid',
          reviewerId: house.ownerId || '',
          isChosen: isChosenByGroup,
          createdAt: house.createdAt,
          updatedAt: house.updatedAt,
        });
      }
    });

    // Also include any standalone repository_houses whose source house was deleted or came from another source
    cloudRepositoryHouses.forEach((r) => {
      if (!seenRepoIds.has(r.id)) {
        const grp = groupById.get(r.sourceGroupId);
        const groupName = grp?.name || r.sourceGroupName;
        const isChosenByGroup = Boolean(
          grp &&
            ((grp.chosenHouseId && grp.chosenHouseId === r.sourceHouseId) ||
              (grp.chosenHouseTitle &&
                grp.chosenHouseTitle.trim().toLowerCase() === r.title.trim().toLowerCase()))
        );
        result.push({
          ...r,
          sourceGroupName: groupName,
          isChosen: isChosenByGroup || Boolean(r.isChosen),
        });
      }
    });

    return result;
  }, [allGroupsWithDefault, cloudRepositoryHouses, allGroupsHouses, activeHouses]);

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

  // Count how many houses the current user has not yet rated
  const unratedHousesCount = useMemo(() => {
    if (!currentUser) return activeHouses.length;
    return activeHouses.filter((h) => !(h.votes || []).some((v) => v.userId === currentUser.uid)).length;
  }, [activeHouses, currentUser]);

  // Determine the single Group Favorite house (highest average rating > 0, tie-breaker: more votes, then lower price)
  const favoriteHouseId = useMemo(() => {
    if (activeHouses.length === 0) return null;
    const sorted = [...activeHouses].sort((a, b) => {
      const rA = getHouseRatingSummary(a);
      const rB = getHouseRatingSummary(b);
      if (rB.average !== rA.average) return rB.average - rA.average;
      if (rB.count !== rA.count) return rB.count - rA.count;
      return a.totalPrice - b.totalPrice;
    });
    const topRating = getHouseRatingSummary(sorted[0]);
    return topRating.count > 0 && topRating.average > 0 ? sorted[0].id : null;
  }, [activeHouses]);

  // Count how many houses in the active group are currently on the Short List
  const shortlistedHousesCount = useMemo(() => {
    return activeHouses.filter((h) => Boolean(h.isShortlisted)).length;
  }, [activeHouses]);

  // Filtered and sorted houses (Chosen house ALWAYS at position 0; when Short List is used, Short List houses come before Long List houses!)
  const displayedHouses = useMemo(() => {
    const chosenId = activeGroupRecord.chosenHouseId;
    const groupUsesShortlist = shortlistedHousesCount > 0;
    return activeHouses
      .filter((h) => {
        if (groupUsesShortlist && shortlistViewFilter === 'shortlist' && !h.isShortlisted && h.id !== chosenId) {
          return false;
        }
        if (groupUsesShortlist && shortlistViewFilter === 'longlist' && (h.isShortlisted || h.id === chosenId)) {
          return false;
        }
        if (facilityFilter === 'bbq' && !h.hasBbq) return false;
        if (facilityFilter === 'openhaard' && !h.hasFireplace) return false;
        if (facilityFilter === 'jacuzzi' && !h.hasJacuzzi) return false;
        if (facilityFilter === 'sauna' && !h.hasSauna) return false;
        if (voteFilter !== 'alle' && currentUser) {
          const hasVoted = (h.votes || []).some((v) => v.userId === currentUser.uid);
          if (voteFilter === 'nog_niet_beoordeeld' && hasVoted) return false;
          if (voteFilter === 'wel_beoordeeld' && !hasVoted) return false;
        }
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
        // 1. Chosen house is ALWAYS at the top of the list
        const aIsChosen = Boolean(chosenId && a.id === chosenId);
        const bIsChosen = Boolean(chosenId && b.id === chosenId);
        if (aIsChosen !== bIsChosen) {
          return aIsChosen ? -1 : 1;
        }
        // 2. If the group uses the Short List feature, Short List houses ALWAYS appear above Long List houses
        if (groupUsesShortlist) {
          const aShort = Boolean(a.isShortlisted);
          const bShort = Boolean(b.isShortlisted);
          if (aShort !== bShort) {
            return aShort ? -1 : 1;
          }
        }
        if (sortBy === 'populariteit') {
          const rA = getHouseRatingSummary(a);
          const rB = getHouseRatingSummary(b);
          if (rB.average !== rA.average) return rB.average - rA.average;
          if (rB.count !== rA.count) return rB.count - rA.count;
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
  }, [
    activeHouses,
    activeGroupRecord.chosenHouseId,
    shortlistedHousesCount,
    shortlistViewFilter,
    facilityFilter,
    voteFilter,
    currentUser,
    searchQuery,
    sortBy,
  ]);

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

  // Toggle Short List indicator on a house (preserves 100% of existing house data)
  const handleToggleShortlist = async (house: HouseRecord) => {
    if (!requireVerifiedLogin('de Short List aan te passen')) return;
    const nextVal = !house.isShortlisted;
    // Optimistic local state update so UI responds immediately
    setCloudHouses((prev) =>
      prev
        ? prev.map((h) => (h.id === house.id ? { ...h, isShortlisted: nextVal } : h))
        : prev
    );
    try {
      await updateDoc(doc(db, 'houses', house.id), {
        isShortlisted: nextVal,
        updatedAt: serverTimestamp(),
      });
      showToast(
        nextVal
          ? `"${house.title}" is op de Short List gezet!`
          : `"${house.title}" is teruggezet naar de Long List.`
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `houses/${house.id}`);
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

  // PARTICIPANTS & CARPOOL MANAGEMENT — Supports adding AND editing all variables (name, isDriver, carSeats, bikeSpots, notes)
  const handleStartEditParticipant = (p: ParticipantRecord) => {
    if (!requireVerifiedLogin('vervoersgegevens te wijzigen')) return;
    setEditingParticipantId(p.id);
    setParticipantName(p.name);
    setParticipantIsDriver(p.isDriver);
    setParticipantCarSeatsInput(p.isDriver ? String(p.carSeats) : '3');
    setParticipantBikeSpotsInput(p.isDriver ? String(p.bikeSpots) : '0');
    setParticipantNotes(p.notes || '');
    setParticipantFormError(null);
  };

  const handleCancelEditParticipant = () => {
    setEditingParticipantId(null);
    setParticipantName('');
    setParticipantIsDriver(true);
    setParticipantCarSeatsInput('3');
    setParticipantBikeSpotsInput('0');
    setParticipantNotes('');
    setParticipantFormError(null);
  };

  const handleAddParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    setParticipantFormError(null);

    if (!requireVerifiedLogin('vervoersgegevens op te slaan')) return;
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

    const cleanNotes = participantNotes.trim().slice(0, 300);

    // If editing an existing participant entry, update all variables in Firestore
    if (editingParticipantId) {
      try {
        await updateDoc(doc(db, 'participants', editingParticipantId), {
          name: cleanName,
          isDriver: participantIsDriver,
          carSeats: seats,
          bikeSpots: bikes,
          notes: cleanNotes,
          updatedAt: serverTimestamp(),
        });

        handleCancelEditParticipant();
        showToast(
          participantIsDriver
            ? `Gegevens van ${cleanName} bijgewerkt: chauffeur (${seats} pers., ${bikes} fietsen)!`
            : `Gegevens van ${cleanName} bijgewerkt: meerijder!`
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `participants/${editingParticipantId}`);
      }
      return;
    }

    const pId = sanitizeId(`deelnemer-${Date.now()}`);

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
    updates: Partial<Pick<ParticipantRecord, 'name' | 'isDriver' | 'carSeats' | 'bikeSpots' | 'notes'>>
  ) => {
    if (!requireVerifiedLogin('deelnemergegevens aan te passen')) return;

    const nextName =
      updates.name !== undefined
        ? updates.name.trim().slice(0, VALIDATION_CONSTRAINTS.NAME_MAX) || participant.name
        : participant.name;
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
        name: nextName,
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
      showToast('Alleen degene die deze deelnemer heeft aangemaakt (of de beheerder) kan de regel verwijderen.');
      return;
    }

    if (editingParticipantId === participant.id) {
      handleCancelEditParticipant();
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

  // GROUP & REPOSITORY HANDLERS
  const handleSaveChosenAndReview = async (payload: {
    house: HouseRecord;
    ratingStars: number;
    reviewText: string;
    reviewerName: string;
  }) => {
    if (!requireVerifiedLogin('het gekozen huisje en de review op te slaan')) return;
    if (!currentUser) return;

    const { house, ratingStars, reviewText, reviewerName } = payload;
    const cleanSourceHouseId = sanitizeId(house.id || `huis-${Date.now()}`);
    const repoDocId = sanitizeId(`repo-${activeTripId}-${cleanSourceHouseId}`);
    const repoDocRef = doc(db, 'repository_houses', repoDocId);
    const groupDocRef = doc(db, 'groups', activeTripId);

    const safeTitle = (house.title || '').trim().slice(0, 120);
    const normalizedTitle = safeTitle.length >= 2 ? safeTitle : 'Gekozen groepshuisje';

    const rawUrl = (house.url || '').trim();
    const normalizedUrl = (
      /^https?:\/\/.+/i.test(rawUrl) && rawUrl.length >= 8
        ? rawUrl
        : rawUrl.length >= 4
        ? `https://${rawUrl}`
        : 'https://supermannen.netlify.app'
    ).slice(0, 2000);

    const safeLocation = (house.locationName || '').trim().slice(0, 160);
    const normalizedLocation = safeLocation.length >= 2 ? safeLocation : 'Ardennen / Limburg';

    const safeGroupName = (activeGroupRecord.name || '').trim().slice(0, 80);
    const normalizedGroupName = safeGroupName.length >= 2 ? safeGroupName : 'Kopgroep ’27';

    const safeReview = (reviewText || '').trim().slice(0, 1200);
    const normalizedReview =
      safeReview.length >= 2
        ? safeReview
        : `Gekozen als accommodatie door ${normalizedGroupName}.`;

    const safeReviewer = (reviewerName || currentUser.displayName || 'Groepslid').trim().slice(0, 60);
    const normalizedReviewer = safeReviewer.length >= 1 ? safeReviewer : 'Groepslid';

    const rawLat = Number(house.lat);
    const normalizedLat = Number.isFinite(rawLat) && rawLat >= -90 && rawLat <= 90 ? rawLat : 50.4;

    const rawLng = Number(house.lng);
    const normalizedLng = Number.isFinite(rawLng) && rawLng >= -180 && rawLng <= 180 ? rawLng : 5.8;

    const rawPrice = Math.round(Number(house.totalPrice));
    const normalizedPrice = Number.isFinite(rawPrice) && rawPrice > 0 ? Math.min(50000, rawPrice) : 1000;

    const rawBedrooms = Math.round(Number(house.bedrooms));
    const normalizedBedrooms = Number.isFinite(rawBedrooms) && rawBedrooms >= 1 ? Math.min(50, rawBedrooms) : 4;

    const rawBathrooms = Math.round(Number(house.bathrooms));
    const normalizedBathrooms = Number.isFinite(rawBathrooms) && rawBathrooms >= 1 ? Math.min(50, rawBathrooms) : 2;

    const rawStars = Math.round(Number(ratingStars));
    const normalizedStars = Number.isFinite(rawStars) ? Math.max(1, Math.min(5, rawStars)) : 5;

    const repoPayload: Record<string, any> = {
      sourceHouseId: cleanSourceHouseId,
      sourceGroupId: activeTripId,
      sourceGroupName: normalizedGroupName,
      title: normalizedTitle,
      url: normalizedUrl,
      photoUrl: (house.photoUrl || '').slice(0, 2000),
      locationName: normalizedLocation,
      lat: normalizedLat,
      lng: normalizedLng,
      totalPrice: normalizedPrice,
      bedrooms: normalizedBedrooms,
      bathrooms: normalizedBathrooms,
      hasBbq: Boolean(house.hasBbq),
      hasFireplace: Boolean(house.hasFireplace),
      hasJacuzzi: Boolean(house.hasJacuzzi),
      hasSauna: Boolean(house.hasSauna),
      routeUrl: (house.routeUrl || '').slice(0, 2000),
      notes: (house.notes || '').slice(0, 1000),
      ratingStars: normalizedStars,
      reviewText: normalizedReview,
      reviewerName: normalizedReviewer,
      reviewerId: currentUser.uid,
      updatedAt: serverTimestamp(),
    };

    const repoAlreadyExists = cloudRepositoryHouses.some((r) => r.id === repoDocId);

    try {
      if (repoAlreadyExists) {
        await updateDoc(repoDocRef, repoPayload);
      } else {
        await setDoc(repoDocRef, {
          ...repoPayload,
          createdAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `repository_houses/${repoDocId}`);
    }

    // Also mark as chosenHouseId on the group document
    try {
      const existingGroupSnap = await getDoc(groupDocRef);
      const existingGroupData = existingGroupSnap.exists() ? existingGroupSnap.data() : null;
      const safePeriodLabel = (
        (existingGroupData?.periodLabel || activeGroupRecord.periodLabel || 'Mei 2027').trim()
      ).slice(0, 80);
      const safeRegionLabel = (
        (existingGroupData?.regionLabel || activeGroupRecord.regionLabel || 'Ardennen / Limburg').trim()
      ).slice(0, 100);
      const safeStartDate = (
        existingGroupData?.startDate || activeGroupRecord.startDate || '2027-05-27'
      ).slice(0, 10);
      const safeEndDate = (
        existingGroupData?.endDate || activeGroupRecord.endDate || '2027-05-30'
      ).slice(0, 10);
      const safeCreatedBy =
        typeof existingGroupData?.createdBy === 'string' &&
        /^[a-zA-Z0-9_-]{1,128}$/.test(existingGroupData.createdBy)
          ? existingGroupData.createdBy
          : currentUser.uid;

      const fullGroupDoc: Record<string, any> = {
        tripId: activeTripId,
        name: normalizedGroupName,
        periodLabel: safePeriodLabel.length >= 2 ? safePeriodLabel : 'Mei 2027',
        regionLabel: safeRegionLabel.length >= 2 ? safeRegionLabel : 'Ardennen / Limburg',
        startDate: safeStartDate,
        endDate: safeEndDate,
        chosenHouseId: cleanSourceHouseId,
        chosenHouseTitle: normalizedTitle,
        createdBy: safeCreatedBy,
        createdAt:
          existingGroupData?.createdAt && typeof existingGroupData.createdAt.toDate === 'function'
            ? existingGroupData.createdAt
            : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (
        typeof existingGroupData?.reviewReminderSentAt === 'string' &&
        existingGroupData.reviewReminderSentAt.length <= 40
      ) {
        fullGroupDoc.reviewReminderSentAt = existingGroupData.reviewReminderSentAt;
      }

      await setDoc(groupDocRef, fullGroupDoc);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `groups/${activeTripId}`);
    }

    showToast(
      `"${normalizedTitle}" is gemarkeerd als hét gekozen huisje van ${normalizedGroupName} en toegevoegd aan de Centrale Repository!`
    );
  };

  // 1-Click Import from Central Repository to active group's houses list
  const handleAddRepoHouseToGroup = async (repoHouse: RepositoryHouseRecord) => {
    if (!requireVerifiedLogin('een huisje uit de repository toe te voegen aan jullie groep')) return;
    if (!currentUser) return;

    const newId = sanitizeId(`huis-${Date.now()}`);
    const houseDocRef = doc(db, 'houses', newId);
    const voteDocRef = doc(db, 'houses', newId, 'votes', currentUser.uid);
    const addedByName = (friendName.trim() || currentUser.displayName || 'Groepslid').slice(
      0,
      VALIDATION_CONSTRAINTS.NAME_MAX
    );

    try {
      const batch = writeBatch(db);
      batch.set(houseDocRef, {
        tripId: activeTripId,
        ownerId: currentUser.uid,
        title: repoHouse.title.slice(0, 120),
        url: repoHouse.url.slice(0, 2000),
        photoUrl: (repoHouse.photoUrl || '').slice(0, 2000),
        locationName: repoHouse.locationName.slice(0, 160),
        lat: Number(repoHouse.lat) || 50.4,
        lng: Number(repoHouse.lng) || 5.8,
        totalPrice: Math.max(1, Math.min(50000, Math.round(repoHouse.totalPrice))),
        bedrooms: Math.max(1, Math.min(50, Math.round(repoHouse.bedrooms))),
        bathrooms: Math.max(1, Math.min(50, Math.round(repoHouse.bathrooms))),
        hasBbq: Boolean(repoHouse.hasBbq),
        hasFireplace: Boolean(repoHouse.hasFireplace),
        hasJacuzzi: Boolean(repoHouse.hasJacuzzi),
        hasSauna: Boolean(repoHouse.hasSauna),
        routeUrl: (repoHouse.routeUrl || '').slice(0, 2000),
        notes: (
          repoHouse.notes
            ? `${repoHouse.notes} (Aanrader van ${repoHouse.sourceGroupName}: ${repoHouse.ratingStars}★)`
            : `Overgenomen uit Centrale Repository — gekozen door ${repoHouse.sourceGroupName} (${repoHouse.ratingStars}★: "${repoHouse.reviewText}")`
        ).slice(0, 1000),
        addedBy: addedByName,
        voteScore: 5,
        voteCount: 1,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(voteDocRef, {
        houseId: newId,
        userId: currentUser.uid,
        voterName: addedByName,
        value: 5,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();
      showToast(`"${repoHouse.title}" is met 1 klik toegevoegd aan de lijst van ${activeGroupRecord.name}!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `houses/${newId}`);
    }
  };

  // Super Admin: Create a new user group with start/end date (date or date range)
  const handleCreateGroup = async (payload: {
    tripId: string;
    name: string;
    startDate: string;
    endDate: string;
    periodLabel: string;
    regionLabel: string;
  }) => {
    if (!isSuperAdmin || !currentUser) return;
    const cleanTripId = sanitizeId(payload.tripId);
    const cleanName = payload.name.trim().slice(0, 80) || 'Fietsgroep';
    const cleanStart = payload.startDate.slice(0, 10);
    const cleanEnd = (payload.endDate || payload.startDate).slice(0, 10);
    const cleanPeriod = payload.periodLabel.trim().slice(0, 80) || 'Mei 2027';
    const cleanRegion = payload.regionLabel.trim().slice(0, 100) || 'Ardennen / Limburg';
    const nowIso = new Date().toISOString();

    try {
      await setDoc(doc(db, 'groups', cleanTripId), {
        tripId: cleanTripId,
        name: cleanName,
        startDate: cleanStart,
        endDate: cleanEnd,
        periodLabel: cleanPeriod,
        regionLabel: cleanRegion,
        chosenHouseId: '',
        chosenHouseTitle: '',
        createdBy: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setCloudGroups((prev) => {
        const filtered = prev.filter((g) => g.tripId !== cleanTripId && g.id !== cleanTripId);
        return [
          ...filtered,
          {
            id: cleanTripId,
            tripId: cleanTripId,
            name: cleanName,
            startDate: cleanStart,
            endDate: cleanEnd,
            periodLabel: cleanPeriod,
            regionLabel: cleanRegion,
            reviewReminderSentAt: '',
            chosenHouseId: '',
            chosenHouseTitle: '',
            createdBy: currentUser.uid,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        ];
      });
      setSelectedGroupId(cleanTripId);
      showToast(`Nieuwe groep "${cleanName}" (${cleanPeriod}) is aangemaakt!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `groups/${cleanTripId}`);
    }
  };

  // Super Admin or Group Admin: Update group name, start/end date range, period, or region
  const handleUpdateGroupDetails = async (
    groupId: string,
    payload: {
      name: string;
      startDate: string;
      endDate: string;
      periodLabel: string;
      regionLabel: string;
    }
  ) => {
    if (!currentUser) return;
    // Find existing group doc if its Firestore doc ID differs from tripId
    const matchedInState = cloudGroups.find(
      (g) => g.tripId === groupId || g.id === groupId
    );
    const targetDocId = matchedInState?.id || groupId;
    const groupRef = doc(db, 'groups', targetDocId);

    const cleanName = payload.name.trim().slice(0, 80) || 'Fietsgroep';
    const cleanStart = (payload.startDate || '2027-05-27').slice(0, 10);
    const cleanEnd = (payload.endDate || payload.startDate || '2027-05-30').slice(0, 10);
    const cleanPeriod = payload.periodLabel.trim().slice(0, 80) || 'Mei 2027';
    const cleanRegion = payload.regionLabel.trim().slice(0, 100) || 'Ardennen / Limburg';

    try {
      const existingGroupSnap = await getDoc(groupRef);
      const existingGroupData = existingGroupSnap.exists() ? existingGroupSnap.data() : null;
      const safeCreatedBy =
        typeof existingGroupData?.createdBy === 'string' &&
        /^[a-zA-Z0-9_-]{1,128}$/.test(existingGroupData.createdBy)
          ? existingGroupData.createdBy
          : currentUser.uid;

      const safeChosenHouseId =
        typeof existingGroupData?.chosenHouseId === 'string'
          ? existingGroupData.chosenHouseId.slice(0, 128)
          : matchedInState?.chosenHouseId || '';
      const safeChosenHouseTitle =
        typeof existingGroupData?.chosenHouseTitle === 'string'
          ? existingGroupData.chosenHouseTitle.slice(0, 120)
          : matchedInState?.chosenHouseTitle || '';

      const fullGroupDoc: Record<string, any> = {
        tripId: targetDocId,
        name: cleanName,
        startDate: cleanStart,
        endDate: cleanEnd,
        periodLabel: cleanPeriod,
        regionLabel: cleanRegion,
        chosenHouseId: safeChosenHouseId,
        chosenHouseTitle: safeChosenHouseTitle,
        createdBy: safeCreatedBy,
        createdAt:
          existingGroupData?.createdAt && typeof existingGroupData.createdAt.toDate === 'function'
            ? existingGroupData.createdAt
            : serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (
        typeof existingGroupData?.reviewReminderSentAt === 'string' &&
        existingGroupData.reviewReminderSentAt.length <= 40
      ) {
        fullGroupDoc.reviewReminderSentAt = existingGroupData.reviewReminderSentAt;
      }

      await setDoc(groupRef, fullGroupDoc);

      const nowIso = new Date().toISOString();
      setCloudGroups((prev) => {
        const exists = prev.some((g) => g.id === targetDocId || g.tripId === groupId);
        if (exists) {
          return prev.map((g) =>
            g.id === targetDocId || g.tripId === groupId
              ? {
                  ...g,
                  name: cleanName,
                  startDate: cleanStart,
                  endDate: cleanEnd,
                  periodLabel: cleanPeriod,
                  regionLabel: cleanRegion,
                  chosenHouseId: safeChosenHouseId,
                  chosenHouseTitle: safeChosenHouseTitle,
                  updatedAt: nowIso,
                }
              : g
          );
        }
        return [
          ...prev,
          {
            id: targetDocId,
            tripId: targetDocId,
            name: cleanName,
            startDate: cleanStart,
            endDate: cleanEnd,
            periodLabel: cleanPeriod,
            regionLabel: cleanRegion,
            reviewReminderSentAt: '',
            chosenHouseId: safeChosenHouseId,
            chosenHouseTitle: safeChosenHouseTitle,
            createdBy: safeCreatedBy,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        ];
      });

      showToast(`Groepsnaam & gegevens bijgewerkt naar "${cleanName}"!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `groups/${targetDocId}`);
    }
  };

  // Super Admin or Group Admin: Update user account (name, email, role, groups, payment status & amount)
  const handleUpdateUserAccount = async (
    targetUser: UserAccountRecord,
    updates: {
      displayName: string;
      email: string;
      role: UserRole;
      primaryGroupId: string;
      groupIds: string[];
      hasPaid: boolean;
      amountPaid: number;
    }
  ) => {
    if (!currentUser) return;
    const normalizedGroupIds = Array.from(
      new Set([
        updates.primaryGroupId,
        ...(Array.isArray(updates.groupIds) && updates.groupIds.length > 0
          ? updates.groupIds
          : getUserGroupIds(targetUser)),
      ])
    ).slice(0, 20);

    const cleanName = updates.displayName.trim().slice(0, 60) || targetUser.displayName;
    const cleanEmail = updates.email.trim().toLowerCase().slice(0, 160) || targetUser.email;
    const cleanAmount = Math.max(0, Math.min(50000, Number(updates.amountPaid) || 0));

    const userRef = doc(db, 'user_accounts', targetUser.id);
    const existsInCloud = cloudUsers.some((u) => u.id === targetUser.id);

    try {
      if (existsInCloud) {
        await updateDoc(userRef, {
          displayName: cleanName,
          email: cleanEmail,
          role: updates.role,
          groupId: updates.primaryGroupId,
          groupIds: normalizedGroupIds,
          hasPaid: Boolean(updates.hasPaid),
          amountPaid: cleanAmount,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(userRef, {
          uid: targetUser.id,
          displayName: cleanName,
          email: cleanEmail,
          role: updates.role,
          groupId: updates.primaryGroupId,
          groupIds: normalizedGroupIds,
          hasPaid: Boolean(updates.hasPaid),
          amountPaid: cleanAmount,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      showToast(`Gegevens van ${cleanName} zijn opgeslagen!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `user_accounts/${targetUser.id}`);
    }
  };

  // Super Admin or Group Admin: Pre-register or add an existing member by email into one or more groups
  const handlePreRegisterMember = async (payload: {
    email: string;
    displayName: string;
    groupId: string;
    groupIds: string[];
    role: UserRole;
    hasPaid?: boolean;
    amountPaid?: number;
  }) => {
    if (!currentUser) return;
    const cleanEmail = payload.email.trim().toLowerCase();
    const cleanName = payload.displayName.trim().slice(0, 60);
    const cleanAmount = Math.max(0, Math.min(50000, Number(payload.amountPaid) || 0));

    // Check if a user with this email or displayName already exists in cloudUsers — if so, merge their groupIds!
    const existingUser = cloudUsers.find(
      (u) =>
        u.email.trim().toLowerCase() === cleanEmail ||
        (u.email.endsWith('@kopgroep27.nl') &&
          u.displayName.trim().toLowerCase() === cleanName.toLowerCase())
    );

    if (existingUser) {
      const mergedGroups = Array.from(
        new Set([...getUserGroupIds(existingUser), ...payload.groupIds, payload.groupId])
      ).slice(0, 20);

      try {
        await updateDoc(doc(db, 'user_accounts', existingUser.id), {
          email: cleanEmail.slice(0, 160),
          groupIds: mergedGroups,
          displayName: cleanName || existingUser.displayName,
          role:
            existingUser.role === 'super_admin'
              ? 'super_admin'
              : payload.role || existingUser.role,
          hasPaid:
            payload.hasPaid !== undefined
              ? Boolean(payload.hasPaid)
              : Boolean(existingUser.hasPaid),
          amountPaid:
            payload.amountPaid !== undefined
              ? cleanAmount
              : existingUser.amountPaid || 0,
          updatedAt: serverTimestamp(),
        });
        showToast(
          `${cleanName || existingUser.displayName} (${cleanEmail}) is bijgewerkt en gekoppeld aan ${mergedGroups.length} groep(en)!`
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `user_accounts/${existingUser.id}`);
      }
      return;
    }

    const inviteId = sanitizeId(
      `invite-${payload.groupId}-${cleanEmail.replace(/[^a-zA-Z0-9]/g, '-')}`
    ).slice(0, 120);
    const normalizedGroupIds = Array.from(
      new Set([payload.groupId, ...payload.groupIds])
    ).slice(0, 20);

    try {
      await setDoc(doc(db, 'user_accounts', inviteId), {
        uid: inviteId,
        email: cleanEmail.slice(0, 160),
        displayName: cleanName,
        groupId: payload.groupId,
        groupIds: normalizedGroupIds,
        role: payload.role,
        hasPaid: Boolean(payload.hasPaid),
        amountPaid: cleanAmount,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      showToast(
        `${cleanName} (${cleanEmail}) toegevoegd aan ${activeGroupRecord.name}!`
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `user_accounts/${inviteId}`);
    }
  };

  // Remove a user from a specific group (if they belong to multiple groups) or delete their user_account record
  const handleRemoveUserFromGroupOrDelete = async (
    targetUser: UserAccountRecord,
    groupIdToRemoveFrom: string
  ) => {
    if (!currentUser) return;
    const currentGroups = getUserGroupIds(targetUser);

    if (currentGroups.length > 1 && currentGroups.includes(groupIdToRemoveFrom)) {
      const remainingGroups = currentGroups.filter((gid) => gid !== groupIdToRemoveFrom);
      const nextPrimary =
        targetUser.groupId === groupIdToRemoveFrom
          ? remainingGroups[0]
          : targetUser.groupId;

      try {
        await updateDoc(doc(db, 'user_accounts', targetUser.id), {
          groupId: nextPrimary,
          groupIds: remainingGroups,
          updatedAt: serverTimestamp(),
        });
        showToast(
          `${targetUser.displayName} is verwijderd uit ${activeGroupRecord.name} (blijft lid van ${remainingGroups.length} andere groep(en)).`
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `user_accounts/${targetUser.id}`);
      }
      return;
    }

    const existsInCloud = cloudUsers.some((u) => u.id === targetUser.id);
    try {
      if (existsInCloud) {
        await deleteDoc(doc(db, 'user_accounts', targetUser.id));
      }
      showToast(`${targetUser.displayName} verwijderd uit ${activeGroupRecord.name}.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `user_accounts/${targetUser.id}`);
    }
  };

  // Sync existing participants (from Deelnemers & Auto's) and voters/house owners into /user_accounts for the active group
  const handleSyncGroupParticipantsToUsers = async (silent = false) => {
    if (!currentUser || !isAdminUser) return;

    const existingInGroup = cloudUsers.filter((u) =>
      userBelongsToGroup(u, activeTripId)
    );
    const knownNames = new Set(
      existingInGroup.map((u) => u.displayName.trim().toLowerCase())
    );
    const knownUids = new Set(existingInGroup.map((u) => u.uid));
    const knownDocIds = new Set(cloudUsers.map((u) => u.id));

    const candidates: { name: string; uidHint?: string }[] = [];

    activeParticipants.forEach((p) => {
      const clean = p.name.trim();
      if (clean && !knownNames.has(clean.toLowerCase())) {
        knownNames.add(clean.toLowerCase());
        candidates.push({ name: clean });
      }
    });

    activeHouses.forEach((h) => {
      const addedByClean = (h.addedBy || '').trim();
      if (
        addedByClean &&
        addedByClean.toLowerCase() !== 'groepslid' &&
        !knownNames.has(addedByClean.toLowerCase()) &&
        (!h.ownerId || !knownUids.has(h.ownerId))
      ) {
        knownNames.add(addedByClean.toLowerCase());
        candidates.push({ name: addedByClean, uidHint: h.ownerId });
      }
      (h.votes || []).forEach((v) => {
        const voterClean = (v.voterName || '').trim();
        if (
          voterClean &&
          voterClean.toLowerCase() !== 'groepslid' &&
          !knownNames.has(voterClean.toLowerCase()) &&
          (!v.userId || !knownUids.has(v.userId))
        ) {
          knownNames.add(voterClean.toLowerCase());
          candidates.push({ name: voterClean, uidHint: v.userId });
        }
      });
    });

    if (candidates.length === 0) return;

    let addedCount = 0;
    for (const c of candidates) {
      const slug = c.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
      const docId = sanitizeId(`lid-${activeTripId}-${slug || Date.now()}`).slice(
        0,
        120
      );
      if (knownDocIds.has(docId)) continue;
      const placeholderEmail = `${slug || 'deelnemer'}@kopgroep27.nl`;

      try {
        const ref = doc(db, 'user_accounts', docId);
        await setDoc(ref, {
          uid: docId,
          email: placeholderEmail,
          displayName: c.name.slice(0, 60),
          groupId: activeTripId,
          groupIds: [activeTripId],
          role: 'member',
          hasPaid: false,
          amountPaid: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        knownDocIds.add(docId);
        addedCount++;
      } catch (err) {
        console.error('Error syncing participant to user_accounts:', err);
      }
    }

    if (addedCount > 0 && !silent) {
      showToast(
        `${addedCount} bestaande deelnemer(s) gekoppeld aan de gebruikerslijst van ${activeGroupRecord.name}!`
      );
    }
  };

  // Automatically sync existing participants/voters of the group into user_accounts when an admin opens the group
  useEffect(() => {
    if (
      !isAdminUser ||
      !currentUser ||
      cloudParticipants === null ||
      cloudHouses === null
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      handleSyncGroupParticipantsToUsers(true);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [
    isAdminUser,
    currentUser,
    activeTripId,
    cloudParticipants?.length,
    cloudHouses?.length,
    cloudUsers.length,
  ]);

  // Ensure visibleUsers passed to UserGroupAdminView always includes currentUserAccount + any activeParticipants not yet written, while deduplicating placeholder rows against real logged-in accounts
  const mergedUsersForAdminView: UserAccountRecord[] = useMemo(() => {
    const mapById = new Map<string, UserAccountRecord>();
    cloudUsers.forEach((u) => mapById.set(u.id, u));

    if (currentUserAccount && !mapById.has(currentUserAccount.id)) {
      mapById.set(currentUserAccount.id, currentUserAccount);
    }

    // Deduplicate: if a real logged-in user (non-@kopgroep27.nl) has the same displayName or uid in the same group as a placeholder `lid-...` record, hide the placeholder record
    const allEntries = Array.from(mapById.values());
    const realUsers = allEntries.filter(
      (u) => !u.email.endsWith('@kopgroep27.nl') && !u.id.startsWith('lid-')
    );

    allEntries.forEach((u) => {
      if (u.email.endsWith('@kopgroep27.nl') || u.id.startsWith('lid-')) {
        const hasRealMatch = realUsers.some(
          (r) =>
            r.uid === u.uid ||
            r.displayName.trim().toLowerCase() === u.displayName.trim().toLowerCase()
        );
        if (hasRealMatch) {
          mapById.delete(u.id);
        }
      }
    });

    const existingNamesInActiveGroup = new Set(
      Array.from(mapById.values())
        .filter((u) => userBelongsToGroup(u, activeTripId))
        .map((u) => u.displayName.trim().toLowerCase())
    );

    activeParticipants.forEach((p) => {
      const cleanName = p.name.trim();
      if (cleanName && !existingNamesInActiveGroup.has(cleanName.toLowerCase())) {
        existingNamesInActiveGroup.add(cleanName.toLowerCase());
        const slug = cleanName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40);
        const docId = sanitizeId(`lid-${activeTripId}-${slug || p.id}`).slice(
          0,
          120
        );
        if (!mapById.has(docId)) {
          mapById.set(docId, {
            id: docId,
            uid: docId,
            email: `${slug || 'deelnemer'}@kopgroep27.nl`,
            displayName: cleanName,
            groupId: activeTripId,
            groupIds: [activeTripId],
            role: 'member',
            hasPaid: false,
            amountPaid: 0,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          });
        }
      }
    });

    return Array.from(mapById.values());
  }, [cloudUsers, currentUserAccount, activeParticipants, activeTripId]);

  // Send 1-week post-trip review reminder email via Gmail API and record reviewReminderSentAt on the group document
  const handleConfirmSendReviewReminderEmail = async (payload: {
    groupId: string;
    toEmails: string[];
    subject: string;
    bodyText: string;
  }) => {
    if (!currentUser) return;

    await sendGroupReviewReminderEmailViaGmail({
      toEmails: payload.toEmails,
      subject: payload.subject,
      bodyText: payload.bodyText,
    });

    const sentIso = new Date().toISOString();
    const groupRef = doc(db, 'groups', payload.groupId);
    const groupExists = cloudGroups.some((g) => g.id === payload.groupId || g.tripId === payload.groupId);
    try {
      if (groupExists) {
        await updateDoc(groupRef, {
          reviewReminderSentAt: sentIso,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      console.error('Kon reviewReminderSentAt niet opslaan op groepsdocument:', error);
    }

    showToast(
      `Review-oproep succesvol per e-mail verzonden naar ${payload.toEmails.length} groepsleden!`
    );
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
        {/* Zone 1: Single text element wordmark + Active Group Badge */}
        <div className="flex items-center gap-2.5 shrink-0">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveView('vergelijken');
              setMobilePane('lijst');
            }}
            className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 font-display uppercase whitespace-nowrap shrink-0"
          >
            {activeGroupRecord.name}
          </a>
          {userAccessibleGroups.length > 1 && (
            <select
              value={activeTripId}
              onChange={(e) => {
                setIsTestEnvironment(false);
                setSelectedGroupId(e.target.value);
              }}
              aria-label="Wissel actieve gebruikersgroep"
              className="hidden sm:inline-block text-xs font-bold bg-orange-50 text-orange-900 border border-orange-300 rounded-lg px-2 py-1 cursor-pointer"
            >
              {userAccessibleGroups.map((g) => (
                <option key={g.tripId} value={g.tripId}>
                  Groep: {g.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Zone 2: Navigation links including Centrale Repository & Groepen/Gebruikers */}
        <nav className="hidden md:flex items-center gap-5 text-sm font-medium text-slate-600">
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
            onClick={() => setActiveView('repository')}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-1.5 ${
              activeView === 'repository'
                ? 'text-slate-900 underline decoration-[#FC4C02] decoration-2 underline-offset-8 font-semibold'
                : ''
            }`}
          >
            <Trophy className="w-3.5 h-3.5 text-amber-500" />
            Centrale Repository ({combinedRepositoryHouses.length})
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
          {canAccessAdminView && (
            <button
              type="button"
              onClick={() => setActiveView('administratie')}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-1.5 ${
                activeView === 'administratie'
                  ? 'text-slate-900 underline decoration-[#FC4C02] decoration-2 underline-offset-8 font-semibold'
                  : ''
              }`}
            >
              <ShieldCheck className="w-4 h-4 text-[#FC4C02]" />
              {isSuperAdmin ? 'Groepen & Users' : 'Groepsleden'}
            </button>
          )}
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
              <span className="font-semibold text-[#FC4C02] uppercase">
                GROEP: {activeGroupRecord.name}
              </span>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1.5 text-white font-medium">
                <Calendar className="w-3.5 h-3.5 text-[#FC4C02] shrink-0" />
                <span>{activeGroupRecord.periodLabel}</span>
              </span>
              <span aria-hidden="true">·</span>
              <span>{activeGroupRecord.regionLabel}</span>
              {activeGroupRecord.chosenHouseTitle && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-400/40 text-amber-300 font-bold">
                    <Trophy className="w-3 h-3 text-amber-400" />
                    Gekozen huisje: {activeGroupRecord.chosenHouseTitle}
                  </span>
                </>
              )}
            </div>
            <h1 className="text-xl sm:text-3xl font-bold tracking-tight font-display uppercase text-white">
              {activeGroupRecord.name} — Accommodatie & Route Planner
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-3xl">
              Samen vakantiehuizen aandragen, vergelijken op de kaart, auto- en fietsindeling afstemmen en het gekozen huisje delen in de Centrale Repository.
            </p>
          </div>

          {/* Collaborator Identity & Quick Action Controls */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {userAccessibleGroups.length > 1 && (
              <div className="flex items-center gap-1.5 bg-orange-500/20 border border-orange-400/40 rounded-lg px-2.5 py-1.5 min-h-[38px]">
                <Building2 className="w-3.5 h-3.5 text-orange-300 shrink-0" />
                <select
                  value={activeTripId}
                  onChange={(e) => {
                    setIsTestEnvironment(false);
                    setSelectedGroupId(e.target.value);
                  }}
                  aria-label="Kies jouw actieve groep"
                  className="bg-transparent text-xs font-extrabold text-white focus:outline-hidden cursor-pointer"
                >
                  {userAccessibleGroups.map((g) => (
                    <option key={g.tripId} value={g.tripId} className="text-slate-900">
                      Groep: {g.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

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
              onClick={() => setActiveView('repository')}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-400/30 text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trophy className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Repository ({combinedRepositoryHouses.length})</span>
            </button>

            {canAccessAdminView && (
              <button
                type="button"
                onClick={() => setActiveView('administratie')}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-[#FC4C02] shrink-0" />
                <span>{isSuperAdmin ? 'Groepen & Users' : 'Groepsbeheer'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleLogoutOrExitGuest}
              title={
                currentUser
                  ? `Geverifieerd ingelogd als ${currentUser.email} (${
                      isSuperAdmin ? 'Super User' : isGroupAdmin ? 'Groepsbeheerder' : 'Groepslid'
                    }) — klik om uit te loggen`
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

      {/* 1-Week Post-Trip Automatic Review Reminder Call Banner */}
      {isVerifiedMember &&
        activeGroupRecord.chosenHouseTitle &&
        isReviewReminderDueNow(activeGroupRecord.startDate, activeGroupRecord.endDate) &&
        !activeGroupRecord.reviewReminderSentAt && (
          <div className="bg-gradient-to-r from-amber-500 via-orange-600 to-amber-600 text-white border-b border-orange-700 px-3 sm:px-6 py-3 shadow-sm">
            <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5">
                <BellRing className="w-4 h-4 text-white shrink-0 animate-bounce" />
                <span>
                  <strong>1 week na jullie vakantie ({activeGroupRecord.periodLabel})!</strong> Tijd om heel{' '}
                  <strong>{activeGroupRecord.name}</strong> per mail op te roepen een review & sterrenbeoordeling te schrijven voor{' '}
                  <strong>“{activeGroupRecord.chosenHouseTitle}”</strong>.
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setReminderTargetGroup(activeGroupRecord)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-950 hover:bg-slate-900 text-white font-extrabold transition cursor-pointer"
                >
                  <Mail className="w-3.5 h-3.5 text-orange-400" />
                  <span>Stuur review-oproep per mail naar de groep</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const chosen = activeHouses.find(
                      (h) => h.id === activeGroupRecord.chosenHouseId
                    );
                    if (chosen) {
                      setReviewingHouse(chosen);
                    } else {
                      setActiveView('repository');
                    }
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white font-bold transition cursor-pointer"
                >
                  <Star className="w-3.5 h-3.5" />
                  <span>Direct review schrijven</span>
                </button>
              </div>
            </div>
          </div>
        )}

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
        {/* Row 1: Primary sections */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 p-1 bg-slate-100 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveView('vergelijken')}
            className={`min-h-[38px] px-1.5 py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors truncate cursor-pointer ${
              activeView === 'vergelijken' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Huisjes ({activeHouses.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveView('repository')}
            className={`min-h-[38px] px-1.5 py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors truncate cursor-pointer ${
              activeView === 'repository' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Repository ({combinedRepositoryHouses.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveView('deelnemers')}
            className={`min-h-[38px] px-1.5 py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors truncate cursor-pointer ${
              activeView === 'deelnemers' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Auto’s ({activeParticipants.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveView('ideeen')}
            className={`min-h-[38px] px-1.5 py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors truncate cursor-pointer ${
              activeView === 'ideeen' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Ideeën ({activeIdeas.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveView('beheren')}
            className={`min-h-[38px] px-1.5 py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors truncate cursor-pointer ${
              activeView === 'beheren' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Beheren
          </button>
          {canAccessAdminView && (
            <button
              type="button"
              onClick={() => setActiveView('administratie')}
              className={`min-h-[38px] px-1.5 py-1.5 text-[11px] sm:text-xs font-semibold rounded-lg transition-colors truncate cursor-pointer ${
                activeView === 'administratie' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              {isSuperAdmin ? 'Groepen' : 'Leden'}
            </button>
          )}
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
              <div className="pt-3 border-t border-slate-100 space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
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
                      <option value="prijs_oplopend">Prijs (laag naar hoog — vaste volgorde)</option>
                      <option value="populariteit">Hoogste gemiddelde (sterren)</option>
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

                {/* Optional Short List / Long List Filter Strip (shown whenever the group uses the Short List) */}
                {shortlistedHousesCount > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
                    <span className="text-[11px] font-bold text-indigo-900 flex items-center gap-1.5 uppercase tracking-wider">
                      <ListChecks className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Selectieproces (Short List / Long List):</span>
                    </span>
                    <div className="flex items-center gap-1 p-1 bg-indigo-50/80 border border-indigo-200/70 rounded-lg overflow-x-auto max-w-full">
                      <button
                        type="button"
                        onClick={() => setShortlistViewFilter('alle')}
                        className={`min-h-[30px] px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          shortlistViewFilter === 'alle'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-indigo-900 hover:bg-indigo-100'
                        }`}
                      >
                        Short List + Long List ({activeHouses.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setShortlistViewFilter('shortlist')}
                        className={`min-h-[30px] px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          shortlistViewFilter === 'shortlist'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-indigo-900 hover:bg-indigo-100'
                        }`}
                      >
                        ★ Alleen Short List ({shortlistedHousesCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setShortlistViewFilter('longlist')}
                        className={`min-h-[30px] px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          shortlistViewFilter === 'longlist'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-indigo-900 hover:bg-indigo-100'
                        }`}
                      >
                        Alleen Long List ({Math.max(0, activeHouses.length - shortlistedHousesCount)})
                      </button>
                    </div>
                  </div>
                )}

                {/* Personal Assessment Filter: Huisjes die ik nog niet beoordeeld heb */}
                {currentUser && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      Mijn beoordelingen:
                    </span>
                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto max-w-full">
                      <button
                        type="button"
                        onClick={() => setVoteFilter('alle')}
                        className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          voteFilter === 'alle'
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Alle ({activeHouses.length})
                      </button>
                      <button
                        type="button"
                        data-testid="filter-unrated-btn"
                        onClick={() => setVoteFilter('nog_niet_beoordeeld')}
                        className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          voteFilter === 'nog_niet_beoordeeld'
                            ? 'bg-[#FC4C02] text-white shadow-xs font-semibold'
                            : 'text-slate-700 hover:text-slate-900'
                        }`}
                      >
                        Nog niet door mij beoordeeld ({unratedHousesCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setVoteFilter('wel_beoordeeld')}
                        className={`min-h-[32px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          voteFilter === 'wel_beoordeeld'
                            ? 'bg-white text-slate-900 shadow-xs font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Al beoordeeld ({Math.max(0, activeHouses.length - unratedHousesCount)})
                      </button>
                    </div>
                  </div>
                )}
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
                  {voteFilter === 'nog_niet_beoordeeld' && activeHouses.length > 0
                    ? 'Je hebt alle huisjes al beoordeeld!'
                    : 'Nog geen vakantiehuizen in deze weergave'}
                </h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  {activeHouses.length === 0
                    ? 'De centrale groepslijst is momenteel leeg (voorbeeldhuisjes worden nooit automatisch teruggezet). Voeg het eerste echte voorstel toe!'
                    : voteFilter === 'nog_niet_beoordeeld'
                    ? 'Goed bezig! Je hebt op elk huisje in deze selectie al een stem uitgebracht.'
                    : 'Geen huisjes gevonden met de huidige zoekopdracht of filter.'}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                  {(facilityFilter !== 'alle' ||
                    voteFilter !== 'alle' ||
                    shortlistViewFilter !== 'alle' ||
                    searchQuery.trim()) && (
                    <button
                      type="button"
                      onClick={() => {
                        setFacilityFilter('alle');
                        setVoteFilter('alle');
                        setShortlistViewFilter('alle');
                        setSearchQuery('');
                      }}
                      className="min-h-[40px] px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Toon alle huisjes
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
                    const ratingSummary = getHouseRatingSummary(house);
                    const isChosen = Boolean(
                      activeGroupRecord.chosenHouseId &&
                        house.id === activeGroupRecord.chosenHouseId
                    );
                    const isShortlisted = Boolean(house.isShortlisted);
                    const isFavorite = house.id === favoriteHouseId && ratingSummary.average > 0;
                    const isOwnerOrAdmin = canModifyRecord(house.ownerId);
                    return (
                      <div
                        key={house.id}
                        className={`p-4 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                          isChosen
                            ? 'bg-amber-50/90 hover:bg-amber-100/70'
                            : isShortlisted
                            ? 'bg-indigo-50/40 hover:bg-indigo-50/80'
                            : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {isChosen ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-gradient-to-r from-amber-500 to-orange-600 text-white text-[11px] font-extrabold shrink-0">
                                <Trophy className="w-3 h-3" />
                                GEKOZEN HUISJE
                              </span>
                            ) : activeGroupRecord.chosenHouseId ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-200 text-slate-700 text-[10px] font-bold shrink-0">
                                Backup
                              </span>
                            ) : null}
                            {isShortlisted ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-600 text-white text-[10px] font-extrabold shrink-0">
                                <ListChecks className="w-3 h-3" />
                                SHORT LIST
                              </span>
                            ) : shortlistedHousesCount > 0 && !isChosen ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-500 text-[10px] font-semibold shrink-0">
                                Long List
                              </span>
                            ) : null}
                            {isFavorite && !isChosen && (
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
                              {ratingSummary.formattedLabel}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <div className="text-right font-mono-num mr-2">
                            <div className="text-sm font-bold text-[#FC4C02]">€{pricePerPerson} p.p.</div>
                            <div className="text-[11px] text-slate-500">€{house.totalPrice} tot.</div>
                          </div>

                          {isVerifiedMember && !isChosen && (
                            <button
                              type="button"
                              onClick={() => handleToggleShortlist(house)}
                              className={`min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                                isShortlisted
                                  ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                                  : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200'
                              }`}
                            >
                              <ListChecks className="w-3.5 h-3.5" />
                              {isShortlisted ? 'Op Short List ✓' : '+ Short List'}
                            </button>
                          )}

                          {isVerifiedMember && !isChosen && (
                            <button
                              type="button"
                              onClick={() => setReviewingHouse(house)}
                              className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold cursor-pointer"
                            >
                              <Trophy className="w-3.5 h-3.5 text-amber-600" />
                              Kies dit huisje
                            </button>
                          )}

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
              /* DETAILED HOUSE CARDS (with Chosen House pinned on top, optional Short List / Long List split, and collapsible Backup / Long List Houses) */
              <div className="space-y-4">
                {displayedHouses.map((house, index) => {
                  const hasChosenHouseInList = Boolean(
                    activeGroupRecord.chosenHouseId &&
                      displayedHouses.some((h) => h.id === activeGroupRecord.chosenHouseId)
                  );
                  const isChosenHouse =
                    Boolean(activeGroupRecord.chosenHouseId) &&
                    house.id === activeGroupRecord.chosenHouseId;
                  const isBackupHouse = hasChosenHouseInList && !isChosenHouse;
                  const isFirstBackupHouse =
                    isBackupHouse &&
                    (index === 1 ||
                      (index > 0 &&
                        displayedHouses[index - 1].id === activeGroupRecord.chosenHouseId));
                  const isBackupExpanded = Boolean(expandedBackupHouses[house.id]);
                  const backupHousesCount = hasChosenHouseInList
                    ? displayedHouses.filter((h) => h.id !== activeGroupRecord.chosenHouseId).length
                    : 0;
                  const allBackupsExpanded =
                    backupHousesCount > 0 &&
                    displayedHouses
                      .filter((h) => h.id !== activeGroupRecord.chosenHouseId)
                      .every((h) => expandedBackupHouses[h.id]);

                  // Optional Short List / Long List logic (active when at least 1 house in the group is marked as Short List and no final house is chosen yet)
                  const isShortlisted = Boolean(house.isShortlisted);
                  const groupUsesShortlist = !hasChosenHouseInList && shortlistedHousesCount > 0;
                  const isShortlistSectionStart =
                    groupUsesShortlist &&
                    isShortlisted &&
                    (index === 0 || !displayedHouses[index - 1].isShortlisted);
                  const isLongListHouse = groupUsesShortlist && !isShortlisted;
                  const isFirstLongListHouse =
                    isLongListHouse &&
                    (index === 0 || Boolean(displayedHouses[index - 1].isShortlisted));
                  const isLongListExpanded = Boolean(expandedLongListHouses[house.id]);
                  const longListHousesInView = groupUsesShortlist
                    ? displayedHouses.filter((h) => !h.isShortlisted)
                    : [];
                  const longListHousesCount = longListHousesInView.length;
                  const allLongListExpanded =
                    longListHousesCount > 0 &&
                    longListHousesInView.every((h) => expandedLongListHouses[h.id]);

                  const ratingSummary = getHouseRatingSummary(house);
                  const isFavorite = house.id === favoriteHouseId && ratingSummary.average > 0;
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
                    <React.Fragment key={house.id}>
                      {/* Section Header above the Short List when the group uses Short List / Long List */}
                      {isShortlistSectionStart && (
                        <div className="bg-indigo-950 text-white border border-indigo-800 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-xs">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2 text-xs sm:text-sm font-extrabold uppercase tracking-wide text-indigo-200">
                              <ListChecks className="w-4 h-4 text-indigo-400 shrink-0" />
                              <span>
                                Short List van {activeGroupRecord.name} ({shortlistedHousesCount})
                              </span>
                            </div>
                            <p className="text-xs text-indigo-200/90">
                              Jullie favoriete kanshebbers met direct alle detailinformatie, prijzen en stemmen zichtbaar.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Section Divider right above the first Long List House when the group uses a Short List */}
                      {isFirstLongListHouse && (
                        <div className="pt-3 pb-1">
                          <div className="bg-slate-200/80 border border-slate-300 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2 text-xs font-extrabold text-slate-800 uppercase tracking-wide">
                                <span>Long List — Overige huisjes ({longListHousesCount})</span>
                              </div>
                              <p className="text-xs text-slate-600">
                                Compact ingeklapt voor overzicht. Klik op een huisje om de details open te klappen of zet het met één klik op de Short List.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const nextState: Record<string, boolean> = {};
                                longListHousesInView.forEach((h) => {
                                  nextState[h.id] = !allLongListExpanded;
                                });
                                setExpandedLongListHouses(nextState);
                              }}
                              className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-300 text-xs font-bold text-slate-700 cursor-pointer shrink-0"
                            >
                              {allLongListExpanded ? (
                                <>
                                  <ChevronUp className="w-3.5 h-3.5" />
                                  <span>Long List inklappen</span>
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="w-3.5 h-3.5" />
                                  <span>Long List uitklappen</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Section Divider right above the first Backup House when a house has been chosen */}
                      {isFirstBackupHouse && (
                        <div className="pt-3 pb-1">
                          <div className="bg-slate-200/80 border border-slate-300 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2 text-xs font-extrabold text-slate-800 uppercase tracking-wide">
                                <span>Overige huisjes als backup ({backupHousesCount})</span>
                              </div>
                              <p className="text-xs text-slate-600">
                                Ingeklapt bewaard als reserve. Klik op een huisje om alle details te bekijken of alsnog een ander huisje als gekozen huisje in te stellen.
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const nextState: Record<string, boolean> = {};
                                displayedHouses.forEach((h) => {
                                  if (h.id !== activeGroupRecord.chosenHouseId) {
                                    nextState[h.id] = !allBackupsExpanded;
                                  }
                                });
                                setExpandedBackupHouses(nextState);
                              }}
                              className="min-h-[34px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-300 text-xs font-bold text-slate-700 cursor-pointer shrink-0"
                            >
                              {allBackupsExpanded ? (
                                <>
                                  <ChevronUp className="w-3.5 h-3.5" />
                                  <span>Alle backups inklappen</span>
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="w-3.5 h-3.5" />
                                  <span>Alle backups uitklappen</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {/* COLLAPSED LONG LIST HOUSE ROW (minimal info visible, click to expand details or promote to Short List) */}
                      {isLongListHouse && !isLongListExpanded ? (
                        <article
                          data-testid={`house-card-longlist-collapsed-${house.id}`}
                          className={`bg-white rounded-xl border transition-all overflow-hidden ${
                            isSelected
                              ? 'border-[#FC4C02] ring-2 ring-[#FC4C02]/20'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="p-3 sm:px-4 sm:py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                            {/* Left Minimal Info Area (Click to open details) */}
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedLongListHouses((prev) => ({
                                  ...prev,
                                  [house.id]: true,
                                }))
                              }
                              className="flex-1 min-w-0 text-left flex items-center gap-2.5 cursor-pointer group"
                            >
                              <div className="w-7 h-7 rounded-lg bg-slate-100 group-hover:bg-indigo-50 border border-slate-200 flex items-center justify-center shrink-0">
                                <ChevronDown className="w-4 h-4 text-slate-500 group-hover:text-indigo-600" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-500 text-[10px] font-semibold uppercase shrink-0">
                                    Long List
                                  </span>
                                  <h3 className="text-sm font-bold text-slate-800 group-hover:text-indigo-700 transition-colors truncate">
                                    {house.title}
                                  </h3>
                                  <span className="text-xs text-slate-400 truncate hidden md:inline">
                                    · {house.locationName}
                                  </span>
                                </div>
                              </div>
                            </button>

                            {/* Right Minimal Price + Promote to Short List + Expand Button */}
                            <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 shrink-0">
                              <span className="text-xs font-mono-num font-bold text-slate-700 mr-1">
                                €{pricePerPerson} p.p.
                              </span>

                              {isVerifiedMember && (
                                <button
                                  type="button"
                                  onClick={() => handleToggleShortlist(house)}
                                  title="Zet dit huisje op de Short List zodat alle details direct zichtbaar zijn"
                                  className="min-h-[32px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-xs font-bold cursor-pointer"
                                >
                                  <ListChecks className="w-3.5 h-3.5 text-indigo-600" />
                                  <span>+ Zet op Short List</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedLongListHouses((prev) => ({
                                    ...prev,
                                    [house.id]: true,
                                  }))
                                }
                                className="min-h-[32px] inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold cursor-pointer"
                              >
                                <span>Openklappen</span>
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </article>
                      ) : isBackupHouse && !isBackupExpanded ? (
                        <article
                          data-testid={`house-card-collapsed-${house.id}`}
                          className={`bg-white rounded-xl border transition-all overflow-hidden ${
                            isSelected
                              ? 'border-[#FC4C02] ring-2 ring-[#FC4C02]/20'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="p-3.5 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            {/* Left Clickable Info Area to Expand */}
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedBackupHouses((prev) => ({
                                  ...prev,
                                  [house.id]: true,
                                }))
                              }
                              className="flex-1 min-w-0 text-left flex items-start sm:items-center gap-3 cursor-pointer group"
                            >
                              <div className="w-8 h-8 rounded-lg bg-slate-100 group-hover:bg-orange-50 border border-slate-200 flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
                                <ChevronDown className="w-4 h-4 text-slate-600 group-hover:text-[#FC4C02]" />
                              </div>
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600 text-[10px] font-bold uppercase">
                                    Backup-optie
                                  </span>
                                  {isShortlisted && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-bold uppercase">
                                      Short List
                                    </span>
                                  )}
                                  {isFavorite && (
                                    <span className="text-amber-600 text-[11px] font-bold">
                                      ★ Hoogst beoordeeld ({ratingSummary.formattedLabel})
                                    </span>
                                  )}
                                  <h3 className="text-sm sm:text-base font-bold text-slate-900 group-hover:text-[#FC4C02] transition-colors truncate">
                                    {house.title}
                                  </h3>
                                </div>
                                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">
                                  <span className="font-medium text-slate-700">{house.locationName}</span>
                                  <span>·</span>
                                  <span>
                                    {house.bedrooms} slpk / {house.bathrooms} badk
                                  </span>
                                  <span>·</span>
                                  <span className="font-mono-num font-semibold text-slate-700">
                                    {ratingSummary.formattedLabel}
                                  </span>
                                  <span>·</span>
                                  <span>Door {house.addedBy}</span>
                                  {commentsList.length > 0 && (
                                    <>
                                      <span>·</span>
                                      <span>{commentsList.length} reactie(s)</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </button>

                            {/* Right Price & Quick Actions (Expand details or Switch Chosen House) */}
                            <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
                              <div className="text-left sm:text-right font-mono-num mr-2">
                                <div className="text-sm font-bold text-[#FC4C02]">
                                  €{pricePerPerson} p.p.
                                </div>
                                <div className="text-[11px] text-slate-500">
                                  €{house.totalPrice} totaal
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleShowOnMap(house.id)}
                                className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold cursor-pointer"
                              >
                                <MapPin className="w-3.5 h-3.5 text-[#FC4C02]" />
                                <span className="hidden xl:inline">Op kaart</span>
                              </button>

                              {isVerifiedMember && (
                                <button
                                  type="button"
                                  onClick={() => setReviewingHouse(house)}
                                  title="Wijzig de groepskeuze en maak dit huisje alsnog het gekozen huisje"
                                  className="min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold cursor-pointer"
                                >
                                  <Trophy className="w-3.5 h-3.5 text-amber-600" />
                                  <span>Kies alsnog dit huisje</span>
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedBackupHouses((prev) => ({
                                    ...prev,
                                    [house.id]: true,
                                  }))
                                }
                                className="min-h-[34px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
                              >
                                <span>Details uitklappen</span>
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </article>
                      ) : (
                        <article
                          data-testid={`house-card-${house.id}`}
                          className={`group bg-white rounded-xl border transition-colors overflow-hidden ${
                            isChosenHouse
                              ? 'border-amber-500 ring-2 ring-amber-500/30 shadow-md'
                              : isSelected
                              ? 'border-[#FC4C02] ring-2 ring-[#FC4C02]/20'
                              : isShortlisted
                              ? 'border-indigo-500 ring-1 ring-indigo-500/20 shadow-xs'
                              : isFavorite
                              ? 'border-amber-400'
                              : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          {/* Top Chosen House OR Expanded Backup OR Short List OR Expanded Long List OR Groepsfavoriet banner */}
                          {isChosenHouse ? (
                            <div className="bg-gradient-to-r from-amber-500 via-orange-600 to-amber-600 text-white px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span className="font-extrabold flex items-center gap-2 text-xs sm:text-sm">
                                <Trophy className="w-4 h-4 text-white shrink-0" />
                                <span>
                                  HÉT GEKOZEN HUISJE VAN {activeGroupRecord.name.toUpperCase()} 🏆 — Altijd bovenaan & gedeeld in Centrale Repository
                                </span>
                              </span>
                              <span className="font-mono-num font-bold text-amber-100 shrink-0">
                                {ratingSummary.formattedLabel}
                              </span>
                            </div>
                          ) : isBackupHouse ? (
                            <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span className="font-bold text-slate-700 flex items-center gap-1.5">
                                <span>Backup-huisje (uitgeklapt) — Je kunt dit huisje nog steeds bekijken of alsnog kiezen</span>
                              </span>
                              <div className="flex items-center gap-2">
                                {isVerifiedMember && (
                                  <button
                                    type="button"
                                    onClick={() => setReviewingHouse(house)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-500 hover:bg-amber-600 text-white font-bold cursor-pointer"
                                  >
                                    <Trophy className="w-3 h-3" />
                                    <span>Maak dit alsnog het gekozen huisje</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedBackupHouses((prev) => ({
                                      ...prev,
                                      [house.id]: false,
                                    }))
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white hover:bg-slate-200 border border-slate-300 text-slate-700 font-semibold cursor-pointer"
                                >
                                  <span>Inklappen</span>
                                  <ChevronUp className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ) : isShortlisted ? (
                            <div className="bg-indigo-600 text-white px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span className="font-extrabold flex items-center gap-1.5">
                                <ListChecks className="w-4 h-4 text-indigo-200 shrink-0" />
                                <span>
                                  SHORT LIST KANSHEBBER ★
                                  {isFavorite ? ' · Tevens Groepsfavoriet 🏆' : ''}
                                </span>
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="font-mono-num font-bold text-indigo-100">
                                  {ratingSummary.formattedLabel}
                                </span>
                                {isVerifiedMember && (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleShortlist(house)}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-800/80 hover:bg-indigo-900 text-indigo-100 text-[11px] font-semibold cursor-pointer"
                                  >
                                    <span>Verplaats naar Long List</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : isLongListHouse ? (
                            <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                              <span className="font-bold text-slate-700 flex items-center gap-1.5">
                                <span>Long List-huisje (uitgeklapt)</span>
                              </span>
                              <div className="flex items-center gap-2">
                                {isVerifiedMember && (
                                  <button
                                    type="button"
                                    onClick={() => handleToggleShortlist(house)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer"
                                  >
                                    <ListChecks className="w-3 h-3" />
                                    <span>+ Zet op Short List</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedLongListHouses((prev) => ({
                                      ...prev,
                                      [house.id]: false,
                                    }))
                                  }
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white hover:bg-slate-200 border border-slate-300 text-slate-700 font-semibold cursor-pointer"
                                >
                                  <span>Inklappen</span>
                                  <ChevronUp className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ) : isFavorite ? (
                            <div className="bg-amber-500/10 border-b border-amber-300/60 px-4 py-2 flex items-center justify-between gap-2 text-xs">
                              <span className="font-bold text-amber-900 flex items-center gap-1.5">
                                <Trophy className="w-4 h-4 text-amber-600 shrink-0" />
                                <span>Groepsfavoriet 🏆 — Hoogste gemiddelde</span>
                              </span>
                              <span className="font-mono-num font-semibold text-amber-800 shrink-0">
                                {ratingSummary.formattedLabel}
                              </span>
                            </div>
                          ) : null}

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

                          {/* Action Buttons Row: Map Focus, Chosen House & Review, Route Link, External Site */}
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

                              {isVerifiedMember && !isChosenHouse && (
                                <button
                                  type="button"
                                  onClick={() => handleToggleShortlist(house)}
                                  title={
                                    isShortlisted
                                      ? 'Verwijder van de Short List (terug naar Long List)'
                                      : 'Zet dit huisje op de Short List van jullie groep'
                                  }
                                  className={`min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                    isShortlisted
                                      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                                      : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200'
                                  }`}
                                >
                                  <ListChecks className="w-3.5 h-3.5" />
                                  <span>
                                    {isShortlisted ? 'Op Short List ✓' : '+ Zet op Short List'}
                                  </span>
                                </button>
                              )}

                              {isVerifiedMember && (
                                <button
                                  type="button"
                                  onClick={() => setReviewingHouse(house)}
                                  className={`min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                                    activeGroupRecord.chosenHouseId === house.id
                                      ? 'bg-amber-500 text-white hover:bg-amber-600'
                                      : 'bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300'
                                  }`}
                                >
                                  <Trophy className="w-3.5 h-3.5" />
                                  {activeGroupRecord.chosenHouseId === house.id
                                    ? 'Gekozen huisje & Review bewerken'
                                    : activeGroupRecord.chosenHouseId
                                    ? 'Kies alsnog dit huisje & Review'
                                    : 'Dit huisje is het geworden & Review'}
                                </button>
                              )}

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
                          <span
                            data-testid={`house-rating-label-${house.id}`}
                            className="text-xs font-semibold text-slate-700 font-mono-num"
                          >
                            {ratingSummary.formattedLabel}
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
                      )}
                    </React.Fragment>
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
                      const ratingSummary = getHouseRatingSummary(house);
                      const isFav = house.id === favoriteHouseId && ratingSummary.average > 0;
                      const isOwnerOrAdmin = canModifyRecord(house.ownerId);
                      const extras: string[] = [];
                      if (house.hasBbq) extras.push('BBQ');
                      if (house.hasFireplace) extras.push('Open haard');
                      if (house.hasJacuzzi) extras.push('Jacuzzi');
                      if (house.hasSauna) extras.push('Sauna');

                      return (
                        <tr key={house.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-slate-900 text-sm flex flex-wrap items-center gap-1.5">
                              {isFav && <span className="text-amber-500">★</span>}
                              {house.isShortlisted && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-extrabold uppercase">
                                  Short List
                                </span>
                              )}
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
                            {ratingSummary.compactLabel}
                          </td>
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {isVerifiedMember && (
                                <button
                                  type="button"
                                  onClick={() => handleToggleShortlist(house)}
                                  className={`min-h-[34px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-bold cursor-pointer ${
                                    house.isShortlisted
                                      ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                                      : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200'
                                  }`}
                                >
                                  <ListChecks className="w-3.5 h-3.5" />
                                  {house.isShortlisted ? 'Short List ✓' : '+ Short List'}
                                </button>
                              )}
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

          {/* Main Grid: Add / Edit Participant Form + Participants Table */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left 4 cols: Add or Edit Participant Form */}
            <form
              onSubmit={handleAddParticipant}
              noValidate
              data-testid="add-participant-form"
              className={`lg:col-span-4 bg-white rounded-xl border p-4 sm:p-5 space-y-4 ${
                editingParticipantId ? 'border-[#FC4C02] ring-2 ring-[#FC4C02]/20' : 'border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Car className="w-4 h-4 text-[#FC4C02]" />
                  {editingParticipantId
                    ? 'Vervoersgegevens Wijzigen'
                    : 'Deelnemer Toevoegen aan Lijst'}
                </h3>
                {editingParticipantId && (
                  <button
                    type="button"
                    onClick={handleCancelEditParticipant}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    Annuleren
                  </button>
                )}
              </div>

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

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!isVerifiedMember}
                  data-testid="participant-submit-btn"
                  className="w-full min-h-[42px] py-2.5 rounded-lg bg-[#FC4C02] hover:bg-[#E04300] text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {!isVerifiedMember
                    ? 'Log in om deelnemer op te slaan'
                    : editingParticipantId
                    ? 'Wijzigingen Opslaan'
                    : '+ Deelnemer Toevoegen'}
                </button>
                {editingParticipantId && (
                  <button
                    type="button"
                    onClick={handleCancelEditParticipant}
                    className="min-h-[42px] px-3.5 py-2.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shrink-0"
                  >
                    Annuleren
                  </button>
                )}
              </div>
            </form>

            {/* Right 8 cols: Interactive Participants Table */}
            <div className="lg:col-span-8 bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800">
                  Deelnemerslijst ({activeParticipants.length} personen)
                </span>
                <span className="text-[11px] text-slate-500">
                  Klik direct op Chauffeur / + / − of op &ldquo;Wijzig&rdquo; om alle variabelen aan te passen
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
                        const isBeingEdited = editingParticipantId === p.id;
                        return (
                          <tr
                            key={p.id}
                            data-testid={`participant-row-${p.id}`}
                            className={`transition-colors ${
                              isBeingEdited ? 'bg-orange-50/70' : 'hover:bg-slate-50'
                            }`}
                          >
                            <td className="py-3.5 px-4 font-bold text-slate-900 text-sm whitespace-nowrap">
                              {p.name}
                            </td>

                            {/* Toggle Driver status directly for any verified member */}
                            <td className="py-3.5 px-4 whitespace-nowrap">
                              <button
                                type="button"
                                disabled={!isVerifiedMember}
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
                                    ? 'bg-slate-900 text-white hover:bg-slate-800'
                                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
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
                                    disabled={!isVerifiedMember}
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
                                    disabled={!isVerifiedMember}
                                    onClick={() =>
                                      handleUpdateParticipant(p, {
                                        carSeats: Math.min(15, p.carSeats + 1),
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
                                    disabled={!isVerifiedMember}
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
                                    disabled={!isVerifiedMember}
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

                            <td className="py-3.5 px-4 text-slate-600 max-w-[200px] truncate">
                              {p.notes || <span className="text-slate-400">–</span>}
                            </td>

                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                {isVerifiedMember && (
                                  <button
                                    type="button"
                                    data-testid={`edit-participant-${p.id}`}
                                    onClick={() => handleStartEditParticipant(p)}
                                    className="min-h-[32px] inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 font-semibold cursor-pointer"
                                  >
                                    <Pencil className="w-3.5 h-3.5" />
                                    Wijzig
                                  </button>
                                )}
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

      {/* VIEW 5: Centrale Repository van Alle Gevonden & Uitverkozen Huisjes */}
      {activeView === 'repository' && (
        <main className="flex-1 max-w-[1280px] w-full mx-auto px-3 sm:px-6 py-6">
          <RepositoryView
            repositoryHouses={combinedRepositoryHouses}
            allGroups={allGroupsWithDefault}
            activeGroupHouses={activeHouses}
            activeGroupId={activeTripId}
            activeGroupName={activeGroupRecord.name}
            cyclistCount={cyclistCount}
            canWrite={isVerifiedMember}
            onAddRepoHouseToGroup={handleAddRepoHouseToGroup}
            onRequireLogin={() =>
              showToast('Log eerst in met je Google-account of e-mailadres om een huisje aan jullie groepslijst toe te voegen.')
            }
          />
        </main>
      )}

      {/* VIEW 6: Hiërarchische Gebruikers- & Groepsadministratie */}
      {activeView === 'administratie' && (
        <main className="flex-1 max-w-[1280px] w-full mx-auto px-3 sm:px-6 py-6">
          {canAccessAdminView && currentUser ? (
            <UserGroupAdminView
              currentUserRole={
                isSuperAdmin
                  ? 'super_admin'
                  : currentUserAccount?.role || 'member'
              }
              currentUserEmail={currentUser.email || ''}
              currentUserUid={currentUser.uid}
              activeGroup={activeGroupRecord}
              allGroups={allGroupsWithDefault}
              visibleUsers={mergedUsersForAdminView}
              activeGroupParticipants={activeParticipants}
              activeGroupHouses={activeHouses}
              onSwitchActiveGroup={(groupId) => {
                if (
                  isSuperAdmin ||
                  userAccessibleGroups.some((g) => g.tripId === groupId)
                ) {
                  setIsTestEnvironment(false);
                  setSelectedGroupId(groupId);
                  showToast(`Groep "${groupId}" geopend voor deelnemersbeheer`);
                }
              }}
              onCreateGroup={handleCreateGroup}
              onUpdateGroupDetails={handleUpdateGroupDetails}
              onUpdateUserAccount={handleUpdateUserAccount}
              onPreRegisterMember={handlePreRegisterMember}
              onRemoveUserFromGroupOrDelete={handleRemoveUserFromGroupOrDelete}
              onSyncGroupParticipantsToUsers={() =>
                handleSyncGroupParticipantsToUsers(false)
              }
              onOpenReviewReminderModal={(group) => setReminderTargetGroup(group)}
            />
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
              <ShieldCheck className="w-8 h-8 text-slate-400 mx-auto" />
              <h3 className="text-base font-bold text-slate-900">
                Alleen toegankelijk voor Super User en Groepsbeheerders
              </h3>
              <p className="text-xs text-slate-500">
                Je bent momenteel ingelogd als groepslid van {activeGroupRecord.name}.
              </p>
            </div>
          )}
        </main>
      )}

      {/* Quiet Footer */}
      <footer className="bg-white border-t border-slate-200 mt-12">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>
            {activeGroupRecord.name} — Racefiets Weekend Planner ({activeGroupRecord.periodLabel})
          </span>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setActiveView('repository')}
              className="hover:text-slate-900 underline cursor-pointer"
            >
              Centrale Repository ({cloudRepositoryHouses.length})
            </button>
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
            {canAccessAdminView && (
              <button
                type="button"
                onClick={() => setActiveView('administratie')}
                className="hover:text-slate-900 underline cursor-pointer"
              >
                {isSuperAdmin ? 'Groepen & Gebruikers' : 'Groepsleden beheren'}
              </button>
            )}
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

      {/* Modal: Add or Edit House */}
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

      {/* Modal: Mark House as Chosen & Write Group Review for Central Repository */}
      <ChosenHouseReviewModal
        isOpen={Boolean(reviewingHouse)}
        onClose={() => setReviewingHouse(null)}
        house={reviewingHouse}
        activeGroupName={activeGroupRecord.name}
        existingRepoEntry={
          reviewingHouse
            ? cloudRepositoryHouses.find(
                (r) =>
                  r.sourceGroupId === activeTripId && r.sourceHouseId === reviewingHouse.id
              ) || null
            : null
        }
        defaultReviewerName={friendName || currentUser?.displayName || 'Groepslid'}
        onSaveChosenAndReview={handleSaveChosenAndReview}
      />

      {/* Modal: Confirm & Send 1-Week Post-Vacation Review Reminder Email via Gmail API */}
      <ReviewReminderEmailModal
        isOpen={Boolean(reminderTargetGroup)}
        onClose={() => setReminderTargetGroup(null)}
        group={reminderTargetGroup || activeGroupRecord}
        groupMembers={mergedUsersForAdminView.filter((u) =>
          userBelongsToGroup(u, (reminderTargetGroup || activeGroupRecord).tripId)
        )}
        onConfirmSendEmail={handleConfirmSendReviewReminderEmail}
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
