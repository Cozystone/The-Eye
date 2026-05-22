const STORAGE_KEY = 'ruview-observatory-mapper-v1';

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
      scan: { active: false, samples: [], marks: [] },
      map: { draft: null, final: null, selectedRoomId: null, drag: null },
      tracking: {
        active: false,
        roomId: null,
        zoneId: null,
        confidence: 0,
        x: 0,
        y: 0,
        path: [],
        transitions: [],
      },
    };

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
      scanStop: document.getElementById('mapper-scan-stop'),
      scanMark: document.getElementById('mapper-scan-mark'),
      scanReset: document.getElementById('mapper-scan-reset'),
      mapSave: document.getElementById('mapper-map-save'),
      mapReset: document.getElementById('mapper-map-reset'),
      trackStart: document.getElementById('mapper-track-start'),
      trackStop: document.getElementById('mapper-track-stop'),
    };

    this._restore();
    if (!this._state.map.draft && !this._state.map.final) {
      const draft = this._generateDraft();
      this._state.map.draft = draft;
      this._state.map.final = clone(draft);
    }
    this._bind();
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
    if (this._state.scan.active && data) {
      this._state.scan.samples.push(this._sampleFromData(data, false));
      while (this._state.scan.samples.length > 500) this._state.scan.samples.shift();
    }

    if (this._state.tracking.active) {
      this._updateTracking(data);
    }

    this._renderStats(data);
    this._renderMap();
    this._renderMesh();
    this._persist();
  }

  startScan() {
    this._state.scan.active = true;
    this._log('scan started', 'Passive fingerprint collection running.');
    this._renderStats(this._lastData);
    this._persist();
  }

  stopScanAndGenerate() {
    this._state.scan.active = false;
    const draft = this._generateDraft();
    this._state.map.draft = draft;
    this._state.map.final = clone(draft);
    this._state.mode = 'edit';
    this._log('draft ready', `${draft.rooms.length} rooms and router estimate generated.`);
    this._renderShell();
    this._renderStats(this._lastData);
    this._renderMap();
    this._renderMesh();
    this._persist();
  }

  addMark() {
    if (!this._lastData) return;
    const sample = this._sampleFromData(this._lastData, true);
    this._state.scan.samples.push(sample);
    this._state.scan.marks.push(sample);
    this._log('scan mark', `Locked fingerprint at RSSI ${sample.meanRssi.toFixed(0)} dBm.`);
    this._renderStats(this._lastData);
    this._persist();
  }

  reset() {
    this._state.scan = { active: false, samples: [], marks: [] };
    this._state.map = { draft: null, final: null, selectedRoomId: null, drag: null };
    this._state.tracking = { active: false, roomId: null, zoneId: null, confidence: 0, x: 0, y: 0, path: [], transitions: [] };
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
    return {
      tick: Number(data.tick || 0),
      meanRssi: Number(data?.features?.mean_rssi ?? -100),
      variance: Number(data?.features?.variance || 0),
      motion: Number(data?.features?.motion_band_power || 0),
      bssidCount: Number(data.bssid_count || 0),
      breathing: Number(data?.vital_signs?.breathing_rate_bpm || 0),
      confidence: Number(data?.classification?.confidence || 0),
      marked,
      ts: Date.now(),
    };
  }

  _generateDraft() {
    const samples = this._state.scan.samples;
    const marks = this._state.scan.marks.length;
    const stats = this._summarize(samples);
    const roomCount = clamp(Math.round(2 + (stats.maxBssid + stats.avgVariance * 80 + marks * 1.8) / 4.8), 2, 5);
    const rooms = this._buildRooms(roomCount);
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
    const confidence = clamp(0.26 + stats.maxBssid * 0.035 + stats.avgVariance * 5 + stats.avgMotion * 4 + marks * 0.05, 0.18, 0.88);
    return {
      apartment: { x: 30, y: 28, w: 360, h: 236 },
      rooms,
      zones,
      doorways,
      router: this._estimateRouter(rooms, stats),
      meta: { confidence, stats },
    };
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

  _buildRooms(count) {
    const layouts = {
      2: [
        { id: 'living', name: 'Living', x: 30, y: 28, w: 210, h: 236 },
        { id: 'bedroom', name: 'Bedroom', x: 240, y: 28, w: 150, h: 236 },
      ],
      3: [
        { id: 'living', name: 'Living', x: 30, y: 28, w: 210, h: 138 },
        { id: 'kitchen', name: 'Kitchen', x: 30, y: 166, w: 210, h: 98 },
        { id: 'bedroom', name: 'Bedroom', x: 240, y: 28, w: 150, h: 236 },
      ],
      4: [
        { id: 'living', name: 'Living', x: 30, y: 28, w: 190, h: 138 },
        { id: 'kitchen', name: 'Kitchen', x: 30, y: 166, w: 190, h: 98 },
        { id: 'bed-a', name: 'Bed A', x: 220, y: 28, w: 170, h: 118 },
        { id: 'bed-b', name: 'Bed B', x: 220, y: 146, w: 170, h: 118 },
      ],
      5: [
        { id: 'living', name: 'Living', x: 30, y: 28, w: 180, h: 112 },
        { id: 'kitchen', name: 'Kitchen', x: 30, y: 140, w: 180, h: 74 },
        { id: 'bath', name: 'Bath', x: 30, y: 214, w: 88, h: 50 },
        { id: 'bed-a', name: 'Bed A', x: 210, y: 28, w: 180, h: 122 },
        { id: 'bed-b', name: 'Bed B', x: 118, y: 214, w: 272, h: 50 },
      ],
    };
    return layouts[count];
  }

  _estimateRouter(rooms, stats) {
    const room = rooms[0];
    const edgeBias = stats.avgRssi > -72 ? 0.16 : stats.avgRssi > -84 ? 0.24 : 0.32;
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
    const marks = this._state.scan.marks;
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
    const map = this._state.map.final || this._state.map.draft;
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

    this._els.scanStatus.textContent = this._state.scan.active ? 'Scanning' : 'Idle';
    this._els.scanSamples.textContent = `${this._state.scan.samples.length} samples`;
    this._els.scanConfidence.textContent = `${Math.round((map?.meta?.confidence || 0) * 100)}% draft`;
    this._els.mapRooms.textContent = `${map?.rooms?.length || 0} rooms`;
    this._els.mapDoors.textContent = `${map?.doorways?.length || 0} doors`;
    this._els.mapZones.textContent = `${map?.zones?.length || 0} zones`;
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
      svg.appendChild(createSvg('text', { x: 210, y: 148, 'text-anchor': 'middle', fill: 'rgba(232,236,224,0.5)', 'font-size': 16 }, 'No draft map yet'));
      return;
    }

    svg.appendChild(createSvg('rect', {
      x: map.apartment.x, y: map.apartment.y, width: map.apartment.w, height: map.apartment.h, rx: 18,
      fill: 'rgba(255,176,32,0.03)', stroke: 'rgba(255,176,32,0.45)', 'stroke-width': 2.4,
    }));

    map.zones.forEach((zone) => {
      svg.appendChild(createSvg('rect', {
        x: zone.x, y: zone.y, width: zone.w, height: zone.h, rx: 10,
        fill: 'rgba(32,144,255,0.07)', stroke: 'rgba(32,144,255,0.48)', 'stroke-dasharray': '5 4',
      }));
    });

    map.rooms.forEach((room, idx) => {
      const selected = this._state.map.selectedRoomId === room.id;
      svg.appendChild(createSvg('rect', {
        x: room.x, y: room.y, width: room.w, height: room.h, rx: 12,
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
    if (this._state.tracking.active && this._state.tracking.roomId) {
      svg.appendChild(createSvg('circle', { cx: this._state.tracking.x, cy: this._state.tracking.y, r: 8.5, fill: '#00d878', stroke: '#f4fff9', 'stroke-width': 2 }));
    }
  }

  _renderMesh() {
    const canvas = this._els.mesh;
    const ctx = canvas.getContext('2d');
    const map = this._state.map.final || this._state.map.draft;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#071019';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this._drawMeshGrid(ctx);

    if (!map) {
      ctx.fillStyle = 'rgba(232,236,224,0.48)';
      ctx.font = '600 18px Inter';
      ctx.fillText('No 3D draft yet', 140, 112);
      return;
    }

    const rooms = [...map.rooms].sort((a, b) => (a.y + a.h) - (b.y + b.h));
    rooms.forEach((room, idx) => this._drawExtrudedRoom(ctx, room, idx, room.id === this._state.tracking.roomId));
    if (map.router) this._drawRouter(ctx, map.router);
    if (this._state.tracking.active && this._state.tracking.roomId) this._drawTracker(ctx);
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
    return [
      this._projectPoint(room.x, room.y),
      this._projectPoint(room.x + room.w, room.y),
      this._projectPoint(room.x + room.w, room.y + room.h),
      this._projectPoint(room.x, room.y + room.h),
    ];
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
    const map = this._state.map.final || this._state.map.draft;
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
        map: { ...this._state.map, ...(parsed.map || {}) },
        tracking: { ...this._state.tracking, ...(parsed.tracking || {}) },
      };
      this._state.open = true;
    } catch {}
  }

  getSceneState() {
    return {
      map: this._state.map.final || this._state.map.draft,
      tracking: this._state.tracking,
    };
  }
}
