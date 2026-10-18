import { HouseRecord } from '../types';
import { INITIAL_HOUSES } from '../data/initialData';

export type NumericInputStatus = 'zero' | 'positive' | 'empty' | 'missing' | 'negative' | 'invalid';

export interface ParsedNumericField {
  valid: boolean;
  value: number | null;
  status: NumericInputStatus;
  error?: string;
}

export const DEMO_HOUSE_IDS = new Set(INITIAL_HOUSES.map((h) => h.id));

/**
 * Resolves the active tripId ('racefiets-2027' for production, 'racefiets-2027-test' for isolated test environment).
 */
export function resolveTripId(searchParams?: string, explicitTestMode?: boolean): 'racefiets-2027' | 'racefiets-2027-test' {
  if (explicitTestMode) {
    return 'racefiets-2027-test';
  }
  if (typeof searchParams === 'string' && searchParams.length > 0) {
    const params = new URLSearchParams(searchParams);
    if (params.get('env') === 'test' || params.get('test') === '1') {
      return 'racefiets-2027-test';
    }
  }
  return 'racefiets-2027';
}

/**
 * Strictly parses bike spots input (0..15).
 * Never replaces a valid 0 with a truthy/falsy fallback like 3 or 2.
 * Distinguishes: 'zero', 'positive', 'empty', 'missing', 'negative', and 'invalid'.
 */
export function parseBikeSpotsInput(raw: string | number | null | undefined): ParsedNumericField {
  if (raw === null || raw === undefined) {
    return {
      valid: false,
      value: null,
      status: 'missing',
      error: 'Aantal fietsen ontbreekt. Vul een getal van 0 t/m 15 in.',
    };
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
      return {
        valid: false,
        value: null,
        status: 'invalid',
        error: 'Voer een geheel getal in voor het aantal fietsen (0 t/m 15).',
      };
    }
    if (raw < 0) {
      return {
        valid: false,
        value: null,
        status: 'negative',
        error: 'Aantal fietsen kan niet negatief zijn (minimaal 0).',
      };
    }
    if (raw > 15) {
      return {
        valid: false,
        value: null,
        status: 'invalid',
        error: 'Aantal fietsen per auto kan maximaal 15 zijn.',
      };
    }
    return {
      valid: true,
      value: raw,
      status: raw === 0 ? 'zero' : 'positive',
    };
  }

  const trimmed = String(raw).trim();
  if (trimmed === '') {
    return {
      valid: false,
      value: null,
      status: 'empty',
      error: 'Vul het aantal fietsen in (0 als er geen fietsen in/op de auto passen).',
    };
  }

  // Reject decimal numbers or scientific notation or non-digits (allow optional leading minus to detect negative)
  if (!/^-?\d+$/.test(trimmed)) {
    return {
      valid: false,
      value: null,
      status: 'invalid',
      error: 'Ongeldige invoer. Gebruik een geheel getal tussen 0 en 15.',
    };
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed)) {
    return {
      valid: false,
      value: null,
      status: 'invalid',
      error: 'Ongeldig getal voor aantal fietsen.',
    };
  }

  if (parsed < 0) {
    return {
      valid: false,
      value: null,
      status: 'negative',
      error: 'Aantal fietsen kan niet negatief zijn (minimaal 0).',
    };
  }

  if (parsed > 15) {
    return {
      valid: false,
      value: null,
      status: 'invalid',
      error: 'Aantal fietsen per auto kan maximaal 15 zijn.',
    };
  }

  return {
    valid: true,
    value: parsed,
    status: parsed === 0 ? 'zero' : 'positive',
  };
}

/**
 * Strictly parses car seats input for a driver (1..9 or 1..15).
 */
export function parseCarSeatsInput(raw: string | number | null | undefined): ParsedNumericField {
  if (raw === null || raw === undefined) {
    return {
      valid: false,
      value: null,
      status: 'missing',
      error: 'Vul het aantal zitplaatsen in (incl. chauffeur, 1 t/m 9).',
    };
  }

  const trimmed = typeof raw === 'number' ? String(raw) : String(raw).trim();
  if (trimmed === '') {
    return {
      valid: false,
      value: null,
      status: 'empty',
      error: 'Vul het aantal zitplaatsen in de auto in (1 t/m 9).',
    };
  }

  if (!/^-?\d+$/.test(trimmed)) {
    return {
      valid: false,
      value: null,
      status: 'invalid',
      error: 'Gebruik een geheel getal voor zitplaatsen (1 t/m 9).',
    };
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < 0) {
    return {
      valid: false,
      value: null,
      status: 'negative',
      error: 'Aantal zitplaatsen kan niet negatief zijn.',
    };
  }
  if (parsed === 0) {
    return {
      valid: false,
      value: null,
      status: 'zero',
      error: 'Een chauffeur heeft minimaal 1 zitplaats (zichzelf) in de auto.',
    };
  }
  if (parsed > 15) {
    return {
      valid: false,
      value: null,
      status: 'invalid',
      error: 'Aantal zitplaatsen kan maximaal 15 zijn.',
    };
  }

  return {
    valid: true,
    value: parsed,
    status: 'positive',
  };
}

/**
 * Normalizes a stored bikeSpots value from Firestore or JSON cache.
 * Preserves 0 explicitly and never uses `val || 3`.
 */
export function normalizeStoredBikeSpots(raw: unknown): number {
  const res = parseBikeSpotsInput(raw as string | number | null | undefined);
  if (res.valid && res.value !== null) {
    return res.value;
  }
  return 0;
}

/**
 * Normalizes a stored carSeats value from Firestore or JSON cache.
 */
export function normalizeStoredCarSeats(raw: unknown, isDriver: boolean): number {
  if (!isDriver) return 0;
  const res = parseCarSeatsInput(raw as string | number | null | undefined);
  if (res.valid && res.value !== null) {
    return res.value;
  }
  return 1;
}

/**
 * Extracts custom (non-demo) houses from legacy localStorage so Hermen's locally added house
 * can be safely migrated to Firestore without ever re-adding the 4 starter example houses
 * or overwriting existing Firestore houses.
 */
export function extractCustomLocalHousesToMigrate(
  rawLocalJson: string | null,
  existingCloudHouses: HouseRecord[]
): HouseRecord[] {
  if (!rawLocalJson) return [];
  try {
    const parsed = JSON.parse(rawLocalJson);
    if (!Array.isArray(parsed)) return [];

    const existingIds = new Set(existingCloudHouses.map((h) => h.id));
    const existingUrls = new Set(existingCloudHouses.map((h) => h.url.trim().toLowerCase()));

    return parsed.filter((h: any): h is HouseRecord => {
      if (!h || typeof h !== 'object' || typeof h.id !== 'string' || typeof h.title !== 'string') {
        return false;
      }
      // Never migrate any of the 4 default demo houses
      if (DEMO_HOUSE_IDS.has(h.id)) {
        return false;
      }
      // Never overwrite an already existing cloud house
      if (existingIds.has(h.id)) {
        return false;
      }
      if (typeof h.url === 'string' && existingUrls.has(h.url.trim().toLowerCase())) {
        return false;
      }
      return true;
    });
  } catch {
    return [];
  }
}
