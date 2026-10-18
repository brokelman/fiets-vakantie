# Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants

1. **Authentication & Verification Invariant**: Every read and write operation requires an authenticated user (`request.auth != null`) with a verified email (`request.auth.token.email_verified == true`).
2. **Master Gate & Relational Sync**:
   - Subcollections `/houses/{houseId}/votes/{voteId}` and `/houses/{houseId}/comments/{commentId}` require the parent `/houses/{houseId}` document to exist and have `status == 'active'`.
   - For votes, `voteId` must strictly equal `request.auth.uid` and `incoming().userId == request.auth.uid`, plus `incoming().houseId == houseId`.
   - For comments, `incoming().authorId == request.auth.uid` and `incoming().houseId == houseId`.
3. **Strict Keys & Anti-Update-Gap**:
   - Every `create` and `update` invokes `isValidHouse`, `isValidHouseVote`, `isValidHouseComment`, or `isValidGeneralIdea` with `hasAll` and `hasOnly` key checks and strict string/number/boolean bounds.
4. **Path Variable Hardening**:
   - Single-document operations (`get`, `create`, `update`, `delete`) validate path IDs (`houseId`, `voteId`, `commentId`, `ideaId`) via `isValidId(id)` matching `^[a-zA-Z0-9_\-]+$` and `.size() <= 128`.
5. **Terminal State Locking**:
   - Once a `House` reaches `status == 'archived'` or a `GeneralIdea` reaches `status == 'resolved'`, non-admin updates are blocked.
6. **Temporal & Identity Immutability**:
   - `createdAt` must equal `request.time` on `create` and remain immutable (`incoming().createdAt == existing().createdAt`) on `update`.
   - `updatedAt` must equal `request.time` on `create` and `update`.
   - `ownerId` / `authorId` / `userId` / `tripId` / `houseId` are immutable on `update`.
7. **Secure List Queries**:
   - `allow list` on `/houses/{houseId}` enforces `resource.data.tripId == 'racefiets-2027'`.
   - `allow list` on `/ideas/{ideaId}` enforces `resource.data.tripId == 'racefiets-2027'`.
   - `allow list` on `/houses/{houseId}/votes/{voteId}` and `/houses/{houseId}/comments/{commentId}` enforces `resource.data.houseId == houseId`.

## 2. The "Dirty Dozen" Payloads

1. **Payload 1 (Identity Spoofing on House Create)**: `ownerId: "victim-uid"` when `request.auth.uid == "attacker-uid"`. -> `PERMISSION_DENIED`
2. **Payload 2 (Unverified Email Write)**: `request.auth.token.email_verified == false` attempting to create a House. -> `PERMISSION_DENIED`
3. **Payload 3 (Shadow Field Injection on House Create)**: Includes required fields plus `"isFeatured": true`. -> `PERMISSION_DENIED`
4. **Payload 4 (Path Variable Poisoning)**: `houseId` with 200 characters or special characters `house/../admin`. -> `PERMISSION_DENIED`
5. **Payload 5 (Invalid URL Protocol / XSS)**: `url: "javascript:alert(1)"` on House create. -> `PERMISSION_DENIED`
6. **Payload 6 (Value Poisoning on Update)**: Updating `voteScore` on `/houses/{houseId}` with a string `"999999"` or out-of-range number `999999`. -> `PERMISSION_DENIED`
7. **Payload 7 (Terminal State Mutation)**: Updating `notes` on a House where `existing().status == "archived"`. -> `PERMISSION_DENIED`
8. **Payload 8 (Immortal Field Tampering)**: Updating `ownerId` or `createdAt` during a House update. -> `PERMISSION_DENIED`
9. **Payload 9 (Orphaned Comment Create)**: Creating a comment under `/houses/non-existent-id/comments/c1` where the parent House does not exist. -> `PERMISSION_DENIED`
10. **Payload 10 (Cross-User Vote Spoofing)**: Creating `/houses/h1/votes/other-user-uid` or setting `userId: "other-user-uid"`. -> `PERMISSION_DENIED`
11. **Payload 11 (Forged Client Timestamp)**: Setting `createdAt` or `updatedAt` to a past/future timestamp instead of `request.time`. -> `PERMISSION_DENIED`
12. **Payload 12 (Unbounded String DoS)**: Setting `notes` to a 5,000-character string exceeding `maxLength: 1000`. -> `PERMISSION_DENIED`
