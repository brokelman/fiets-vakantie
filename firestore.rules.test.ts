/**
 * Firestore Security Rules Test Specification (Dirty Dozen Verification)
 * Verifies that all 12 adversarial payloads in security_spec.md return PERMISSION_DENIED.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  collectionPath: string;
  operation: 'create' | 'update' | 'delete' | 'get' | 'list';
  auth: { uid: string; email: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expectedResult: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Identity Spoofing on House Create',
    collectionPath: '/houses/house-1',
    operation: 'create',
    auth: { uid: 'attacker-uid', email: 'attacker@example.com', email_verified: true },
    payload: { ownerId: 'victim-uid', tripId: 'racefiets-2027' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Write',
    collectionPath: '/houses/house-1',
    operation: 'create',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: false },
    payload: { ownerId: 'user-1', tripId: 'racefiets-2027' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Shadow Field Injection on House Create',
    collectionPath: '/houses/house-1',
    operation: 'create',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { ownerId: 'user-1', tripId: 'racefiets-2027', isVerifiedAdmin: true },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Path Variable Poisoning',
    collectionPath: '/houses/invalid$id!with*bad*chars',
    operation: 'create',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { ownerId: 'user-1', tripId: 'racefiets-2027' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Invalid URL Protocol / XSS',
    collectionPath: '/houses/house-1',
    operation: 'create',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { ownerId: 'user-1', tripId: 'racefiets-2027', url: 'javascript:alert(1)' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Value Poisoning on Update',
    collectionPath: '/houses/house-1',
    operation: 'update',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { voteScore: '999999' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Terminal State Mutation on Archived House',
    collectionPath: '/houses/house-archived',
    operation: 'update',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { notes: 'Mutating archived house' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Immortal Field Tampering (ownerId / createdAt)',
    collectionPath: '/houses/house-1',
    operation: 'update',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { ownerId: 'new-owner' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Orphaned Comment Create on Non-Existent House',
    collectionPath: '/houses/missing-house/comments/comment-1',
    operation: 'create',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { houseId: 'missing-house', authorId: 'user-1', authorName: 'Jan', text: 'Hallo' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Cross-User Vote Spoofing',
    collectionPath: '/houses/house-1/votes/victim-uid',
    operation: 'create',
    auth: { uid: 'attacker-uid', email: 'attacker@example.com', email_verified: true },
    payload: { houseId: 'house-1', userId: 'victim-uid', voterName: 'Victim', value: 5 },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Forged Client Timestamp',
    collectionPath: '/ideas/idea-1',
    operation: 'create',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { tripId: 'racefiets-2027', authorId: 'user-1', createdAt: '2020-01-01T00:00:00Z' },
    expectedResult: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Unbounded String DoS on Notes',
    collectionPath: '/houses/house-1',
    operation: 'create',
    auth: { uid: 'user-1', email: 'user1@example.com', email_verified: true },
    payload: { notes: 'A'.repeat(5000) },
    expectedResult: 'PERMISSION_DENIED',
  },
];
