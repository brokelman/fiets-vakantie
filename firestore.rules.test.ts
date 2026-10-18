import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeApp } from 'firebase/app';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  extractCustomLocalHousesToMigrate,
  normalizeStoredBikeSpots,
  normalizeStoredCarSeats,
  parseBikeSpotsInput,
  parseCarSeatsInput,
  resolveTripId,
} from './src/utils/validation';
import { classifyAuthError } from './src/firebase';
import { INITIAL_HOUSES } from './src/data/initialData';

async function runAcceptanceTests() {
  console.log('=== 1. FIETSENINVOER & PARSING ACCEPTATIETESTS ===');

  // Test 0 (number and string) -> must stay 0, NEVER 3!
  const zeroNum = parseBikeSpotsInput(0);
  assert.equal(zeroNum.valid, true);
  assert.equal(zeroNum.value, 0);
  assert.equal(zeroNum.status, 'zero');

  const zeroStr = parseBikeSpotsInput('0');
  assert.equal(zeroStr.valid, true);
  assert.equal(zeroStr.value, 0);
  assert.equal(zeroStr.status, 'zero');

  assert.equal(normalizeStoredBikeSpots(0), 0);
  assert.equal(normalizeStoredBikeSpots('0'), 0);

  // Test 1 and 3
  const oneStr = parseBikeSpotsInput('1');
  assert.equal(oneStr.valid, true);
  assert.equal(oneStr.value, 1);
  assert.equal(oneStr.status, 'positive');

  const threeStr = parseBikeSpotsInput('3');
  assert.equal(threeStr.valid, true);
  assert.equal(threeStr.value, 3);
  assert.equal(threeStr.status, 'positive');

  // Test empty ("", "   ")
  const emptyStr = parseBikeSpotsInput('');
  assert.equal(emptyStr.valid, false);
  assert.equal(emptyStr.value, null);
  assert.equal(emptyStr.status, 'empty');

  const spacesStr = parseBikeSpotsInput('   ');
  assert.equal(spacesStr.valid, false);
  assert.equal(spacesStr.value, null);
  assert.equal(spacesStr.status, 'empty');

  // Test missing (null, undefined)
  const missingNull = parseBikeSpotsInput(null);
  assert.equal(missingNull.valid, false);
  assert.equal(missingNull.value, null);
  assert.equal(missingNull.status, 'missing');

  const missingUndef = parseBikeSpotsInput(undefined);
  assert.equal(missingUndef.valid, false);
  assert.equal(missingUndef.value, null);
  assert.equal(missingUndef.status, 'missing');

  // Test negative (-1, "-3")
  const negNum = parseBikeSpotsInput(-1);
  assert.equal(negNum.valid, false);
  assert.equal(negNum.value, null);
  assert.equal(negNum.status, 'negative');

  const negStr = parseBikeSpotsInput('-3');
  assert.equal(negStr.valid, false);
  assert.equal(negStr.value, null);
  assert.equal(negStr.status, 'negative');

  // Test invalid ("abc", "2.5", "20", NaN)
  for (const bad of ['abc', '2.5', '20', NaN]) {
    const res = parseBikeSpotsInput(bad as any);
    assert.equal(res.valid, false, `Expected invalid for ${String(bad)}`);
    assert.equal(res.value, null);
    assert.equal(res.status, 'invalid');
  }

  // Test car seats parser
  assert.equal(parseCarSeatsInput('3').value, 3);
  assert.equal(parseCarSeatsInput('0').valid, false);
  assert.equal(normalizeStoredCarSeats(4, true), 4);
  assert.equal(normalizeStoredCarSeats(4, false), 0);

  console.log('✓ Alle fietseninvoer-tests (0, 1, 3, leeg, ontbrekend, negatief, ongeldig) GESLAAGD.');

  console.log('\n=== 2. GEDEELDE HUISJESLIJST & MIGRATIE-FILTER TESTS ===');
  const customHouse = {
    ...INITIAL_HOUSES[0],
    id: 'huis-hermen-ardennen-custom',
    title: 'Villa Hermen Ardennen Test',
    url: 'https://www.airbnb.nl/rooms/99999999',
  };
  const legacyPayload = JSON.stringify([...INITIAL_HOUSES, customHouse]);
  const toMigrate = extractCustomLocalHousesToMigrate(legacyPayload, []);
  assert.equal(toMigrate.length, 1, 'Alleen het eigen huisje van Hermen mag gemigreerd worden, geen van de 4 voorbeeldhuisjes');
  assert.equal(toMigrate[0].id, 'huis-hermen-ardennen-custom');

  // If already in cloudHouses, do not duplicate or overwrite
  const toMigrateWhenAlreadyInCloud = extractCustomLocalHousesToMigrate(legacyPayload, [customHouse]);
  assert.equal(toMigrateWhenAlreadyInCloud.length, 0);

  // Environment resolver test
  assert.equal(resolveTripId(''), 'racefiets-2027');
  assert.equal(resolveTripId('?env=test'), 'racefiets-2027-test');
  assert.equal(resolveTripId('', true), 'racefiets-2027-test');
  console.log('✓ Migratie-filter (geen terugkerende voorbeeldhuisjes) en testomgeving-isolatie GESLAAGD.');

  console.log('\n=== 3. AUTHENTICATIE FOUTCLASSIFICATIE TESTS ===');
  const unauthErr = classifyAuthError(new Error('Firebase: Error (auth/unauthorized-domain).'), 'Google');
  assert.equal(unauthErr.code, 'unauthorized-domain');
  const closedErr = classifyAuthError(new Error('Firebase: Error (auth/popup-closed-by-user).'), 'Google');
  assert.equal(closedErr.code, 'popup-closed');
  const blockedErr = classifyAuthError(new Error('Firebase: Error (auth/popup-blocked).'), 'Google');
  assert.equal(blockedErr.code, 'popup-blocked');
  console.log('✓ Authenticatie foutafhandeling (unauthorized-domain, popup-closed, popup-blocked) GESLAAGD.');

  console.log('\n=== 4. LIVE FIRESTORE BEVEILIGINGS- EN ISOLATIETEST (racefiets-2027-test) ===');
  const cfg = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
  const app = initializeApp(cfg, 'test-runner');
  const db = getFirestore(app, cfg.firestoreDatabaseId);

  // 4A. Read in isolated test environment ('racefiets-2027-test') works for read-only viewer
  const housesSnap = await getDocs(
    query(collection(db, 'houses'), where('tripId', '==', 'racefiets-2027-test'))
  );
  assert.equal(Array.isArray(housesSnap.docs), true);
  console.log(`✓ Alleen-lezen query op racefiets-2027-test geslaagd (${housesSnap.size} docs).`);

  // 4B. Unauthenticated guest write to houses MUST be rejected with permission-denied
  let guestWriteBlocked = false;
  try {
    await setDoc(doc(db, 'houses', 'test-unauthorized-guest-house'), {
      tripId: 'racefiets-2027-test',
      ownerId: 'fake-guest-uid',
      title: 'Illegaal Gast Huisje',
      url: 'https://example.com/huis',
      photoUrl: '',
      locationName: 'Ardennen',
      lat: 50.2,
      lng: 5.7,
      totalPrice: 1200,
      bedrooms: 4,
      bathrooms: 2,
      hasBbq: true,
      hasFireplace: false,
      hasJacuzzi: false,
      hasSauna: false,
      routeUrl: '',
      notes: '',
      addedBy: 'Gast',
      voteScore: 5,
      voteCount: 1,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err: any) {
    if (err?.code === 'permission-denied' || String(err).includes('permission-denied')) {
      guestWriteBlocked = true;
    }
  }
  assert.equal(guestWriteBlocked, true, 'Onbevestigde gast mag GEEN huisje aanmaken in Firestore');
  console.log('✓ Onbevestigde gast-schrijfactie op /houses correct geblokkeerd door firestore.rules (PERMISSION_DENIED).');

  // 4C. Unauthenticated guest write to participants MUST be rejected with permission-denied
  let guestParticipantBlocked = false;
  try {
    await setDoc(doc(db, 'participants', 'test-unauthorized-guest-participant'), {
      tripId: 'racefiets-2027-test',
      ownerId: 'fake-guest-uid',
      name: 'Nep Deelnemer',
      isDriver: true,
      carSeats: 3,
      bikeSpots: 0,
      notes: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err: any) {
    if (err?.code === 'permission-denied' || String(err).includes('permission-denied')) {
      guestParticipantBlocked = true;
    }
  }
  assert.equal(guestParticipantBlocked, true, 'Onbevestigde gast mag GEEN deelnemer aanmaken in Firestore');
  console.log('✓ Onbevestigde gast-schrijfactie op /participants correct geblokkeerd door firestore.rules (PERMISSION_DENIED).');

  // 4D. Unauthenticated guest delete MUST be rejected with permission-denied
  let guestDeleteBlocked = false;
  try {
    await deleteDoc(doc(db, 'houses', 'non-existent-house'));
  } catch (err: any) {
    if (err?.code === 'permission-denied' || String(err).includes('permission-denied')) {
      guestDeleteBlocked = true;
    }
  }
  assert.equal(guestDeleteBlocked, true, 'Onbevestigde gast mag GEEN huisje verwijderen in Firestore');
  console.log('✓ Onbevestigde gast-verwijderactie correct geblokkeerd door firestore.rules (PERMISSION_DENIED).');

  console.log('\nALLE GEAUTOMATISEERDE ACCEPTATIETESTS ZIJN GESLAAGD.');
  process.exit(0);
}

runAcceptanceTests().catch((err) => {
  console.error('Acceptatietest mislukt:', err);
  process.exit(1);
});
