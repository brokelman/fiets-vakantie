export type UserRole = 'super_admin' | 'group_admin' | 'member';

export interface GroupRecord {
  id: string;
  tripId: string;
  name: string;
  periodLabel: string;
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  reviewReminderSentAt?: string;
  regionLabel: string;
  chosenHouseId: string;
  chosenHouseTitle: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserAccountRecord {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  groupId: string;
  groupIds: string[];
  role: UserRole;
  hasPaid?: boolean;
  amountPaid?: number;
  createdAt: string;
  updatedAt: string;
}

export interface RepositoryHouseRecord {
  id: string;
  sourceHouseId: string;
  sourceGroupId: string;
  sourceGroupName: string;
  isChosen?: boolean;
  title: string;
  url: string;
  photoUrl: string;
  locationName: string;
  lat: number;
  lng: number;
  totalPrice: number;
  bedrooms: number;
  bathrooms: number;
  hasBbq: boolean;
  hasFireplace: boolean;
  hasJacuzzi: boolean;
  hasSauna: boolean;
  routeUrl: string;
  notes: string;
  ratingStars: number; // 1..5
  reviewText: string;
  reviewerName: string;
  reviewerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface HouseVoteRecord {
  id: string;
  houseId: string;
  userId: string;
  voterName: string;
  value: number; // -1 or 1..5
  createdAt: string;
  updatedAt: string;
}

export interface HouseCommentRecord {
  id: string;
  houseId: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string;
}

export interface HouseRecord {
  id: string;
  tripId: string;
  ownerId: string;
  title: string;
  url: string;
  photoUrl: string;
  locationName: string;
  lat: number;
  lng: number;
  totalPrice: number;
  bedrooms: number;
  bathrooms: number;
  hasBbq: boolean;
  hasFireplace: boolean;
  hasJacuzzi: boolean;
  hasSauna: boolean;
  isShortlisted?: boolean;
  routeUrl: string;
  notes: string;
  addedBy: string;
  voteScore: number;
  voteCount: number;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  votes?: HouseVoteRecord[];
  comments?: HouseCommentRecord[];
}

export interface GeneralIdeaRecord {
  id: string;
  tripId: string;
  authorId: string;
  authorName: string;
  category: 'regio' | 'route' | 'logistiek' | 'overig';
  text: string;
  likesCount: number;
  status: 'open' | 'resolved';
  createdAt: string;
  updatedAt: string;
}

export interface ParticipantRecord {
  id: string;
  tripId: string;
  ownerId: string;
  name: string;
  isDriver: boolean;
  carSeats: number;
  bikeSpots: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type SortOption = 'populariteit' | 'prijs_oplopend' | 'slaapkamers';
export type RepoSortOption =
  | 'rating_desc'
  | 'prijs_oplopend'
  | 'prijs_aflopend'
  | 'slaapkamers_desc'
  | 'nieuwste';
export type FacilityFilter = 'alle' | 'bbq' | 'openhaard' | 'jacuzzi' | 'sauna';
export type VoteFilter = 'alle' | 'nog_niet_beoordeeld' | 'wel_beoordeeld';
