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
export type FacilityFilter = 'alle' | 'bbq' | 'openhaard' | 'jacuzzi' | 'sauna';
