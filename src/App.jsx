import React, { useState, useEffect, useRef } from 'react';
import {
  Play, Square, Trophy, Activity, AlertTriangle, FastForward, User, Filter,
  Sparkles, Loader2, Flag, Plus, Timer, Swords, Crown, ArrowLeft, FlaskConical,
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import {
  getFirestore, collection, addDoc, onSnapshot, serverTimestamp, doc, setDoc,
  getDoc, updateDoc, deleteDoc, increment,
} from 'firebase/firestore';

// =====================================================================
//  EHRLICHE HINWEISE ZU DIESER VERSION (bitte lesen):
//
//  1) "10 Hz": Ein Browser kann KEINE echten 10-Hz-GPS-Daten liefern.
//     watchPosition feuert in der Praxis ~1x pro Sekunde, die Rate ist
//     nicht einstellbar. Diese App erzeugt einen 10-Hz-AUSGABE-Takt,
//     indem sie zwischen den echten ~1-Hz-Fixes interpoliert (flüssige
//     Anzeige) und den Ziel-Zeitpunkt zwischen zwei Messungen
//     rechnerisch schätzt (genauer als nur "letzter Messwert"). Das ist
//     KEIN Ersatz für echte 10-Hz-Hardware (Dragy/RaceBox). Dafür
//     bräuchtest du eine native App + externes Bluetooth-GNSS-Modul.
//
//  1b) SENSOR-FUSION: Zwischen den ~1-Hz-GPS-Korrekturen sagt der
//     Beschleunigungssensor (~60 Hz) Geschwindigkeit & Strecke voraus
//     (1D-Kalman-Filter). Schwerkraft und Fahrtrichtungs-Achse werden
//     beim Anfahren automatisch kalibriert. Das Handy muss dafür FEST
//     montiert sein (Halterung) - in der Hand/Hosentasche wird die
//     Achsen-Kalibrierung unbrauchbar. iOS fragt einmalig um Erlaubnis
//     für Bewegungssensoren. Deutlich reaktionsschneller und glatter
//     als nur GPS, aber weiterhin keine Profi-Hardware: Handy-Sensoren
//     rauschen und driften.
//
//  2) Renn-Synchronisation: Die Ampel wird über die Server-Zeit auf
//     beiden Handys synchronisiert. Wegen Netzwerk-/Uhren-Schwankungen
//     nur auf ~0,1-0,3 s genau. Jeder misst seine EIGENE Zeit von seiner
//     eigenen Ampel bis zu seinem Ziel.
//
//  3) SIMULATIONSMODUS (neu): Zum Testen am PC ohne echtes GPS/Fahren.
//     Erzeugt eine realistische Beschleunigungskurve und speist sie in
//     dieselbe Mess-Pipeline wie echtes GPS. Klar als "Simulation"
//     gekennzeichnet. Achtung: Simulierte Rennen schreiben ECHTE Punkte
//     in die Rangliste (damit du die Ranglisten-Logik wirklich testen
//     kannst) - dein Punktestand verändert sich dadurch tatsächlich.
//
//  4) Fairness/Cheating: Ergebnisse werden von den Geräten selbst
//     geschrieben. Ein manipulationssicheres System bräuchte eine
//     serverseitige Prüfung (Cloud Function).
// =====================================================================

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

    // 6) Kalman-VORHERSAGE: Geschwindigkeit & Strecke fortschreiben
    vRef.current = Math.max(0, vRef.current + aLong * dt);
    PRef.current += Q * dt;
    distRef.current += vRef.current * dt;

    // Stillstands-Korrektur (ZUPT): am Stand nicht "davondriften"
    const gpsSpd = lastGps.current?.speed ?? 0;
    if (ahMag < 0.3 && vRef.current < 0.8 && gpsSpd < 0.6) {
      vRef.current *= 0.9;
      if (vRef.current < 0.05) vRef.current = 0;
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
      if (d > 0.4) gpsDistRef.current += d;
      // Wenn der Browser keine Geschwindigkeit liefert: aus Strecke/Zeit ableiten
      if (z == null) z = d / dtS;
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

  // Fahrzeug-Auswahl beim Setup
  const [carDatabase, setCarDatabase] = useState([]);
  const [setupName, setSetupName] = useState('');
  const [setupCarId, setSetupCarId] = useState('');

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

  // --- Fahrzeugdaten (simulierte API) ---
  useEffect(() => {
    const cars = [
      { id: 'c1', make: 'Porsche', model: '911 Turbo S', icon: '🏎️', factory0to100: 2.7, type: 'sports' },
      { id: 'c2', make: 'Tesla', model: 'Model 3 Perf.', icon: '⚡', factory0to100: 3.3, type: 'ev' },
      { id: 'c3', make: 'BMW', model: 'M3 Competition', icon: '🚘', factory0to100: 3.9, type: 'sports' },
      { id: 'c4', make: 'Mercedes', model: 'A45 AMG', icon: '🚙', factory0to100: 3.9, type: 'compact' },
      { id: 'c5', make: 'VW', model: 'Golf 8 GTI', icon: '🚗', factory0to100: 6.2, type: 'compact' },
      { id: 'c6', make: 'Ford', model: 'Mustang GT', icon: '🐎', factory0to100: 4.6, type: 'muscle' },
      { id: 'c7', make: 'Audi', model: 'RS6 Avant', icon: '🏎️', factory0to100: 3.6, type: 'wagon' },
      { id: 'c8', make: 'Toyota', model: 'GR Yaris', icon: '🚗', factory0to100: 5.5, type: 'compact' },
    ];
    const t = setTimeout(() => {
      setCarDatabase(cars);
      setSetupCarId(cars[0].id);
    }, 400);
    return () => clearTimeout(t);
  }, []);

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
    const prompt = `Ich bin auf einer abgesperrten Strecke mit meinem ${c.make} ${c.model} von 0 auf 100 km/h in ${zeroToHundred.toFixed(2)} Sekunden beschleunigt. Werksangabe: ${c.factory0to100} Sekunden. Gib mir ein kurzes, witziges Feedback in 2-3 Sätzen!`;
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
    const selectedCar = carDatabase.find((c) => c.id === setupCarId);
    if (!username || !selectedCar || !user) return;
    const profileData = { username, car: selectedCar, points: 0, createdAt: serverTimestamp() };
    try {
      await setDoc(doc(db, 'artifacts', appId, 'users', user.uid), profileData);
      await setDoc(racerRef(user.uid), { username, car: selectedCar, points: 0 }, { merge: true });
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
    if (s.cumDist >= raceTargetRef.current && s.prevCumDist < raceTargetRef.current) {
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
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center p-6 pt-20">
        <div className="w-full max-w-sm bg-slate-900 p-6 rounded-2xl border border-slate-800 space-y-6">
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
          <div>
            <label className="block text-sm text-slate-400 mb-2">Wähle dein Auto</label>
            {carDatabase.length === 0 ? (
              <div className="p-3 text-slate-500 animate-pulse">Fahrzeuge werden geladen...</div>
            ) : (
              <select
                value={setupCarId}
                onChange={(e) => setSetupCarId(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-white focus:border-orange-500 outline-none appearance-none"
              >
                {carDatabase.map((car) => (
                  <option key={car.id} value={car.id}>
                    {car.icon} {car.make} {car.model} (~{car.factory0to100}s)
                  </option>
                ))}
              </select>
            )}
          </div>
          <button
            onClick={handleProfileSetup}
            disabled={carDatabase.length === 0 || !setupName.trim()}
            className="w-full bg-orange-500 text-white font-bold rounded-lg p-3 hover:bg-orange-600 disabled:opacity-50"
          >
            Loslegen
          </button>
        </div>
      </div>
    );
  }

  const myRank = getRank(userProfile.points || 0);
  const filteredLeaderboard = leaderboard.filter((run) => {
    if (leaderboardFilter === 'all') return true;
    if (leaderboardFilter === 'same_car') return run.car?.id === userProfile.car.id;
    if (leaderboardFilter === 'similar')
      return run.car && Math.abs(run.car.factory0to100 - userProfile.car.factory0to100) <= 0.5;
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
                <p className="text-sm text-slate-400">Werksangabe: {userProfile.car.factory0to100}s</p>
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
              <p className="text-slate-400 mb-4">{userProfile.car.make} {userProfile.car.model}</p>

              <div className="flex items-center justify-center gap-3 bg-slate-800 rounded-xl py-3 mb-6">
                <span className="text-3xl">{myRank.icon}</span>
                <div className="text-left">
                  <p className="font-bold text-white flex items-center gap-1"><Crown size={16} className="text-yellow-500" /> {myRank.name}</p>
                  <p className="text-sm text-orange-400 font-bold tabular-nums">{userProfile.points || 0} Punkte</p>
                </div>
              </div>

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
