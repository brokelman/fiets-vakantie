import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_FILE_PATH = path.join(__dirname, 'central-group-data.json');

interface StoredGroupState {
  houses: any[];
  participants: any[];
  ideas: any[];
  cyclistCount: number;
  updatedAt: string;
}

const DEFAULT_PARTICIPANTS = [
  {
    id: 'deelnemer-daan',
    tripId: 'racefiets-2027',
    ownerId: 'group-member',
    name: 'Daan',
    isDriver: true,
    carSeats: 3,
    bikeSpots: 3,
    notes: 'Stationwagen met Thule drager (3 fietsen op trekhaak)',
    createdAt: '2026-10-16T09:00:00.000Z',
    updatedAt: '2026-10-16T09:00:00.000Z',
  },
  {
    id: 'deelnemer-jasper',
    tripId: 'racefiets-2027',
    ownerId: 'group-member',
    name: 'Jasper',
    isDriver: true,
    carSeats: 3,
    bikeSpots: 3,
    notes: 'Rijdt vanaf Utrecht, drager voor 2 fietsen + 1 fiets achterin',
    createdAt: '2026-10-16T09:15:00.000Z',
    updatedAt: '2026-10-16T09:15:00.000Z',
  },
];

const DEFAULT_IDEAS = [
  {
    id: 'idea-koninginnerit-zaterdag',
    tripId: 'racefiets-2027',
    authorId: 'group-member',
    authorName: 'Thomas',
    category: 'route',
    text: 'Zaterdag koninginnerit van 135 km met minimaal 2.400 hoogtemeters plannen, en op vrijdag een snelle opwarmer van 75 km.',
    likesCount: 6,
    status: 'open',
    createdAt: '2026-10-15T20:00:00.000Z',
    updatedAt: '2026-10-16T19:00:00.000Z',
  },
];

function loadState(): StoredGroupState {
  try {
    if (fs.existsSync(DATA_FILE_PATH)) {
      const raw = fs.readFileSync(DATA_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      return {
        houses: Array.isArray(parsed.houses) ? parsed.houses : [],
        participants: Array.isArray(parsed.participants) ? parsed.participants : DEFAULT_PARTICIPANTS,
        ideas: Array.isArray(parsed.ideas) ? parsed.ideas : DEFAULT_IDEAS,
        cyclistCount: typeof parsed.cyclistCount === 'number' ? parsed.cyclistCount : 8,
        updatedAt: parsed.updatedAt || new Date().toISOString(),
      };
    }
  } catch (err) {
    console.error('Error loading central group state:', err);
  }

  // IMPORTANT: Start with an empty houses list so deleted default houses NEVER reappear for other users like Erik!
  const initialState: StoredGroupState = {
    houses: [],
    participants: DEFAULT_PARTICIPANTS,
    ideas: DEFAULT_IDEAS,
    cyclistCount: 8,
    updatedAt: new Date().toISOString(),
  };
  saveState(initialState);
  return initialState;
}

function saveState(state: StoredGroupState): void {
  try {
    fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving central group state:', err);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '2mb' }));

  // GET central shared state for all group members
  app.get('/api/group-state', (_req, res) => {
    const state = loadState();
    res.json(state);
  });

  // POST/PUT update houses in central shared state
  app.post('/api/group-state/houses', (req, res) => {
    const state = loadState();
    if (Array.isArray(req.body.houses)) {
      state.houses = req.body.houses;
      state.updatedAt = new Date().toISOString();
      saveState(state);
    }
    res.json(state);
  });

  // POST/PUT update participants in central shared state
  app.post('/api/group-state/participants', (req, res) => {
    const state = loadState();
    if (Array.isArray(req.body.participants)) {
      state.participants = req.body.participants;
      state.updatedAt = new Date().toISOString();
      saveState(state);
    }
    res.json(state);
  });

  // POST/PUT update ideas in central shared state
  app.post('/api/group-state/ideas', (req, res) => {
    const state = loadState();
    if (Array.isArray(req.body.ideas)) {
      state.ideas = req.body.ideas;
      state.updatedAt = new Date().toISOString();
      saveState(state);
    }
    res.json(state);
  });

  // POST rescue/merge custom houses from a client's browser localStorage without re-adding demo houses
  app.post('/api/group-state/rescue-custom', (req, res) => {
    const state = loadState();
    const customHouses = Array.isArray(req.body.customHouses) ? req.body.customHouses : [];
    const existingIds = new Set(state.houses.map((h: any) => h.id));

    let changed = false;
    for (const h of customHouses) {
      if (h && h.id && !existingIds.has(h.id)) {
        state.houses.unshift(h);
        existingIds.add(h.id);
        changed = true;
      }
    }

    if (changed) {
      state.updatedAt = new Date().toISOString();
      saveState(state);
    }
    res.json(state);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
