import React, { useState, useEffect, useRef } from 'react';
import {
  Play, Square, Trophy, Activity, AlertTriangle, FastForward, User, Filter,
  Sparkles, Loader2, Flag, Plus, Timer, Swords, Crown, ArrowLeft, FlaskConical, Gauge,
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  getFirestore, collection, addDoc, onSnapshot, serverTimestamp, doc, setDoc,
  getDoc, updateDoc, deleteDoc, increment,
} from 'firebase/firestore';



// --- Firebase: in der echten App durch eigene Werte ersetzen ---
const firebaseConfig =
   {
        // TODO: Eigene Werte aus der Firebase Console eintragen:
        apiKey: "AIzaSyAkwVHsxUnzw4PF2eMK6a-JT17oLauCtyI",
        authDomain: "track-rank-b7568.firebaseapp.com",
        projectId: "track-rank-b7568",
        storageBucket: "track-rank-b7568.firebasestorage.app",
        messagingSenderId: "312261225586",
        appId: "1:312261225586:web:898c7bad9b984d358666eb"
      };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'track-rank-v2';

// KI-Backend (eigene Cloud Function, hält den Schlüssel serverseitig)
const AI_BACKEND_URL = '/api/aiCoach';

// Cars-API-Backend (Proxy zu API Ninjas, hält den Schlüssel serverseitig)
const CARS_BACKEND_URL = '/api/cars';

// Ruft einen Cars-API-Endpunkt über das eigene Backend auf
async function fetchCarsApi(endpoint, params = {}) {
  const clean = {};
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== '') clean[k] = v; });
  const qs = new URLSearchParams({ endpoint, ...clean }).toString();
  const res = await fetch(`${CARS_BACKEND_URL}?${qs}`);
  let body = null;
  try { body = await res.json(); } catch {}
  if (!res.ok) {
    const apiMsg = body && body.error ? body.error : `HTTP ${res.status}`;
    let msg = `Fehler ${res.status}: ${apiMsg}`;
    if (res.status === 402 || res.status === 403) {
      msg = `Kein Zugriff (${res.status}): ${apiMsg} – dieser Endpunkt braucht vermutlich einen kostenpflichtigen API-Ninjas-Plan.`;
    } else if (res.status === 401) {
      msg = `Schlüssel ungültig oder fehlt (401): bitte API_NINJAS_KEY in Vercel prüfen.`;
    }
    throw new Error(msg);
  }
  return body;
}

// Erste Zahl aus einem Spec-Wert ziehen (z.B. "14.6 s" -> 14.6, "185 km/h" -> 185)
const numFromSpec = (s) => {
  if (s == null) return null;
  const m = String(s).replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};

// Passendes Emoji aus Karosserie/Kraftstoff ableiten (API liefert kein Icon)
function pickCarIcon(spec = {}, serie = '') {
  const fuel = String(spec['Engine type'] || spec['Fuel'] || '').toLowerCase();
  const body = String(spec['Body type'] || serie || '').toLowerCase();
  if (fuel.includes('electric') || fuel.includes('elektro')) return '⚡';
  if (body.includes('suv') || body.includes('crossover') || body.includes('off-road')) return '🚙';
  if (body.includes('coupe') || body.includes('roadster') || body.includes('cabrio') || body.includes('convertible')) return '🏎️';
  if (body.includes('wagon') || body.includes('avant') || body.includes('estate') || body.includes('kombi')) return '🚐';
  if (body.includes('pickup') || body.includes('truck')) return '🛻';
  if (body.includes('van') || body.includes('minivan')) return '🚐';
  return '🚗';
}

// Hervorgehobene Spec-Felder fürs Profil: [API-Schlüssel, deutsches Label]
const SPEC_HIGHLIGHTS = [
  ['Max speed', 'Höchstgeschw.'],
  ['Engine power', 'Leistung'],
  ['Acceleration (0-100 km/h)', '0–100 km/h'],
  ['Maximum torque', 'Drehmoment'],
  ['Engine type', 'Kraftstoff'],
  ['Capacity', 'Hubraum'],
  ['Number of cylinders', 'Zylinder'],
  ['Drive wheels', 'Antrieb'],
  ['Gearbox type', 'Getriebe'],
  ['Curb weight', 'Leergewicht'],
];

// Reihenfolge/Labels für die vollständige Spec-Liste
const SPEC_LABELS = {
  'Max speed': 'Höchstgeschwindigkeit',
  'Engine power': 'Motorleistung',
  'Max power at RPM': 'Leistung bei Drehzahl',
  'Maximum torque': 'Max. Drehmoment',
  'Turnover of maximum torque': 'Drehmoment bei Drehzahl',
  'Acceleration (0-100 km/h)': 'Beschleunigung 0–100 km/h',
  'Engine type': 'Kraftstoffart',
  'Fuel': 'Kraftstoff (Oktan)',
  'Injection type': 'Einspritzung',
  'Capacity': 'Hubraum',
  'Number of cylinders': 'Anzahl Zylinder',
  'Cylinder layout': 'Zylinderanordnung',
  'Valves per cylinder': 'Ventile pro Zylinder',
  'Cylinder bore': 'Bohrung',
  'Stroke cycle': 'Hub',
  'Drive wheels': 'Antrieb',
  'Gearbox type': 'Getriebeart',
  'Number of gear': 'Anzahl Gänge',
  'Curb weight': 'Leergewicht',
  'Full weight': 'Zul. Gesamtgewicht',
  'Payload': 'Zuladung',
  'Length': 'Länge',
  'Width': 'Breite',
  'Height': 'Höhe',
  'Wheelbase': 'Radstand',
  'Ground clearance': 'Bodenfreiheit',
  'Front track': 'Spurweite vorn',
  'Rear track': 'Spurweite hinten',
  'Turning circle': 'Wendekreis',
  'Front brakes': 'Bremsen vorn',
  'Rear brakes': 'Bremsen hinten',
  'Front suspension': 'Fahrwerk vorn',
  'Back suspension': 'Fahrwerk hinten',
  'Body type': 'Karosserie',
  'Number of seater': 'Sitzplätze',
  'Fuel tank capacity': 'Tankvolumen',
  'City driving fuel consumption per 100 km': 'Verbrauch Stadt',
  'Highway driving fuel consumption per 100 km': 'Verbrauch Autobahn',
  'Mixed driving fuel consumption per 100 km': 'Verbrauch kombiniert',
  'Cruising range': 'Reichweite',
  'Min trunk capacity': 'Kofferraum (min)',
  'Max trunk capacity': 'Kofferraum (max)',
};

// Aus make/model/trim/specs ein App-Auto-Objekt bauen (kompatibel zur restlichen App)
function buildCarObject(make, model, trim, specifications = {}, serie = '') {
  return {
    id: `${make}|${model}|${trim}`.toLowerCase(),
    make,
    model,
    trim,
    serie,
    icon: pickCarIcon(specifications, serie),
    factory0to100: numFromSpec(specifications['Acceleration (0-100 km/h)']),
    specs: specifications,
    dataMode: 'full',
  };
}

// === Cars-API-MODUS =========================================================
// 'demo' = eingebaute Beispielautos, KEINE API nötig (immer kostenlos, zum Testen)
// 'free' = kostenloser, veralteter /v1/cars-Endpunkt (wenige Daten; API Ninjas
//          schränkt diesen Endpunkt inzwischen ein -> kann eine Fehlermeldung geben)
// 'full' = make -> model -> trim -> cardetails (volle Daten, Business-Plan nötig)
//
// >>> ZUM WECHSELN: einfach diese eine Zeile ändern und neu laden. <<<
const CARS_API_MODE = 'free';

// --- Helfer für den kostenlosen Modus (/v1/cars liefert MPG-Stil-Daten) ---
const mpgToL100 = (mpg) => (mpg ? Math.round((235.215 / mpg) * 10) / 10 : null);
const FUEL_DE = { gas: 'Benzin', diesel: 'Diesel', electricity: 'Elektro' };
const DRIVE_DE = { fwd: 'Frontantrieb', rwd: 'Heckantrieb', awd: 'Allrad', '4wd': 'Allrad' };
const TRANS_DE = { a: 'Automatik', m: 'Schaltgetriebe' };

function pickFreeIcon(d = {}) {
  const fuel = String(d.fuel_type || '').toLowerCase();
  const cls = String(d.class || '').toLowerCase();
  if (fuel.includes('electric')) return '⚡';
  if (cls.includes('sport utility') || cls.includes('suv')) return '🚙';
  if (cls.includes('pickup') || cls.includes('truck')) return '🛻';
  if (cls.includes('van') || cls.includes('minivan')) return '🚐';
  if (cls.includes('two seater') || cls.includes('sport')) return '🏎️';
  return '🚗';
}

function buildFreeCarObject(d) {
  const liters = d.displacement != null ? `${d.displacement} l` : null;
  const specs = {};
  if (d.class) specs['Klasse'] = d.class;
  if (liters) specs['Hubraum'] = liters;
  if (d.cylinders != null) specs['Zylinder'] = `${d.cylinders}`;
  if (d.drive) specs['Antrieb'] = DRIVE_DE[d.drive] || d.drive;
  if (d.transmission) specs['Getriebe'] = TRANS_DE[d.transmission] || d.transmission;
  if (d.fuel_type) specs['Kraftstoff'] = FUEL_DE[d.fuel_type] || d.fuel_type;
  if (d.combination_mpg) specs['Verbrauch komb.'] = `${mpgToL100(d.combination_mpg)} l/100km`;
  if (d.city_mpg) specs['Verbrauch Stadt'] = `${mpgToL100(d.city_mpg)} l/100km`;
  if (d.highway_mpg) specs['Verbrauch Autobahn'] = `${mpgToL100(d.highway_mpg)} l/100km`;
  if (d.year) specs['Baujahr'] = `${d.year}`;
  const trimParts = [d.year, liters, d.transmission ? TRANS_DE[d.transmission] : null].filter(Boolean);
  return {
    id: `${d.make}|${d.model}|${d.year}|${d.cylinders}|${d.transmission}|${d.drive}`.toLowerCase(),
    make: d.make,
    model: d.model,
    trim: trimParts.join(' · '),
    icon: pickFreeIcon(d),
    factory0to100: null,
    specs,
    dataMode: 'free',
  };
}

// --- Demo-Modus: eingebaute Beispielautos (keine API nötig) ---
function demoCar(make, model, trim, d) {
  const specs = {
    'Max speed': `${d.speed} km/h`,
    'Engine power': `${d.hp} hp`,
    'Acceleration (0-100 km/h)': `${d.accel} s`,
    'Maximum torque': `${d.torque} N*m`,
    'Engine type': d.fuel,
    'Capacity': d.cc ? `${d.cc} cm3` : '–',
    'Number of cylinders': d.cyl ? `${d.cyl}` : '–',
    'Drive wheels': d.drive,
    'Gearbox type': d.gear,
    'Curb weight': `${d.weight} kg`,
  };
  return buildCarObject(make, model, trim, specs, '');
}

const DEMO_CARS = [
  demoCar('Volkswagen', 'Golf GTI', '2.0 TSI (245 hp)', { speed: 250, hp: 245, accel: 6.2, torque: 370, fuel: 'Gasoline', cc: 1984, cyl: 4, drive: 'Front wheel drive', gear: 'Automatic', weight: 1486 }),
  demoCar('BMW', 'M3 Competition', '3.0 (510 hp)', { speed: 290, hp: 510, accel: 3.5, torque: 650, fuel: 'Gasoline', cc: 2993, cyl: 6, drive: 'All wheel drive', gear: 'Automatic', weight: 1730 }),
  demoCar('Mercedes-Benz', 'A 45 S AMG', '2.0 (421 hp)', { speed: 270, hp: 421, accel: 3.9, torque: 500, fuel: 'Gasoline', cc: 1991, cyl: 4, drive: 'All wheel drive', gear: 'Automatic', weight: 1550 }),
  demoCar('Audi', 'RS6 Avant', '4.0 V8 (600 hp)', { speed: 305, hp: 600, accel: 3.6, torque: 800, fuel: 'Gasoline', cc: 3996, cyl: 8, drive: 'All wheel drive', gear: 'Automatic', weight: 2075 }),
  demoCar('Porsche', '911 Turbo S', '3.8 (650 hp)', { speed: 330, hp: 650, accel: 2.7, torque: 800, fuel: 'Gasoline', cc: 3745, cyl: 6, drive: 'All wheel drive', gear: 'Automatic', weight: 1640 }),
  demoCar('Tesla', 'Model 3 Performance', 'Dual Motor (460 hp)', { speed: 261, hp: 460, accel: 3.3, torque: 660, fuel: 'Electric', drive: 'All wheel drive', gear: 'Automatic', weight: 1844 }),
  demoCar('Ford', 'Mustang GT', '5.0 V8 (450 hp)', { speed: 250, hp: 450, accel: 4.6, torque: 529, fuel: 'Gasoline', cc: 4951, cyl: 8, drive: 'Rear wheel drive', gear: 'Automatic', weight: 1740 }),
  demoCar('Toyota', 'GR Yaris', '1.6 (261 hp)', { speed: 230, hp: 261, accel: 5.5, torque: 360, fuel: 'Gasoline', cc: 1618, cyl: 3, drive: 'All wheel drive', gear: 'Manual', weight: 1280 }),
  demoCar('Honda', 'Civic Type R', '2.0 (329 hp)', { speed: 275, hp: 329, accel: 5.4, torque: 420, fuel: 'Gasoline', cc: 1996, cyl: 4, drive: 'Front wheel drive', gear: 'Manual', weight: 1429 }),
  demoCar('Nissan', 'GT-R', '3.8 V6 (570 hp)', { speed: 315, hp: 570, accel: 2.9, torque: 637, fuel: 'Gasoline', cc: 3799, cyl: 6, drive: 'All wheel drive', gear: 'Automatic', weight: 1752 }),
  demoCar('Volkswagen', 'Polo GTI', '2.0 TSI (207 hp)', { speed: 240, hp: 207, accel: 6.5, torque: 320, fuel: 'Gasoline', cc: 1984, cyl: 4, drive: 'Front wheel drive', gear: 'Automatic', weight: 1355 }),
  demoCar('Opel', 'Corsa', '1.2 Turbo (100 hp)', { speed: 192, hp: 100, accel: 9.9, torque: 205, fuel: 'Gasoline', cc: 1199, cyl: 3, drive: 'Front wheel drive', gear: 'Manual', weight: 1165 }),
];

// --- Firestore-Pfade ---
const raceRef = (code) => doc(db, 'artifacts', appId, 'public', 'data', 'races', code);
const racerRef = (uid) => doc(db, 'artifacts', appId, 'public', 'data', 'racers', uid);
const racersCol = () => collection(db, 'artifacts', appId, 'public', 'data', 'racers');
const runsCol = () => collection(db, 'artifacts', appId, 'public', 'data', 'runs');
const clockRef = (uid) => doc(db, 'artifacts', appId, 'public', 'data', '_clock', uid);

// --- Renn-Distanzen ---
const DISTANCES = [
  { m: 500, label: '½ km' },
  { m: 1000, label: '1 km' },
];

// --- Rang-Stufen nach Punkten ---
const RANKS = [
  { min: 0, name: 'Rookie', icon: '🐣' },
  { min: 50, name: 'Amateur', icon: '🚗' },
  { min: 150, name: 'Semi-Pro', icon: '🏁' },
  { min: 350, name: 'Pro', icon: '🏆' },
  { min: 700, name: 'Legend', icon: '👑' },
];
const getRank = (points = 0) => {
  let r = RANKS[0];
  for (const tier of RANKS) if (points >= tier.min) r = tier;
  return r;
};

// --- Hilfsfunktionen ---
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () =>
  Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

// Entfernung zwischen zwei Koordinaten in Metern (Haversine)
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Schätzt die Differenz zwischen Server- und Geräte-Uhr (für die Ampel-Sync)
async function estimateServerOffset(uid) {
  try {
    const ref = clockRef(uid);
    const t0 = Date.now();
    await setDoc(ref, { t: serverTimestamp() });
    const snap = await getDoc(ref);
    const t1 = Date.now();
    const serverMs = snap.data().t.toMillis();
    const mid = t0 + (t1 - t0) / 2;
    return serverMs - mid; // lokale Zeit + offset ≈ Server-Zeit
  } catch (e) {
    console.warn('Offset-Schätzung fehlgeschlagen:', e);
    return 0;
  }
}

// =====================================================================
//  FUSION-Hook (GPS + Bewegungssensor, 1D-Kalman-Filter):
//  - GPS (~1 Hz): absolute Geschwindigkeits-KORREKTUR + Strecke (Haversine)
//  - Beschleunigungssensor (~60 Hz): sagt Geschwindigkeit & Strecke
//    ZWISCHEN den GPS-Fixes voraus (Vorhersage-Schritt)
//  - Schwerkraft wird per Tiefpass geschätzt, die Fahrtrichtungs-Achse
//    beim ersten kräftigen Anfahren automatisch kalibriert
//  - Stillstands-Korrektur (ZUPT) verhindert Drift im Stand
//  - Fällt automatisch auf "nur GPS" zurück (Desktop, abgelehnte
//    Berechtigung, Simulationsmodus)
//  onSample feuert im Fusion-Betrieb mit ~60 Hz, sonst pro GPS-Fix.
// =====================================================================
// iOS verlangt eine explizite Berechtigung für die Bewegungssensoren.
// Die Abfrage MUSS aus einer Nutzer-Geste (Button-Klick) heraus erfolgen.
let motionPermissionGranted = null; // null = noch nicht gefragt
async function requestMotionPermission() {
  try {
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      const p = await DeviceMotionEvent.requestPermission();
      motionPermissionGranted = p === 'granted';
    } else {
      motionPermissionGranted = true; // Android/Desktop: keine Abfrage nötig
    }
  } catch {
    motionPermissionGranted = false;
  }
  return motionPermissionGranted;
}

function useGpsTracker() {
  const [speedKmh, setSpeedKmh] = useState(0);
  const [distanceM, setDistanceM] = useState(0);
  const [accelMs2, setAccelMs2] = useState(0);
  const [peakG, setPeakG] = useState(0);
  const [accuracyM, setAccuracyM] = useState(null);
  const [tracking, setTracking] = useState(false);
  const [simulated, setSimulated] = useState(false);
  const [fusionActive, setFusionActive] = useState(false);

  const watchId = useRef(null);
  const intId = useRef(null);
  const simId = useRef(null);
  const onSampleRef = useRef(null);
  const motionListenerRef = useRef(null);

  // --- Kalman-Zustand (Fusion) ---
  const vRef = useRef(0); // m/s, fusionierte Geschwindigkeit
  const PRef = useRef(25); // Unsicherheit der Schätzung
  const distRef = useRef(0); // m, fusionierte Strecke
  const gpsDistRef = useRef(0); // m, reine GPS-Haversine-Summe
  const lastGps = useRef(null);
  // --- IMU-Zustand ---
  const imuActive = useRef(false);
  const lastImuT = useRef(null);
  const gravRef = useRef(null); // Tiefpass-Schätzung der Schwerkraft
  const fwdRef = useRef(null); // Fahrtrichtungs-Achse im Geräte-Koordinatensystem
  const aLongSmooth = useRef(0);
  const peakGRef = useRef(0);
  const lastSample = useRef(null); // {t, v, d} für die prev-Werte in onSample
  // --- Anzeige-Fallback ohne IMU (Interpolation wie bisher) ---
  const lastZ = useRef(null);
  const prevZ = useRef(null);

  const Q = 0.6; // Prozessrauschen: Unsicherheit wächst pro Sekunde ohne GPS-Korrektur

  const emitSample = (tMs) => {
    const prev = lastSample.current;
    const cur = { t: tMs, v: vRef.current, d: distRef.current };
    lastSample.current = cur;
    if (prev && onSampleRef.current) {
      onSampleRef.current({
        tMs: cur.t,
        prevTMs: prev.t,
        speedKmh: cur.v * 3.6,
        prevSpeedKmh: prev.v * 3.6,
        cumDist: cur.d,
        prevCumDist: prev.d,
      });
    }
  };

  // ---- Bewegungssensor (~60 Hz): VORHERSAGE-Schritt des Kalman-Filters ----
  const handleMotion = (e) => {
    const ag = e.accelerationIncludingGravity;
    if (!ag || ag.x == null) return;
    const now = performance.now();
    const dt = lastImuT.current != null ? Math.min((now - lastImuT.current) / 1000, 0.1) : 0;
    lastImuT.current = now;
    if (dt <= 0) return;

    if (!imuActive.current) {
      imuActive.current = true;
      setFusionActive(true);
    }

    // 1) Schwerkraft per Tiefpass schätzen (Zeitkonstante ~3 s)
    const aG = Math.exp(-dt / 3);
    if (!gravRef.current) gravRef.current = { x: ag.x, y: ag.y, z: ag.z };
    const g = gravRef.current;
    g.x = aG * g.x + (1 - aG) * ag.x;
    g.y = aG * g.y + (1 - aG) * ag.y;
    g.z = aG * g.z + (1 - aG) * ag.z;

    // 2) Lineare Beschleunigung (ohne Schwerkraft). Wenn das OS sie schon
    //    bereitstellt (Gyro-Fusion), ist die genauer als unsere Subtraktion.
    let lin;
    if (e.acceleration && e.acceleration.x != null) {
      lin = { x: e.acceleration.x, y: e.acceleration.y, z: e.acceleration.z };
    } else {
      lin = { x: ag.x - g.x, y: ag.y - g.y, z: ag.z - g.z };
    }

    // 3) Auf die horizontale Ebene projizieren (Vertikal-Anteil entfernen)
    const gm = Math.hypot(g.x, g.y, g.z) || 9.81;
    const gu = { x: g.x / gm, y: g.y / gm, z: g.z / gm };
    const dotG = lin.x * gu.x + lin.y * gu.y + lin.z * gu.z;
    const ah = { x: lin.x - dotG * gu.x, y: lin.y - dotG * gu.y, z: lin.z - dotG * gu.z };
    const ahMag = Math.hypot(ah.x, ah.y, ah.z);

    // 4) Fahrtrichtungs-Achse automatisch kalibrieren: Das erste kräftige
    //    Anfahren aus dem Stand definiert "vorwärts". Danach wird die Achse
    //    bei jeder kräftigen Längsbeschleunigung langsam nachgeführt
    //    (Vorzeichen beachten: Bremsen zeigt nach hinten).
    if (!fwdRef.current) {
      if (vRef.current < 1.5 && ahMag > 1.2) {
        fwdRef.current = { x: ah.x / ahMag, y: ah.y / ahMag, z: ah.z / ahMag };
      }
    } else if (ahMag > 1.0) {
      const f = fwdRef.current;
      const s = Math.sign(ah.x * f.x + ah.y * f.y + ah.z * f.z) || 1;
      const b = 0.03;
      f.x = (1 - b) * f.x + b * s * (ah.x / ahMag);
      f.y = (1 - b) * f.y + b * s * (ah.y / ahMag);
      f.z = (1 - b) * f.z + b * s * (ah.z / ahMag);
      const fm = Math.hypot(f.x, f.y, f.z) || 1;
      f.x /= fm; f.y /= fm; f.z /= fm;
    }

    // 5) Längs-Beschleunigung mit Vorzeichen (Beschleunigen + / Bremsen -)
    const f = fwdRef.current;
    const aLong = f ? ah.x * f.x + ah.y * f.y + ah.z * f.z : 0;
    aLongSmooth.current = 0.8 * aLongSmooth.current + 0.2 * aLong;
    if (aLong < 15 && aLong / 9.81 > peakGRef.current && vRef.current > 0.5) {
      peakGRef.current = aLong / 9.81;
    }

    // 6) Kalman-VORHERSAGE: Geschwindigkeit fortschreiben
    vRef.current = Math.max(0, vRef.current + aLong * dt);
    PRef.current += Q * dt;

    // Stillstands-Korrektur (ZUPT): Nur wenn der Sensor wirklich ruhig ist
    // (kaum Beschleunigung). So wird im Stand nicht weitergezählt, ein echtes
    // Losfahren (hohe Längsbeschleunigung) aber sofort erkannt.
    const gpsSpd = lastGps.current?.speed ?? 0;
    const quiet = ahMag < 0.4 && Math.abs(aLong) < 0.6;
    const stationary = quiet && (gpsSpd < 1.0 || vRef.current < 1.0);
    if (stationary) {
      vRef.current *= 0.6;
      if (vRef.current < 0.1) vRef.current = 0;
    } else {
      // in Fahrt: Strecke integrieren
      distRef.current += vRef.current * dt;
    }

    emitSample(Date.now());
  };

  // ---- GPS (~1 Hz): KORREKTUR-Schritt des Kalman-Filters ----
  const handlePos = (pos) => {
    const acc = pos.coords.accuracy;
    // Ungenaue Fixes verwerfen (in Gebäuden o.ä.)
    if (acc != null && acc > 25) {
      setAccuracyM(acc);
      return;
    }
    setAccuracyM(acc ?? null);

    const tMs = pos.timestamp;
    let z = pos.coords.speed; // m/s, kann null sein
    const fromDoppler = z != null;

    if (lastGps.current) {
      const d = haversine(lastGps.current.lat, lastGps.current.lng, pos.coords.latitude, pos.coords.longitude);
      const dtS = Math.max((tMs - lastGps.current.t) / 1000, 0.001);
      // Bewegung NUR über die Doppler-Geschwindigkeit erkennen. Beim GPS-
      // Kaltstart springt die Position teils um hunderte Meter, obwohl das
      // Auto steht — die Doppler-Geschwindigkeit bleibt dabei ~0. Genau das
      // hat bisher das Rennen sofort beendet.
      const moving = fromDoppler ? pos.coords.speed > 1.0 : d / dtS > 3.0;
      // Plausibilitätsgrenze: nie mehr Strecke zählen, als bei aktueller
      // Geschwindigkeit physikalisch möglich ist (fängt Positions-Sprünge ab).
      const maxStep = (Math.max(vRef.current, pos.coords.speed || 0) + 3) * dtS + 5;
      const validStep = moving && d > 0.4 && d < maxStep;
      if (validStep) gpsDistRef.current += d;
      // Geschwindigkeit aus Strecke nur ableiten, wenn der Schritt gültig war
      if (z == null) z = validStep ? d / dtS : 0;
      // Fusions-Strecke sanft zur GPS-Strecke ziehen (verhindert IMU-Drift)
      distRef.current += 0.3 * (gpsDistRef.current - distRef.current);
    } else if (z == null) {
      z = 0;
    }
    lastGps.current = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: tMs, speed: z };

    // Kalman-KORREKTUR (Doppler-Geschwindigkeit ist genauer als abgeleitete)
    const R = fromDoppler ? 0.35 : 1.5;
    const K = PRef.current / (PRef.current + R);
    vRef.current = Math.max(0, vRef.current + K * (z - vRef.current));
    PRef.current *= (1 - K);

    if (!imuActive.current) {
      // Fallback ohne Bewegungssensor (Desktop, abgelehnt, Simulation):
      // Verhalten wie v2 — onSample pro Fix, Anzeige interpoliert
      prevZ.current = lastZ.current;
      lastZ.current = { v: vRef.current, tPerf: performance.now() };
      distRef.current = gpsDistRef.current;
      emitSample(tMs);
    }
  };

  // 10-Hz-Anzeige-Takt
  const displayTick = () => {
    if (imuActive.current) {
      setSpeedKmh(vRef.current * 3.6);
      setDistanceM(distRef.current);
      setAccelMs2(aLongSmooth.current);
      setPeakG(peakGRef.current);
      return;
    }
    // Ohne IMU: zwischen den GPS-Fixes extrapolieren (flüssige Anzeige)
    const lz = lastZ.current;
    const pz = prevZ.current;
    let v = vRef.current;
    if (lz && pz) {
      const dt = lz.tPerf - pz.tPerf;
      if (dt > 0) {
        const slope = (lz.v - pz.v) / dt;
        const ahead = Math.min(performance.now() - lz.tPerf, 1200);
        v = Math.max(0, lz.v + slope * ahead);
      }
    }
    setSpeedKmh(v * 3.6);
    setDistanceM(distRef.current);
  };

  const resetState = (onSample) => {
    onSampleRef.current = onSample || null;
    vRef.current = 0;
    PRef.current = 25;
    distRef.current = 0;
    gpsDistRef.current = 0;
    lastGps.current = null;
    lastImuT.current = null;
    gravRef.current = null;
    fwdRef.current = null;
    aLongSmooth.current = 0;
    peakGRef.current = 0;
    lastSample.current = null;
    lastZ.current = null;
    prevZ.current = null;
    imuActive.current = false;
    setFusionActive(false);
    setDistanceM(0);
    setSpeedKmh(0);
    setAccelMs2(0);
    setPeakG(0);
    setAccuracyM(null);
  };

  const start = async (onSample) => {
    if (!('geolocation' in navigator)) {
      alert('GPS wird von deinem Gerät nicht unterstützt. Nutze den Simulationsmodus.');
      return false;
    }
    resetState(onSample);
    setSimulated(false);
    setTracking(true);

    // Bewegungssensor aktivieren (falls erlaubt) -> Sensor-Fusion
    if (motionPermissionGranted === null) await requestMotionPermission();
    if (motionPermissionGranted) {
      motionListenerRef.current = handleMotion;
      window.addEventListener('devicemotion', motionListenerRef.current);
    }

    watchId.current = navigator.geolocation.watchPosition(
      handlePos,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          alert('GPS-Berechtigung verweigert. Bitte in den Einstellungen erlauben.');
          stop();
        }
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
    intId.current = setInterval(displayTick, 100);
    return true;
  };

  // ---- SIMULATION: erzeugt 1-Hz-"Fixes" mit Beschleunigungskurve ----
  // (nutzt bewusst NUR den GPS-Pfad, keine echten Bewegungssensoren)
  const startSim = (onSample) => {
    resetState(onSample);
    setSimulated(true);
    setAccuracyM(5);
    setTracking(true);

    let simLat = 51.36; // beliebiger Startpunkt
    const simLng = 7.46;
    let tSim = 0; // Sekunden seit Start
    const SIM_DT = 1; // 1-Hz-Fixes wie echtes GPS
    const vmaxMps = 250 / 3.6; // ~250 km/h Höchstgeschwindigkeit
    const tau = 5; // Zeitkonstante der Beschleunigung

    simId.current = setInterval(() => {
      tSim += SIM_DT;
      const spd = vmaxMps * (1 - Math.exp(-tSim / tau)); // m/s
      simLat += (spd * SIM_DT) / 111320; // Strecke -> Breitengrad
      handlePos({
        coords: { latitude: simLat, longitude: simLng, speed: spd, accuracy: 5 },
        timestamp: Date.now(),
      });
    }, SIM_DT * 1000);

    intId.current = setInterval(displayTick, 100);
    return true;
  };

  const stop = () => {
    setTracking(false);
    setSimulated(false);
    if (watchId.current != null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    if (motionListenerRef.current) {
      window.removeEventListener('devicemotion', motionListenerRef.current);
      motionListenerRef.current = null;
    }
    if (simId.current != null) {
      clearInterval(simId.current);
      simId.current = null;
    }
    if (intId.current != null) {
      clearInterval(intId.current);
      intId.current = null;
    }
    setSpeedKmh(0);
    setAccelMs2(0);
    setFusionActive(false);
  };

  useEffect(() => {
    return () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
      if (motionListenerRef.current) window.removeEventListener('devicemotion', motionListenerRef.current);
      if (simId.current != null) clearInterval(simId.current);
      if (intId.current != null) clearInterval(intId.current);
    };
  }, []);

  return { speedKmh, distanceM, accelMs2, peakG, accuracyM, tracking, simulated, fusionActive, start, startSim, stop };
}

// --- Kleine Präsentationskomponenten ---
function TrafficLight({ phase }) {
  const lamp = (active, color) =>
    `w-16 h-16 rounded-full transition-all duration-150 ${
      active ? `${color} shadow-[0_0_30px_currentColor]` : 'bg-slate-800'
    }`;
  return (
    <div className="flex flex-col items-center gap-3 bg-slate-950 border-4 border-slate-700 rounded-3xl p-4 w-fit mx-auto">
      <div className={lamp(phase === 'red', 'bg-red-500 text-red-500')} />
      <div className={lamp(phase === 'yellow', 'bg-yellow-400 text-yellow-400')} />
      <div className={lamp(phase === 'green', 'bg-green-500 text-green-500')} />
    </div>
  );
}

function ProgressRow({ name, icon, dist, target, isYou, finishTime }) {
  const pct = Math.min(100, (dist / target) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center text-sm">
        <span className="flex items-center gap-2 font-semibold">
          <span className="text-lg">{icon}</span>
          {name}
          {isYou && <span className="text-[9px] bg-orange-500 text-white px-1.5 py-0.5 rounded uppercase">Du</span>}
        </span>
        <span className="tabular-nums text-slate-400">
          {finishTime != null ? `${finishTime.toFixed(2)}s` : `${Math.round(dist)} m`}
        </span>
      </div>
      <div className="h-3 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-100 ${isYou ? 'bg-orange-500' : 'bg-sky-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function App() {
  // Auth & Profil
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  // Navigation
  const [activeTab, setActiveTab] = useState('tracker');

  // Fahrzeug-Auswahl beim Setup (über die API Ninjas Cars API)
  const [setupName, setSetupName] = useState('');
  const [makeInput, setMakeInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [freeResults, setFreeResults] = useState([]);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [trims, setTrims] = useState([]);
  const [selectedTrim, setSelectedTrim] = useState('');
  const [chosenCar, setChosenCar] = useState(null);
  const [setupLoading, setSetupLoading] = useState(''); // '', 'models', 'trims', 'details'
  const [setupError, setSetupError] = useState('');

  // Bestenlisten
  const [leaderboard, setLeaderboard] = useState([]);
  const [pointsBoard, setPointsBoard] = useState([]);
  const [leaderboardFilter, setLeaderboardFilter] = useState('all');
  const [boardMode, setBoardMode] = useState('times'); // 'times' | 'points'

  // 0-100 Tracker
  const [topSpeed, setTopSpeed] = useState(0);
  const [zeroToHundred, setZeroToHundred] = useState(null);
  const tracker = useGpsTracker();
  const launchRef = useRef(null);
  const topRef = useRef(0);
  const zeroRecordedRef = useRef(false);

  // KI
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [tuningTips, setTuningTips] = useState(null);
  const [showAllSpecs, setShowAllSpecs] = useState(false);
  const [isFetchingTuning, setIsFetchingTuning] = useState(false);

  // Renn-Modus
  const [raceMode, setRaceMode] = useState('menu'); // 'menu' | 'lobby' | 'solo' | 'sim'
  const [raceId, setRaceId] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [race, setRace] = useState(null);
  const [selectedDistance, setSelectedDistance] = useState(500);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [raceError, setRaceError] = useState('');
  const [localPhase, setLocalPhase] = useState('idle'); // 'idle'|'countdown'|'racing'|'finished'
  const [nowTick, setNowTick] = useState(Date.now());
  const [myFinish, setMyFinish] = useState(null);
  const [raceOutcome, setRaceOutcome] = useState(null); // 'win'|'lose'|'tie'|'solo'|'sim'

  // Renn-Refs (stale-closure-frei)
  const offsetRef = useRef(0);
  const greenLocalEpochRef = useRef(null);
  const finishRef = useRef(false);
  const raceMovedRef = useRef(false);
  const raceTargetRef = useRef(500);
  const raceModeRef = useRef('menu');
  const onSampleRaceRef = useRef(null);
  const pointsAwardedRef = useRef(false);
  const lastProgressWrite = useRef(0);
  const userProfileRef = useRef(null);
  const useSimRef = useRef(false);
  const simGhostRef = useRef(null);

  useEffect(() => { userProfileRef.current = userProfile; }, [userProfile]);
  useEffect(() => { raceModeRef.current = raceMode; }, [raceMode]);

  // --- Kostenloser Modus: direkte Suche über /v1/cars ---
  const searchFreeCars = async () => {
    const make = makeInput.trim();
    const model = modelInput.trim();
    if (!make && !model) { setSetupError('Bitte mindestens Marke oder Modell eingeben.'); return; }
    setSetupError('');
    setSetupLoading('models');
    setFreeResults([]); setChosenCar(null);
    try {
      const data = await fetchCarsApi('cars', { make, model, limit: 30 });
      if (!Array.isArray(data) || data.length === 0) {
        setSetupError('Keine Treffer. Tipp: englische Schreibweise, z.B. Marke „toyota", Modell „corolla".');
      } else {
        setFreeResults(data);
      }
    } catch (e) {
      setSetupError(e.message);
    } finally {
      setSetupLoading('');
    }
  };

  // --- Auto-Auswahl über die Cars API (3 Schritte: Marke -> Modell -> Trim) ---
  const loadModels = async () => {
    const make = makeInput.trim();
    if (!make) return;
    setSetupError('');
    setSetupLoading('models');
    setModels([]); setSelectedModel('');
    setTrims([]); setSelectedTrim('');
    setChosenCar(null);
    try {
      const data = await fetchCarsApi('carmodels', { make });
      if (!Array.isArray(data) || data.length === 0) {
        setSetupError(`Keine Modelle für „${make}" gefunden. Schreibweise prüfen (z.B. „Audi", „BMW").`);
      } else {
        setModels(data);
      }
    } catch (e) {
      setSetupError(e.message);
    } finally {
      setSetupLoading('');
    }
  };

  const loadTrims = async (model) => {
    setSelectedModel(model);
    setTrims([]); setSelectedTrim('');
    setChosenCar(null);
    if (!model) return;
    setSetupError('');
    setSetupLoading('trims');
    try {
      const data = await fetchCarsApi('cartrims', { make: makeInput.trim(), model, limit: 100 });
      if (!Array.isArray(data) || data.length === 0) {
        setSetupError('Keine Ausstattungen/Trims für dieses Modell gefunden.');
      } else {
        // Doppelte Trim-Namen zusammenfassen (es gibt oft mehrere Karosserien)
        setTrims(data);
      }
    } catch (e) {
      setSetupError(e.message);
    } finally {
      setSetupLoading('');
    }
  };

  const loadDetails = async (trimIndex) => {
    const idx = parseInt(trimIndex, 10);
    const t = trims[idx];
    setChosenCar(null);
    if (!t) { setSelectedTrim(''); return; }
    setSelectedTrim(String(idx));
    setSetupError('');
    setSetupLoading('details');
    try {
      const data = await fetchCarsApi('cardetails', { make: makeInput.trim(), model: selectedModel, trim: t.trim });
      const entry = Array.isArray(data) ? data[0] : null;
      if (!entry || !entry.specifications) {
        setSetupError('Für diese Ausstattung sind keine Detaildaten verfügbar.');
      } else {
        setChosenCar(buildCarObject(entry.make, entry.model, entry.trim, entry.specifications, t.serie));
      }
    } catch (e) {
      setSetupError(e.message);
    } finally {
      setSetupLoading('');
    }
  };

  // --- Auth ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) {
        console.error('Auth error:', e);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        try {
          const profileSnap = await getDoc(doc(db, 'artifacts', appId, 'users', currentUser.uid));
          if (profileSnap.exists()) {
            const data = profileSnap.data();
            setUserProfile(data);
            setDoc(racerRef(currentUser.uid), {
              username: data.username, car: data.car, points: data.points ?? 0,
            }, { merge: true }).catch(() => {});
          } else {
            setUserProfile(null);
          }
        } catch (e) {
          console.error('Profil-Ladefehler:', e);
          setUserProfile(null);
        }
        offsetRef.current = await estimateServerOffset(currentUser.uid);
      } else {
        setUserProfile(null);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // --- Bestzeiten-Rangliste (0-100) ---
  useEffect(() => {
    if (!userProfile) return;
    const unsub = onSnapshot(
      runsCol(),
      (snap) => {
        const runs = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((r) => typeof r.zeroToHundred === 'number' && r.zeroToHundred > 0)
          .sort((a, b) => a.zeroToHundred - b.zeroToHundred);
        setLeaderboard(runs);
      },
      (e) => console.error('Bestzeiten-Fehler:', e)
    );
    return () => unsub();
  }, [userProfile]);

  // --- Punkte-Rangliste ---
  useEffect(() => {
    if (!userProfile) return;
    const unsub = onSnapshot(
      racersCol(),
      (snap) => {
        const racers = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.points || 0) - (a.points || 0));
        setPointsBoard(racers);
      },
      (e) => console.error('Punkte-Fehler:', e)
    );
    return () => unsub();
  }, [userProfile]);

  // --- Renn-Dokument live verfolgen ---
  useEffect(() => {
    if (!raceId || raceMode !== 'lobby') return;
    const unsub = onSnapshot(raceRef(raceId), (snap) => {
      if (!snap.exists()) {
        setRace(null);
        resetRace(false);
        return;
      }
      setRace(snap.data());
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raceId, raceMode]);

  // --- Online-Rennen-Status mit lokaler Phase abgleichen ---
  useEffect(() => {
    if (raceMode !== 'lobby' || !race) return;
    if (
      race.status === 'countdown' &&
      localPhase !== 'countdown' && localPhase !== 'racing' && localPhase !== 'finished'
    ) {
      if (greenLocalEpochRef.current == null && race.startAt) {
        greenLocalEpochRef.current = race.startAt - (offsetRef.current || 0);
      }
      setLocalPhase('countdown');
    }
    if (race.status === 'finished' && localPhase !== 'finished') {
      setLocalPhase('finished');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [race, raceMode, localPhase]);

  // --- Countdown-/Renn-Timer (10 Hz) ---
  useEffect(() => {
    if (localPhase !== 'countdown' && localPhase !== 'racing') return;
    const id = setInterval(() => setNowTick(Date.now()), 100);
    return () => clearInterval(id);
  }, [localPhase]);

  // --- Bei Grün automatisch starten ---
  useEffect(() => {
    if (localPhase !== 'countdown' || greenLocalEpochRef.current == null) return;
    if (nowTick >= greenLocalEpochRef.current) {
      finishRef.current = false;
      raceMovedRef.current = false;
      raceTargetRef.current = raceMode === 'lobby' ? (race?.distance || selectedDistance) : selectedDistance;
      setLocalPhase('racing');
      // Simulation oder echtes GPS?
      (useSimRef.current ? tracker.startSim : tracker.start)(onSampleRaceRef.current);
      if (raceMode === 'lobby' && isHost && raceId) {
        updateDoc(raceRef(raceId), { status: 'racing' }).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowTick, localPhase]);

  // --- Sieger bestimmen (nur Host, sobald beide im Ziel) ---
  useEffect(() => {
    if (raceMode !== 'lobby' || !race || !isHost || !user) return;
    const r = race.results || {};
    const oppId = race.guestId;
    const meDone = r[user.uid]?.finished;
    const oppDone = oppId && r[oppId]?.finished;
    if (meDone && oppDone && !race.winnerId && raceId) {
      const mT = r[user.uid].finishTime;
      const oT = r[oppId].finishTime;
      const winner = mT <= oT ? user.uid : oppId;
      updateDoc(raceRef(raceId), { winnerId: winner, status: 'finished', finishedAt: serverTimestamp() }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [race, isHost, raceMode]);

  // --- Punkte vergeben, wenn Online-Rennen beendet ---
  useEffect(() => {
    if (raceMode !== 'lobby' || !race || race.status !== 'finished' || !race.winnerId || !user) return;
    if (pointsAwardedRef.current) return;
    pointsAwardedRef.current = true;
    const won = race.winnerId === user.uid;
    setRaceOutcome(won ? 'win' : 'lose');
    awardPoints(won ? 25 : 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [race, raceMode]);

  // =================== KI ===================
  const callAiBackend = async (prompt, systemInstruction) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(AI_BACKEND_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, systemInstruction }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return data.text;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  };

  const handleAnalyzeRun = async () => {
    if (!zeroToHundred || !userProfile) return;
    setIsAnalyzing(true);
    setAiAnalysis(null);
    const c = userProfile.car;
    const factory = c.factory0to100 != null
      ? `Die Werksangabe für 0-100 km/h liegt bei ${c.factory0to100} Sekunden.`
      : '';
    const power = c.specs?.['Engine power'] ? ` Das Auto hat ${c.specs['Engine power']}.` : '';
    const prompt = `Ich bin auf einer abgesperrten Strecke mit meinem ${c.make} ${c.model} (${c.trim || 'Serienmodell'}) von 0 auf 100 km/h in ${zeroToHundred.toFixed(2)} Sekunden beschleunigt.${power} ${factory} Gib mir ein kurzes, witziges Feedback in 2-3 Sätzen!`;
    try {
      setAiAnalysis(await callAiBackend(prompt, 'Du bist ein cooler Motorsport-Coach für Trackdays.'));
    } catch {
      setAiAnalysis('Die KI ist gerade in der Boxengasse beschäftigt. Versuche es später nochmal!');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGetTuningTips = async () => {
    if (!userProfile) return;
    setIsFetchingTuning(true);
    setTuningTips(null);
    const c = userProfile.car;
    const prompt = `Nenne 3 realistische, kurze und legale Tuning-Tipps (Performance, Reifen, Gewicht), um die 0-100 km/h Zeit eines ${c.make} ${c.model} auf der Rennstrecke zu verbessern. Weise darauf hin, dass Umbauten in Deutschland eintragungspflichtig sein können (TÜV).`;
    try {
      setTuningTips(await callAiBackend(prompt, 'Du bist ein erfahrener Auto-Tuner. Gib präzise, stichpunktartige Tipps.'));
    } catch {
      setTuningTips('Fehler beim Abrufen der Tuning-Tipps. Probier es später nochmal!');
    } finally {
      setIsFetchingTuning(false);
    }
  };

  // =================== Profil ===================
  const handleProfileSetup = async () => {
    const username = setupName.trim();
    if (!username || !chosenCar || !user) return;
    const profileData = { username, car: chosenCar, points: 0, createdAt: serverTimestamp() };
    try {
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid), profileData);
      await setDoc(racerRef(user.uid), { username, car: chosenCar, points: 0 }, { merge: true });
      setUserProfile(profileData);
    } catch (e) {
      console.error('Profil-Speicherfehler:', e);
      alert('Profil konnte nicht gespeichert werden. Internetverbindung prüfen.');
    }
  };

  const awardPoints = async (delta) => {
    const p = userProfileRef.current;
    if (!p || !user) return;
    try {
      await updateDoc(doc(db, 'artifacts', appId, 'users', user.uid), { points: increment(delta) });
      await setDoc(racerRef(user.uid), { username: p.username, car: p.car, points: increment(delta) }, { merge: true });
      setUserProfile((prev) => ({ ...prev, points: (prev.points || 0) + delta }));
    } catch (e) {
      console.error('Punkte-Fehler:', e);
    }
  };

  // =================== 0-100 Tracker ===================
  const onSampleTracker = (s) => {
    if (launchRef.current == null) {
      if (s.prevSpeedKmh < 3 && s.speedKmh >= 3) {
        const frac = (3 - s.prevSpeedKmh) / (s.speedKmh - s.prevSpeedKmh || 1);
        launchRef.current = s.prevTMs + frac * (s.tMs - s.prevTMs);
      } else if (s.prevSpeedKmh >= 3) {
        launchRef.current = s.prevTMs;
      }
    }
    if (s.speedKmh > topRef.current) {
      const prevInt = Math.floor(topRef.current);
      topRef.current = s.speedKmh;
      // Fusion liefert ~60 Samples/s -> nur rendern, wenn sich die Anzeige ändert
      if (Math.floor(s.speedKmh) !== prevInt) setTopSpeed(s.speedKmh);
    }
    if (!zeroRecordedRef.current && launchRef.current != null && s.prevSpeedKmh < 100 && s.speedKmh >= 100) {
      const frac = (100 - s.prevSpeedKmh) / (s.speedKmh - s.prevSpeedKmh || 1);
      const crossT = s.prevTMs + frac * (s.tMs - s.prevTMs);
      const z = (crossT - launchRef.current) / 1000;
      zeroRecordedRef.current = true;
      setZeroToHundred(z);
      saveRun(z, topRef.current);
      tracker.stop();
    }
  };

  const resetTrackerMeasurement = () => {
    launchRef.current = null;
    topRef.current = 0;
    zeroRecordedRef.current = false;
    setZeroToHundred(null);
    setTopSpeed(0);
    setAiAnalysis(null);
  };

  const startTrackerTab = () => {
    resetTrackerMeasurement();
    tracker.start(onSampleTracker);
  };

  const startTrackerSim = () => {
    resetTrackerMeasurement();
    tracker.startSim(onSampleTracker);
  };

  const saveRun = async (timeTaken, maxSpd) => {
    const p = userProfileRef.current;
    const cu = auth.currentUser;
    if (!p || !cu) return;
    try {
      await addDoc(runsCol(), {
        userId: cu.uid,
        username: p.username,
        car: p.car,
        zeroToHundred: parseFloat(timeTaken.toFixed(2)),
        topSpeed: parseFloat(maxSpd.toFixed(1)),
        timestamp: serverTimestamp(),
      });
    } catch (e) {
      console.error('Run-Speicherfehler:', e);
    }
  };

  // =================== Renn-Logik ===================
  const onSampleRace = (s) => {
    if (finishRef.current) return;
    // Schranke gegen GPS-Sprünge: das Ziel erst werten, wenn das Auto sich
    // tatsächlich bewegt hat (irgendwann > 8 km/h). Sonst könnte ein
    // Positions-Sprung im Stand das Rennen sofort "beenden".
    if (s.speedKmh > 8) raceMovedRef.current = true;
    if (raceMovedRef.current && s.cumDist >= raceTargetRef.current && s.prevCumDist < raceTargetRef.current) {
      const frac = (raceTargetRef.current - s.prevCumDist) / (s.cumDist - s.prevCumDist || 1);
      const crossT = s.prevTMs + frac * (s.tMs - s.prevTMs);
      const elapsed = (crossT - greenLocalEpochRef.current) / 1000;
      finishRef.current = true;
      handleRaceFinish(elapsed, s.cumDist);
    } else if (raceModeRef.current === 'lobby') {
      const now = Date.now();
      if (now - lastProgressWrite.current > 300 && raceId) {
        lastProgressWrite.current = now;
        updateDoc(raceRef(raceId), { [`results.${user.uid}.distance`]: Math.round(s.cumDist) }).catch(() => {});
      }
    }
  };
  onSampleRaceRef.current = onSampleRace;

  const handleRaceFinish = (elapsed, dist) => {
    setMyFinish(elapsed);
    tracker.stop();
    if (raceModeRef.current === 'lobby' && raceId && user) {
      updateDoc(raceRef(raceId), {
        [`results.${user.uid}.finished`]: true,
        [`results.${user.uid}.finishTime`]: parseFloat(elapsed.toFixed(3)),
        [`results.${user.uid}.distance`]: Math.round(dist),
      }).catch((e) => console.error(e));
    } else if (raceModeRef.current === 'sim') {
      // Simuliertes Rennen gegen Geist: Sieger lokal bestimmen + ECHTE Punkte
      const ghost = simGhostRef.current;
      const won = elapsed <= (ghost?.time ?? 9999);
      setRaceOutcome(won ? 'win' : 'lose');
      awardPoints(won ? 25 : 8);
      setLocalPhase('finished');
    } else {
      // Solo: kein Gegner, keine Punkte
      setRaceOutcome('solo');
      setLocalPhase('finished');
    }
  };

  const freshCode = async () => {
    for (let i = 0; i < 5; i++) {
      const code = genCode();
      const snap = await getDoc(raceRef(code));
      if (!snap.exists()) return code;
    }
    return genCode() + genCode();
  };

  const createRace = async () => {
    if (!userProfile || !user) return;
    setRaceError('');
    useSimRef.current = false;
    requestMotionPermission(); // iOS: jetzt fragen (Klick-Geste), nicht erst bei Grün
    try {
      const code = await freshCode();
      await setDoc(raceRef(code), {
        hostId: user.uid,
        hostName: userProfile.username,
        hostCar: userProfile.car,
        guestId: null,
        guestName: null,
        guestCar: null,
        distance: selectedDistance,
        status: 'waiting',
        startAt: null,
        results: {},
        winnerId: null,
        createdAt: serverTimestamp(),
      });
      setRaceId(code);
      setIsHost(true);
      setRaceMode('lobby');
      setLocalPhase('idle');
    } catch (e) {
      console.error(e);
      setRaceError('Rennen konnte nicht erstellt werden.');
    }
  };

  const joinRace = async () => {
    if (!userProfile || !user) return;
    setRaceError('');
    useSimRef.current = false;
    requestMotionPermission(); // iOS: jetzt fragen (Klick-Geste), nicht erst bei Grün
    const code = joinCodeInput.trim().toUpperCase();
    if (code.length < 4) {
      setRaceError('Bitte einen gültigen Code eingeben.');
      return;
    }
    try {
      const snap = await getDoc(raceRef(code));
      if (!snap.exists()) return setRaceError('Kein Rennen mit diesem Code gefunden.');
      const data = snap.data();
      if (data.hostId === user.uid) return setRaceError('Du kannst deinem eigenen Rennen nicht beitreten.');
      if (data.guestId) return setRaceError('Dieses Rennen ist schon voll.');
      await updateDoc(raceRef(code), {
        guestId: user.uid,
        guestName: userProfile.username,
        guestCar: userProfile.car,
        status: 'ready',
      });
      setRaceId(code);
      setIsHost(false);
      setRaceMode('lobby');
      setLocalPhase('idle');
    } catch (e) {
      console.error(e);
      setRaceError('Beitritt fehlgeschlagen.');
    }
  };

  const startOnlineRace = async () => {
    if (!isHost || !raceId) return;
    const offset = offsetRef.current || 0;
    const startAt = Date.now() + offset + 4500; // 4,5 s Countdown (Server-Zeit)
    greenLocalEpochRef.current = startAt - offset;
    await updateDoc(raceRef(raceId), { status: 'countdown', startAt }).catch((e) => console.error(e));
  };

  const startSolo = () => {
    useSimRef.current = false;
    requestMotionPermission(); // iOS: jetzt fragen (Klick-Geste), nicht erst bei Grün
    setRaceMode('solo');
    setMyFinish(null);
    setRaceOutcome(null);
    finishRef.current = false;
    greenLocalEpochRef.current = Date.now() + 4500;
    raceTargetRef.current = selectedDistance;
    setLocalPhase('countdown');
  };

  // NEU: simuliertes Rennen gegen einen "Geist" (kein Fahren nötig)
  const startSimRace = () => {
    useSimRef.current = true;
    setRaceMode('sim');
    setMyFinish(null);
    setRaceOutcome(null);
    finishRef.current = false;
    raceTargetRef.current = selectedDistance;
    // Geist-Zielzeit aus einfachem Modell + etwas Zufall
    const base = selectedDistance === 500 ? 12 : 19;
    simGhostRef.current = { name: 'Geist', icon: '👻', time: base + (Math.random() * 4 - 2) };
    greenLocalEpochRef.current = Date.now() + 4500;
    setLocalPhase('countdown');
  };

  const resetRace = async (doNetwork = true) => {
    tracker.stop();
    useSimRef.current = false;
    greenLocalEpochRef.current = null;
    finishRef.current = false;
    raceMovedRef.current = false;
    pointsAwardedRef.current = false;
    simGhostRef.current = null;
    setMyFinish(null);
    setRaceOutcome(null);
    setLocalPhase('idle');
    if (doNetwork && raceId) {
      try {
        if (isHost) {
          await deleteDoc(raceRef(raceId));
        } else if (user) {
          await updateDoc(raceRef(raceId), { guestId: null, guestName: null, guestCar: null, status: 'waiting' });
        }
      } catch {}
    }
    setRaceId(null);
    setIsHost(false);
    setRace(null);
    setRaceMode('menu');
  };

  // =================== Render ===================
  if (authLoading)
    return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">Laden...</div>;

  if (!userProfile) {
    const stepActive = (n) =>
      n === 1 ? true : n === 2 ? models.length > 0 : n === 3 ? trims.length > 0 : false;
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center p-6 pt-12 pb-16">
        <div className="w-full max-w-sm bg-slate-900 p-6 rounded-2xl border border-slate-800 space-y-5">
          <h2 className="text-2xl font-bold text-center">Profil einrichten</h2>

          <div>
            <label className="block text-sm text-slate-400 mb-2">Dein Fahrername</label>
            <input
              value={setupName}
              onChange={(e) => setSetupName(e.target.value)}
              type="text"
              placeholder="z.B. SpeedKing99"
              maxLength={20}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:border-orange-500 outline-none"
            />
          </div>

          {/* ===== Demo-Modus: eingebaute Beispielautos (keine API) ===== */}
          {CARS_API_MODE === 'demo' && (
            <div>
              <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg p-2.5 text-[11px] text-sky-200 mb-3">
                Demo-Modus: eingebaute Beispielautos, keine API nötig. Umschaltbar im Code (eine Zeile).
              </div>
              <label className="block text-sm text-slate-400 mb-2">Wähle dein Auto</label>
              <select
                value={chosenCar ? chosenCar.id : ''}
                onChange={(e) => setChosenCar(DEMO_CARS.find((c) => c.id === e.target.value) || null)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:border-orange-500 outline-none appearance-none"
              >
                <option value="">– Auto wählen –</option>
                {DEMO_CARS.map((c) => (
                  <option key={c.id} value={c.id}>{c.icon} {c.make} {c.model} · {c.trim}</option>
                ))}
              </select>
            </div>
          )}

          {/* ===== Kostenloser Modus: direkte Suche nach Marke + Modell ===== */}
          {CARS_API_MODE === 'free' && (
            <>
              <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg p-2.5 text-[11px] text-sky-200">
                Testmodus (kostenlose API): begrenzte Daten – kein Top-Speed/PS. Umschaltbar im Code.
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-2">Marke & Modell (englisch)</label>
                <div className="flex gap-2">
                  <input
                    value={makeInput}
                    onChange={(e) => setMakeInput(e.target.value)}
                    type="text"
                    placeholder="toyota"
                    className="flex-1 w-0 bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:border-orange-500 outline-none"
                  />
                  <input
                    value={modelInput}
                    onChange={(e) => setModelInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') searchFreeCars(); }}
                    type="text"
                    placeholder="corolla"
                    className="flex-1 w-0 bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:border-orange-500 outline-none"
                  />
                  <button
                    onClick={searchFreeCars}
                    disabled={setupLoading === 'models' || (!makeInput.trim() && !modelInput.trim())}
                    className="px-4 rounded-lg font-bold bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50 flex items-center"
                  >
                    {setupLoading === 'models' ? <Loader2 className="animate-spin" size={18} /> : 'Suchen'}
                  </button>
                </div>
              </div>

              {freeResults.length > 0 && (
                <div className="space-y-2 max-h-64 overflow-y-auto animate-in fade-in duration-300">
                  {freeResults.map((d, i) => {
                    const car = buildFreeCarObject(d);
                    const active = chosenCar && chosenCar.id === car.id;
                    return (
                      <button
                        key={`${car.id}-${i}`}
                        onClick={() => setChosenCar(car)}
                        className={`w-full text-left rounded-lg p-3 border transition-colors ${
                          active ? 'bg-orange-500/15 border-orange-500/60' : 'bg-slate-800 border-slate-700 hover:bg-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{car.icon}</span>
                          <div className="min-w-0">
                            <p className="font-bold text-white capitalize truncate">{d.make} {d.model}</p>
                            <p className="text-[11px] text-slate-400 truncate">
                              {[d.year, d.displacement ? `${d.displacement} l` : null, d.cylinders ? `${d.cylinders} Zyl.` : null, FUEL_DE[d.fuel_type] || d.fuel_type].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* ===== Voller Modus: Marke -> Modell -> Trim ===== */}
          {CARS_API_MODE === 'full' && (
            <>
              {/* Schritt 1: Marke */}
              <div>
                <label className="block text-sm text-slate-400 mb-2">1 · Automarke</label>
                <div className="flex gap-2">
                  <input
                    value={makeInput}
                    onChange={(e) => setMakeInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') loadModels(); }}
                    type="text"
                    placeholder="z.B. Audi, BMW, Toyota"
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:border-orange-500 outline-none"
                  />
                  <button
                    onClick={loadModels}
                    disabled={!makeInput.trim() || setupLoading === 'models'}
                    className="px-4 rounded-lg font-bold bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50 flex items-center"
                  >
                    {setupLoading === 'models' ? <Loader2 className="animate-spin" size={18} /> : 'Suchen'}
                  </button>
                </div>
              </div>

              {/* Schritt 2: Modell */}
              {stepActive(2) && (
                <div className="animate-in fade-in duration-300">
                  <label className="block text-sm text-slate-400 mb-2">2 · Modell</label>
                  <select
                    value={selectedModel}
                    onChange={(e) => loadTrims(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:border-orange-500 outline-none appearance-none"
                  >
                    <option value="">– Modell wählen –</option>
                    {models.map((m) => (<option key={m} value={m}>{m}</option>))}
                  </select>
                </div>
              )}

              {/* Schritt 3: Trim/Ausstattung */}
              {stepActive(3) && (
                <div className="animate-in fade-in duration-300">
                  <label className="block text-sm text-slate-400 mb-2">3 · Ausstattung / Motorisierung</label>
                  <select
                    value={selectedTrim}
                    onChange={(e) => loadDetails(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:border-orange-500 outline-none appearance-none"
                  >
                    <option value="">– Variante wählen –</option>
                    {trims.map((t, i) => (
                      <option key={`${t.trim}-${t.serie}-${i}`} value={i}>
                        {t.trim}{t.serie ? ` · ${t.serie}` : ''}{t.generation ? ` · ${t.generation}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {setupLoading === 'details' && (
                <div className="flex items-center justify-center gap-2 text-slate-400 text-sm py-2">
                  <Loader2 className="animate-spin" size={16} /> Fahrzeugdaten werden geladen…
                </div>
              )}
            </>
          )}

          {/* Vorschau des gewählten Autos (beide Modi) */}
          {chosenCar && (
            <div className="bg-slate-800 border border-orange-500/40 rounded-xl p-4 animate-in fade-in duration-300">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-4xl">{chosenCar.icon}</span>
                <div className="min-w-0">
                  <p className="font-bold text-white leading-tight capitalize">{chosenCar.make} {chosenCar.model}</p>
                  <p className="text-xs text-slate-400 truncate">{chosenCar.trim || '–'}</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {(chosenCar.dataMode === 'free'
                  ? [['Klasse', chosenCar.specs['Klasse']], ['Kraftstoff', chosenCar.specs['Kraftstoff']], ['Hubraum', chosenCar.specs['Hubraum']]]
                  : [['Top', chosenCar.specs['Max speed']], ['Leistung', chosenCar.specs['Engine power']], ['0–100', chosenCar.specs['Acceleration (0-100 km/h)']]]
                ).map(([label, val]) => (
                  <div key={label} className="bg-slate-900 rounded-lg p-2">
                    <p className="text-[10px] text-slate-500 uppercase">{label}</p>
                    <p className="text-sm font-bold capitalize">{val || '–'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {setupError && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg p-3">{setupError}</p>
          )}

          <button
            onClick={handleProfileSetup}
            disabled={!chosenCar || !setupName.trim()}
            className="w-full bg-orange-500 text-white font-bold rounded-lg p-3 hover:bg-orange-600 disabled:opacity-50"
          >
            Loslegen
          </button>

          <p className="text-[11px] text-slate-600 text-center">Fahrzeugdaten: API Ninjas Cars API</p>
        </div>
      </div>
    );
  }

  const myRank = getRank(userProfile.points || 0);
  const filteredLeaderboard = leaderboard.filter((run) => {
    if (leaderboardFilter === 'all') return true;
    if (leaderboardFilter === 'same_car') return run.car?.id === userProfile.car.id;
    if (leaderboardFilter === 'similar')
      return run.car && run.car.factory0to100 != null && userProfile.car.factory0to100 != null &&
        Math.abs(run.car.factory0to100 - userProfile.car.factory0to100) <= 0.5;
    return true;
  });

  // Renn-Hilfswerte
  const target = raceMode === 'lobby' ? (race?.distance || selectedDistance) : selectedDistance;
  const oppId = race ? (isHost ? race.guestId : race.hostId) : null;
  const oppName = race ? (isHost ? race.guestName : race.hostName) : null;
  const oppCar = race ? (isHost ? race.guestCar : race.hostCar) : null;
  const oppResult = race && oppId ? race.results?.[oppId] : null;
  const msToGreen = greenLocalEpochRef.current != null ? greenLocalEpochRef.current - nowTick : null;
  const lightPhase =
    localPhase === 'racing' ? 'green' :
    msToGreen == null ? null :
    msToGreen > 2000 ? 'red' :
    msToGreen > 0 ? 'yellow' : 'green';

  // Geist-Fortschritt im simulierten Rennen (linear bis zur Zielzeit)
  const elapsedSinceGreen = greenLocalEpochRef.current != null ? Math.max(0, (nowTick - greenLocalEpochRef.current) / 1000) : 0;
  const ghost = simGhostRef.current;
  const ghostDist = ghost ? Math.min(target, (elapsedSinceGreen / ghost.time) * target) : 0;
  const ghostFinished = ghost ? elapsedSinceGreen >= ghost.time : false;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans pb-24">
      <header className="bg-slate-900/80 backdrop-blur-md border-b border-slate-800 p-4 sticky top-0 z-10">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FastForward className="text-orange-500" size={24} />
            <h1 className="text-xl font-black tracking-tight italic text-white">
              Track <span className="text-orange-500">Rank</span>
            </h1>
          </div>
          <div className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-full border border-slate-700">
            <span className="text-lg">{myRank.icon}</span>
            <span className="text-sm font-semibold truncate max-w-[90px]">{userProfile.username}</span>
          </div>
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 space-y-6">
        {/* ===================== TRACKER ===================== */}
        {activeTab === 'tracker' && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex gap-3 text-sm text-red-200">
              <AlertTriangle className="text-red-500 shrink-0" size={20} />
              <p>Nur auf abgesperrten Strecken nutzen. Rennen auf öffentlichen Straßen sind in Deutschland strafbar (§ 315d StGB).</p>
            </div>

            <div className="bg-gradient-to-r from-slate-900 to-slate-800 border border-slate-800 rounded-2xl p-4 flex items-center justify-between shadow-lg">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wider font-bold mb-1">Ausgewähltes Fahrzeug</p>
                <h3 className="text-xl font-bold text-white">{userProfile.car.make} {userProfile.car.model}</h3>
                <p className="text-sm text-slate-400">
                  {userProfile.car.factory0to100 != null
                    ? `Werksangabe 0–100: ${userProfile.car.factory0to100}s`
                    : (userProfile.car.trim || '–')}
                </p>
              </div>
              <div className="text-5xl drop-shadow-lg">{userProfile.car.icon}</div>
            </div>

            <div className="relative w-64 h-64 mx-auto flex flex-col items-center justify-center rounded-full border-8 border-slate-800 bg-slate-900 shadow-[0_0_50px_rgba(249,115,22,0.1)]">
              <span className="text-7xl font-black tracking-tighter tabular-nums text-white">{Math.floor(tracker.speedKmh)}</span>
              <span className="text-slate-400 font-semibold uppercase tracking-widest text-sm mt-1">km/h</span>
              {tracker.simulated && (
                <span className="absolute top-8 text-[10px] text-sky-400 font-bold uppercase tracking-wider flex items-center gap-1">
                  <FlaskConical size={12} /> Simulation
                </span>
              )}
              {tracker.tracking && !tracker.simulated && (
                <span className={`absolute top-8 text-[10px] font-bold uppercase tracking-wider ${tracker.fusionActive ? 'text-green-400' : 'text-slate-500'}`}>
                  {tracker.fusionActive ? '⚡ Sensor-Fusion aktiv' : 'Nur GPS'}
                </span>
              )}
              {tracker.tracking && !tracker.simulated && tracker.accuracyM != null && tracker.accuracyM > 20 && (
                <span className="absolute bottom-6 text-[10px] text-yellow-400">GPS ungenau ({Math.round(tracker.accuracyM)} m)</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col items-center justify-center">
                <span className="text-sm text-slate-400 mb-1">0 - 100 km/h</span>
                <span className={`text-3xl font-bold tabular-nums ${zeroToHundred ? 'text-green-400' : 'text-white'}`}>
                  {zeroToHundred ? `${zeroToHundred.toFixed(2)}s` : '--.--s'}
                </span>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col items-center justify-center">
                <span className="text-sm text-slate-400 mb-1">Top Speed</span>
                <span className="text-3xl font-bold tabular-nums text-white">{Math.floor(topSpeed)}</span>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col items-center justify-center">
                <span className="text-sm text-slate-400 mb-1">Beschleunigung</span>
                <span className={`text-3xl font-bold tabular-nums ${tracker.accelMs2 > 0.2 ? 'text-green-400' : tracker.accelMs2 < -0.2 ? 'text-red-400' : 'text-white'}`}>
                  {tracker.accelMs2 >= 0 ? '+' : ''}{tracker.accelMs2.toFixed(1)}
                </span>
                <span className="text-[10px] text-slate-500 mt-0.5">m/s² (nur mit Fusion)</span>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col items-center justify-center">
                <span className="text-sm text-slate-400 mb-1">Max. Beschl.</span>
                <span className="text-3xl font-bold tabular-nums text-white">{tracker.peakG.toFixed(2)}</span>
                <span className="text-[10px] text-slate-500 mt-0.5">g</span>
              </div>
            </div>

            <button
              onClick={tracker.tracking ? tracker.stop : startTrackerTab}
              className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-2 transition-all active:scale-95 ${
                tracker.tracking ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30' : 'bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/30'
              }`}
            >
              {tracker.tracking ? <Square size={20} /> : <Play fill="currentColor" size={20} />}
              <span>{tracker.tracking ? 'Tracking stoppen' : 'GPS Tracking starten'}</span>
            </button>

            {/* Simulationsknopf zum Testen ohne Fahren */}
            {!tracker.tracking && (
              <button
                onClick={startTrackerSim}
                className="w-full py-3 rounded-xl font-semibold border border-dashed border-sky-500/50 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 flex items-center justify-center gap-2 transition-all"
              >
                <FlaskConical size={18} /> 🧪 Simulation (0-100 ohne GPS testen)
              </button>
            )}

            {zeroToHundred && !tracker.tracking && (
              <div className="bg-slate-900 border border-purple-500/30 rounded-2xl p-5 shadow-[0_0_15px_rgba(168,85,247,0.15)] animate-in slide-in-from-bottom-4">
                <button
                  onClick={handleAnalyzeRun}
                  disabled={isAnalyzing}
                  className="w-full py-3 rounded-xl font-bold bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  {isAnalyzing ? <Loader2 className="animate-spin" size={20} /> : <Sparkles size={20} />}
                  <span>{isAnalyzing ? 'KI analysiert Fahrt...' : '✨ KI Renn-Analyse anfordern'}</span>
                </button>
                {aiAnalysis && (
                  <div className="mt-4 p-4 bg-slate-800 rounded-xl border border-purple-500/50 text-sm leading-relaxed text-purple-100 whitespace-pre-wrap">{aiAnalysis}</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===================== RACE ===================== */}
        {activeTab === 'race' && (
          <div className="space-y-5 animate-in fade-in duration-300">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Swords className="text-orange-500" /> Drag Race
            </h2>

            {/* --- Menü --- */}
            {raceMode === 'menu' && localPhase === 'idle' && (
              <>
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                  <p className="text-sm text-slate-400 font-bold uppercase tracking-wider">Distanz</p>
                  <div className="grid grid-cols-2 gap-3">
                    {DISTANCES.map((d) => (
                      <button
                        key={d.m}
                        onClick={() => setSelectedDistance(d.m)}
                        className={`py-4 rounded-xl font-bold text-lg transition-colors ${
                          selectedDistance === d.m ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={createRace}
                  className="w-full py-4 rounded-xl font-bold text-lg bg-orange-500 hover:bg-orange-600 text-white flex items-center justify-center gap-2 active:scale-95 transition-all"
                >
                  <Plus size={20} /> Online-Rennen erstellen
                </button>

                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
                  <p className="text-sm text-slate-400">Mit Code beitreten</p>
                  <div className="flex gap-2">
                    <input
                      value={joinCodeInput}
                      onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                      maxLength={8}
                      placeholder="z.B. K7Q2"
                      className="flex-1 bg-slate-800 border border-slate-700 rounded-lg p-3 text-white font-mono tracking-widest text-center focus:border-orange-500 outline-none"
                    />
                    <button onClick={joinRace} className="px-5 rounded-lg font-bold bg-sky-600 hover:bg-sky-500 text-white">
                      Beitreten
                    </button>
                  </div>
                </div>

                <div className="border-t border-slate-800 pt-4 space-y-3">
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-bold">Testen ohne Fahren</p>
                  <button
                    onClick={startSimRace}
                    className="w-full py-3 rounded-xl font-semibold border border-dashed border-sky-500/50 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 flex items-center justify-center gap-2"
                  >
                    <FlaskConical size={18} /> 🧪 Renn-Simulation (gegen Geist 👻)
                  </button>
                  <button
                    onClick={startSolo}
                    className="w-full py-3 rounded-xl font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center gap-2"
                  >
                    <Timer size={18} /> Solo-Übung (echtes GPS, alleine)
                  </button>
                </div>

                {raceError && <p className="text-sm text-red-400 text-center">{raceError}</p>}
              </>
            )}

            {/* --- Lobby (warten / bereit) --- */}
            {raceMode === 'lobby' && race && (race.status === 'waiting' || race.status === 'ready') && localPhase === 'idle' && (
              <div className="space-y-5">
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center">
                  <p className="text-sm text-slate-400 mb-1">Renn-Code (an Gegner weitergeben)</p>
                  <p className="text-5xl font-black font-mono tracking-[0.3em] text-orange-500 mb-3">{raceId}</p>
                  <p className="text-sm text-slate-400">Distanz: {DISTANCES.find((d) => d.m === race.distance)?.label}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-900 border border-orange-500/40 rounded-2xl p-4 text-center">
                    <div className="text-3xl mb-1">{race.hostCar?.icon}</div>
                    <p className="font-bold truncate">{race.hostName}</p>
                    <p className="text-[10px] text-orange-400 uppercase">Host</p>
                  </div>
                  <div className={`rounded-2xl p-4 text-center border ${race.guestId ? 'bg-slate-900 border-sky-500/40' : 'bg-slate-900/40 border-slate-800 border-dashed'}`}>
                    {race.guestId ? (
                      <>
                        <div className="text-3xl mb-1">{race.guestCar?.icon}</div>
                        <p className="font-bold truncate">{race.guestName}</p>
                        <p className="text-[10px] text-sky-400 uppercase">Gegner</p>
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full text-slate-500">
                        <Loader2 className="animate-spin mb-2" size={24} />
                        <p className="text-xs">Warte auf Gegner…</p>
                      </div>
                    )}
                  </div>
                </div>

                {isHost ? (
                  <button
                    onClick={startOnlineRace}
                    disabled={!race.guestId}
                    className="w-full py-4 rounded-xl font-bold text-lg bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white flex items-center justify-center gap-2 active:scale-95 transition-all"
                  >
                    <Flag size={20} /> {race.guestId ? 'Rennen starten' : 'Warte auf Gegner…'}
                  </button>
                ) : (
                  <p className="text-center text-slate-400 py-3">Warte auf den Start durch den Host…</p>
                )}

                <button onClick={() => resetRace(true)} className="w-full py-2 text-slate-500 text-sm flex items-center justify-center gap-1">
                  <ArrowLeft size={16} /> Rennen verlassen
                </button>
              </div>
            )}

            {/* --- Countdown --- */}
            {localPhase === 'countdown' && (
              <div className="flex flex-col items-center gap-6 py-6">
                {raceMode === 'sim' && (
                  <span className="text-[11px] text-sky-400 font-bold uppercase tracking-wider flex items-center gap-1">
                    <FlaskConical size={13} /> Simulation gegen Geist
                  </span>
                )}
                <TrafficLight phase={lightPhase} />
                <p className="text-6xl font-black tabular-nums text-white">
                  {msToGreen != null && msToGreen > 0 ? Math.ceil(msToGreen / 1000) : 'LOS!'}
                </p>
                <p className="text-slate-400">Mach dich bereit… {DISTANCES.find((d) => d.m === target)?.label}</p>
              </div>
            )}

            {/* --- Rennen läuft --- */}
            {localPhase === 'racing' && (
              <div className="space-y-6">
                <TrafficLight phase="green" />
                <div className="text-center">
                  <span className="text-6xl font-black tabular-nums text-white">{Math.floor(tracker.speedKmh)}</span>
                  <span className="text-slate-400 font-semibold uppercase tracking-widest text-sm ml-2">km/h</span>
                  {tracker.simulated && <span className="ml-2 text-[10px] text-sky-400 uppercase">(Sim)</span>}
                  {tracker.fusionActive && (
                    <p className="text-xs text-slate-500 mt-1 tabular-nums">
                      {tracker.accelMs2 >= 0 ? '+' : ''}{tracker.accelMs2.toFixed(1)} m/s²
                    </p>
                  )}
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
                  <ProgressRow name={userProfile.username} icon={userProfile.car.icon} dist={tracker.distanceM} target={target} isYou finishTime={myFinish} />
                  {raceMode === 'lobby' && oppId && (
                    <ProgressRow name={oppName} icon={oppCar?.icon} dist={oppResult?.distance || 0} target={target} finishTime={oppResult?.finished ? oppResult.finishTime : null} />
                  )}
                  {raceMode === 'sim' && ghost && (
                    <ProgressRow name={ghost.name} icon={ghost.icon} dist={ghostDist} target={target} finishTime={ghostFinished ? ghost.time : null} />
                  )}
                </div>
                {myFinish != null && raceMode === 'lobby' && (
                  <p className="text-center text-green-400 font-bold">Im Ziel! Warte auf Gegner…</p>
                )}
                <button onClick={() => resetRace(true)} className="w-full py-2 text-slate-500 text-sm">Abbrechen</button>
              </div>
            )}

            {/* --- Ergebnis --- */}
            {localPhase === 'finished' && (
              <div className="space-y-5 text-center">
                <div className={`rounded-2xl p-6 border ${
                  raceOutcome === 'win' ? 'bg-green-500/10 border-green-500/40' :
                  raceOutcome === 'lose' ? 'bg-red-500/10 border-red-500/40' :
                  'bg-slate-900 border-slate-800'
                }`}>
                  <div className="text-6xl mb-3">
                    {raceOutcome === 'win' ? '🏆' : raceOutcome === 'lose' ? '😤' : '🏁'}
                  </div>
                  <h3 className="text-2xl font-black mb-1">
                    {raceOutcome === 'win' ? 'Gewonnen!' : raceOutcome === 'lose' ? 'Verloren' : 'Lauf beendet'}
                  </h3>
                  {myFinish != null && <p className="text-slate-300">Deine Zeit: <span className="font-bold tabular-nums">{myFinish.toFixed(2)}s</span></p>}
                  {raceMode === 'lobby' && oppResult?.finishTime != null && (
                    <p className="text-slate-400 text-sm">Gegner: {oppResult.finishTime.toFixed(2)}s</p>
                  )}
                  {raceMode === 'sim' && ghost && (
                    <p className="text-slate-400 text-sm">Geist 👻: {ghost.time.toFixed(2)}s</p>
                  )}
                  {raceOutcome === 'win' && <p className="text-green-400 font-bold mt-2">+25 Punkte</p>}
                  {raceOutcome === 'lose' && <p className="text-slate-400 font-bold mt-2">+8 Punkte</p>}
                  {raceMode === 'sim' && (
                    <p className="text-[11px] text-sky-400/80 mt-2">Simulation – Punkte wurden trotzdem echt gutgeschrieben.</p>
                  )}
                </div>
                <button onClick={() => resetRace(true)} className="w-full py-3 rounded-xl font-bold bg-orange-500 hover:bg-orange-600 text-white">
                  Zurück zum Menü
                </button>
              </div>
            )}
          </div>
        )}

        {/* ===================== RANKS ===================== */}
        {activeTab === 'leaderboard' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Trophy className="text-yellow-500" /> Rangliste
            </h2>

            <div className="flex gap-2 bg-slate-900 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setBoardMode('times')}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold ${boardMode === 'times' ? 'bg-orange-500 text-white' : 'text-slate-400'}`}
              >
                Bestzeiten (0-100)
              </button>
              <button
                onClick={() => setBoardMode('points')}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold ${boardMode === 'points' ? 'bg-orange-500 text-white' : 'text-slate-400'}`}
              >
                Renn-Punkte
              </button>
            </div>

            {boardMode === 'times' && (
              <>
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                  {[
                    ['all', 'Global'],
                    ['same_car', 'Gleiches Auto'],
                    ['similar', 'Ähnliche Leistung'],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setLeaderboardFilter(key)}
                      className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-colors flex items-center gap-1 ${
                        leaderboardFilter === key ? 'bg-orange-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                      }`}
                    >
                      {key === 'similar' && <Filter size={14} />} {label}
                    </button>
                  ))}
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                  {filteredLeaderboard.length === 0 ? (
                    <div className="p-8 text-center text-slate-500">Keine Einträge für diesen Filter gefunden.</div>
                  ) : (
                    <ul className="divide-y divide-slate-800/50">
                      {filteredLeaderboard.map((run, index) => (
                        <li key={run.id} className={`p-4 flex items-center justify-between ${run.userId === user.uid ? 'bg-orange-500/5' : ''}`}>
                          <div className="flex items-center gap-3">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${
                              index === 0 ? 'bg-yellow-500 text-yellow-950' : index === 1 ? 'bg-slate-300 text-slate-800' : index === 2 ? 'bg-amber-700 text-amber-100' : 'bg-slate-800 text-slate-400'
                            }`}>{index + 1}</div>
                            <div className="text-2xl">{run.car?.icon || '🚗'}</div>
                            <div>
                              <div className="font-bold text-white flex items-center gap-2">
                                {run.username}
                                {run.userId === user.uid && <span className="text-[9px] bg-orange-500 text-white px-1.5 py-0.5 rounded uppercase">Du</span>}
                              </div>
                              <div className="text-[11px] text-slate-400">{run.car?.make} {run.car?.model}</div>
                            </div>
                          </div>
                          <div className="font-black text-lg text-green-400 tabular-nums">{run.zeroToHundred.toFixed(2)}s</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}

            {boardMode === 'points' && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                {pointsBoard.length === 0 ? (
                  <div className="p-8 text-center text-slate-500">Noch keine Rennen gefahren.</div>
                ) : (
                  <ul className="divide-y divide-slate-800/50">
                    {pointsBoard.map((racer, index) => {
                      const rank = getRank(racer.points || 0);
                      return (
                        <li key={racer.id} className={`p-4 flex items-center justify-between ${racer.id === user.uid ? 'bg-orange-500/5' : ''}`}>
                          <div className="flex items-center gap-3">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${
                              index === 0 ? 'bg-yellow-500 text-yellow-950' : index === 1 ? 'bg-slate-300 text-slate-800' : index === 2 ? 'bg-amber-700 text-amber-100' : 'bg-slate-800 text-slate-400'
                            }`}>{index + 1}</div>
                            <div className="text-2xl">{rank.icon}</div>
                            <div>
                              <div className="font-bold text-white flex items-center gap-2">
                                {racer.username}
                                {racer.id === user.uid && <span className="text-[9px] bg-orange-500 text-white px-1.5 py-0.5 rounded uppercase">Du</span>}
                              </div>
                              <div className="text-[11px] text-slate-400">{rank.name} · {racer.car?.make} {racer.car?.model}</div>
                            </div>
                          </div>
                          <div className="font-black text-lg text-orange-400 tabular-nums">{racer.points || 0}</div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===================== PROFIL ===================== */}
        {activeTab === 'profile' && (
          <div className="space-y-4 animate-in fade-in duration-300">
            <h2 className="text-xl font-bold flex items-center gap-2 mb-6">
              <User className="text-orange-500" /> Profil
            </h2>
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center">
              <div className="text-6xl mb-2">{userProfile.car.icon}</div>
              <h3 className="text-2xl font-bold text-white mb-1">{userProfile.username}</h3>
              <p className="text-slate-400">{userProfile.car.make} {userProfile.car.model}</p>
              {userProfile.car.trim && <p className="text-xs text-slate-500 mb-4">{userProfile.car.trim}</p>}
              {!userProfile.car.trim && <div className="mb-4" />}

              <div className="flex items-center justify-center gap-3 bg-slate-800 rounded-xl py-3 mb-6">
                <span className="text-3xl">{myRank.icon}</span>
                <div className="text-left">
                  <p className="font-bold text-white flex items-center gap-1"><Crown size={16} className="text-yellow-500" /> {myRank.name}</p>
                  <p className="text-sm text-orange-400 font-bold tabular-nums">{userProfile.points || 0} Punkte</p>
                </div>
              </div>

              {/* Fahrzeugdaten aus der Cars API */}
              {userProfile.car.specs && Object.keys(userProfile.car.specs).length > 0 && (
                <div className="text-left mb-5">
                  <p className="text-sm font-bold text-slate-300 mb-3 flex items-center gap-2">
                    <Gauge size={16} className="text-orange-500" /> Fahrzeugdaten
                  </p>

                  {userProfile.car.dataMode === 'free' ? (
                    // Kostenloser Modus: einfache Liste aller vorhandenen Werte
                    <>
                      <div className="bg-slate-800/60 rounded-lg divide-y divide-slate-700/50 mb-2">
                        {Object.entries(userProfile.car.specs).map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-3 px-3 py-2 text-sm">
                            <span className="text-slate-400">{k}</span>
                            <span className="text-white text-right font-medium capitalize">{v}</span>
                          </div>
                        ))}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Testmodus: eingeschränkte Daten (kostenlose API). Höchstgeschwindigkeit, Leistung und Motordetails gibt es im vollen Modus.
                      </p>
                    </>
                  ) : (
                    // Voller Modus: Highlights + ausklappbare Vollliste
                    <>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        {SPEC_HIGHLIGHTS.filter(([k]) => userProfile.car.specs[k]).map(([k, label]) => (
                          <div key={k} className="bg-slate-800 rounded-lg p-3">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
                            <p className="text-sm font-bold text-white">{userProfile.car.specs[k]}</p>
                          </div>
                        ))}
                      </div>

                      {showAllSpecs && (
                        <div className="bg-slate-800/60 rounded-lg divide-y divide-slate-700/50 mb-3 animate-in fade-in duration-200">
                          {Object.keys(SPEC_LABELS)
                            .filter((k) => userProfile.car.specs[k] != null)
                            .map((k) => (
                              <div key={k} className="flex justify-between gap-3 px-3 py-2 text-sm">
                                <span className="text-slate-400">{SPEC_LABELS[k]}</span>
                                <span className="text-white text-right font-medium">{userProfile.car.specs[k]}</span>
                              </div>
                            ))}
                        </div>
                      )}

                      <button
                        onClick={() => setShowAllSpecs((v) => !v)}
                        className="w-full py-2 rounded-lg text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300"
                      >
                        {showAllSpecs ? 'Weniger anzeigen' : 'Alle technischen Daten anzeigen'}
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className="text-left mb-2">
                <button
                  onClick={handleGetTuningTips}
                  disabled={isFetchingTuning}
                  className="w-full py-3 rounded-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-50 shadow-lg"
                >
                  {isFetchingTuning ? <Loader2 className="animate-spin" size={20} /> : <Sparkles size={20} />}
                  <span>{isFetchingTuning ? 'Tuning-Pläne werden erstellt...' : '✨ KI Tuning-Tipps für mein Auto'}</span>
                </button>
                {tuningTips && (
                  <div className="mt-4 p-5 bg-slate-800 rounded-xl border border-indigo-500/30 text-sm leading-relaxed text-indigo-100 whitespace-pre-wrap">{tuningTips}</div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Navigation */}
      <nav className="fixed bottom-0 w-full bg-slate-900/90 backdrop-blur-lg border-t border-slate-800 pb-safe">
        <div className="max-w-md mx-auto flex justify-between p-2 px-6">
          {[
            ['tracker', Activity, 'Track'],
            ['race', Swords, 'Race'],
            ['leaderboard', Trophy, 'Ranks'],
            ['profile', User, 'Profil'],
          ].map(([key, Icon, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex flex-col items-center p-2 transition-colors ${activeTab === key ? 'text-orange-500' : 'text-slate-500'}`}
            >
              <Icon size={24} className="mb-1" />
              <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
