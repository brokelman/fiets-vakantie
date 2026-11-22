import React, { useMemo, useRef, useState } from 'react';
import {
  ShieldCheck,
  Users,
  Plus,
  Crown,
  UserCheck,
  Building2,
  Calendar,
  MapPin,
  Trophy,
  Pencil,
  Trash2,
  CheckCircle2,
  Lock,
  ArrowRight,
  Mail,
  BellRing,
  Send,
  X,
  CreditCard,
  Euro,
  FolderOpen,
  UserPlus,
  RefreshCw,
} from 'lucide-react';
import {
  GroupRecord,
  HouseRecord,
  ParticipantRecord,
  UserAccountRecord,
  UserRole,
} from '../types';
import {
  formatDutchPeriodLabel,
  formatIsoDateDutch,
  getReviewReminderDueDate,
  isReviewReminderDueNow,
} from '../utils/dateUtils';

export function getUserGroupIds(user: UserAccountRecord): string[] {
  const raw = Array.isArray(user.groupIds) ? user.groupIds.filter(Boolean) : [];
  if (user.groupId && !raw.includes(user.groupId)) {
    raw.unshift(user.groupId);
  }
  return raw.length > 0 ? Array.from(new Set(raw)) : ['racefiets-2027'];
}

export function userBelongsToGroup(
  user: UserAccountRecord,
  targetGroupId: string
): boolean {
  return getUserGroupIds(user).includes(targetGroupId);
}

interface UserGroupAdminViewProps {
  currentUserRole: UserRole;
  currentUserEmail: string;
  currentUserUid: string;
  activeGroup: GroupRecord;
  allGroups: GroupRecord[];
  visibleUsers: UserAccountRecord[];
  activeGroupParticipants: ParticipantRecord[];
  activeGroupHouses: HouseRecord[];
  onSwitchActiveGroup: (groupId: string) => void;
  onCreateGroup: (payload: {
    tripId: string;
    name: string;
    startDate: string;
    endDate: string;
    periodLabel: string;
    regionLabel: string;
  }) => Promise<void>;
  onUpdateGroupDetails: (
    groupId: string,
    payload: {
      name: string;
      startDate: string;
      endDate: string;
      periodLabel: string;
      regionLabel: string;
    }
  ) => Promise<void>;
  onUpdateUserAccount: (
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
  ) => Promise<void>;
  onPreRegisterMember: (payload: {
    email: string;
    displayName: string;
    groupId: string;
    groupIds: string[];
    role: UserRole;
    hasPaid?: boolean;
    amountPaid?: number;
  }) => Promise<void>;
  onRemoveUserFromGroupOrDelete: (
    targetUser: UserAccountRecord,
    groupIdToRemoveFrom: string
  ) => Promise<void>;
  onSyncGroupParticipantsToUsers: () => Promise<void>;
  onOpenReviewReminderModal: (group: GroupRecord) => void;
}

export const UserGroupAdminView: React.FC<UserGroupAdminViewProps> = ({
  currentUserRole,
  currentUserEmail,
  currentUserUid,
  activeGroup,
  allGroups,
  visibleUsers,
  activeGroupParticipants,
  activeGroupHouses,
  onSwitchActiveGroup,
  onCreateGroup,
  onUpdateGroupDetails,
  onUpdateUserAccount,
  onPreRegisterMember,
  onRemoveUserFromGroupOrDelete,
  onSyncGroupParticipantsToUsers,
  onOpenReviewReminderModal,
}) => {
  const isSuperAdmin =
    currentUserRole === 'super_admin' ||
    currentUserEmail.toLowerCase() === 'brokelman@gmail.com';

  const openedGroupDetailRef = useRef<HTMLDivElement | null>(null);

  // New group creation state (Super Admin only) — requires a date or date range
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupStartDate, setNewGroupStartDate] = useState('2027-05-27');
  const [newGroupEndDate, setNewGroupEndDate] = useState('2027-05-30');
  const [newGroupPeriod, setNewGroupPeriod] = useState(
    formatDutchPeriodLabel('2027-05-27', '2027-05-30')
  );
  const [newGroupRegion, setNewGroupRegion] = useState('Ardennen / Eifel / Limburg');
  const [createGroupError, setCreateGroupError] = useState<string | null>(null);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  // Edit active group state (Super Admin or Group Admin of activeGroup)
  const [isEditingGroup, setIsEditingGroup] = useState(false);
  const [editGroupName, setEditGroupName] = useState(activeGroup.name);
  const [editGroupStartDate, setEditGroupStartDate] = useState(
    activeGroup.startDate || '2027-05-27'
  );
  const [editGroupEndDate, setEditGroupEndDate] = useState(
    activeGroup.endDate || activeGroup.startDate || '2027-05-30'
  );
  const [editGroupPeriod, setEditGroupPeriod] = useState(activeGroup.periodLabel);
  const [editGroupRegion, setEditGroupRegion] = useState(activeGroup.regionLabel);
  const [editGroupError, setEditGroupError] = useState<string | null>(null);

  // Add/pre-register member inside opened group state
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('member');
  const [inviteHasPaid, setInviteHasPaid] = useState(false);
  const [inviteAmountPaid, setInviteAmountPaid] = useState('0');
  const [inviteExtraGroupIds, setInviteExtraGroupIds] = useState<string[]>([]);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);

  // Inline Edit User Row State
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUserName, setEditUserName] = useState('');
  const [editUserEmail, setEditUserEmail] = useState('');
  const [editUserRole, setEditUserRole] = useState<UserRole>('member');
  const [editUserGroupIds, setEditUserGroupIds] = useState<string[]>([]);
  const [editUserHasPaid, setEditUserHasPaid] = useState(false);
  const [editUserAmountPaid, setEditUserAmountPaid] = useState('0');
  const [isSavingUserEdit, setIsSavingUserEdit] = useState(false);

  // Delete confirmation state
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);
  const [isSyncingParticipants, setIsSyncingParticipants] = useState(false);

  // Filter users in table: by default shows the OPENED group (`activeGroup.tripId`), with option for Super Admin to view "ALLE_GROEPEN"
  const [viewScope, setViewScope] = useState<'ACTIVE_GROUP' | 'ALL_GROUPS'>('ACTIVE_GROUP');

  // Users in the currently opened group (`activeGroup.tripId`)
  const activeGroupMembers = useMemo(() => {
    return visibleUsers.filter((u) => userBelongsToGroup(u, activeGroup.tripId));
  }, [visibleUsers, activeGroup.tripId]);

  const displayedUsers = useMemo(() => {
    if (!isSuperAdmin || viewScope === 'ACTIVE_GROUP') {
      return activeGroupMembers;
    }
    return visibleUsers;
  }, [isSuperAdmin, viewScope, activeGroupMembers, visibleUsers]);

  // Check if there are participants/voters in the active group's participants or houses that aren't in activeGroupMembers yet
  const unsyncedParticipantNames = useMemo(() => {
    const existingNames = new Set(
      activeGroupMembers.map((u) => u.displayName.trim().toLowerCase())
    );
    const existingUids = new Set(activeGroupMembers.map((u) => u.uid));
    const namesToSync = new Set<string>();

    activeGroupParticipants.forEach((p) => {
      const clean = p.name.trim();
      if (clean && !existingNames.has(clean.toLowerCase())) {
        namesToSync.add(clean);
      }
    });

    activeGroupHouses.forEach((h) => {
      const addedByClean = (h.addedBy || '').trim();
      if (
        addedByClean &&
        addedByClean.toLowerCase() !== 'groepslid' &&
        !existingNames.has(addedByClean.toLowerCase()) &&
        (!h.ownerId || !existingUids.has(h.ownerId))
      ) {
        namesToSync.add(addedByClean);
      }
      (h.votes || []).forEach((v) => {
        const voterClean = (v.voterName || '').trim();
        if (
          voterClean &&
          voterClean.toLowerCase() !== 'groepslid' &&
          !existingNames.has(voterClean.toLowerCase()) &&
          (!v.userId || !existingUids.has(v.userId))
        ) {
          namesToSync.add(voterClean);
        }
      });
    });

    return Array.from(namesToSync);
  }, [activeGroupMembers, activeGroupParticipants, activeGroupHouses]);

  // Payment summary for the opened group
  const paymentSummary = useMemo(() => {
    const paidCount = activeGroupMembers.filter((u) => Boolean(u.hasPaid)).length;
    const totalAmount = activeGroupMembers.reduce(
      (sum, u) => sum + (typeof u.amountPaid === 'number' ? u.amountPaid : 0),
      0
    );
    return { paidCount, totalCount: activeGroupMembers.length, totalAmount };
  }, [activeGroupMembers]);

  const handleOpenGroupAndScroll = (groupId: string) => {
    onSwitchActiveGroup(groupId);
    setViewScope('ACTIVE_GROUP');
    setIsEditingGroup(false);
    setEditingUserId(null);
    window.setTimeout(() => {
      openedGroupDetailRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 80);
  };

  const handleNewStartDateChange = (val: string) => {
    setNewGroupStartDate(val);
    const nextEnd = newGroupEndDate && newGroupEndDate < val ? val : newGroupEndDate;
    if (nextEnd !== newGroupEndDate) {
      setNewGroupEndDate(nextEnd);
    }
    const autoLabel = formatDutchPeriodLabel(val, nextEnd || val);
    if (autoLabel) {
      setNewGroupPeriod(autoLabel);
    }
  };

  const handleNewEndDateChange = (val: string) => {
    setNewGroupEndDate(val);
    const autoLabel = formatDutchPeriodLabel(newGroupStartDate, val || newGroupStartDate);
    if (autoLabel) {
      setNewGroupPeriod(autoLabel);
    }
  };

  const handleCreateGroupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) return;

    const cleanName = newGroupName.trim();
    const cleanRegion = newGroupRegion.trim();

    if (cleanName.length < 2) {
      setCreateGroupError('Geef een groepsnaam op van minimaal 2 tekens.');
      return;
    }
    if (!newGroupStartDate) {
      setCreateGroupError('Kies een startdatum (of tijdsreeks) voor de vakantie van deze groep.');
      return;
    }
    const effectiveEndDate = newGroupEndDate || newGroupStartDate;
    if (effectiveEndDate < newGroupStartDate) {
      setCreateGroupError('De einddatum kan niet vóór de startdatum liggen.');
      return;
    }

    const computedPeriod =
      newGroupPeriod.trim() ||
      formatDutchPeriodLabel(newGroupStartDate, effectiveEndDate) ||
      'Weekend 2027';

    const slug = cleanName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const generatedTripId = `groep-${slug || 'fiets'}-${Date.now().toString().slice(-4)}`;

    setCreateGroupError(null);
    setIsCreatingGroup(true);
    try {
      await onCreateGroup({
        tripId: generatedTripId,
        name: cleanName,
        startDate: newGroupStartDate,
        endDate: effectiveEndDate,
        periodLabel: computedPeriod,
        regionLabel: cleanRegion || 'Ardennen / Limburg',
      });
      setNewGroupName('');
    } catch (err: any) {
      setCreateGroupError(err?.message || 'Groep aanmaken is niet gelukt.');
    } finally {
      setIsCreatingGroup(false);
    }
  };

  const handleStartEditGroup = () => {
    const start = activeGroup.startDate || '2027-05-27';
    const end = activeGroup.endDate || start;
    setEditGroupName(activeGroup.name);
    setEditGroupStartDate(start);
    setEditGroupEndDate(end);
    setEditGroupPeriod(activeGroup.periodLabel);
    setEditGroupRegion(activeGroup.regionLabel);
    setEditGroupError(null);
    setIsEditingGroup(true);
  };

  const handleEditStartDateChange = (val: string) => {
    setEditGroupStartDate(val);
    const nextEnd = editGroupEndDate && editGroupEndDate < val ? val : editGroupEndDate;
    if (nextEnd !== editGroupEndDate) {
      setEditGroupEndDate(nextEnd);
    }
    const autoLabel = formatDutchPeriodLabel(val, nextEnd || val);
    if (autoLabel) {
      setEditGroupPeriod(autoLabel);
    }
  };

  const handleEditEndDateChange = (val: string) => {
    setEditGroupEndDate(val);
    const autoLabel = formatDutchPeriodLabel(editGroupStartDate, val || editGroupStartDate);
    if (autoLabel) {
      setEditGroupPeriod(autoLabel);
    }
  };

  const handleSaveGroupDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editGroupName.trim().length < 2) {
      setEditGroupError('Groepsnaam moet minimaal 2 tekens bevatten.');
      return;
    }
    if (!editGroupStartDate) {
      setEditGroupError('Vul een geldige startdatum in.');
      return;
    }
    const effectiveEnd = editGroupEndDate || editGroupStartDate;
    if (effectiveEnd < editGroupStartDate) {
      setEditGroupError('De einddatum kan niet vóór de startdatum liggen.');
      return;
    }

    const computedPeriod =
      editGroupPeriod.trim() ||
      formatDutchPeriodLabel(editGroupStartDate, effectiveEnd) ||
      activeGroup.periodLabel;

    setEditGroupError(null);
    await onUpdateGroupDetails(activeGroup.tripId, {
      name: editGroupName.trim(),
      startDate: editGroupStartDate,
      endDate: effectiveEnd,
      periodLabel: computedPeriod,
      regionLabel: editGroupRegion.trim() || activeGroup.regionLabel,
    });
    setIsEditingGroup(false);
  };

  const handleToggleInviteExtraGroup = (tripId: string) => {
    setInviteExtraGroupIds((prev) =>
      prev.includes(tripId) ? prev.filter((id) => id !== tripId) : [...prev, tripId]
    );
  };

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = inviteName.trim();
    const cleanEmail = inviteEmail.trim().toLowerCase();
    if (!cleanName) {
      setInviteError('Vul de naam van de deelnemer in.');
      return;
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setInviteError('Vul een geldig e-mailadres in (bijv. naam@voorbeeld.nl).');
      return;
    }

    const targetGroups = Array.from(
      new Set([activeGroup.tripId, ...(isSuperAdmin ? inviteExtraGroupIds : [])])
    );
    const parsedAmount = Math.max(0, Math.min(50000, Number(inviteAmountPaid) || 0));

    setInviteError(null);
    setIsInviting(true);
    try {
      await onPreRegisterMember({
        email: cleanEmail,
        displayName: cleanName,
        groupId: activeGroup.tripId,
        groupIds: targetGroups,
        role: inviteRole,
        hasPaid: inviteHasPaid,
        amountPaid: parsedAmount,
      });
      setInviteName('');
      setInviteEmail('');
      setInviteRole('member');
      setInviteHasPaid(false);
      setInviteAmountPaid('0');
      setInviteExtraGroupIds([]);
    } catch (err: any) {
      setInviteError(err?.message || 'Gebruiker toevoegen is niet gelukt.');
    } finally {
      setIsInviting(false);
    }
  };

  const handleStartEditUserRow = (u: UserAccountRecord) => {
    setEditingUserId(u.id);
    setEditUserName(u.displayName);
    setEditUserEmail(u.email);
    setEditUserRole(u.role);
    setEditUserGroupIds(getUserGroupIds(u));
    setEditUserHasPaid(Boolean(u.hasPaid));
    setEditUserAmountPaid(String(typeof u.amountPaid === 'number' ? u.amountPaid : 0));
  };

  const handleCancelEditUserRow = () => {
    setEditingUserId(null);
  };

  const handleToggleEditUserGroup = (tripId: string) => {
    setEditUserGroupIds((prev) => {
      if (prev.includes(tripId)) {
        if (prev.length <= 1) return prev; // Keep at least 1 group
        return prev.filter((id) => id !== tripId);
      }
      return [...prev, tripId];
    });
  };

  const handleSaveEditUserRow = async (u: UserAccountRecord) => {
    const cleanName = editUserName.trim();
    const cleanEmail = editUserEmail.trim().toLowerCase();
    if (!cleanName || cleanEmail.length < 3 || !cleanEmail.includes('@')) {
      return;
    }

    const nextGroups =
      editUserGroupIds.length > 0 ? editUserGroupIds : getUserGroupIds(u);
    const nextPrimary = nextGroups.includes(u.groupId) ? u.groupId : nextGroups[0];
    const parsedAmount = Math.max(
      0,
      Math.min(50000, Math.round((Number(editUserAmountPaid) || 0) * 100) / 100)
    );

    setIsSavingUserEdit(true);
    try {
      await onUpdateUserAccount(u, {
        displayName: cleanName,
        email: cleanEmail,
        role: editUserRole,
        primaryGroupId: nextPrimary,
        groupIds: nextGroups,
        hasPaid: editUserHasPaid,
        amountPaid: parsedAmount,
      });
      setEditingUserId(null);
    } finally {
      setIsSavingUserEdit(false);
    }
  };

  const handleQuickTogglePaid = async (u: UserAccountRecord) => {
    const nextPaid = !u.hasPaid;
    await onUpdateUserAccount(u, {
      displayName: u.displayName,
      email: u.email,
      role: u.role,
      primaryGroupId: u.groupId,
      groupIds: getUserGroupIds(u),
      hasPaid: nextPaid,
      amountPaid: typeof u.amountPaid === 'number' ? u.amountPaid : 0,
    });
  };

  const handleQuickChangeRole = async (u: UserAccountRecord, nextRole: UserRole) => {
    await onUpdateUserAccount(u, {
      displayName: u.displayName,
      email: u.email,
      role: nextRole,
      primaryGroupId: u.groupId,
      groupIds: getUserGroupIds(u),
      hasPaid: Boolean(u.hasPaid),
      amountPaid: typeof u.amountPaid === 'number' ? u.amountPaid : 0,
    });
  };

  const handleQuickToggleGroupBadge = async (
    u: UserAccountRecord,
    groupIdToToggle: string
  ) => {
    const currentList = getUserGroupIds(u);
    const exists = currentList.includes(groupIdToToggle);
    if (exists && currentList.length <= 1) return;
    const nextList = exists
      ? currentList.filter((id) => id !== groupIdToToggle)
      : [...currentList, groupIdToToggle];
    const nextPrimary = nextList.includes(u.groupId) ? u.groupId : nextList[0];

    await onUpdateUserAccount(u, {
      displayName: u.displayName,
      email: u.email,
      role: u.role,
      primaryGroupId: nextPrimary,
      groupIds: nextList,
      hasPaid: Boolean(u.hasPaid),
      amountPaid: typeof u.amountPaid === 'number' ? u.amountPaid : 0,
    });
  };

  const getRoleBadge = (role: UserRole, email: string) => {
    if (role === 'super_admin' || email.toLowerCase() === 'brokelman@gmail.com') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-purple-100 text-purple-900 border border-purple-300">
          <Crown className="w-3 h-3 text-purple-700" />
          Super User
        </span>
      );
    }
    if (role === 'group_admin') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-amber-100 text-amber-900 border border-amber-300">
          <ShieldCheck className="w-3 h-3 text-amber-700" />
          Groepsbeheerder
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
        <UserCheck className="w-3 h-3 text-slate-500" />
        Groepslid
      </span>
    );
  };

  // Active group reminder calculations
  const activeReminderDueDate = getReviewReminderDueDate(
    activeGroup.startDate,
    activeGroup.endDate
  );
  const activeReminderDueFormatted = formatIsoDateDutch(activeReminderDueDate, true);
  const isActiveReminderDue = isReviewReminderDueNow(
    activeGroup.startDate,
    activeGroup.endDate
  );

  return (
    <div className="space-y-8">
      {/* Top Hierarchy Banner */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-lg border border-slate-700">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/20 border border-orange-400/30 text-orange-300 text-xs font-extrabold uppercase tracking-wider">
              {isSuperAdmin ? (
                <>
                  <Crown className="w-3.5 h-3.5" />
                  Super User Administratie ({currentUserEmail})
                </>
              ) : (
                <>
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Groepsbeheerder voor {activeGroup.name}
                </>
              )}
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              {isSuperAdmin
                ? 'Gebruikersgroepen, Deelnemers & Betalingen Beheren'
                : `Groepsbeheer & Deelnemers: ${activeGroup.name}`}
            </h2>
            <p className="text-sm text-slate-300 leading-relaxed">
              {isSuperAdmin
                ? 'Klik op een groep om deze te openen en direct de deelnemers (naam, e-mail, rol in de groep en betaalstatus/bedrag) toe te voegen, te wijzigen of te verwijderen.'
                : `Beheer hier alle deelnemers van ${activeGroup.name}: voeg leden toe, wijzig hun naam, e-mailadres, rol of betaalstatus en pas de vakantiedatum aan.`}
            </p>
          </div>

          <div className="bg-white/10 backdrop-blur-sm border border-white/15 rounded-2xl p-4 space-y-1.5 shrink-0 min-w-[260px]">
            <span className="text-[11px] font-bold uppercase tracking-wider text-orange-300 block">
              Momenteel geopende groep
            </span>
            <div className="text-lg font-extrabold text-white flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-orange-400 shrink-0" />
              {activeGroup.name}
            </div>
            <div className="text-xs text-slate-300 flex items-center justify-between gap-2 pt-1">
              <span>
                <strong>{activeGroupMembers.length}</strong> deelnemer(s)
              </span>
              <span>·</span>
              <span className="text-emerald-300 font-bold">
                {paymentSummary.paidCount}/{paymentSummary.totalCount} betaald (€{' '}
                {paymentSummary.totalAmount})
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 1: GROUPS OVERVIEW & CREATE NEW GROUP (For Super Admin) */}
      {isSuperAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Existing Groups List — Every group card shows member chips and an "Open groep & beheer gebruikers" button */}
          <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-200/90 p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-orange-600" />
                  Kies een Groep om Gebruikers te Beheren ({allGroups.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Klik op een groep om het volledige deelnemersoverzicht (naam, e-mail, rol & betaalstatus) te openen en te bewerken.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {allGroups.map((group) => {
                const isSelected = group.tripId === activeGroup.tripId;
                const groupMembers = visibleUsers.filter((u) =>
                  userBelongsToGroup(u, group.tripId)
                );
                const groupAdmins = groupMembers.filter((u) => u.role === 'group_admin');
                const paidInGroup = groupMembers.filter((u) => Boolean(u.hasPaid)).length;
                const totalPaidInGroup = groupMembers.reduce(
                  (sum, u) => sum + (typeof u.amountPaid === 'number' ? u.amountPaid : 0),
                  0
                );

                return (
                  <div
                    key={group.tripId}
                    onClick={() => handleOpenGroupAndScroll(group.tripId)}
                    className={`rounded-2xl border p-4 transition flex flex-col justify-between gap-3 cursor-pointer ${
                      isSelected
                        ? 'bg-orange-50/80 border-orange-500 ring-2 ring-orange-500/20 shadow-sm'
                        : 'bg-slate-50/70 border-slate-200 hover:border-orange-300 hover:bg-white'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-extrabold text-slate-900 text-base leading-snug flex items-center gap-1.5">
                          <FolderOpen
                            className={`w-4 h-4 shrink-0 ${
                              isSelected ? 'text-orange-600' : 'text-slate-400'
                            }`}
                          />
                          {group.name}
                        </h4>
                        {isSelected ? (
                          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-orange-600 text-white shrink-0">
                            Geopend
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-700 shrink-0">
                            Klik om te openen
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-slate-600 space-y-0.5 font-medium">
                        <p className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                          <span>{group.periodLabel}</span>
                        </p>
                        <p className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{group.regionLabel}</span>
                        </p>
                      </div>

                      {/* Preview of Participants / Users inside this Group */}
                      <div className="pt-1.5">
                        <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">
                          Deelnemers in deze groep ({groupMembers.length}):
                        </div>
                        {groupMembers.length === 0 ? (
                          <p className="text-xs text-slate-400 italic">
                            Nog geen deelnemers gekoppeld — klik om toe te voegen
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {groupMembers.slice(0, 6).map((m) => (
                              <span
                                key={m.id}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold bg-white border border-slate-200 text-slate-800"
                              >
                                {m.role === 'super_admin' ||
                                m.email.toLowerCase() === 'brokelman@gmail.com' ? (
                                  <Crown className="w-2.5 h-2.5 text-purple-600" />
                                ) : m.role === 'group_admin' ? (
                                  <ShieldCheck className="w-2.5 h-2.5 text-amber-600" />
                                ) : null}
                                {m.displayName}
                              </span>
                            ))}
                            {groupMembers.length > 6 && (
                              <span className="px-2 py-0.5 rounded-lg text-[11px] font-bold bg-slate-200 text-slate-700">
                                +{groupMembers.length - 6} meer
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="pt-2.5 border-t border-slate-200/80 space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-slate-600">
                        <span>
                          {groupAdmins.length > 0 ? (
                            <span className="text-amber-800 font-bold">
                              Beheerder: {groupAdmins.map((a) => a.displayName).join(', ')}
                            </span>
                          ) : (
                            <span className="text-slate-400 italic">Geen groepsadmin</span>
                          )}
                        </span>
                        <span className="font-bold text-emerald-700">
                          {paidInGroup}/{groupMembers.length} betaald (€ {totalPaidInGroup})
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenGroupAndScroll(group.tripId);
                        }}
                        className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                          isSelected
                            ? 'bg-orange-600 hover:bg-orange-500 text-white'
                            : 'bg-slate-900 hover:bg-slate-800 text-white'
                        }`}
                      >
                        <Users className="w-3.5 h-3.5" />
                        {isSelected
                          ? `Geopend: Beheer ${groupMembers.length} deelnemers hieronder`
                          : `Open groep & beheer deelnemers (${groupMembers.length})`}
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Create New User Group Form with Date / Date Range */}
          <div className="bg-white rounded-3xl border border-slate-200/90 p-6 shadow-xs space-y-4">
            <div>
              <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                <Plus className="w-5 h-5 text-orange-600" />
                Nieuwe Groep Opstarten
              </h3>
              <p className="text-xs text-slate-500">
                Geef een groepsnaam en een datum of tijdsreeks op. Een week na de einddatum kan de groep een review-oproep per mail ontvangen.
              </p>
            </div>

            <form onSubmit={handleCreateGroupSubmit} className="space-y-3.5">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Groepsnaam *
                </label>
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder="Bijv. Klimgeiten ’27 of WTC De Amstel"
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Startdatum *
                  </label>
                  <input
                    type="date"
                    value={newGroupStartDate}
                    onChange={(e) => handleNewStartDateChange(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Einddatum (tijdsreeks)
                  </label>
                  <input
                    type="date"
                    value={newGroupEndDate}
                    min={newGroupStartDate}
                    onChange={(e) => handleNewEndDateChange(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Weergavetekst Periode / Weekend
                </label>
                <input
                  type="text"
                  value={newGroupPeriod}
                  onChange={(e) => setNewGroupPeriod(e.target.value)}
                  placeholder="Bijv. Do 27 mei t/m zo 30 mei 2027"
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white"
                />
                {newGroupStartDate && (
                  <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                    <BellRing className="w-3 h-3 text-orange-500 shrink-0" />
                    <span>
                      Review-oproep gepland op:{' '}
                      <strong>
                        {formatIsoDateDutch(
                          getReviewReminderDueDate(newGroupStartDate, newGroupEndDate),
                          true
                        )}
                      </strong>{' '}
                      (1 week na afloop)
                    </span>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Doelregio
                </label>
                <input
                  type="text"
                  value={newGroupRegion}
                  onChange={(e) => setNewGroupRegion(e.target.value)}
                  placeholder="Bijv. Vogezen / Ardennen / Zuid-Limburg"
                  className="w-full px-3.5 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white"
                />
              </div>

              {createGroupError && (
                <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
                  {createGroupError}
                </div>
              )}

              <button
                type="submit"
                disabled={isCreatingGroup}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold bg-orange-600 hover:bg-orange-500 text-white shadow-xs transition cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                {isCreatingGroup ? 'Bezig met aanmaken...' : 'Groep aanmaken'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* SECTION 2: OPENED GROUP WORKSPACE — USER MANAGEMENT (NAME, EMAIL, ROLE, PAYMENT) & GROUP SETTINGS */}
      <div
        ref={openedGroupDetailRef}
        className="bg-white rounded-3xl border-2 border-orange-500/80 shadow-md overflow-hidden"
      >
        {/* Opened Group Header Bar */}
        <div className="bg-slate-900 text-white px-6 py-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-orange-400">
              <FolderOpen className="w-4 h-4" />
              Geopende Groep — Gebruikersbeheer & Betalingen
            </div>
            <h3 className="text-xl sm:text-2xl font-extrabold flex flex-wrap items-center gap-2.5">
              <span>{activeGroup.name}</span>
              <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-white/10 text-slate-200">
                {activeGroup.periodLabel}
              </span>
            </h3>
            <p className="text-xs text-slate-300">
              Regio: <strong>{activeGroup.regionLabel}</strong>
              {activeGroup.startDate && (
                <>
                  {' · '}Datumreeks:{' '}
                  <strong className="font-mono">
                    {activeGroup.startDate}
                    {activeGroup.endDate && activeGroup.endDate !== activeGroup.startDate
                      ? ` t/m ${activeGroup.endDate}`
                      : ''}
                  </strong>
                </>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Payment Summary Pill for this group */}
            <div className="bg-emerald-500/15 border border-emerald-400/30 rounded-2xl px-3.5 py-2 text-xs">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 flex items-center gap-1">
                <CreditCard className="w-3 h-3" />
                Betaalstatus groep
              </div>
              <div className="font-extrabold text-white">
                {paymentSummary.paidCount} / {paymentSummary.totalCount} betaald · €{' '}
                {paymentSummary.totalAmount.toFixed(2).replace(/\.00$/, '')}
              </div>
            </div>

            <button
              type="button"
              onClick={handleStartEditGroup}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white transition cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5 text-orange-400" />
              Datum & groepsnaam wijzigen
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Edit Group Details Form (when opened) */}
          {isEditingGroup && (
            <form
              onSubmit={handleSaveGroupDetails}
              className="p-5 rounded-2xl bg-orange-50/60 border border-orange-200 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-extrabold text-slate-900">
                  Groepsnaam & Vakantiedatum / Tijdsreeks aanpassen
                </h4>
                <button
                  type="button"
                  onClick={() => setIsEditingGroup(false)}
                  className="text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
                >
                  Sluiten
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Groepsnaam *
                  </label>
                  <input
                    type="text"
                    value={editGroupName}
                    onChange={(e) => setEditGroupName(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Startdatum *
                  </label>
                  <input
                    type="date"
                    value={editGroupStartDate}
                    onChange={(e) => handleEditStartDateChange(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Einddatum (tijdsreeks)
                  </label>
                  <input
                    type="date"
                    value={editGroupEndDate}
                    min={editGroupStartDate}
                    onChange={(e) => handleEditEndDateChange(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Weergavetekst periode
                  </label>
                  <input
                    type="text"
                    value={editGroupPeriod}
                    onChange={(e) => setEditGroupPeriod(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">
                    Regio
                  </label>
                  <input
                    type="text"
                    value={editGroupRegion}
                    onChange={(e) => setEditGroupRegion(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-xl"
                    required
                  />
                </div>
              </div>

              {editGroupError && (
                <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
                  {editGroupError}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span className="text-xs text-slate-600">
                  Datum voor automatische review-herinneringsmail (+7 dagen):{' '}
                  <strong>
                    {formatIsoDateDutch(
                      getReviewReminderDueDate(editGroupStartDate, editGroupEndDate),
                      true
                    ) || 'Onbekend'}
                  </strong>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEditingGroup(false)}
                    className="px-3.5 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 cursor-pointer"
                  >
                    Annuleren
                  </button>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Datum & wijzigingen opslaan
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Banner if there are participants from "Deelnemers & Auto's" or house voters that aren't synced to user_accounts yet */}
          {unsyncedParticipantNames.length > 0 && (
            <div className="rounded-2xl bg-amber-50 border border-amber-300 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs font-extrabold text-amber-950 flex items-center gap-1.5">
                  <RefreshCw className="w-4 h-4 text-amber-600 shrink-0" />
                  Bestaande deelnemers/stemmers uit {activeGroup.name} gevonden ({unsyncedParticipantNames.length})
                </div>
                <p className="text-xs text-amber-900">
                  De volgende personen staan al bij Deelnemers & Auto’s of bij de stemmen ({unsyncedParticipantNames.join(', ')}), maar nog niet in deze gebruikerslijst. Zet ze met 1 klik over:
                </p>
              </div>
              <button
                type="button"
                disabled={isSyncingParticipants}
                onClick={async () => {
                  setIsSyncingParticipants(true);
                  try {
                    await onSyncGroupParticipantsToUsers();
                  } finally {
                    setIsSyncingParticipants(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-extrabold bg-amber-600 hover:bg-amber-500 text-white shrink-0 cursor-pointer disabled:opacity-50"
              >
                <UserPlus className="w-3.5 h-3.5" />
                {isSyncingParticipants
                  ? 'Bezig met overzetten...'
                  : `Koppel ${unsyncedParticipantNames.length} deelnemer(s) aan groep`}
              </button>
            </div>
          )}

          {/* MAIN GROUP USERS TABLE + ADD USER TO THIS GROUP */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Left 2 Columns: Deelnemers / Gebruikers in deze groep */}
            <div className="xl:col-span-2 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                    <Users className="w-5 h-5 text-orange-600" />
                    {viewScope === 'ACTIVE_GROUP'
                      ? `Gebruikers & Deelnemers in ${activeGroup.name} (${activeGroupMembers.length})`
                      : `Alle geregistreerde gebruikers (${visibleUsers.length})`}
                  </h4>
                  <p className="text-xs text-slate-500">
                    Overzicht van naam, e-mailadres, rol in de groep en betaalstatus. Klik op <strong>Wijzigen</strong> om gegevens of het betaalde bedrag aan te passen.
                  </p>
                </div>

                {isSuperAdmin && allGroups.length > 1 && (
                  <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl shrink-0 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setViewScope('ACTIVE_GROUP')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                        viewScope === 'ACTIVE_GROUP'
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Alleen {activeGroup.name} ({activeGroupMembers.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewScope('ALL_GROUPS')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition cursor-pointer ${
                        viewScope === 'ALL_GROUPS'
                          ? 'bg-white text-slate-900 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Alle groepen ({visibleUsers.length})
                    </button>
                  </div>
                )}
              </div>

              {displayedUsers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center space-y-2">
                  <Users className="w-8 h-8 text-slate-400 mx-auto" />
                  <h5 className="text-sm font-extrabold text-slate-800">
                    Nog geen gebruikers in {activeGroup.name}
                  </h5>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Voeg hiernaast via het formulier <strong>“Gebruiker toevoegen aan {activeGroup.name}”</strong> direct de deelnemers (naam, e-mailadres en rol) toe.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-extrabold uppercase tracking-wider text-slate-500">
                        <th className="py-3 px-4">Naam & E-mailadres</th>
                        <th className="py-3 px-3">Rol in de groep</th>
                        <th className="py-3 px-3">Betaling (Betaaldienst)</th>
                        <th className="py-3 px-3">Groep(en)</th>
                        <th className="py-3 px-4 text-right">Acties</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm bg-white">
                      {displayedUsers.map((u) => {
                        const isTargetSuper =
                          u.role === 'super_admin' ||
                          u.email.toLowerCase() === 'brokelman@gmail.com';
                        const memberGroupIds = getUserGroupIds(u);
                        const isEditingThisRow = editingUserId === u.id;
                        const isConfirmingDelete = confirmDeleteUserId === u.id;
                        const isPlaceholderEmail =
                          u.email.endsWith('@kopgroep27.nl') ||
                          u.email.startsWith('invullen-');

                        if (isEditingThisRow) {
                          return (
                            <tr key={u.id} className="bg-orange-50/70">
                              <td colSpan={5} className="p-4">
                                <div className="space-y-4">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-extrabold uppercase tracking-wider text-orange-700">
                                      Gegevens wijzigen: {u.displayName}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={handleCancelEditUserRow}
                                      className="text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
                                    >
                                      Sluiten
                                    </button>
                                  </div>

                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                    <div>
                                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                                        Naam *
                                      </label>
                                      <input
                                        type="text"
                                        value={editUserName}
                                        onChange={(e) => setEditUserName(e.target.value)}
                                        className="w-full px-3 py-2 text-xs font-bold bg-white border border-slate-300 rounded-xl"
                                        required
                                      />
                                    </div>

                                    <div>
                                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                                        E-mailadres *
                                      </label>
                                      <input
                                        type="email"
                                        value={editUserEmail}
                                        onChange={(e) => setEditUserEmail(e.target.value)}
                                        className="w-full px-3 py-2 text-xs font-semibold bg-white border border-slate-300 rounded-xl"
                                        required
                                      />
                                    </div>

                                    <div>
                                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                                        Rol in de groep
                                      </label>
                                      {isTargetSuper ? (
                                        <div className="px-3 py-2 text-xs font-extrabold text-purple-900 bg-purple-100 rounded-xl">
                                          Super User (vast)
                                        </div>
                                      ) : (
                                        <select
                                          value={editUserRole}
                                          onChange={(e) =>
                                            setEditUserRole(e.target.value as UserRole)
                                          }
                                          className="w-full px-3 py-2 text-xs font-bold bg-white border border-slate-300 rounded-xl"
                                        >
                                          <option value="member">Groepslid</option>
                                          <option value="group_admin">
                                            Groepsbeheerder (Admin)
                                          </option>
                                        </select>
                                      )}
                                    </div>

                                    <div>
                                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                                        Betaalstatus & Bedrag (€)
                                      </label>
                                      <div className="flex items-center gap-2">
                                        <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800 bg-white border border-slate-300 rounded-xl px-2.5 py-2 cursor-pointer shrink-0">
                                          <input
                                            type="checkbox"
                                            checked={editUserHasPaid}
                                            onChange={(e) =>
                                              setEditUserHasPaid(e.target.checked)
                                            }
                                            className="rounded border-slate-300 text-emerald-600"
                                          />
                                          <span>Betaald</span>
                                        </label>
                                        <div className="relative flex-1">
                                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                                            €
                                          </span>
                                          <input
                                            type="number"
                                            min="0"
                                            max="50000"
                                            step="0.01"
                                            value={editUserAmountPaid}
                                            onChange={(e) =>
                                              setEditUserAmountPaid(e.target.value)
                                            }
                                            className="w-full pl-6 pr-2 py-2 text-xs font-bold bg-white border border-slate-300 rounded-xl"
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {isSuperAdmin && allGroups.length > 1 && (
                                    <div>
                                      <label className="block text-[11px] font-bold text-slate-600 mb-1">
                                        Lid van groep(en) (meerdere mogelijk):
                                      </label>
                                      <div className="flex flex-wrap gap-2">
                                        {allGroups.map((g) => {
                                          const checked = editUserGroupIds.includes(
                                            g.tripId
                                          );
                                          return (
                                            <label
                                              key={g.tripId}
                                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border cursor-pointer ${
                                                checked
                                                  ? 'bg-orange-100 border-orange-400 text-orange-950'
                                                  : 'bg-white border-slate-200 text-slate-600'
                                              }`}
                                            >
                                              <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() =>
                                                  handleToggleEditUserGroup(g.tripId)
                                                }
                                                className="rounded border-slate-300 text-orange-600"
                                              />
                                              <span>{g.name}</span>
                                            </label>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  <div className="flex items-center justify-end gap-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={handleCancelEditUserRow}
                                      className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-200 cursor-pointer"
                                    >
                                      Annuleren
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isSavingUserEdit}
                                      onClick={() => handleSaveEditUserRow(u)}
                                      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-extrabold bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer disabled:opacity-50"
                                    >
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                      {isSavingUserEdit ? 'Opslaan...' : 'Wijzigingen opslaan'}
                                    </button>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        return (
                          <tr
                            key={u.id}
                            className="hover:bg-slate-50/90 transition align-middle"
                          >
                            {/* Column 1: Naam & E-mail */}
                            <td className="py-3.5 px-4">
                              <div className="font-extrabold text-slate-900 flex items-center gap-1.5">
                                <span>{u.displayName}</span>
                                {u.uid === currentUserUid && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-200 text-slate-700">
                                    Jij
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                                {isPlaceholderEmail ? (
                                  <button
                                    type="button"
                                    onClick={() => handleStartEditUserRow(u)}
                                    className="text-amber-700 font-semibold underline hover:text-amber-900 cursor-pointer"
                                  >
                                    E-mailadres invullen ({u.email})
                                  </button>
                                ) : (
                                  <span className="truncate max-w-[220px]">{u.email}</span>
                                )}
                              </div>
                            </td>

                            {/* Column 2: Rol in de groep */}
                            <td className="py-3.5 px-3">
                              <div className="flex flex-col gap-1.5 items-start">
                                {getRoleBadge(u.role, u.email)}
                                {!isTargetSuper && (
                                  <select
                                    value={u.role}
                                    onChange={(e) =>
                                      handleQuickChangeRole(
                                        u,
                                        e.target.value as UserRole
                                      )
                                    }
                                    aria-label={`Wijzig rol van ${u.displayName}`}
                                    className="text-[11px] font-bold bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg px-2 py-1 cursor-pointer"
                                  >
                                    <option value="member">Groepslid</option>
                                    <option value="group_admin">Groepsbeheerder</option>
                                  </select>
                                )}
                              </div>
                            </td>

                            {/* Column 3: Betaling (Status & Bedrag) */}
                            <td className="py-3.5 px-3">
                              <div className="flex flex-col items-start gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleQuickTogglePaid(u)}
                                  title="Klik om betaalstatus te wisselen ( of klik op Wijzigen voor het bedrag )"
                                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold border transition cursor-pointer ${
                                    u.hasPaid
                                      ? 'bg-emerald-100 text-emerald-900 border-emerald-300 hover:bg-emerald-200'
                                      : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                                  }`}
                                >
                                  <CreditCard className="w-3 h-3" />
                                  {u.hasPaid ? 'Betaald' : 'Openstaand'}
                                </button>
                                <span className="text-xs font-mono font-bold text-slate-700 pl-1">
                                  €{' '}
                                  {(typeof u.amountPaid === 'number' ? u.amountPaid : 0)
                                    .toFixed(2)
                                    .replace(/\.00$/, '')}
                                </span>
                              </div>
                            </td>

                            {/* Column 4: Gekoppelde groepen */}
                            <td className="py-3.5 px-3">
                              {isSuperAdmin && allGroups.length > 1 ? (
                                <div className="flex flex-wrap gap-1">
                                  {allGroups.map((g) => {
                                    const isMember = memberGroupIds.includes(g.tripId);
                                    return (
                                      <button
                                        key={g.tripId}
                                        type="button"
                                        onClick={() =>
                                          handleQuickToggleGroupBadge(u, g.tripId)
                                        }
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-bold border transition cursor-pointer ${
                                          isMember
                                            ? 'bg-orange-50 text-orange-950 border-orange-300'
                                            : 'bg-slate-50 text-slate-400 border-slate-200 hover:text-slate-700'
                                        }`}
                                      >
                                        <span>{isMember ? '✓' : '+'}</span>
                                        <span>{g.name}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {memberGroupIds.map((gid) => {
                                    const gObj = allGroups.find((g) => g.tripId === gid);
                                    return (
                                      <span
                                        key={gid}
                                        className="inline-flex items-center px-2.5 py-0.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-800 border border-slate-200"
                                      >
                                        {gObj ? gObj.name : gid}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </td>

                            {/* Column 5: Acties (Wijzigen / Verwijderen) */}
                            <td className="py-3.5 px-4 text-right">
                              {isConfirmingDelete ? (
                                <div className="inline-flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-xl px-2.5 py-1.5">
                                  <span className="text-[11px] font-bold text-red-800">
                                    {memberGroupIds.length > 1
                                      ? `Uit ${activeGroup.name} halen?`
                                      : 'Verwijderen?'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await onRemoveUserFromGroupOrDelete(
                                        u,
                                        activeGroup.tripId
                                      );
                                      setConfirmDeleteUserId(null);
                                    }}
                                    className="px-2 py-0.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-[11px] font-extrabold cursor-pointer"
                                  >
                                    Ja
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteUserId(null)}
                                    className="px-2 py-0.5 rounded-lg bg-white text-slate-600 text-[11px] font-bold border border-slate-200 cursor-pointer"
                                  >
                                    Nee
                                  </button>
                                </div>
                              ) : (
                                <div className="inline-flex items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleStartEditUserRow(u)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 transition cursor-pointer"
                                    title="Wijzig naam, e-mail, rol of betaald bedrag"
                                  >
                                    <Pencil className="w-3.5 h-3.5 text-slate-600" />
                                    <span>Wijzigen</span>
                                  </button>
                                  {!isTargetSuper && u.uid !== currentUserUid && (
                                    <button
                                      type="button"
                                      onClick={() => setConfirmDeleteUserId(u.id)}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 transition cursor-pointer"
                                      title="Verwijder deelnemer uit deze groep"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      <span className="hidden sm:inline">Verwijderen</span>
                                    </button>
                                  )}
                                </div>
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

            {/* Right 1 Column: Nieuwe deelnemer / gebruiker toevoegen aan deze geopende groep */}
            <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 space-y-4 self-start">
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-orange-600 block">
                  Geopende groep: {activeGroup.name}
                </span>
                <h4 className="text-base font-extrabold text-slate-900 flex items-center gap-2 mt-0.5">
                  <UserPlus className="w-4 h-4 text-orange-600" />
                  Deelnemer Toevoegen aan {activeGroup.name}
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Voeg iemand toe met naam, e-mailadres en rol. Bestaat het e-mailadres al in een andere groep? Dan wordt deze persoon aan beide groepen gekoppeld.
                </p>
              </div>

              <form onSubmit={handleInviteSubmit} className="space-y-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Naam deelnemer *
                  </label>
                  <input
                    type="text"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Bijv. Erik, Dirk of Jasper"
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                    E-mailadres *
                  </label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="naam@voorbeeld.nl"
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Rol in {activeGroup.name}
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as UserRole)}
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-xl font-semibold text-slate-800"
                  >
                    <option value="member">Groepslid (member)</option>
                    <option value="group_admin">Groepsbeheerder (group_admin)</option>
                  </select>
                </div>

                {/* Payment status & amount (prepared for payment service) */}
                <div className="pt-1">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                    Betaling (Betaaldienst)
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800 bg-white border border-slate-300 rounded-xl px-3 py-2 cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={inviteHasPaid}
                        onChange={(e) => setInviteHasPaid(e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600"
                      />
                      <span>Reeds betaald</span>
                    </label>
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                        €
                      </span>
                      <input
                        type="number"
                        min="0"
                        max="50000"
                        step="0.01"
                        value={inviteAmountPaid}
                        onChange={(e) => setInviteAmountPaid(e.target.value)}
                        placeholder="Bedrag"
                        className="w-full pl-7 pr-3 py-2 text-sm font-semibold bg-white border border-slate-300 rounded-xl"
                      />
                    </div>
                  </div>
                </div>

                {isSuperAdmin && allGroups.length > 1 && (
                  <div className="pt-1">
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-600 mb-1">
                      Ook direct koppelen aan andere groep(en):
                    </label>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto p-2.5 rounded-xl bg-white border border-slate-200">
                      {allGroups.map((g) => {
                        const isCurrent = g.tripId === activeGroup.tripId;
                        const checked =
                          isCurrent || inviteExtraGroupIds.includes(g.tripId);
                        return (
                          <label
                            key={g.tripId}
                            className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isCurrent}
                              onChange={() => handleToggleInviteExtraGroup(g.tripId)}
                              className="rounded border-slate-300 text-orange-600"
                            />
                            <span>
                              {g.name} {isCurrent ? '(deze groep)' : ''}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {inviteError && (
                  <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-xs font-semibold text-red-700">
                    {inviteError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isInviting}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold bg-[#FC4C02] hover:bg-[#E04300] text-white shadow-xs transition cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                  {isInviting
                    ? 'Toevoegen...'
                    : `Toevoegen aan ${activeGroup.name}`}
                </button>
              </form>
            </div>
          </div>

          {/* 1-Week Post-Vacation Review Reminder Status Box inside Opened Group */}
          <div
            className={`rounded-2xl border p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
              activeGroup.reviewReminderSentAt
                ? 'bg-emerald-50/70 border-emerald-200'
                : activeGroup.chosenHouseId && isActiveReminderDue
                ? 'bg-orange-50 border-orange-300 ring-2 ring-orange-500/15'
                : 'bg-slate-50 border-slate-200'
            }`}
          >
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate-900">
                  <BellRing className="w-4 h-4 text-orange-600 shrink-0" />
                  Automatische Review-Oproep voor {activeGroup.name} (1 week na vakantie)
                </span>
                {activeGroup.reviewReminderSentAt ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-600 text-white">
                    Verzonden op{' '}
                    {new Date(activeGroup.reviewReminderSentAt).toLocaleDateString(
                      'nl-NL',
                      {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      }
                    )}
                  </span>
                ) : !activeGroup.chosenHouseId ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-slate-200 text-slate-700">
                    Wacht op keuze winnend huisje
                  </span>
                ) : isActiveReminderDue ? (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-orange-600 text-white">
                    1 week verstreken — Klaar voor verzending!
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                    Gepland voor {activeReminderDueFormatted || '1 week na einddatum'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600">
                {activeGroup.chosenHouseTitle ? (
                  <>
                    Gekozen huisje: <strong>{activeGroup.chosenHouseTitle}</strong>.{' '}
                    {activeReminderDueFormatted
                      ? `Een week na de einddatum (${activeReminderDueFormatted}) ontvangt de hele groep (${activeGroupMembers.length} leden) een e-mail met de oproep om een review en sterrenbeoordeling te schrijven.`
                      : 'Stel een start- en einddatum in om de herinneringsdatum te berekenen.'}
                  </>
                ) : (
                  'Zodra jullie bij een huisje op "Gekozen & Review" klikken om het winnende huisje vast te leggen, wordt de review-herinneringsmail 1 week na de vakantie klaargezet voor alle leden van deze groep.'
                )}
              </p>
            </div>

            <div className="shrink-0">
              <button
                type="button"
                disabled={!activeGroup.chosenHouseTitle}
                onClick={() => onOpenReviewReminderModal(activeGroup)}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-extrabold bg-slate-900 hover:bg-slate-800 text-white shadow-xs transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Send className="w-3.5 h-3.5" />
                {activeGroup.reviewReminderSentAt
                  ? 'Review-oproep opnieuw mailen'
                  : 'Stuur review-oproep per mail naar groep'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
