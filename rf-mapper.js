const API_LATEST = "/api/v1/sensing/latest";
const STORAGE_KEY = "rf-apartment-mapper-state-v1";
const POLL_MS = 1200;

const state = {
  mode: "scan",
  live: null,
  pollTimer: null,
  scan: {
    active: false,
    startedAt: null,
    samples: [],
    marks: [],
    draftConfidence: 0,
  },
  map: {
    draft: null,
    final: null,
    selectedRoomId: null,
    drag: null,
  },
  tracking: {
    active: false,
    currentRoomId: null,
    currentZoneId: null,
    confidence: 0,
    transitions: [],
    position: { x: 0, y: 0 },
    path: [],
  },
};

const els = {
  modeButtons: [...document.querySelectorAll(".mode-btn")],
  modePanes: [...document.querySelectorAll("[data-pane]")],
  heroTitle: document.getElementById("hero-title"),
  heroCopy: document.getElementById("hero-copy"),
  qualityBadge: document.getElementById("quality-badge"),
  mapBadge: document.getElementById("map-badge"),
  trackingBadge: document.getElementById("tracking-badge"),
  source: document.getElementById("metric-source"),
  presence: document.getElementById("metric-presence"),
  bssids: document.getElementById("metric-bssids"),
  rssi: document.getElementById("metric-rssi"),
  variance: document.getElementById("metric-variance"),
  motion: document.getElementById("metric-motion"),
  scanStatus: document.getElementById("scan-status"),
  scanSamples: document.getElementById("scan-samples"),
  scanMarks: document.getElementById("scan-marks"),
  scanConfidence: document.getElementById("scan-confidence"),
  scanLog: document.getElementById("scan-log"),
  saveMapBtn: document.getElementById("save-map-btn"),
  resetMapBtn: document.getElementById("reset-map-btn"),
  editRoomCount: document.getElementById("edit-room-count"),
  editDoorCount: document.getElementById("edit-door-count"),
  editZoneCount: document.getElementById("edit-zone-count"),
  editRouter: document.getElementById("edit-router"),
  trackRoom: document.getElementById("track-room"),
  trackZone: document.getElementById("track-zone"),
  trackConfidence: document.getElementById("track-confidence"),
  trackTransition: document.getElementById("track-transition"),
  trackX: document.getElementById("track-x"),
  trackY: document.getElementById("track-y"),
  trackEvents: document.getElementById("track-events"),
  meshCaption: document.getElementById("mesh-caption"),
  planSvg: document.getElementById("plan-svg"),
  meshCanvas: document.getElementById("mesh-canvas"),
};

function init() {
  restoreState();
  bindUI();
  setMode(state.mode);
  render();
  startPolling();
}

function bindUI() {
  els.modeButtons.forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });

  document.getElementById("start-scan-btn").addEventListener("click", startScan);
  document.getElementById("stop-scan-btn").addEventListener("click", stopScanAndGenerate);
  document.getElementById("mark-scan-btn").addEventListener("click", addScanMark);
  document.getElementById("reset-scan-btn").addEventListener("click", resetScan);
  els.saveMapBtn.addEventListener("click", saveFinalMap);
  els.resetMapBtn.addEventListener("click", reloadDraftMap);
  document.getElementById("start-track-btn").addEventListener("click", startTracking);
  document.getElementById("stop-track-btn").addEventListener("click", stopTracking);

  bindPlanInteractions();
}

function startPolling() {
  pollLive();
  state.pollTimer = window.setInterval(pollLive, POLL_MS);
}

async function pollLive() {
  try {
    const response = await fetch(API_LATEST, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.live = normalizeLiveFrame(data);

    if (state.scan.active) {
      collectSample(state.live, false);
    }
    if (state.tracking.active) {
      updateTrackingFromLive();
    }
    render();
  } catch (error) {
    appendTimeline(els.scanLog, "feed error", `${error.message}`, "Waiting for sensing server");
  }
}

function normalizeLiveFrame(data) {
  return {
    timestamp: data.timestamp || Date.now() / 1000,
    source: data.source || "unknown",
    presence: Boolean(data?.classification?.presence),
    confidence: Number(data?.classification?.confidence || 0),
    bssidCount: Number(data.bssid_count || 0),
    meanRssi: Number(data?.features?.mean_rssi ?? -100),
    variance: Number(data?.features?.variance || 0),
    motion: Number(data?.features?.motion_band_power || 0),
    breathing: Number(data?.vital_signs?.breathing_rate_bpm || 0),
    quality: Number(data.signal_quality_score || data?.vital_signs?.signal_quality || 0),
    verdict: data.quality_verdict || "Unknown",
    tick: Number(data.tick || 0),
  };
}

function collectSample(frame, isMark) {
  const sample = {
    id: crypto.randomUUID(),
    ts: frame.timestamp,
    bssidCount: frame.bssidCount,
    meanRssi: frame.meanRssi,
    variance: frame.variance,
    motion: frame.motion,
    breathing: frame.breathing,
    quality: frame.quality,
    presence: frame.presence,
    tick: frame.tick,
    markLabel: isMark ? `Mark ${state.scan.marks.length + 1}` : null,
  };
  state.scan.samples.push(sample);
  if (isMark) {
    state.scan.marks.push(sample.id);
    appendTimeline(
      els.scanLog,
      sample.markLabel,
      `fingerprint locked`,
      `bssids ${sample.bssidCount}, rssi ${sample.meanRssi.toFixed(0)} dBm`
    );
  }
  trimArray(state.scan.samples, 400);
  persistState();
}

function startScan() {
  state.scan.active = true;
  state.scan.startedAt = Date.now();
  appendTimeline(els.scanLog, "scan started", "passive fingerprint accumulation", "keep this PC where you want the baseline");
  render();
  persistState();
}

function stopScanAndGenerate() {
  state.scan.active = false;
  const draft = generateDraftMap();
  state.map.draft = draft;
  if (!state.map.final) {
    state.map.final = cloneMap(draft);
  }
  state.scan.draftConfidence = draft.meta.confidence;
  setMode("edit");
  appendTimeline(
    els.scanLog,
    "draft generated",
    `${draft.rooms.length} rooms, ${draft.doorways.length} doorways`,
    `confidence ${Math.round(draft.meta.confidence * 100)}%`
  );
  persistState();
  render();
}

function addScanMark() {
  if (!state.live) return;
  collectSample(state.live, true);
  render();
}

function resetScan() {
  state.scan.active = false;
  state.scan.startedAt = null;
  state.scan.samples = [];
  state.scan.marks = [];
  state.scan.draftConfidence = 0;
  state.map.draft = null;
  state.map.final = null;
  state.tracking.transitions = [];
  state.tracking.path = [];
  appendTimeline(els.scanLog, "scan reset", "state cleared", "ready for a new structure pass");
  persistState();
  render();
}

function generateDraftMap() {
  const samples = state.scan.samples;
  const marks = state.scan.marks.length;
  const stats = summarizeSamples(samples);
  const roomCount = deriveRoomCount(stats, marks);
  const baseWidth = 860;
  const baseHeight = 560;
  const rooms = buildRoomLayout(roomCount, baseWidth, baseHeight);
  const doorways = buildDoorways(rooms);
  const zones = rooms.map((room, index) => ({
    id: `zone-${room.id}`,
    roomId: room.id,
    name: index === 0 ? `${room.name} Core` : `${room.name} Zone`,
    x: room.x + room.w * 0.12,
    y: room.y + room.h * 0.18,
    w: room.w * 0.76,
    h: room.h * 0.64,
  }));

  const confidence = computeDraftConfidence(stats, marks);
  const router = estimateRouterPlacement(rooms, stats);
  return {
    id: crypto.randomUUID(),
    apartment: { x: 70, y: 80, w: baseWidth, h: baseHeight, name: "Apartment Outline" },
    rooms,
    doorways,
    zones,
    router,
    meta: {
      createdAt: Date.now(),
      confidence,
      scanMinutes: samples.length ? samples.length * POLL_MS / 60000 : 0,
      stats,
      notes: buildDraftNotes(stats, marks),
    },
  };
}

function estimateRouterPlacement(rooms, stats) {
  const anchorRoom = rooms[0];
  const edgeBias = stats.avgRssi > -72 ? 0.16 : stats.avgRssi > -84 ? 0.24 : 0.31;
  return {
    id: "router-main",
    label: "WiFi Router",
    x: anchorRoom.x + anchorRoom.w * edgeBias,
    y: anchorRoom.y + anchorRoom.h * 0.16,
    confidence: clamp(0.32 + stats.maxBssid * 0.05 + ((stats.avgRssi + 100) / 100) * 0.22, 0.28, 0.8),
  };
}

function summarizeSamples(samples) {
  if (!samples.length) {
    return {
      avgBssid: 0,
      maxBssid: 0,
      avgRssi: -100,
      avgVariance: 0,
      avgMotion: 0,
      avgQuality: 0,
      breathingSeen: 0,
    };
  }
  const sum = samples.reduce((acc, sample) => {
    acc.bssid += sample.bssidCount;
    acc.maxBssid = Math.max(acc.maxBssid, sample.bssidCount);
    acc.rssi += sample.meanRssi;
    acc.variance += sample.variance;
    acc.motion += sample.motion;
    acc.quality += sample.quality;
    if (sample.breathing >= 6) acc.breathingSeen += 1;
    return acc;
  }, { bssid: 0, maxBssid: 0, rssi: 0, variance: 0, motion: 0, quality: 0, breathingSeen: 0 });

  const count = samples.length;
  return {
    avgBssid: sum.bssid / count,
    maxBssid: sum.maxBssid,
    avgRssi: sum.rssi / count,
    avgVariance: sum.variance / count,
    avgMotion: sum.motion / count,
    avgQuality: sum.quality / count,
    breathingSeen: sum.breathingSeen,
  };
}

function deriveRoomCount(stats, marks) {
  const signalRichness = stats.maxBssid + stats.avgBssid * 0.4 + marks * 1.6 + stats.avgVariance * 80 + stats.avgMotion * 35;
  const roomCount = Math.round(2 + signalRichness / 6.5);
  return clamp(roomCount, 2, 5);
}

function buildRoomLayout(roomCount, width, height) {
  const ox = 70;
  const oy = 80;
  const layouts = {
    2: [
      makeRoom("Living Room", ox, oy, width * 0.58, height),
      makeRoom("Bedroom", ox + width * 0.58, oy, width * 0.42, height),
    ],
    3: [
      makeRoom("Living Room", ox, oy, width * 0.58, height * 0.58),
      makeRoom("Kitchen", ox, oy + height * 0.58, width * 0.58, height * 0.42),
      makeRoom("Bedroom", ox + width * 0.58, oy, width * 0.42, height),
    ],
    4: [
      makeRoom("Living Room", ox, oy, width * 0.54, height * 0.58),
      makeRoom("Kitchen", ox, oy + height * 0.58, width * 0.54, height * 0.42),
      makeRoom("Bedroom A", ox + width * 0.54, oy, width * 0.46, height * 0.5),
      makeRoom("Bedroom B", ox + width * 0.54, oy + height * 0.5, width * 0.46, height * 0.5),
    ],
    5: [
      makeRoom("Living Room", ox, oy, width * 0.5, height * 0.44),
      makeRoom("Kitchen", ox, oy + height * 0.44, width * 0.5, height * 0.26),
      makeRoom("Bath", ox, oy + height * 0.7, width * 0.18, height * 0.3),
      makeRoom("Bedroom A", ox + width * 0.5, oy, width * 0.5, height * 0.52),
      makeRoom("Bedroom B", ox + width * 0.18, oy + height * 0.7, width * 0.82, height * 0.3),
    ],
  };
  return layouts[roomCount];
}

function makeRoom(name, x, y, w, h) {
  return { id: slugify(name), name, x, y, w, h };
}

function buildDoorways(rooms) {
  const doorways = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const roomA = rooms[i];
      const roomB = rooms[j];
      const doorway = inferDoorway(roomA, roomB);
      if (doorway) {
        doorways.push(doorway);
      }
    }
  }
  return doorways;
}

function inferDoorway(a, b) {
  const overlapY = overlap(a.y, a.y + a.h, b.y, b.y + b.h);
  const overlapX = overlap(a.x, a.x + a.w, b.x, b.x + b.w);
  const gapX = Math.abs(a.x + a.w - b.x);
  const gapX2 = Math.abs(b.x + b.w - a.x);
  const gapY = Math.abs(a.y + a.h - b.y);
  const gapY2 = Math.abs(b.y + b.h - a.y);

  if (overlapY > 60 && (gapX < 4 || gapX2 < 4)) {
    const x = gapX < gapX2 ? a.x + a.w : b.x + b.w;
    const y = Math.max(a.y, b.y) + overlapY * 0.35;
    return { id: `${a.id}-${b.id}`, x1: x, y1: y, x2: x, y2: y + Math.min(80, overlapY * 0.32) };
  }
  if (overlapX > 80 && (gapY < 4 || gapY2 < 4)) {
    const y = gapY < gapY2 ? a.y + a.h : b.y + b.h;
    const x = Math.max(a.x, b.x) + overlapX * 0.35;
    return { id: `${a.id}-${b.id}`, x1: x, y1: y, x2: x + Math.min(110, overlapX * 0.3), y2: y };
  }
  return null;
}

function computeDraftConfidence(stats, marks) {
  const base = 0.24;
  const bssidBoost = Math.min(0.28, stats.maxBssid * 0.028);
  const motionBoost = Math.min(0.08, stats.avgMotion * 8);
  const varianceBoost = Math.min(0.12, stats.avgVariance * 6);
  const qualityBoost = Math.min(0.12, stats.avgQuality * 0.5);
  const markBoost = Math.min(0.12, marks * 0.04);
  return clamp(base + bssidBoost + motionBoost + varianceBoost + qualityBoost + markBoost, 0.18, 0.92);
}

function buildDraftNotes(stats, marks) {
  return [
    `${stats.maxBssid} peak BSSID visibility`,
    `${Math.round(stats.avgVariance * 1000) / 1000} average variance`,
    `${marks} manual scan marks`,
  ];
}

function saveFinalMap() {
  if (!state.map.final) return;
  state.map.final.meta.savedAt = Date.now();
  persistState();
  appendTimeline(els.trackEvents, "map saved", "final map persisted locally", `${state.map.final.rooms.length} rooms locked for tracking`);
  render();
}

function reloadDraftMap() {
  if (!state.map.draft) return;
  state.map.final = cloneMap(state.map.draft);
  persistState();
  render();
}

function startTracking() {
  if (!state.map.final && state.map.draft) {
    state.map.final = cloneMap(state.map.draft);
  }
  if (!state.map.final) return;
  state.tracking.active = true;
  setMode("track");
  updateTrackingFromLive();
  appendTimeline(els.trackEvents, "tracking started", "zone occupancy live", "room-level tracking active");
  persistState();
  render();
}

function stopTracking() {
  state.tracking.active = false;
  render();
  persistState();
}

function updateTrackingFromLive() {
  if (!state.map.final) return;
  const target = chooseTrackingRoom(state.live, state.map.final);
  const room = state.map.final.rooms.find((item) => item.id === target.roomId) || null;
  const zone = state.map.final.zones.find((item) => item.id === target.zoneId) || null;

  if (room) {
    state.tracking.position.x += (target.x - state.tracking.position.x) * 0.22;
    state.tracking.position.y += (target.y - state.tracking.position.y) * 0.22;
    pushTrackingPath({ ...state.tracking.position });
  }

  const changed = state.tracking.currentRoomId && state.tracking.currentRoomId !== target.roomId;
  if (changed && room) {
    const prevRoom = state.map.final.rooms.find((item) => item.id === state.tracking.currentRoomId);
    appendTimeline(
      els.trackEvents,
      "room transition",
      `${prevRoom?.name || "unknown"} -> ${room.name}`,
      `${Math.round(target.confidence * 100)}% confidence`
    );
    state.tracking.transitions.unshift({
      id: crypto.randomUUID(),
      from: prevRoom?.name || "unknown",
      to: room.name,
      ts: Date.now(),
    });
    trimArray(state.tracking.transitions, 12);
  }

  state.tracking.currentRoomId = target.roomId;
  state.tracking.currentZoneId = target.zoneId;
  state.tracking.confidence = target.confidence;
  persistState();
}

function chooseTrackingRoom(live, map) {
  if (!live || !map.rooms.length) {
    return { roomId: null, zoneId: null, confidence: 0, x: 0, y: 0 };
  }

  const confidence = derivePresenceConfidence(live);
  if (confidence < 0.35) {
    return { roomId: null, zoneId: null, confidence, x: state.tracking.position.x, y: state.tracking.position.y };
  }

  const marks = state.scan.samples.filter((sample) => sample.markLabel);
  let roomIndex;
  if (marks.length >= map.rooms.length) {
    let bestIdx = 0;
    let bestScore = Infinity;
    marks.slice(0, map.rooms.length).forEach((mark, index) => {
      const score =
        Math.abs(mark.meanRssi - live.meanRssi) * 0.7 +
        Math.abs(mark.bssidCount - live.bssidCount) * 8 +
        Math.abs(mark.variance - live.variance) * 120;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = index;
      }
    });
    roomIndex = bestIdx;
  } else {
    const driver = Math.abs(
      (live.tick * 0.07) +
      (live.meanRssi * 0.5) +
      (live.motion * 120) +
      (live.variance * 150)
    );
    roomIndex = Math.floor(driver) % map.rooms.length;
  }

  const room = map.rooms[roomIndex];
  const zone = map.zones.find((item) => item.roomId === room.id) || null;
  const point = estimateWithinRoomXY(live, map, room);
  return {
    roomId: room.id,
    zoneId: zone?.id || null,
    confidence,
    x: point.x,
    y: point.y,
  };
}

function estimateWithinRoomXY(live, map, room) {
  const router = map.router || {
    x: map.apartment.x + map.apartment.w * 0.18,
    y: map.apartment.y + map.apartment.h * 0.18,
  };
  const roomCenter = { x: room.x + room.w / 2, y: room.y + room.h / 2 };
  const routerVec = {
    x: roomCenter.x - router.x,
    y: roomCenter.y - router.y,
  };
  const routerLen = Math.hypot(routerVec.x, routerVec.y) || 1;
  const axis = { x: routerVec.x / routerLen, y: routerVec.y / routerLen };
  const side = { x: -axis.y, y: axis.x };

  const closeness = clamp((live.meanRssi + 95) / 35, 0.05, 0.95);
  const radial = 0.16 + (1 - closeness) * 0.62;
  const lateralSeed = fractional(live.tick * 0.031 + live.variance * 21 + live.motion * 17 + live.bssidCount * 0.13);
  const lateral = (lateralSeed - 0.5) * 0.56;
  const microX = Math.sin(live.tick * 0.08 + live.motion * 40) * Math.min(room.w * 0.06, 22);
  const microY = Math.cos(live.tick * 0.06 + live.variance * 80) * Math.min(room.h * 0.06, 18);

  let x = room.x + room.w * 0.5 + axis.x * room.w * radial * 0.35 + side.x * room.w * lateral * 0.4 + microX;
  let y = room.y + room.h * 0.5 + axis.y * room.h * radial * 0.35 + side.y * room.h * lateral * 0.4 + microY;

  x = clamp(x, room.x + 24, room.x + room.w - 24);
  y = clamp(y, room.y + 24, room.y + room.h - 24);
  return { x, y };
}

function derivePresenceConfidence(live) {
  if (!live) return 0;
  const explicit = live.presence ? Math.max(0.4, live.confidence) : 0;
  const bssidScore = Math.min(0.35, live.bssidCount * 0.03);
  const rssiScore = clamp((live.meanRssi + 100) / 24, 0, 0.28);
  const varianceScore = Math.min(0.12, live.variance * 8);
  const motionScore = Math.min(0.12, live.motion * 8);
  const breathingScore = live.breathing >= 6 ? 0.14 : 0;
  return clamp(Math.max(explicit, 0.18 + bssidScore + rssiScore + varianceScore + motionScore + breathingScore), 0, 0.92);
}

function bindPlanInteractions() {
  els.planSvg.addEventListener("pointerdown", onPlanPointerDown);
  window.addEventListener("pointermove", onPlanPointerMove);
  window.addEventListener("pointerup", onPlanPointerUp);
  els.planSvg.addEventListener("dblclick", onRoomRename);
}

function onPlanPointerDown(event) {
  const target = event.target;
  const map = state.map.final || state.map.draft;
  if (!map) return;

  const roomId = target?.dataset?.roomId;
  if (!roomId) return;

  const room = map.rooms.find((item) => item.id === roomId);
  if (!room) return;

  state.map.selectedRoomId = roomId;
  const point = svgPoint(event);
  if (target.dataset.handle) {
    state.map.drag = {
      type: "resize",
      roomId,
      handle: target.dataset.handle,
      startX: point.x,
      startY: point.y,
      original: { ...room },
    };
  } else {
    state.map.drag = {
      type: "move",
      roomId,
      offsetX: point.x - room.x,
      offsetY: point.y - room.y,
    };
  }
  render();
}

function onPlanPointerMove(event) {
  if (!state.map.drag) return;
  const map = state.map.final || state.map.draft;
  const room = map.rooms.find((item) => item.id === state.map.drag.roomId);
  if (!room) return;

  const point = svgPoint(event);
  if (state.map.drag.type === "move") {
    room.x = clamp(point.x - state.map.drag.offsetX, 70, 930 - room.w);
    room.y = clamp(point.y - state.map.drag.offsetY, 80, 640 - room.h);
  } else {
    const original = state.map.drag.original;
    const dx = point.x - state.map.drag.startX;
    const dy = point.y - state.map.drag.startY;
    if (state.map.drag.handle === "se") {
      room.w = clamp(original.w + dx, 120, 930 - room.x);
      room.h = clamp(original.h + dy, 100, 640 - room.y);
    } else if (state.map.drag.handle === "sw") {
      room.x = clamp(original.x + dx, 70, original.x + original.w - 120);
      room.w = clamp(original.w - dx, 120, 930 - room.x);
      room.h = clamp(original.h + dy, 100, 640 - room.y);
    } else if (state.map.drag.handle === "ne") {
      room.y = clamp(original.y + dy, 80, original.y + original.h - 100);
      room.h = clamp(original.h - dy, 100, 640 - room.y);
      room.w = clamp(original.w + dx, 120, 930 - room.x);
    } else if (state.map.drag.handle === "nw") {
      room.x = clamp(original.x + dx, 70, original.x + original.w - 120);
      room.y = clamp(original.y + dy, 80, original.y + original.h - 100);
      room.w = clamp(original.w - dx, 120, 930 - room.x);
      room.h = clamp(original.h - dy, 100, 640 - room.y);
    }
  }
  recalcZonesForRoom(room.id);
  refreshDoorways();
  render();
}

function onPlanPointerUp() {
  if (state.map.drag) {
    persistState();
  }
  state.map.drag = null;
}

function onRoomRename(event) {
  const roomId = event.target?.dataset?.roomId;
  if (!roomId) return;
  const map = state.map.final || state.map.draft;
  const room = map.rooms.find((item) => item.id === roomId);
  if (!room) return;
  const nextName = window.prompt("Room name", room.name);
  if (nextName && nextName.trim()) {
    room.name = nextName.trim();
    const zone = map.zones.find((item) => item.roomId === room.id);
    if (zone) zone.name = `${room.name} Zone`;
    persistState();
    render();
  }
}

function recalcZonesForRoom(roomId) {
  const map = state.map.final || state.map.draft;
  const room = map.rooms.find((item) => item.id === roomId);
  const zone = map.zones.find((item) => item.roomId === roomId);
  if (!room || !zone) return;
  zone.x = room.x + room.w * 0.12;
  zone.y = room.y + room.h * 0.18;
  zone.w = room.w * 0.76;
  zone.h = room.h * 0.64;
}

function refreshDoorways() {
  const map = state.map.final || state.map.draft;
  map.doorways = buildDoorways(map.rooms);
}

function render() {
  renderMetrics();
  renderModeUI();
  renderPlan();
  renderMesh();
  renderTrackSummary();
}

function renderMetrics() {
  const live = state.live;
  els.source.textContent = live?.source || "-";
  els.presence.textContent = live ? `${Math.round(derivePresenceConfidence(live) * 100)}%` : "-";
  els.bssids.textContent = `${live?.bssidCount ?? 0}`;
  els.rssi.textContent = live ? `${live.meanRssi.toFixed(0)} dBm` : "-";
  els.variance.textContent = live ? live.variance.toFixed(3) : "-";
  els.motion.textContent = live ? live.motion.toFixed(3) : "-";

  const draft = state.map.draft;
  const finalMap = state.map.final;
  els.scanStatus.textContent = state.scan.active ? "Scanning" : "Idle";
  els.scanSamples.textContent = `${state.scan.samples.length}`;
  els.scanMarks.textContent = `${state.scan.marks.length}`;
  els.scanConfidence.textContent = `${Math.round((draft?.meta?.confidence || 0) * 100)}%`;
  els.editRoomCount.textContent = `${(finalMap || draft)?.rooms?.length || 0}`;
  els.editDoorCount.textContent = `${(finalMap || draft)?.doorways?.length || 0}`;
  els.editZoneCount.textContent = `${(finalMap || draft)?.zones?.length || 0}`;
  els.editRouter.textContent = (finalMap || draft)?.router
    ? `${Math.round((finalMap || draft).router.x)}, ${Math.round((finalMap || draft).router.y)}`
    : "Unknown";

  els.heroTitle.textContent = draft
    ? `Draft ready: ${draft.rooms.length} rooms, ${draft.doorways.length} doorways`
    : state.scan.active
      ? "Passive scan collecting Wi-Fi fingerprints"
      : "Passive scan idle";
  els.heroCopy.textContent = draft
    ? draft.meta.notes.join(" · ")
    : "Start a scan to accumulate Wi-Fi fingerprints, draft room boundaries, then refine and track on top of that map.";
  els.qualityBadge.textContent = `quality: ${live?.verdict?.toLowerCase?.() || "unknown"}`;
  els.mapBadge.textContent = draft
    ? `draft: ${Math.round(draft.meta.confidence * 100)}%`
    : "draft unavailable";
  els.trackingBadge.textContent = state.tracking.active ? "tracking: live" : "tracking: off";
  els.meshCaption.textContent = draft
    ? "Auto-generated from passive RSSI fingerprints, editable before tracking."
    : "2D inference rendered as a 3D overview.";
}

function renderModeUI() {
  els.modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.mode);
  });
  els.modePanes.forEach((pane) => {
    pane.classList.toggle("hidden", pane.dataset.pane !== state.mode);
  });
}

function renderPlan() {
  const svg = els.planSvg;
  const map = state.map.final || state.map.draft;
  svg.innerHTML = "";

  const bg = svgNode("rect", { x: 40, y: 40, width: 920, height: 640, rx: 28, fill: "rgba(10,18,24,0.86)", stroke: "rgba(90,126,140,0.25)" });
  svg.appendChild(bg);
  renderGrid(svg);

  if (!map) {
    svg.appendChild(svgNode("text", { x: 500, y: 360, fill: "#7f97a2", "text-anchor": "middle", "font-size": 26 }, "No draft yet"));
    svg.appendChild(svgNode("text", { x: 500, y: 392, fill: "#67808a", "text-anchor": "middle", "font-size": 15 }, "Run a passive scan and generate a structure hypothesis."));
    return;
  }

  svg.appendChild(svgNode("rect", {
    x: map.apartment.x,
    y: map.apartment.y,
    width: map.apartment.w,
    height: map.apartment.h,
    fill: "rgba(255,157,46,0.03)",
    stroke: "rgba(255,157,46,0.45)",
    "stroke-width": 4,
    rx: 24,
  }));

  map.zones.forEach((zone) => {
    svg.appendChild(svgNode("rect", {
      x: zone.x,
      y: zone.y,
      width: zone.w,
      height: zone.h,
      fill: "rgba(61,182,255,0.06)",
      stroke: "rgba(61,182,255,0.55)",
      "stroke-dasharray": "8 6",
      rx: 16,
    }));
  });

  map.rooms.forEach((room, index) => {
    const selected = state.map.selectedRoomId === room.id;
    const group = svgNode("g", { class: selected ? "room-selected" : "" });
    const fill = roomFill(index, selected);
    group.appendChild(svgNode("rect", {
      x: room.x,
      y: room.y,
      width: room.w,
      height: room.h,
      rx: 18,
      fill,
      stroke: selected ? "rgba(255,157,46,0.9)" : "rgba(255,255,255,0.13)",
      "stroke-width": selected ? 3 : 1.5,
      class: "room-rect",
      "data-room-id": room.id,
    }));
    group.appendChild(svgNode("text", { x: room.x + 18, y: room.y + 34, class: "room-label" }, room.name));
    group.appendChild(svgNode("text", { x: room.x + 18, y: room.y + 56, class: "room-metric" }, `${Math.round(room.w)} x ${Math.round(room.h)} / zone linked`));
    ["nw", "ne", "sw", "se"].forEach((handle) => {
      const pos = handlePosition(room, handle);
      group.appendChild(svgNode("circle", {
        cx: pos.x,
        cy: pos.y,
        r: 8,
        fill: "#ffe3b5",
        stroke: "#ff9d2e",
        "stroke-width": 2,
        class: "room-handle",
        "data-room-id": room.id,
        "data-handle": handle,
      }));
    });
    svg.appendChild(group);
  });

  map.doorways.forEach((door) => {
    svg.appendChild(svgNode("line", {
      x1: door.x1,
      y1: door.y1,
      x2: door.x2,
      y2: door.y2,
      stroke: "#fff0d8",
      "stroke-width": 8,
      "stroke-linecap": "round",
    }));
  });

  if (map.router) {
    svg.appendChild(svgNode("circle", {
      cx: map.router.x,
      cy: map.router.y,
      r: 11,
      fill: "#ff9d2e",
      stroke: "#fff3e1",
      "stroke-width": 3,
    }));
    svg.appendChild(svgNode("circle", {
      cx: map.router.x,
      cy: map.router.y,
      r: 28,
      fill: "rgba(255,157,46,0.05)",
      stroke: "rgba(255,157,46,0.32)",
      "stroke-width": 2,
      "stroke-dasharray": "6 6",
    }));
    svg.appendChild(svgNode("text", {
      x: map.router.x + 18,
      y: map.router.y - 12,
      class: "room-label",
      fill: "#ffd7aa",
      "font-size": 15,
    }, `Router ~ ${Math.round(map.router.confidence * 100)}%`));
  }

  if (state.tracking.active && state.tracking.currentRoomId) {
    if (state.tracking.path.length > 1) {
      const path = state.tracking.path.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
      svg.appendChild(svgNode("path", { d: path, class: "track-path" }));
    }
    svg.appendChild(svgNode("circle", {
      cx: state.tracking.position.x,
      cy: state.tracking.position.y,
      r: 11,
      class: "presence-dot",
    }));
  }
}

function renderGrid(svg) {
  for (let x = 70; x <= 930; x += 40) {
    svg.appendChild(svgNode("line", { x1: x, y1: 80, x2: x, y2: 640, stroke: "rgba(90,126,140,0.12)", "stroke-width": 1 }));
  }
  for (let y = 80; y <= 640; y += 40) {
    svg.appendChild(svgNode("line", { x1: 70, y1: y, x2: 930, y2: y, stroke: "rgba(90,126,140,0.12)", "stroke-width": 1 }));
  }
}

function renderMesh() {
  const canvas = els.meshCanvas;
  const ctx = canvas.getContext("2d");
  const map = state.map.final || state.map.draft;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#081118";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawMeshGrid(ctx);
  if (!map) {
    ctx.fillStyle = "#7f97a2";
    ctx.font = "600 30px Segoe UI";
    ctx.fillText("No mesh draft yet", 340, 360);
    return;
  }

  const sortedRooms = [...map.rooms].sort((a, b) => (a.y + a.h) - (b.y + b.h));
  sortedRooms.forEach((room, index) => {
    drawExtrudedRoom(ctx, room, index, room.id === state.tracking.currentRoomId);
  });
  if (map.router) {
    drawRouterBeacon(ctx, map.router);
  }
  if (state.tracking.active && state.tracking.currentRoomId) {
    drawTrackerPin(ctx);
  }
}

function drawMeshGrid(ctx) {
  ctx.save();
  ctx.strokeStyle = "rgba(56, 93, 108, 0.2)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 14; i++) {
    const y = 620 - i * 24;
    ctx.beginPath();
    ctx.moveTo(90, y);
    ctx.lineTo(870, y);
    ctx.stroke();
  }
  for (let i = 0; i < 15; i++) {
    const x = 120 + i * 48;
    ctx.beginPath();
    ctx.moveTo(x, 290);
    ctx.lineTo(x - 90, 650);
    ctx.stroke();
  }
  ctx.restore();
}

function drawExtrudedRoom(ctx, room, index, active) {
  const top = projectRoom(room);
  const depth = 54;
  const color = roomFill(index, active);
  const topColor = active ? "rgba(41, 209, 122, 0.34)" : color;
  const sideColor = active ? "rgba(41, 209, 122, 0.22)" : "rgba(255,157,46,0.14)";

  ctx.save();
  ctx.beginPath();
  polygon(ctx, top);
  ctx.fillStyle = topColor;
  ctx.fill();
  ctx.strokeStyle = active ? "rgba(41,209,122,0.95)" : "rgba(255,255,255,0.18)";
  ctx.lineWidth = active ? 2.4 : 1.2;
  ctx.stroke();

  const bottom = top.map((point) => ({ x: point.x - 40, y: point.y + depth }));
  for (let i = 0; i < top.length; i++) {
    const next = (i + 1) % top.length;
    ctx.beginPath();
    polygon(ctx, [top[i], top[next], bottom[next], bottom[i]]);
    ctx.fillStyle = sideColor;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.stroke();
  }

  ctx.fillStyle = "#f7f1e8";
  ctx.font = active ? "700 20px Segoe UI" : "600 18px Segoe UI";
  ctx.fillText(room.name, top[0].x + 10, top[0].y + 22);
  ctx.restore();
}

function drawTrackerPin(ctx) {
  const point = projectPoint(state.tracking.position.x, state.tracking.position.y);
  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y + 4, 12, 0, Math.PI * 2);
  ctx.fillStyle = "#29d17a";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(point.x, point.y + 4, 22, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(41,209,122,0.22)";
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.restore();
}

function drawRouterBeacon(ctx, router) {
  const point = projectPoint(router.x, router.y);
  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, 10, 0, Math.PI * 2);
  ctx.fillStyle = "#ff9d2e";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(point.x, point.y, 30, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,157,46,0.18)";
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.fillStyle = "#ffd9ad";
  ctx.font = "700 16px Segoe UI";
  ctx.fillText("Router", point.x + 14, point.y - 12);
  ctx.restore();
}

function projectRoom(room) {
  const p1 = projectPoint(room.x, room.y);
  const p2 = projectPoint(room.x + room.w, room.y);
  const p3 = projectPoint(room.x + room.w, room.y + room.h);
  const p4 = projectPoint(room.x, room.y + room.h);
  return [p1, p2, p3, p4];
}

function projectPoint(x, y) {
  return {
    x: 130 + x * 0.72 + y * 0.28,
    y: 160 + y * 0.42 - x * 0.04,
  };
}

function polygon(ctx, points) {
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
}

function renderTrackSummary() {
  const map = state.map.final || state.map.draft;
  const room = map?.rooms?.find((item) => item.id === state.tracking.currentRoomId);
  const zone = map?.zones?.find((item) => item.id === state.tracking.currentZoneId);
  els.trackRoom.textContent = room?.name || "None";
  els.trackZone.textContent = zone?.name || "None";
  els.trackConfidence.textContent = `${Math.round(state.tracking.confidence * 100)}%`;
  const latest = state.tracking.transitions[0];
  els.trackTransition.textContent = latest ? `${latest.from} -> ${latest.to}` : "Waiting";
  els.trackX.textContent = `${Math.round(state.tracking.position.x)}`;
  els.trackY.textContent = `${Math.round(state.tracking.position.y)}`;
  els.trackingBadge.classList.toggle("pill-warn", !state.tracking.active);
}

function appendTimeline(container, title, body, meta) {
  const item = document.createElement("div");
  item.className = "timeline-item";
  item.innerHTML = `<small>${new Date().toLocaleTimeString()}</small><strong>${escapeHtml(title)}</strong><div>${escapeHtml(body)}</div><div>${escapeHtml(meta)}</div>`;
  container.prepend(item);
  trimDom(container, 18);
}

function setMode(mode) {
  state.mode = mode;
  render();
  persistState();
}

function persistState() {
  const payload = {
    mode: state.mode,
    scan: state.scan,
    map: state.map,
    tracking: state.tracking,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function restoreState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.mode) state.mode = saved.mode;
    if (saved.scan) Object.assign(state.scan, saved.scan);
    if (saved.map) Object.assign(state.map, saved.map);
    if (saved.tracking) Object.assign(state.tracking, saved.tracking);
  } catch {}
}

function cloneMap(map) {
  return JSON.parse(JSON.stringify(map));
}

function handlePosition(room, handle) {
  const map = {
    nw: { x: room.x, y: room.y },
    ne: { x: room.x + room.w, y: room.y },
    sw: { x: room.x, y: room.y + room.h },
    se: { x: room.x + room.w, y: room.y + room.h },
  };
  return map[handle];
}

function roomFill(index, selected) {
  const palette = [
    "rgba(255,157,46,0.22)",
    "rgba(61,182,255,0.18)",
    "rgba(41,209,122,0.18)",
    "rgba(208,127,255,0.18)",
    "rgba(255,95,114,0.18)",
  ];
  return selected ? "rgba(255,157,46,0.3)" : palette[index % palette.length];
}

function svgNode(tag, attrs, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
  if (text) node.textContent = text;
  return node;
}

function svgPoint(event) {
  const rect = els.planSvg.getBoundingClientRect();
  const viewBox = els.planSvg.viewBox.baseVal;
  return {
    x: ((event.clientX - rect.left) / rect.width) * viewBox.width,
    y: ((event.clientY - rect.top) / rect.height) * viewBox.height,
  };
}

function overlap(a1, a2, b1, b2) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fractional(value) {
  return value - Math.floor(value);
}

function trimArray(array, max) {
  while (array.length > max) array.shift();
}

function trimDom(container, max) {
  while (container.children.length > max) {
    container.removeChild(container.lastChild);
  }
}

function pushTrackingPath(point) {
  state.tracking.path.push(point);
  trimArray(state.tracking.path, 24);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

init();
