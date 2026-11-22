# Security Specification (Phase 0: Payload-First Security TDD)

## 1. Data Invariants

1. **Authentication & Verification Invariant**: Every write operation requires an authenticated user (`request.auth != null`) who is verified via Google OAuth (`email_verified == true`) or Firebase Email/Password (`sign_in_provider == 'password'`).
2. **Hierarchical Role & Group Isolation Invariant**:
   - **Super User (`isAdmin()`)**: Strictly `brokelman@gmail.com` (with `email_verified == true`) or UID in `/admins/{uid}`. Can create/manage all groups (`/groups/{groupId}`), view all user accounts (`/user_accounts/{userId}`), assign users to any group, and promote/demote `group_admin`.
   - **Group Administrator (`isGroupAdminOf(groupId)`)**: A user whose `/user_accounts/$(request.auth.uid)` has `role == 'group_admin'` and `groupId == targetGroupId`. Can list and manage `/user_accounts` ONLY where `resource.data.groupId == groupId` (cannot view or modify users of other groups, and cannot assign `role == 'super_admin'`). Can also mark the group's chosen house on `/groups/{groupId}` and publish/update reviews in `/repository_houses/{repoHouseId}`.
   - **Regular Member**: Can read their own `/user_accounts/$(request.auth.uid)` profile and see members within their own group (`resource.data.groupId == currentUserGroupId()`). During self-registration on `/user_accounts/{userId}`, a non-Super-User can only create their own profile with `role == 'member'`.
3. **Central Repository Invariant (`/repository_houses/{repoHouseId}`)**:
   - All authenticated users can browse (`get`, `list`) the central repository of chosen and reviewed houses and copy them to their own group's `/houses` list.
   - Only a verified member/admin of the source group (or Super User) can publish or update a repository review (`ratingStars` 1..5, `reviewText` 2..1200 chars).
4. **Master Gate & Relational Sync**:
   - Subcollections `/houses/{houseId}/votes/{voteId}` and `/houses/{houseId}/comments/{commentId}` require the parent `/houses/{houseId}` document to exist and have `status == 'active'`.
5. **Strict Keys & Anti-Update-Gap**:
   - Every `create` and `update` invokes its entity blueprint (`isValidGroup`, `isValidUserAccount`, `isValidRepositoryHouse`, `isValidHouse`, `isValidHouseVote`, `isValidHouseComment`, `isValidGeneralIdea`, `isValidParticipant`) with strict `hasAll` and `hasOnly` key checks and string/number/boolean bounds.

## 2. The "Dirty Dozen" Payloads

1. **Payload 1 (Identity Spoofing on House Create)**: `ownerId: "victim-uid"` when `request.auth.uid == "attacker-uid"`. -> `PERMISSION_DENIED`
2. **Payload 2 (Self-Assigned Role Escalation)**: Regular user creating `/user_accounts/{uid}` with `role: "super_admin"` or `role: "group_admin"`. -> `PERMISSION_DENIED`
3. **Payload 3 (Cross-Group User Scraping)**: Group Admin of `group-a` querying `/user_accounts` for `group-b`. -> `PERMISSION_DENIED`
4. **Payload 4 (Path Variable Poisoning)**: `houseId` or `groupId` with 200 characters or special characters `house/../admin`. -> `PERMISSION_DENIED`
5. **Payload 5 (Invalid URL Protocol / XSS)**: `url: "javascript:alert(1)"` on House or RepositoryHouse create. -> `PERMISSION_DENIED`
6. **Payload 6 (Value Poisoning on Update)**: Updating `voteScore` on `/houses/{houseId}` with a string `"999999"` or out-of-range number `999999`. -> `PERMISSION_DENIED`
7. **Payload 7 (Terminal State Mutation)**: Updating `notes` on a House where `existing().status == "archived"`. -> `PERMISSION_DENIED`
8. **Payload 8 (Immortal Field Tampering)**: Updating `ownerId` or `createdAt` during an update. -> `PERMISSION_DENIED`
9. **Payload 9 (Orphaned Comment Create)**: Creating a comment under `/houses/non-existent-id/comments/c1` where the parent House does not exist. -> `PERMISSION_DENIED`
10. **Payload 10 (Cross-User Vote Spoofing)**: Creating `/houses/h1/votes/other-user-uid` or setting `userId: "other-user-uid"`. -> `PERMISSION_DENIED`
11. **Payload 11 (Forged Client Timestamp)**: Setting `createdAt` or `updatedAt` to a past/future timestamp instead of `request.time`. -> `PERMISSION_DENIED`
12. **Payload 12 (Out-of-Range Repository Rating)**: Creating a `/repository_houses` review with `ratingStars: 10` or empty `reviewText`. -> `PERMISSION_DENIED`
