const STORAGE_KEY = 'ruview-observatory-mapper-v2';
const DEFAULT_APARTMENT = { x: 30, y: 28, w: 360, h: 236 };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function overlap(a1, a2, b1, b2) {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

function fractional(value) {
  return value - Math.floor(value);
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function createSvg(tag, attrs = {}, text = '') {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (text) node.textContent = text;
  return node;
}

export class MapperOverlay {
  constructor(observatory) {
    this._obs = observatory;
    this._state = {
      open: true,
      mode: 'scan',
      scan: { active: false, samples: [], marks: [], mobileTrail: [] },
      session: {
        status: 'idle',
        failure: null,
        lastStep: 'idle',
        updatedAt: null,
      },
      map: { draft: null, final: null, selectedRoomId: null, drag: null },
      tracking: {
        active: false,
        roomId: null,
        zoneId: null,
        confidence: 0,
        x: 0,
        y: 0,
        headingDeg: 0,
        source: 'rf',
        path: [],
        transitions: [],
      },
      sceneVisible: false,
    };
    this._autoDraftSeeded = false;

    this._els = {
      overlay: document.getElementById('mapper-overlay'),
      toggle: document.getElementById('mapper-toggle'),
      close: document.getElementById('mapper-close'),
      tabs: [...document.querySelectorAll('.mapper-tab')],
      panes: [...document.querySelectorAll('.mapper-pane')],
      routerLabel: document.getElementById('mapper-router-label'),
      trackXY: document.getElementById('mapper-track-xy'),
      trackRoom: document.getElementById('mapper-track-room'),
      trackConf: document.getElementById('mapper-track-conf'),
      scanStatus: document.getElementById('mapper-scan-status'),
      scanSamples: document.getElementById('mapper-scan-samples'),
      scanConfidence: document.getElementById('mapper-scan-confidence'),
      mapRooms: document.getElementById('mapper-map-rooms'),
      mapDoors: document.getElementById('mapper-map-doors'),
      mapZones: document.getElementById('mapper-map-zones'),
      trackZone: document.getElementById('mapper-track-zone'),
      trackTransition: document.getElementById('mapper-track-transition'),
      log: document.getElementById('mapper-log'),
      map: document.getElementById('mapper-map'),
      mesh: document.getElementById('mapper-mesh'),
      scanStart: document.getElementById('mapper-scan-start'),
      scanResume: document.getElementById('mapper-scan-resume'),
      scanStop: document.getElementById('mapper-scan-stop'),
      scanMark: document.getElementById('mapper-scan-mark'),
      scanReset: document.getElementById('mapper-scan-reset'),
      liveStatus: document.getElementById('mapper-live-status'),
      failure: document.getElementById('mapper-failure'),
      mapSave: document.getElementById('mapper-map-save'),
      mapReset: document.getElementById('mapper-map-reset'),
      trackStart: document.getElementById('mapper-track-start'),
      trackStop: document.getElementById('mapper-track-stop'),
    };

    this._restore();
    this._bind();
    this._startDiagnosticsPolling();
    this._renderShell();
    this._renderMap();
    this._renderMesh();
  }

  _bind() {
    this._els.toggle.addEventListener('click', () => {
      this._state.open = !this._state.open;
      this._renderShell();
      this._persist();
    });
    this._els.close.addEventListener('click', () => {
      this._state.open = false;
      this._renderShell();
      this._persist();
    });
    this._els.tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        this._state.mode = tab.dataset.mapperMode;
        this._renderShell();
        this._persist();
      });
    });
    this._els.scanStart.addEventListener('click', () => this.startScan());
    this._els.scanResume.addEventListener('click', () => this.resumeScan());
    this._els.scanStop.addEventListener('click', () => this.stopScanAndGenerate());
    this._els.scanMark.addEventListener('click', () => this.addMark());
    this._els.scanReset.addEventListener('click', () => this.reset());
    this._els.mapSave.addEventListener('click', () => this.saveMap());
    this._els.mapReset.addEventListener('click', () => this.reloadDraft());
    this._els.trackStart.addEventListener('click', () => this.startTracking());
    this._els.trackStop.addEventListener('click', () => this.stopTracking());

    this._els.map.addEventListener('pointerdown', (event) => this._onPointerDown(event));
    window.addEventListener('pointermove', (event) => this._onPointerMove(event));
    window.addEventListener('pointerup', () => this._onPointerUp());
    this._els.map.addEventListener('dblclick', (event) => this._renameRoom(event));
  }

  update(data) {
    this._lastData = data;
    if (this._state.scan.active && this._canUseLiveData(data)) {
      this._state.scan.samples.push(this._sampleFromData(data, false));
      while (this._state.scan.samples.length > 500) this._state.scan.samples.shift();
      this._state.session.status = 'collecting';
      this._state.session.failure = null;
      this._state.session.lastStep = 'collecting_live_samples';
      this._state.session.updatedAt = Date.now();
    }

    if (this._state.tracking.active) {
      this._updateTracking(data);
    }

    this._renderStats(data);
    this._renderMap();
    this._renderMesh();
    this._persist();
  }

  startScan(silent = false) {
    this._state.scan.active = true;
    this._state.sceneVisible = false;
    this._state.mode = 'scan';
    this._state.session.status = 'collecting';
    this._state.session.failure = null;
    this._state.session.lastStep = 'scan_started';
    this._state.session.updatedAt = Date.now();
    if (!silent) this._log('scan started', 'Walk with the phone first, then generate the draft and name the spaces.');
    this._renderStats(this._lastData);
    this._persist();
  }

  resumeScan() {
    this._state.scan.active = true;
    this._state.sceneVisible = false;
    this._state.mode = 'scan';
    this._state.session.status = 'collecting';
    this._state.session.failure = null;
    this._state.session.lastStep = 'scan_resumed';
    this._state.session.updatedAt = Date.now();
    this._log('scan resumed', `Continuing from ${this._state.scan.samples.length} stored samples.`);
    this._renderStats(this._lastData);
    this._persist();
  }

  stopScanAndGenerate() {
    this._state.scan.active = false;
    const validation = this._validateGeneration();
    if (!validation.ok) {
      this._state.session.status = 'failed';
      this._state.session.failure = validation.reason;
      this._state.session.lastStep = 'generate_failed';
      this._state.session.updatedAt = Date.now();
      this._log('generation failed', validation.reason);
      this._renderStats(this._lastData);
      this._persist();
      return;
    }
    const draft = this._generateDraft();
    this._state.map.draft = draft;
    this._state.map.final = clone(draft);
    this._state.sceneVisible = true;
    this._state.session.status = 'ready';
    this._state.session.failure = null;
    this._state.session.lastStep = 'draft_generated';
    this._state.session.updatedAt = Date.now();
    this._state.mode = 'edit';
    this._log('draft ready', `${draft.rooms.length} candidate spaces generated. Rename and adjust them in Edit.`);
    this._renderShell();
    this._renderStats(this._lastData);
    this._renderMap();
    this._renderMesh();
    this._persist();
  }

  addMark() {
    if (!this._canUseLiveData(this._lastData)) return;
    const sample = this._sampleFromData(this._lastData, true);
    this._state.scan.samples.push(sample);
    this._state.scan.marks.push(sample);
    this._state.session.status = 'collecting';
    this._state.session.lastStep = 'mark_added';
    this._state.session.updatedAt = Date.now();
    this._log('scan mark', `Locked fingerprint at RSSI ${sample.meanRssi.toFixed(0)} dBm.`);
    this._renderStats(this._lastData);
    this._persist();
  }

  ingestMobileProbe(probe) {
    if (!this._canUseLiveData(this._lastData)) return;
    if (!this._state.scan.active) this.startScan(true);
    const stepLike = Boolean(probe?.step_like);
    const manualPing = String(probe?.note || '') === 'manual_ping';
    const doorwayMark = String(probe?.note || '') === 'doorway_mark';
    const note = String(probe?.note || '');
    if (!stepLike && !manualPing && !doorwayMark && note !== 'heartbeat' && note !== 'wall_walk') return;
    const sample = {
      ...this._sampleFromData(this._lastData, true),
      mobileHeading: Number(probe?.heading_deg ?? NaN),
      mobileMotion: Number(probe?.motion_energy ?? 0),
      mobileTurnRate: Number(probe?.turn_rate ?? 0),
      mobilePitch: Number(probe?.pitch_deg ?? 0),
      mobileRoll: Number(probe?.roll_deg ?? 0),
      mobileAccel: Number(probe?.accel_norm ?? 0),
      mobileRtt: Number(probe?.network_rtt_ms ?? 0),
      mobileDownlink: Number(probe?.downlink_mbps ?? 0),
      mobileEffectiveType: String(probe?.effective_type || ''),
      mobile: true,
    };
    this._state.scan.samples.push(sample);
    if (stepLike || manualPing || doorwayMark) {
      this._state.scan.marks.push(sample);
    }
    while (this._state.scan.samples.length > 500) this._state.scan.samples.shift();
    while (this._state.scan.marks.length > 48) this._state.scan.marks.shift();
    this._state.session.status = 'collecting';
    this._state.session.lastStep = 'mobile_probe_ingested';
    this._state.session.updatedAt = Date.now();
    if (manualPing || doorwayMark || stepLike) {
      this._log('mobile probe', manualPing
        ? 'Manual phone ping anchored the current RF sample.'
        : doorwayMark
          ? 'Doorway crossing marked and anchored.'
          : 'Walking step anchored the current RF sample.');
    }
    this._advanceMobileTracking(probe);
    this._renderStats(this._lastData);
    this._persist();
  }

  reset() {
    this._state.scan = { active: false, samples: [], marks: [], mobileTrail: [] };
    this._state.session = { status: 'idle', failure: null, lastStep: 'idle', updatedAt: Date.now() };
    this._state.map = { draft: null, final: null, selectedRoomId: null, drag: null };
    this._state.tracking = { active: false, roomId: null, zoneId: null, confidence: 0, x: 0, y: 0, headingDeg: 0, source: 'rf', path: [], transitions: [] };
    this._state.sceneVisible = false;
    this._log('reset', 'Scan, map, and tracking state cleared.');
    this._renderStats(this._lastData);
    this._renderMap();
    this._renderMesh();
    this._persist();
  }

  saveMap() {
    if (!this._state.map.final) return;
    this._state.map.final.meta.savedAt = Date.now();
    this._log('map saved', 'Editable draft committed for tracking.');
    this._persist();
  }

  reloadDraft() {
    if (!this._state.map.draft) return;
    this._state.map.final = clone(this._state.map.draft);
    this._renderMap();
    this._renderMesh();
    this._persist();
  }

  startTracking() {
    if (!this._state.map.final && this._state.map.draft) {
      this._state.map.final = clone(this._state.map.draft);
    }
    if (!this._state.map.final) return;
    this._state.tracking.active = true;
    this._state.sceneVisible = true;
    this._state.tracking.source = this._state.tracking.source || 'rf';
    this._state.mode = 'track';
    this._log('tracking started', 'Precise XY estimate now tied to room map.');
    this._renderShell();
    this._persist();
  }

  stopTracking() {
    this._state.tracking.active = false;
    this._renderStats(this._lastData);
    this._persist();
  }

  _sampleFromData(data, marked) {
    const diag = data?.wifi_diagnostics || this._serverStatus?.wifi_diagnostics || {};
    return {
      tick: Number(data.tick || 0),
      meanRssi: Number(data?.features?.mean_rssi ?? -100),
      variance: Number(data?.features?.variance || 0),
      motion: Number(data?.features?.motion_band_power || 0),
      bssidCount: Number(data.bssid_count || diag.last_bssid_count || 0),
      breathing: Number(data?.vital_signs?.breathing_rate_bpm || 0),
      confidence: Number(data?.classification?.confidence || 0),
      source: String(data?.source || this._serverStatus?.source || ''),
      marked,
      ts: Date.now(),
    };
  }

  _generateDraft() {
    const samples = this._state.scan.samples;
    const stats = this._summarize(samples);
    const rooms = this._buildPathRooms(samples, stats);
    const doorways = this._buildDoors(rooms);
    const zones = rooms.map((room, idx) => ({
      id: `zone-${room.id}`,
      roomId: room.id,
      name: idx === 0 ? `${room.name} Core` : `${room.name} Zone`,
      x: room.x + room.w * 0.16,
      y: room.y + room.h * 0.18,
      w: room.w * 0.68,
      h: room.h * 0.6,
    }));
    const confidence = clamp(
      0.24 + stats.maxBssid * 0.035 + stats.avgVariance * 5 + stats.avgMotion * 4 + this._state.scan.marks.length * 0.06,
      0.18,
      0.88
    );
    return {
      apartment: {
        x: DEFAULT_APARTMENT.x,
        y: DEFAULT_APARTMENT.y,
        w: DEFAULT_APARTMENT.w,
        h: DEFAULT_APARTMENT.h,
        contour: this._buildApartmentContour(rooms),
      },
      rooms,
      zones,
      doorways,
      router: this._estimateRouter(rooms, stats, samples),
      meta: { confidence, stats },
    };
  }

  _previewMap() {
    const trail = this._state.scan.mobileTrail || [];
    if (trail.length < 3) return null;
    const samples = this._state.scan.samples || [];
    const stats = this._summarize(samples);
    const rooms = this._buildPathRooms(samples, stats);
    if (!rooms.length) return null;
    return {
      apartment: {
        x: DEFAULT_APARTMENT.x,
        y: DEFAULT_APARTMENT.y,
        w: DEFAULT_APARTMENT.w,
        h: DEFAULT_APARTMENT.h,
        contour: this._buildApartmentContour(rooms),
      },
      rooms,
      zones: rooms.map((room, idx) => ({
        id: `preview-zone-${room.id}`,
        roomId: room.id,
        name: idx === 0 ? `${room.name} Core` : `${room.name} Zone`,
        x: room.x + room.w * 0.16,
        y: room.y + room.h * 0.18,
        w: room.w * 0.68,
        h: room.h * 0.6,
      })),
      doorways: this._buildDoors(rooms),
      router: this._estimateRouter(rooms, stats, samples),
      meta: { confidence: clamp(0.16 + trail.length * 0.012, 0.16, 0.72), preview: true, stats },
    };
  }

  _buildPathRooms(samples, stats) {
    const trail = this._state.scan.mobileTrail || [];
    if (!trail.length) {
      return [this._decorateRoomGeometry({
        id: 'room-1',
        name: 'Start Room',
        x: 150,
        y: 88,
        w: 120,
        h: 92,
      }, samples[0], 0)];
    }

    const clusters = [];
    let current = [trail[0]];
    for (let i = 1; i < trail.length; i++) {
      const point = trail[i];
      const centroid = this._clusterCentroid(current);
      const distance = Math.hypot(point.x - centroid.x, point.y - centroid.y);
      if (distance > 58 && current.length >= 4) {
        clusters.push(current);
        current = [point];
      } else {
        current.push(point);
      }
    }
    if (current.length) clusters.push(current);

    const labels = ['Start Room', 'Space 2', 'Space 3', 'Space 4', 'Space 5'];
    return clusters.slice(0, 5).map((points, index) => {
      const bounds = this._boundsFromTrail(points, index === 0 ? 30 : 24);
      return this._decorateRoomGeometry({
        id: `room-${index + 1}`,
        name: labels[index] || `Space ${index + 1}`,
        x: bounds.x,
        y: bounds.y,
        w: bounds.w,
        h: bounds.h,
      }, points[Math.floor(points.length / 2)] || samples[0], index);
    });
  }

  _clusterCentroid(points) {
    const sum = points.reduce((acc, point) => {
      acc.x += point.x;
      acc.y += point.y;
      return acc;
    }, { x: 0, y: 0 });
    return {
      x: sum.x / Math.max(1, points.length),
      y: sum.y / Math.max(1, points.length),
    };
  }

  _boundsFromTrail(points, padding = 24) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const x = clamp(minX - padding, DEFAULT_APARTMENT.x, DEFAULT_APARTMENT.x + DEFAULT_APARTMENT.w - 72);
    const y = clamp(minY - padding, DEFAULT_APARTMENT.y, DEFAULT_APARTMENT.y + DEFAULT_APARTMENT.h - 60);
    const w = clamp((maxX - minX) + padding * 2, 84, 164);
    const h = clamp((maxY - minY) + padding * 2, 72, 148);
    return {
      x,
      y,
      w: Math.min(w, DEFAULT_APARTMENT.x + DEFAULT_APARTMENT.w - x),
      h: Math.min(h, DEFAULT_APARTMENT.y + DEFAULT_APARTMENT.h - y),
    };
  }

  _buildApartmentContour(rooms) {
    const minX = Math.max(20, Math.min(...rooms.map((room) => room.x)) - 14);
    const minY = Math.max(18, Math.min(...rooms.map((room) => room.y)) - 12);
    const maxX = Math.min(400, Math.max(...rooms.map((room) => room.x + room.w)) + 16);
    const maxY = Math.min(274, Math.max(...rooms.map((room) => room.y + room.h)) + 14);
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    return [
      { x: minX + 8, y: minY + 12 },
      { x: midX - 26, y: minY },
      { x: maxX - 18, y: minY + 10 },
      { x: maxX, y: midY - 18 },
      { x: maxX - 10, y: maxY - 18 },
      { x: midX + 34, y: maxY },
      { x: minX + 18, y: maxY - 6 },
      { x: minX, y: midY + 22 },
    ];
  }

  _anchorSamples(samples, stats, requestedCount) {
    const marks = this._state.scan.marks;
    if (marks.length) {
      return requestedCount ? marks.slice(0, requestedCount) : marks.slice();
    }
    if (!samples.length) return [];
    const count = requestedCount || this._inferRoomCount(samples, stats);
    const ordered = [...samples].sort((a, b) => {
      const scoreA = Number(a.bssidCount || 0) * 18 + Number(a.confidence || 0) * 40 + (100 + Number(a.meanRssi || -100));
      const scoreB = Number(b.bssidCount || 0) * 18 + Number(b.confidence || 0) * 40 + (100 + Number(b.meanRssi || -100));
      return scoreB - scoreA;
    });
    const anchors = [];
    for (let i = 0; i < count; i++) {
      const index = Math.min(ordered.length - 1, Math.floor((i / Math.max(1, count - 1)) * (ordered.length - 1)));
      anchors.push({ ...ordered[index], marked: false, synthesized: true });
    }
    return anchors;
  }

  _summarize(samples) {
    if (!samples.length) return { avgVariance: 0, avgMotion: 0, maxBssid: 0, avgRssi: -100 };
    const totals = samples.reduce((acc, s) => {
      acc.variance += s.variance;
      acc.motion += s.motion;
      acc.bssid += s.bssidCount;
      acc.maxBssid = Math.max(acc.maxBssid, s.bssidCount);
      acc.rssi += s.meanRssi;
      return acc;
    }, { variance: 0, motion: 0, bssid: 0, maxBssid: 0, rssi: 0 });
    return {
      avgVariance: totals.variance / samples.length,
      avgMotion: totals.motion / samples.length,
      avgBssid: totals.bssid / samples.length,
      maxBssid: totals.maxBssid,
      avgRssi: totals.rssi / samples.length,
    };
  }

  _estimateRouter(rooms, stats, samples) {
    const room = rooms[0];
    const strongest = [...samples].sort((a, b) => b.meanRssi - a.meanRssi)[0];
    const edgeBias = strongest ? clamp((-strongest.meanRssi - 40) / 60, 0.14, 0.34) : (stats.avgRssi > -72 ? 0.16 : stats.avgRssi > -84 ? 0.24 : 0.32);
    return {
      x: room.x + room.w * edgeBias,
      y: room.y + room.h * 0.18,
      confidence: clamp(0.3 + stats.maxBssid * 0.05 + ((stats.avgRssi + 100) / 100) * 0.2, 0.28, 0.8),
    };
  }

  _buildDoors(rooms) {
    const doors = [];
    for (let i = 0; i < rooms.length; i++) {
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i];
        const b = rooms[j];
        const oy = overlap(a.y, a.y + a.h, b.y, b.y + b.h);
        const ox = overlap(a.x, a.x + a.w, b.x, b.x + b.w);
        if (oy > 18 && Math.abs((a.x + a.w) - b.x) < 4) {
          const x = a.x + a.w;
          const y = Math.max(a.y, b.y) + oy * 0.38;
          doors.push({ x1: x, y1: y, x2: x, y2: y + Math.min(26, oy * 0.28) });
        } else if (ox > 22 && Math.abs((a.y + a.h) - b.y) < 4) {
          const y = a.y + a.h;
          const x = Math.max(a.x, b.x) + ox * 0.38;
          doors.push({ x1: x, y1: y, x2: x + Math.min(34, ox * 0.28), y2: y });
        }
      }
    }
    return doors;
  }

  _updateTracking(data) {
    const map = this._state.map.final || this._state.map.draft;
    if (!data || !map) return;
    if (this._state.tracking.source === 'mobile') {
      const mobileRoom = map.rooms.find((room) => this._pointInRoom(this._state.tracking.x, this._state.tracking.y, room))
        || this._nearestRoom(this._state.tracking.x, this._state.tracking.y, map.rooms);
      const mobileZone = map.zones.find((z) => z.roomId === mobileRoom?.id) || null;
      this._state.tracking.roomId = mobileRoom?.id || null;
      this._state.tracking.zoneId = mobileZone?.id || null;
      this._state.tracking.confidence = Math.max(this._state.tracking.confidence, 0.82);
      return;
    }
    const confidence = this._presenceConfidence(data);
    this._state.tracking.confidence = confidence;
    if (confidence < 0.35) return;

    const room = this._pickRoom(data, map);
    const zone = map.zones.find((z) => z.roomId === room.id) || null;
    const point = this._estimateXY(data, map, room);
    const prevRoomId = this._state.tracking.roomId;

    this._state.tracking.x += (point.x - this._state.tracking.x) * 0.28;
    this._state.tracking.y += (point.y - this._state.tracking.y) * 0.28;
    this._state.tracking.roomId = room.id;
    this._state.tracking.zoneId = zone?.id || null;
    this._state.tracking.path.push({ x: this._state.tracking.x, y: this._state.tracking.y });
    while (this._state.tracking.path.length > 26) this._state.tracking.path.shift();

    if (prevRoomId && prevRoomId !== room.id) {
      const prevRoom = map.rooms.find((r) => r.id === prevRoomId);
      this._state.tracking.transitions.unshift({
        from: prevRoom?.name || 'unknown',
        to: room.name,
      });
      while (this._state.tracking.transitions.length > 8) this._state.tracking.transitions.pop();
      this._log('transition', `${prevRoom?.name || 'unknown'} -> ${room.name}`);
    }
  }

  _presenceConfidence(data) {
    const explicit = data?.classification?.presence ? Math.max(0.4, Number(data?.classification?.confidence || 0)) : 0;
    const bssid = Math.min(0.34, Number(data.bssid_count || 0) * 0.03);
    const rssi = clamp(((Number(data?.features?.mean_rssi ?? -100) + 100) / 24), 0, 0.28);
    const variance = Math.min(0.12, Number(data?.features?.variance || 0) * 8);
    const motion = Math.min(0.12, Number(data?.features?.motion_band_power || 0) * 8);
    const breathing = Number(data?.vital_signs?.breathing_rate_bpm || 0) >= 6 ? 0.14 : 0;
    return clamp(Math.max(explicit, 0.18 + bssid + rssi + variance + motion + breathing), 0, 0.92);
  }

  _pickRoom(data, map) {
    const marks = this._anchorSamples(this._state.scan.samples, this._summarize(this._state.scan.samples), map.rooms.length);
    if (marks.length >= map.rooms.length) {
      let bestIdx = 0;
      let bestScore = Infinity;
      marks.slice(0, map.rooms.length).forEach((mark, index) => {
        const score =
          Math.abs(mark.meanRssi - Number(data?.features?.mean_rssi ?? -100)) * 0.7 +
          Math.abs(mark.bssidCount - Number(data.bssid_count || 0)) * 8 +
          Math.abs(mark.variance - Number(data?.features?.variance || 0)) * 120;
        if (score < bestScore) {
          bestScore = score;
          bestIdx = index;
        }
      });
      return map.rooms[bestIdx];
    }
    const driver = Math.abs(Number(data.tick || 0) * 0.07 + Number(data?.features?.mean_rssi ?? -100) * 0.5 + Number(data?.features?.motion_band_power || 0) * 120);
    return map.rooms[Math.floor(driver) % map.rooms.length];
  }

  _estimateXY(data, map, room) {
    const router = map.router || { x: 72, y: 62 };
    const roomCenter = { x: room.x + room.w / 2, y: room.y + room.h / 2 };
    const vec = { x: roomCenter.x - router.x, y: roomCenter.y - router.y };
    const len = Math.hypot(vec.x, vec.y) || 1;
    const axis = { x: vec.x / len, y: vec.y / len };
    const side = { x: -axis.y, y: axis.x };

    const meanRssi = Number(data?.features?.mean_rssi ?? -100);
    const variance = Number(data?.features?.variance || 0);
    const motion = Number(data?.features?.motion_band_power || 0);
    const tick = Number(data.tick || 0);
    const closeness = clamp((meanRssi + 95) / 35, 0.05, 0.95);
    const radial = 0.16 + (1 - closeness) * 0.62;
    const lateralSeed = fractional(tick * 0.031 + variance * 21 + motion * 17 + Number(data.bssid_count || 0) * 0.13);
    const lateral = (lateralSeed - 0.5) * 0.56;
    const microX = Math.sin(tick * 0.08 + motion * 40) * Math.min(room.w * 0.06, 11);
    const microY = Math.cos(tick * 0.06 + variance * 80) * Math.min(room.h * 0.06, 9);

    return {
      x: clamp(room.x + room.w * 0.5 + axis.x * room.w * radial * 0.35 + side.x * room.w * lateral * 0.4 + microX, room.x + 12, room.x + room.w - 12),
      y: clamp(room.y + room.h * 0.5 + axis.y * room.h * radial * 0.35 + side.y * room.h * lateral * 0.4 + microY, room.y + 12, room.y + room.h - 12),
    };
  }

  _canUseLiveData(data) {
    const source = String(data?.source || this._serverStatus?.source || '');
    return source.startsWith('wifi') && this._serverStatus?.has_live_update && data?.status !== 'waiting_for_wifi_samples';
  }

  _advanceMobileTracking(probe) {
    const map = this._state.map.final || this._state.map.draft;
    const apartment = map?.apartment || DEFAULT_APARTMENT;
    const headingDeg = Number.isFinite(Number(probe?.heading_deg)) ? Number(probe.heading_deg) : this._state.tracking.headingDeg || 0;
    const headingRad = (headingDeg * Math.PI) / 180;
    const manualPing = String(probe?.note || '') === 'manual_ping';
    const stepLike = Boolean(probe?.step_like);
    const stride = manualPing ? 0 : stepLike ? clamp(8 + Number(probe?.motion_energy || 0) * 0.22, 8, 18) : 0;

    if (!this._state.tracking.active) {
      this._state.tracking.active = true;
      this._state.tracking.source = 'mobile';
      this._state.tracking.x = apartment.x + apartment.w * 0.5;
      this._state.tracking.y = apartment.y + apartment.h * 0.5;
      this._state.tracking.roomId = map?.rooms?.[0]?.id || null;
      this._state.tracking.zoneId = map?.zones?.find((z) => z.roomId === this._state.tracking.roomId)?.id || null;
      this._state.mode = 'track';
    }

    const prevRoomId = this._state.tracking.roomId;
    this._state.tracking.headingDeg = headingDeg;
    this._state.tracking.source = 'mobile';
    if (stride > 0) {
      const targetX = this._state.tracking.x + Math.sin(headingRad) * stride;
      const targetY = this._state.tracking.y - Math.cos(headingRad) * stride;
      this._state.tracking.x = clamp(targetX, apartment.x + 12, apartment.x + apartment.w - 12);
      this._state.tracking.y = clamp(targetY, apartment.y + 12, apartment.y + apartment.h - 12);
    }
    if (this._state.scan.active) {
      this._state.scan.mobileTrail.push({
        x: this._state.tracking.x,
        y: this._state.tracking.y,
        headingDeg,
        ts: Date.now(),
      });
      while (this._state.scan.mobileTrail.length > 240) this._state.scan.mobileTrail.shift();
    }
    const room = map?.rooms?.find((candidate) => this._pointInRoom(this._state.tracking.x, this._state.tracking.y, candidate))
      || (map?.rooms?.length ? this._nearestRoom(this._state.tracking.x, this._state.tracking.y, map.rooms) : null);
    const zone = map?.zones?.find((z) => z.roomId === room?.id) || null;
    this._state.tracking.roomId = room?.id || null;
    this._state.tracking.zoneId = zone?.id || null;
    this._state.tracking.confidence = clamp(0.76 + Number(stepLike) * 0.08, 0.76, 0.92);
    this._state.tracking.path.push({ x: this._state.tracking.x, y: this._state.tracking.y });
    while (this._state.tracking.path.length > 26) this._state.tracking.path.shift();

    if (prevRoomId && room?.id && prevRoomId !== room.id) {
      const prevRoom = map.rooms.find((r) => r.id === prevRoomId);
      this._state.tracking.transitions.unshift({
        from: prevRoom?.name || 'unknown',
        to: room.name,
      });
      while (this._state.tracking.transitions.length > 8) this._state.tracking.transitions.pop();
      this._log('mobile transition', `${prevRoom?.name || 'unknown'} -> ${room.name}`);
    }
  }

  _pointInRoom(x, y, room) {
    const outline = room.outline || [
      { x: room.x, y: room.y },
      { x: room.x + room.w, y: room.y },
      { x: room.x + room.w, y: room.y + room.h },
      { x: room.x, y: room.y + room.h },
    ];
    let inside = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const xi = outline[i].x, yi = outline[i].y;
      const xj = outline[j].x, yj = outline[j].y;
      const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 0.0001) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  _nearestRoom(x, y, rooms) {
    return rooms.reduce((best, room) => {
      const cx = room.x + room.w * 0.5;
      const cy = room.y + room.h * 0.5;
      const score = Math.hypot(x - cx, y - cy);
      if (!best || score < best.score) return { room, score };
      return best;
    }, null)?.room || rooms[0];
  }

  _startDiagnosticsPolling() {
    this._pollDiagnostics();
    this._diagTimer = window.setInterval(() => this._pollDiagnostics(), 3000);
  }

  async _pollDiagnostics() {
    const candidates = this._candidateBases();
    for (const base of candidates) {
      try {
        const response = await fetch(`${base}/api/v1/sensing/diagnostics`, { signal: AbortSignal.timeout(1500) });
        if (!response.ok) continue;
        const data = await response.json();
        this._serverStatus = data;
        this._renderStats(this._lastData);
        return;
      } catch {}
      try {
        const [healthResponse, latestResponse] = await Promise.all([
          fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) }),
          fetch(`${base}/api/v1/sensing/latest`, { signal: AbortSignal.timeout(1500) }),
        ]);
        if (!healthResponse.ok || !latestResponse.ok) continue;
        const health = await healthResponse.json();
        const latest = await latestResponse.json();
        this._serverStatus = {
          status: latest?.status === 'no data yet' ? 'waiting' : 'ok',
          source: latest?.source || health?.source || 'wifi',
          tick: Number(latest?.tick || health?.tick || 0),
          has_live_update: latest?.status !== 'no data yet' && Number(latest?.tick || 0) > 0,
          wifi_diagnostics: {
            scan_status: latest?.status === 'no data yet' ? 'no_frames_published' : 'live_frames_published',
            last_error: latest?.status === 'no data yet' ? 'Server is up, but no Wi-Fi samples reached the UI yet.' : null,
            last_bssid_count: Number(latest?.bssid_count || 0),
            published_frames: Number(latest?.tick || 0),
          },
        };
        this._renderStats(this._lastData);
        return;
      } catch {}
    }
    this._serverStatus = {
      status: 'offline',
      source: 'unavailable',
      has_live_update: false,
      wifi_diagnostics: {
        scan_status: 'server_unavailable',
        last_error: 'Could not reach sensing diagnostics endpoint',
        last_bssid_count: 0,
        published_frames: 0,
      },
    };
    this._renderStats(this._lastData);
  }

  _candidateBases() {
    const host = window.location.hostname || 'localhost';
    return [...new Set([
      window.location.origin,
      `http://${host}:3400`,
      `http://${host}:3000`,
    ])];
  }

  _validateGeneration() {
    const samples = this._state.scan.samples;
    const diag = this._serverStatus?.wifi_diagnostics || {};
    const maxBssid = Math.max(0, ...samples.map((sample) => Number(sample.bssidCount || 0)), Number(diag.last_bssid_count || 0));

    if (!this._canUseLiveData(this._lastData) && !String(this._serverStatus?.source || '').startsWith('wifi')) {
      return { ok: false, reason: 'Live Wi-Fi mode is not connected yet.' };
    }
    if (!this._serverStatus?.has_live_update) {
      return { ok: false, reason: 'No Wi-Fi scan frames published yet.' };
    }
    if (samples.length < 8) {
      return { ok: false, reason: `Need at least 8 samples, only ${samples.length} collected.` };
    }
    if (maxBssid < 2) {
      return { ok: false, reason: `Only ${maxBssid} BSSID detected. Insufficient diversity for structure inference.` };
    }
    return { ok: true, reason: null };
  }

  _buildMeasuredRooms(samples, stats, anchors = this._anchorSamples(samples, stats)) {
    const roomCount = this._inferRoomCount(samples, stats);
    const measured = [];
    const labels = ['Living', 'Bedroom', 'Kitchen', 'Office', 'Hall'];
    const corridor = {
      x: 150,
      y: 82,
      w: clamp(54 + stats.maxBssid * 2.2, 54, 84),
      h: clamp(126 + stats.avgMotion * 120, 126, 168),
    };

    for (let i = 0; i < roomCount; i++) {
      const mark = anchors[i] || samples[Math.floor((i / roomCount) * samples.length)] || samples[0];
      const strength = clamp((Number(mark?.meanRssi ?? -95) + 100) / 30, 0.08, 0.92);
      const spread = clamp((Number(mark?.variance || 0) * 180) + Number(mark?.motion || 0) * 260, 0.12, 0.9);
      const wobble = fractional(Number(mark?.tick || 0) * 0.071 + spread + i * 0.173);
      const wide = clamp(82 + strength * 58 - spread * 12, 78, 166);
      const tall = clamp(70 + spread * 46 + strength * 12, 66, 144);
      let room;

      if (i === 0) {
        room = {
          id: `room-${i + 1}`,
          name: labels[i] || `Room ${i + 1}`,
          x: 36,
          y: clamp(88 + (wobble - 0.5) * 22, 52, 164),
          w: clamp(wide + 12, 112, 170),
          h: clamp(tall + 10, 92, 148),
        };
      } else if (i === roomCount - 1 && roomCount >= 4) {
        room = {
          id: `room-${i + 1}`,
          name: labels[i] || `Room ${i + 1}`,
          x: clamp(corridor.x + corridor.w + 16, 224, 306),
          y: clamp(126 + (wobble - 0.5) * 60, 42, 180),
          w: clamp(wide - 8, 80, 126),
          h: clamp(tall - 4, 64, 118),
        };
      } else if (i % 2 === 1) {
        room = {
          id: `room-${i + 1}`,
          name: labels[i] || `Room ${i + 1}`,
          x: clamp(corridor.x + corridor.w + 10 + (wobble - 0.5) * 16, 188, 304),
          y: clamp(34 + i * 14 + wobble * 18, 28, 118),
          w: clamp(wide - 6, 84, 144),
          h: clamp(tall - 2, 68, 116),
        };
      } else {
        room = {
          id: `room-${i + 1}`,
          name: labels[i] || `Room ${i + 1}`,
          x: clamp(corridor.x + corridor.w + 2 + (wobble - 0.5) * 18, 176, 292),
          y: clamp(corridor.y + corridor.h - tall + 12 + (wobble - 0.5) * 24, 136, 264 - tall),
          w: clamp(wide - 2, 88, 152),
          h: clamp(tall, 72, 132),
        };
      }

      room.x = clamp(room.x, 30, 390 - room.w);
      room.y = clamp(room.y, 28, 264 - room.h);
      measured.push(this._decorateRoomGeometry(room, mark, i));
    }

    const hall = {
      id: 'room-corridor',
      name: roomCount >= 4 ? 'Corridor' : 'Hall',
      x: corridor.x,
      y: corridor.y,
      w: corridor.w,
      h: corridor.h,
    };
    measured.push(this._decorateRoomGeometry(hall, anchors[0] || samples[0], roomCount + 1));

    measured.sort((a, b) => (a.x + a.w * 0.5) - (b.x + b.w * 0.5));
    return measured.slice(0, Math.min(measured.length, 6));
  }

  _decorateRoomGeometry(room, sample, index) {
    const jitter = this._roomWallJitter(sample, index);
    return {
      ...room,
      outline: this._outlineFromRoom(room, jitter),
      jitter,
    };
  }

  _roomWallJitter(sample, index) {
    const seed = fractional((Number(sample?.tick || 0) * 0.019) + Number(sample?.variance || 0) * 37 + index * 0.271);
    return {
      topLeft: 6 + seed * 10,
      topRight: 4 + fractional(seed * 1.7 + 0.13) * 12,
      rightInset: 4 + fractional(seed * 2.1 + 0.31) * 12,
      bottomRight: 6 + fractional(seed * 2.8 + 0.52) * 10,
      bottomLeft: 5 + fractional(seed * 1.9 + 0.72) * 11,
      leftInset: 4 + fractional(seed * 2.4 + 0.18) * 10,
    };
  }

  _outlineFromRoom(room, jitter) {
    const x1 = room.x;
    const y1 = room.y;
    const x2 = room.x + room.w;
    const y2 = room.y + room.h;
    return [
      { x: x1, y: y1 + jitter.topLeft },
      { x: x1 + room.w * 0.34, y: y1 },
      { x: x2 - jitter.topRight, y: y1 + room.h * 0.04 },
      { x: x2, y: y1 + room.h * 0.34 },
      { x: x2 - jitter.rightInset, y: y2 - room.h * 0.18 },
      { x: x2 - room.w * 0.28, y: y2 },
      { x: x1 + jitter.bottomLeft, y: y2 - room.h * 0.02 },
      { x: x1, y: y1 + room.h * 0.58 + jitter.leftInset * 0.2 },
    ];
  }

  _inferRoomCount(samples, stats) {
    const marks = this._state.scan.marks.length;
    const liveBssid = Math.max(stats.maxBssid, ...samples.map((sample) => Number(sample.bssidCount || 0)));
    return clamp(Math.round(1 + marks * 0.8 + liveBssid * 0.35 + stats.avgVariance * 110), 2, 5);
  }

  _renderShell() {
    this._els.overlay.classList.toggle('mapper-overlay--collapsed', !this._state.open);
    this._els.tabs.forEach((tab) => {
      tab.classList.toggle('mapper-tab--active', tab.dataset.mapperMode === this._state.mode);
    });
    this._els.panes.forEach((pane) => {
      pane.classList.toggle('mapper-pane--hidden', pane.dataset.mapperPane !== this._state.mode);
    });
  }

  _renderStats(data) {
    const map = this._state.map.final || this._state.map.draft || this._previewMap();
    const diagnostics = this._serverStatus?.wifi_diagnostics || {};
    const liveStatus = this._serverStatus?.status === 'offline'
      ? 'Server unavailable'
      : this._serverStatus?.has_live_update
        ? `Live RF connected: ${this._serverStatus?.source || 'wifi'}`
        : `Server alive, waiting: ${diagnostics.scan_status || 'no_samples'}`;

    this._els.routerLabel.textContent = map?.router
      ? `${Math.round(map.router.x)}, ${Math.round(map.router.y)}`
      : 'Unknown';
    this._els.trackXY.textContent = `${Math.round(this._state.tracking.x)}, ${Math.round(this._state.tracking.y)}`;
    this._els.trackConf.textContent = `${Math.round(this._state.tracking.confidence * 100)}%`;
    const room = map?.rooms?.find((r) => r.id === this._state.tracking.roomId);
    this._els.trackRoom.textContent = room?.name || 'None';
    this._els.trackZone.textContent = `Zone: ${map?.zones?.find((z) => z.id === this._state.tracking.zoneId)?.name || 'none'}`;
    const tr = this._state.tracking.transitions[0];
    this._els.trackTransition.textContent = `Transition: ${tr ? `${tr.from} -> ${tr.to}` : 'waiting'}`;

    this._els.liveStatus.textContent = liveStatus;
    this._els.scanStatus.textContent = this._state.scan.active
      ? 'Collecting phone walk'
      : this._state.session.status === 'failed'
        ? 'Generation failed'
        : this._state.session.status === 'ready'
          ? 'Draft ready for naming'
          : this._state.session.status === 'collecting'
            ? 'Ready to resume'
            : 'Idle';
    this._els.scanSamples.textContent = `${this._state.scan.samples.length} samples`;
    this._els.scanConfidence.textContent = `${Math.round((map?.meta?.confidence || 0) * 100)}% draft`;
    this._els.mapRooms.textContent = `${map?.rooms?.length || 0} rooms`;
    this._els.mapDoors.textContent = `${map?.doorways?.length || 0} doors`;
    this._els.mapZones.textContent = `${map?.zones?.length || 0} zones`;
    this._els.failure.textContent = this._state.session.failure || '';
    this._els.failure.classList.toggle('mapper-failure--hidden', !this._state.session.failure);
    this._els.scanResume.disabled = this._state.scan.active || this._state.scan.samples.length === 0;
  }

  _renderMap() {
    const svg = this._els.map;
    const map = this._state.map.final || this._state.map.draft;
    svg.innerHTML = '';
    svg.appendChild(createSvg('rect', { x: 10, y: 10, width: 400, height: 280, rx: 18, fill: 'rgba(6,12,18,0.55)', stroke: 'rgba(255,255,255,0.08)' }));
    for (let x = 30; x <= 390; x += 30) {
      svg.appendChild(createSvg('line', { x1: x, y1: 28, x2: x, y2: 264, stroke: 'rgba(255,255,255,0.05)' }));
    }
    for (let y = 28; y <= 264; y += 28) {
      svg.appendChild(createSvg('line', { x1: 30, y1: y, x2: 390, y2: y, stroke: 'rgba(255,255,255,0.05)' }));
    }
    if (!map) {
      const trail = this._state.scan.mobileTrail || [];
      const marks = this._state.scan.marks || [];
      if (trail.length > 1) {
        const d = trail.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
        svg.appendChild(createSvg('path', {
          d,
          fill: 'none',
          stroke: 'rgba(0,216,120,0.88)',
          'stroke-width': 4,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }));
        const first = trail[0];
        svg.appendChild(createSvg('circle', { cx: first.x, cy: first.y, r: 12, fill: 'rgba(255,176,32,0.15)', stroke: '#ffb020', 'stroke-width': 2 }));
        svg.appendChild(createSvg('text', { x: first.x + 14, y: first.y - 10, fill: '#ffcf7a', 'font-size': 12 }, 'Start room'));
      }
      marks.slice(-12).forEach((mark) => {
        const color = mark.mobile && mark.mobileMotion > 0 ? '#00d878' : '#ffb020';
        svg.appendChild(createSvg('circle', {
          cx: this._state.tracking.x || 210,
          cy: this._state.tracking.y || 146,
          r: 5,
          fill: color,
          stroke: '#f6fff9',
          'stroke-width': 1.5,
          opacity: 0.9,
        }));
      });
      const diagnostics = this._serverStatus?.wifi_diagnostics || {};
      const message = this._state.session.failure
        ? this._state.session.failure
        : this._serverStatus?.has_live_update
          ? 'Walk with the phone to sketch the first room, then expand outward'
          : `Waiting for Wi-Fi samples (${diagnostics.scan_status || 'no_samples'})`;
      svg.appendChild(createSvg('text', { x: 210, y: 140, 'text-anchor': 'middle', fill: 'rgba(232,236,224,0.5)', 'font-size': 16 }, 'No draft map yet'));
      svg.appendChild(createSvg('text', { x: 210, y: 164, 'text-anchor': 'middle', fill: 'rgba(232,236,224,0.34)', 'font-size': 12 }, message));
      return;
    }

    svg.appendChild(createSvg('path', {
      d: this._polygonPath(map.apartment.contour || this._outlineFromRoom(map.apartment, this._roomWallJitter({ tick: 1, variance: 0.01 }, 0))),
      fill: 'rgba(255,176,32,0.03)',
      stroke: 'rgba(255,176,32,0.45)',
      'stroke-width': 2.4,
    }));

    map.zones.forEach((zone) => {
      svg.appendChild(createSvg('rect', {
        x: zone.x, y: zone.y, width: zone.w, height: zone.h, rx: 10,
        fill: 'rgba(32,144,255,0.07)', stroke: 'rgba(32,144,255,0.48)', 'stroke-dasharray': '5 4',
      }));
    });

    map.rooms.forEach((room, idx) => {
      const selected = this._state.map.selectedRoomId === room.id;
      svg.appendChild(createSvg('path', {
        d: this._polygonPath(room.outline || this._outlineFromRoom(room, room.jitter || this._roomWallJitter(null, idx))),
        fill: selected ? 'rgba(255,176,32,0.28)' : ['rgba(255,176,32,0.18)','rgba(62,255,138,0.14)','rgba(32,144,255,0.14)','rgba(255,64,96,0.14)','rgba(170,120,255,0.14)'][idx % 5],
        stroke: selected ? 'rgba(255,176,32,0.86)' : 'rgba(255,255,255,0.1)',
        'stroke-width': selected ? 2.4 : 1.2,
        'data-room-id': room.id,
      }));
      svg.appendChild(createSvg('text', { x: room.x + 10, y: room.y + 22, fill: '#f7f2e9', 'font-size': 12, 'font-weight': 700, 'data-room-id': room.id }, room.name));
      ['nw', 'ne', 'sw', 'se'].forEach((handle) => {
        const p = this._handlePos(room, handle);
        svg.appendChild(createSvg('circle', {
          cx: p.x, cy: p.y, r: 5.5, fill: '#ffe0b1', stroke: '#ffb020', 'stroke-width': 1.5,
          'data-room-id': room.id, 'data-handle': handle,
        }));
      });
    });

    map.doorways.forEach((door) => {
      svg.appendChild(createSvg('line', {
        x1: door.x1, y1: door.y1, x2: door.x2, y2: door.y2, stroke: '#fff0d8', 'stroke-width': 6, 'stroke-linecap': 'round',
      }));
    });

    if (map.router) {
      svg.appendChild(createSvg('circle', { cx: map.router.x, cy: map.router.y, r: 9, fill: '#ffb020', stroke: '#fff4e0', 'stroke-width': 2 }));
      svg.appendChild(createSvg('circle', { cx: map.router.x, cy: map.router.y, r: 22, fill: 'none', stroke: 'rgba(255,176,32,0.28)', 'stroke-dasharray': '5 4' }));
      svg.appendChild(createSvg('text', { x: map.router.x + 14, y: map.router.y - 8, fill: '#ffd8a7', 'font-size': 11 }, `Router ${Math.round(map.router.confidence * 100)}%`));
    }

    if (this._state.tracking.path.length > 1) {
      const d = this._state.tracking.path.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
      svg.appendChild(createSvg('path', { d, fill: 'none', stroke: 'rgba(62,255,138,0.35)', 'stroke-width': 3.5, 'stroke-dasharray': '7 5' }));
    }
    (this._state.scan.marks || []).slice(-12).forEach((mark, index) => {
      const x = this._state.tracking.path[index]?.x || this._state.tracking.x || 210;
      const y = this._state.tracking.path[index]?.y || this._state.tracking.y || 146;
      svg.appendChild(createSvg('circle', {
        cx: x,
        cy: y,
        r: 4.5,
        fill: mark.mobile && mark.mobileMotion > 0 ? '#00d878' : '#ffb020',
        stroke: 'rgba(255,255,255,0.9)',
        'stroke-width': 1.2,
      }));
    });
    if (this._state.tracking.active && this._state.tracking.roomId) {
      svg.appendChild(createSvg('circle', { cx: this._state.tracking.x, cy: this._state.tracking.y, r: 8.5, fill: '#00d878', stroke: '#f4fff9', 'stroke-width': 2 }));
    }
  }

  _renderMesh() {
    const canvas = this._els.mesh;
    const ctx = canvas.getContext('2d');
    const map = this._state.map.final || this._state.map.draft || this._previewMap();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#071019';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this._drawMeshGrid(ctx);

    if (!map) {
      ctx.fillStyle = 'rgba(232,236,224,0.48)';
      ctx.font = '600 18px Inter';
      ctx.fillText('No draft yet', 154, 106);
      ctx.fillStyle = 'rgba(232,236,224,0.34)';
      ctx.font = '500 12px Inter';
      ctx.fillText(this._state.session.failure || 'Phone walk is sketching the space in real time', 44, 132);
      const trail = this._state.scan.mobileTrail || [];
      if (trail.length > 1) {
        ctx.strokeStyle = 'rgba(0,216,120,0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        trail.forEach((point, index) => {
          const p = this._projectPoint(point.x, point.y);
          if (index === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
      }
      (this._state.scan.marks || []).slice(-12).forEach(() => {
        const p = this._projectPoint(this._state.tracking.x || 210, this._state.tracking.y || 146);
        ctx.fillStyle = 'rgba(255,176,32,0.95)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      });
      return;
    }

    const rooms = [...map.rooms].sort((a, b) => (a.y + a.h) - (b.y + b.h));
    rooms.forEach((room, idx) => this._drawExtrudedRoom(ctx, room, idx, room.id === this._state.tracking.roomId));
    if (map.router) this._drawRouter(ctx, map.router);
    (this._state.scan.marks || []).slice(-12).forEach((mark, index) => {
      const point = this._state.tracking.path[index] || { x: this._state.tracking.x || 210, y: this._state.tracking.y || 146 };
      const p = this._projectPoint(point.x, point.y);
      ctx.fillStyle = mark.mobile && mark.mobileMotion > 0 ? 'rgba(0,216,120,0.95)' : 'rgba(255,176,32,0.95)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    if (this._state.tracking.active && this._state.tracking.roomId) this._drawTracker(ctx);
  }

  _polygonPath(points) {
    if (!points?.length) return '';
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ') + ' Z';
  }

  _drawMeshGrid(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(56,93,108,0.24)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const y = 190 - i * 16;
      ctx.beginPath();
      ctx.moveTo(42, y);
      ctx.lineTo(380, y);
      ctx.stroke();
    }
    for (let i = 0; i < 9; i++) {
      const x = 70 + i * 34;
      ctx.beginPath();
      ctx.moveTo(x, 78);
      ctx.lineTo(x - 48, 196);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawExtrudedRoom(ctx, room, idx, active) {
    const top = this._projectRoom(room);
    const bottom = top.map((p) => ({ x: p.x - 18, y: p.y + 28 }));
    const fills = [
      'rgba(255,176,32,0.18)',
      'rgba(62,255,138,0.16)',
      'rgba(32,144,255,0.16)',
      'rgba(255,64,96,0.14)',
      'rgba(170,120,255,0.14)',
    ];
    const topFill = active ? 'rgba(62,255,138,0.26)' : fills[idx % fills.length];
    const sideFill = active ? 'rgba(62,255,138,0.18)' : 'rgba(255,176,32,0.10)';

    ctx.save();
    ctx.beginPath();
    this._polygon(ctx, top);
    ctx.fillStyle = topFill;
    ctx.fill();
    ctx.strokeStyle = active ? 'rgba(62,255,138,0.95)' : 'rgba(255,255,255,0.14)';
    ctx.lineWidth = active ? 2 : 1.1;
    ctx.stroke();

    for (let i = 0; i < top.length; i++) {
      const next = (i + 1) % top.length;
      ctx.beginPath();
      this._polygon(ctx, [top[i], top[next], bottom[next], bottom[i]]);
      ctx.fillStyle = sideFill;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.stroke();
    }

    ctx.fillStyle = '#f3ece2';
    ctx.font = active ? '700 12px Inter' : '600 11px Inter';
    ctx.fillText(room.name, top[0].x + 6, top[0].y + 14);
    ctx.restore();
  }

  _drawRouter(ctx, router) {
    const p = this._projectPoint(router.x, router.y);
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffb020';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, 18, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,176,32,0.2)';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = '#ffd7a4';
    ctx.font = '700 11px Inter';
    ctx.fillText('Router', p.x + 10, p.y - 10);
    ctx.restore();
  }

  _drawTracker(ctx) {
    const p = this._projectPoint(this._state.tracking.x, this._state.tracking.y);
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y + 2, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#00d878';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y + 2, 14, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,216,120,0.18)';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.restore();
  }

  _projectRoom(room) {
    const outline = room.outline || this._outlineFromRoom(room, room.jitter || this._roomWallJitter(null, 0));
    return outline.map((point) => this._projectPoint(point.x, point.y));
  }

  _projectPoint(x, y) {
    return {
      x: 66 + x * 0.55 + y * 0.18,
      y: 42 + y * 0.34 - x * 0.03,
    };
  }

  _polygon(ctx, pts) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  _onPointerDown(event) {
    if (this._state.mode !== 'edit') return;
    const roomId = event.target?.dataset?.roomId;
    const map = this._state.map.final || this._state.map.draft || this._previewMap();
    if (!map || !roomId) return;
    const room = map.rooms.find((r) => r.id === roomId);
    if (!room) return;
    this._state.map.selectedRoomId = roomId;
    const point = this._svgPoint(event);
    if (event.target.dataset.handle) {
      this._state.map.drag = {
        type: 'resize',
        roomId,
        handle: event.target.dataset.handle,
        startX: point.x,
        startY: point.y,
        original: { ...room },
      };
    } else {
      this._state.map.drag = {
        type: 'move',
        roomId,
        offsetX: point.x - room.x,
        offsetY: point.y - room.y,
      };
    }
    this._renderMap();
  }

  _onPointerMove(event) {
    const drag = this._state.map.drag;
    const map = this._state.map.final || this._state.map.draft;
    if (!drag || !map) return;
    const room = map.rooms.find((r) => r.id === drag.roomId);
    if (!room) return;
    const point = this._svgPoint(event);
    if (drag.type === 'move') {
      room.x = clamp(point.x - drag.offsetX, 30, 390 - room.w);
      room.y = clamp(point.y - drag.offsetY, 28, 264 - room.h);
    } else {
      const o = drag.original;
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;
      if (drag.handle.includes('n')) {
        room.y = clamp(o.y + dy, 28, o.y + o.h - 46);
        room.h = clamp(o.h - dy, 46, 264 - room.y);
      }
      if (drag.handle.includes('s')) {
        room.h = clamp(o.h + dy, 46, 264 - room.y);
      }
      if (drag.handle.includes('w')) {
        room.x = clamp(o.x + dx, 30, o.x + o.w - 56);
        room.w = clamp(o.w - dx, 56, 390 - room.x);
      }
      if (drag.handle.includes('e')) {
        room.w = clamp(o.w + dx, 56, 390 - room.x);
      }
    }
    const zone = map.zones.find((z) => z.roomId === room.id);
    if (zone) {
      zone.x = room.x + room.w * 0.16;
      zone.y = room.y + room.h * 0.18;
      zone.w = room.w * 0.68;
      zone.h = room.h * 0.6;
    }
    room.outline = this._outlineFromRoom(room, room.jitter || this._roomWallJitter(null, 0));
    map.apartment.contour = this._buildApartmentContour(map.rooms);
    map.doorways = this._buildDoors(map.rooms);
    this._renderMap();
    this._renderMesh();
  }

  _onPointerUp() {
    this._state.map.drag = null;
  }

  _renameRoom(event) {
    if (this._state.mode !== 'edit') return;
    const roomId = event.target?.dataset?.roomId;
    const map = this._state.map.final || this._state.map.draft;
    if (!roomId || !map) return;
    const room = map.rooms.find((r) => r.id === roomId);
    if (!room) return;
    const next = window.prompt('Room name', room.name);
    if (!next || !next.trim()) return;
    room.name = next.trim();
    map.apartment.contour = this._buildApartmentContour(map.rooms);
    const zone = map.zones.find((z) => z.roomId === roomId);
    if (zone) zone.name = `${room.name} Zone`;
    this._renderMap();
    this._renderMesh();
    this._persist();
  }

  _handlePos(room, handle) {
    const positions = {
      nw: { x: room.x, y: room.y },
      ne: { x: room.x + room.w, y: room.y },
      sw: { x: room.x, y: room.y + room.h },
      se: { x: room.x + room.w, y: room.y + room.h },
    };
    return positions[handle];
  }

  _svgPoint(event) {
    const rect = this._els.map.getBoundingClientRect();
    const box = this._els.map.viewBox.baseVal;
    return {
      x: ((event.clientX - rect.left) / rect.width) * box.width,
      y: ((event.clientY - rect.top) / rect.height) * box.height,
    };
  }

  _log(title, message) {
    const node = document.createElement('div');
    node.className = 'mapper-log-item';
    node.innerHTML = `<small>${new Date().toLocaleTimeString()}</small><strong>${title}</strong><span>${message}</span>`;
    this._els.log.prepend(node);
    while (this._els.log.children.length > 12) {
      this._els.log.removeChild(this._els.log.lastChild);
    }
  }

  _persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._state));
    } catch {}
  }

  _restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      this._state = {
        ...this._state,
        ...parsed,
        scan: { ...this._state.scan, ...(parsed.scan || {}) },
        session: { ...this._state.session, ...(parsed.session || {}) },
        map: { ...this._state.map, ...(parsed.map || {}) },
        tracking: { ...this._state.tracking, ...(parsed.tracking || {}) },
      };
      const hasSavedMap = Boolean(this._state.map?.final?.meta?.savedAt || this._state.map?.draft?.meta?.savedAt);
      const shouldKeepDraft = this._state.session?.status === 'ready';
      if (!hasSavedMap && !shouldKeepDraft) {
        this._state.map.draft = null;
        this._state.map.final = null;
      }
      this._state.sceneVisible = false;
      if (this._state.session?.status === 'failed' || this._state.session?.status === 'collecting') {
        this._state.open = true;
      }
      this._state.open = true;
    } catch {}
  }

  getSceneState() {
    const committedMap = this._state.map.final || this._state.map.draft;
    const previewMap = this._previewMap();
    return {
      map: this._state.sceneVisible
        ? (committedMap || previewMap)
        : previewMap,
      tracking: this._state.tracking,
    };
  }

  getMobileTrackerState() {
    const map = this._state.map.final || this._state.map.draft;
    const apartment = map?.apartment || DEFAULT_APARTMENT;
    if (!this._state.tracking.active || this._state.tracking.source !== 'mobile') {
      return null;
    }
    return {
      active: true,
      x: this._state.tracking.x,
      y: this._state.tracking.y,
      sceneX: ((this._state.tracking.x - apartment.x) / apartment.w - 0.5) * 12,
      sceneZ: ((this._state.tracking.y - apartment.y) / apartment.h - 0.5) * 10,
      heading: ((this._state.tracking.headingDeg || 0) * Math.PI) / 180,
      confidence: this._state.tracking.confidence || 0.82,
      roomId: this._state.tracking.roomId,
    };
  }
}
