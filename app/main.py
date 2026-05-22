from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, RedirectResponse

from app.models import (
    Alert,
    AnalysisSummary,
    ApprovalRecord,
    ApprovalRecordCreate,
    AttributionAssessment,
    AttributionAssessmentCreate,
    Case,
    CaseCreate,
    Entity,
    EntityCreate,
    EntityLink,
    EntityLinkCreate,
    ErrorResponse,
    EvidenceArtifact,
    EvidenceArtifactCreate,
    Finding,
    FindingCreate,
    GraphView,
    LocationSignal,
    HealthResponse,
    Subject,
    SubjectAnalysisSummary,
    SubjectCreate,
    SubjectGraphView,
    SubjectMapView,
    SubjectSource,
    SubjectSourceCreate,
    SubjectSummary,
    ReportBundle,
    ResponseAction,
    ResponseActionCreate,
    Watchlist,
    WatchlistCreate,
)
from app.service import (
    analyze_case,
    analyze_subject,
    approve_action,
    build_report,
    create_action,
    create_artifact,
    create_assessment,
    create_case,
    create_entity,
    create_finding,
    create_link,
    create_subject,
    create_subject_source,
    create_watchlist,
    get_graph,
    get_subject_graph,
    get_or_create_subject_by_handle,
    get_subject_map,
    get_subject_summary,
    list_alerts,
    seed_demo_subject,
)

app = FastAPI(
    title="Threat Response Platform Beta",
    version="0.1.0",
    description="Post-breach threat response plus public account intelligence map platform.",
)


@app.get("/", response_class=HTMLResponse)
def root() -> HTMLResponse:
    html = """
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>The Eye</title>
      <style>
        :root {
          --panel: rgba(2, 6, 23, 0.72);
          --panel-strong: rgba(2, 6, 23, 0.86);
          --panel-border: rgba(148, 163, 184, 0.16);
          --ink: #e2e8f0;
          --muted: #94a3b8;
          --accent: #f59e0b;
          --accent-2: #fb7185;
        }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, sans-serif; color: var(--ink); background: #020617; }
        #hero-map { position: fixed; inset: 0; z-index: 0; }
        .shade {
          position: fixed; inset: 0; z-index: 1;
          background:
            radial-gradient(circle at top right, rgba(245, 158, 11, 0.16), transparent 24%),
            linear-gradient(180deg, rgba(2, 6, 23, 0.08) 0%, rgba(2, 6, 23, 0.26) 35%, rgba(2, 6, 23, 0.76) 100%);
        }
        .panel { position: relative; z-index: 2; min-height: 100vh; padding: 24px; }
        .topbar {
          display: flex; justify-content: space-between; align-items: center; gap: 16px;
          padding: 18px 20px; border-radius: 22px; background: var(--panel);
          border: 1px solid var(--panel-border); backdrop-filter: blur(18px);
          box-shadow: 0 28px 80px rgba(0, 0, 0, 0.34);
        }
        .brandline {
          display: inline-flex; align-items: center; gap: 8px;
          color: #fdba74; font-size: 12px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
        }
        .brandblock strong { display: block; font-size: 28px; line-height: 0.95; margin-top: 6px; }
        .brandblock span { display: block; color: var(--muted); font-size: 14px; margin-top: 8px; }
        .shell {
          position: absolute; top: 108px; left: 24px; width: min(560px, calc(100vw - 48px));
          background: var(--panel-strong); border: 1px solid var(--panel-border);
          border-radius: 28px; backdrop-filter: blur(18px); padding: 28px;
          box-shadow: 0 28px 80px rgba(0, 0, 0, 0.34);
        }
        h1 { margin: 0 0 10px; font-size: clamp(48px, 7vw, 78px); line-height: 0.92; max-width: 7ch; }
        .lead { margin: 0; color: var(--muted); font-size: 18px; line-height: 1.6; max-width: 46ch; }
        .search {
          display: flex; gap: 10px; margin: 26px 0 18px; flex-wrap: wrap;
          padding: 10px; border-radius: 20px; background: rgba(15, 23, 42, 0.72); border: 1px solid rgba(148, 163, 184, 0.14);
        }
        .search input {
          flex: 1 1 260px; min-width: 0; padding: 16px 18px; border-radius: 14px;
          border: 1px solid rgba(148, 163, 184, 0.12); background: rgba(2, 6, 23, 0.9); color: var(--ink); font-size: 18px;
        }
        .search button, a.btn {
          appearance: none; border: 0; cursor: pointer; text-decoration: none;
          display: inline-flex; align-items: center; justify-content: center;
          padding: 16px 18px; border-radius: 14px; font-weight: 700;
        }
        .search button { background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #111827; min-width: 138px; }
        .actions { display: flex; gap: 10px; flex-wrap: wrap; margin: 6px 0 24px; }
        a.btn.secondary { background: rgba(15, 23, 42, 0.86); color: var(--ink); border: 1px solid rgba(148, 163, 184, 0.14); }
        .stats {
          position: absolute; left: 24px; right: 24px; bottom: 24px;
          display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px;
        }
        .card {
          padding: 16px 18px; border-radius: 18px; background: rgba(15, 23, 42, 0.78);
          border: 1px solid rgba(148, 163, 184, 0.1); backdrop-filter: blur(14px);
          box-shadow: 0 16px 40px rgba(0, 0, 0, 0.2);
        }
        .card strong { display: block; font-size: 14px; margin-bottom: 6px; }
        .card span { color: var(--muted); font-size: 14px; line-height: 1.5; }
        .foot { margin-top: 18px; color: var(--muted); font-size: 13px; }
        @media (max-width: 1100px) {
          .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 720px) {
          .panel { padding: 14px; }
          .topbar { padding: 14px 16px; border-radius: 18px; }
          .shell { top: 92px; left: 14px; width: calc(100vw - 28px); padding: 22px; border-radius: 22px; }
          .stats { left: 14px; right: 14px; bottom: 14px; grid-template-columns: 1fr; }
          .search button { width: 100%; }
        }
      </style>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    </head>
    <body>
      <div id="hero-map"></div>
      <div class="shade"></div>
      <div class="panel">
        <div class="topbar">
          <div class="brandblock">
            <div class="brandline">Satellite Workspace</div>
            <strong>The Eye</strong>
            <span>Map-first public signal desk</span>
          </div>
          <a class="btn secondary" href="/demo">Launch Demo</a>
        </div>
        <div class="shell">
          <h1>The Eye</h1>
          <p class="lead">
            Map-first public signal workspace. Drop in an Instagram handle, open the subject view, and start from satellite context instead of a generic landing page.
          </p>
          <form class="search" action="/lookup" method="get">
            <input type="text" name="handle" placeholder="@instagram_id" value="@citysignals.media" />
            <button type="submit">Open Map</button>
          </form>
          <div class="actions">
            <a class="btn secondary" href="/demo">Live Demo</a>
            <a class="btn secondary" href="/docs">API Docs</a>
            <a class="btn secondary" href="/api">JSON API</a>
          </div>
          <div class="foot">Health: <a href="/health" style="color:#fdba74;">/health</a></div>
        </div>
        <div class="stats">
          <div class="card">
            <strong>Satellite-first layout</strong>
            <span>Esri imagery fills the whole viewport from the first paint so the map is the product, not a secondary widget.</span>
          </div>
          <div class="card">
            <strong>Handle lookup</strong>
            <span>Input accepts a public handle label and opens a subject workspace immediately. Demo handles are pre-seeded.</span>
          </div>
          <div class="card">
            <strong>Observed signals</strong>
            <span>Explicit public place tags, posting cadence, linked domains, and visible interaction edges are summarized with provenance.</span>
          </div>
          <div class="card">
            <strong>Fast entry</strong>
            <span>Use <code>@citysignals.media</code>, <code>@demo</code>, or <code>@sample</code> to open the seeded map view instantly.</span>
          </div>
        </div>
      </div>
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <script>
        const map = L.map('hero-map', {{
          zoomControl: false,
          attributionControl: true,
          dragging: false,
          scrollWheelZoom: false,
          doubleClickZoom: false,
          boxZoom: false,
          keyboard: false,
          tap: false,
          touchZoom: false,
        }}).setView([37.5665, 126.9780], 5);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{{z}}/{{y}}/{{x}}', {{
          maxZoom: 18,
          attribution: 'Tiles &copy; Esri'
        }}).addTo(map);
      </script>
    </body>
    </html>
    """
    return HTMLResponse(html)


@app.get("/api")
def api_root() -> dict[str, object]:
    return {
        "name": "Threat Response Platform Beta",
        "status": "ok",
        "docs": "/docs",
        "health": "/health",
        "demo": "/demo",
        "subject_ui_example": "/ui/subjects/{subject_id}",
        "features": [
            "incident response case platform",
            "public account intelligence summary",
            "map and network graph views",
            "watchlists and alerts",
        ],
    }


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.post("/cases", response_model=Case, responses={400: {"model": ErrorResponse}})
def post_case(payload: CaseCreate) -> Case:
    return create_case(payload)


@app.post("/cases/{case_id}/artifacts", response_model=EvidenceArtifact, responses={400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}})
def post_artifact(case_id: str, payload: EvidenceArtifactCreate) -> EvidenceArtifact:
    return create_artifact(case_id, payload)


@app.post("/cases/{case_id}/entities", response_model=Entity, responses={404: {"model": ErrorResponse}})
def post_entity(case_id: str, payload: EntityCreate) -> Entity:
    return create_entity(case_id, payload)


@app.post("/cases/{case_id}/links", response_model=EntityLink, responses={404: {"model": ErrorResponse}})
def post_link(case_id: str, payload: EntityLinkCreate) -> EntityLink:
    return create_link(case_id, payload)


@app.post("/cases/{case_id}/findings", response_model=Finding, responses={404: {"model": ErrorResponse}})
def post_finding(case_id: str, payload: FindingCreate) -> Finding:
    return create_finding(case_id, payload)


@app.post("/cases/{case_id}/assessments", response_model=AttributionAssessment, responses={404: {"model": ErrorResponse}})
def post_assessment(case_id: str, payload: AttributionAssessmentCreate) -> AttributionAssessment:
    return create_assessment(case_id, payload)


@app.post("/cases/{case_id}/actions", response_model=ResponseAction, responses={400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}})
def post_action(case_id: str, payload: ResponseActionCreate) -> ResponseAction:
    return create_action(case_id, payload)


@app.post("/cases/{case_id}/actions/{action_id}/approve", response_model=ApprovalRecord, responses={403: {"model": ErrorResponse}, 404: {"model": ErrorResponse}})
def post_approval(case_id: str, action_id: str, payload: ApprovalRecordCreate) -> ApprovalRecord:
    return approve_action(case_id, action_id, payload)


@app.post("/cases/{case_id}/analyze", response_model=AnalysisSummary, responses={404: {"model": ErrorResponse}})
def post_analysis(case_id: str) -> AnalysisSummary:
    return analyze_case(case_id)


@app.get("/cases/{case_id}/graph", response_model=GraphView, responses={404: {"model": ErrorResponse}})
def get_case_graph(case_id: str) -> GraphView:
    return get_graph(case_id)


@app.post("/cases/{case_id}/reports", response_model=ReportBundle, responses={404: {"model": ErrorResponse}})
def post_report(case_id: str) -> ReportBundle:
    return build_report(case_id)


@app.post("/subjects", response_model=Subject, responses={400: {"model": ErrorResponse}})
def post_subject(payload: SubjectCreate) -> Subject:
    return create_subject(payload)


@app.post("/subjects/{subject_id}/sources", response_model=SubjectSource, responses={404: {"model": ErrorResponse}})
def post_subject_source(subject_id: str, payload: SubjectSourceCreate) -> SubjectSource:
    return create_subject_source(subject_id, payload)


@app.post("/subjects/{subject_id}/analyze", response_model=SubjectAnalysisSummary, responses={404: {"model": ErrorResponse}})
def post_subject_analysis(subject_id: str) -> SubjectAnalysisSummary:
    return analyze_subject(subject_id)


@app.get("/subjects/{subject_id}/summary", response_model=SubjectSummary, responses={404: {"model": ErrorResponse}})
def get_summary(subject_id: str) -> SubjectSummary:
    return get_subject_summary(subject_id)


@app.get("/subjects/{subject_id}/map", response_model=SubjectMapView, responses={404: {"model": ErrorResponse}})
def get_map(subject_id: str) -> SubjectMapView:
    return get_subject_map(subject_id)


@app.get("/subjects/{subject_id}/graph", response_model=SubjectGraphView, responses={404: {"model": ErrorResponse}})
def get_graph_subject(subject_id: str) -> SubjectGraphView:
    return get_subject_graph(subject_id)


@app.post("/watchlists", response_model=Watchlist, responses={404: {"model": ErrorResponse}})
def post_watchlist(payload: WatchlistCreate) -> Watchlist:
    return create_watchlist(payload)


@app.get("/alerts", response_model=list[Alert])
def get_alerts() -> list[Alert]:
    return list_alerts()


@app.get("/demo/seed")
def demo_seed() -> dict[str, str]:
    subject = seed_demo_subject()
    return {
        "subject_id": subject.subject_id,
        "demo_url": f"/ui/subjects/{subject.subject_id}",
    }


@app.get("/demo")
def demo_redirect() -> RedirectResponse:
    subject = seed_demo_subject()
    return RedirectResponse(url=f"/ui/subjects/{subject.subject_id}", status_code=307)


@app.get("/lookup")
def lookup_handle(handle: str) -> RedirectResponse:
    subject = get_or_create_subject_by_handle(handle)
    return RedirectResponse(url=f"/ui/subjects/{subject.subject_id}", status_code=307)


@app.get("/ui/subjects/{subject_id}", response_class=HTMLResponse, responses={404: {"model": ErrorResponse}})
def subject_ui(subject_id: str) -> HTMLResponse:
    summary = get_subject_summary(subject_id)
    map_data = get_subject_map(subject_id)
    graph = get_subject_graph(subject_id)
    point_rows = "".join(
        f"<li><strong>{point.label}</strong> ({point.precision}) - {point.observed_count} posts - {point.provenance}</li>"
        for point in map_data.points
    ) or "<li>No explicit public location signals yet.</li>"
    topic_rows = "".join(
        f"<li>#{topic.topic} <span>({topic.weight})</span></li>"
        for topic in summary.top_topics
    ) or "<li>No topic signals yet.</li>"
    edge_rows = "".join(
        f"<li>{edge.source} -> {edge.target} [{edge.label}]</li>"
        for edge in graph.edges[:12]
    ) or "<li>No graph edges yet.</li>"
    html = f"""
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>{summary.subject.handle} intelligence view</title>
      <style>
        :root {{
          --bg: #020617;
          --panel: rgba(2, 6, 23, 0.74);
          --panel-soft: rgba(15, 23, 42, 0.88);
          --stroke: rgba(148, 163, 184, 0.14);
          --ink: #e2e8f0;
          --muted: #94a3b8;
          --accent: #f59e0b;
          --accent-2: #fb7185;
        }}
        * {{ box-sizing: border-box; }}
        body {{ font-family: Arial, sans-serif; margin: 0; background: var(--bg); color: var(--ink); }}
        #map {{ position: fixed; inset: 0; z-index: 0; }}
        .shade {{
          position: fixed; inset: 0; z-index: 1; pointer-events: none;
          background:
            radial-gradient(circle at top right, rgba(251, 113, 133, 0.12), transparent 24%),
            linear-gradient(180deg, rgba(2, 6, 23, 0.1) 0%, rgba(2, 6, 23, 0.3) 30%, rgba(2, 6, 23, 0.76) 100%);
        }}
        .viewport {{ position: relative; z-index: 2; min-height: 100vh; padding: 18px; }}
        .topbar {{
          display: flex; justify-content: space-between; gap: 16px; align-items: center;
          padding: 16px 18px; background: var(--panel); border: 1px solid var(--stroke);
          border-radius: 22px; backdrop-filter: blur(16px); box-shadow: 0 24px 70px rgba(0, 0, 0, 0.34);
        }}
        .brand strong {{ display: block; font-size: 18px; }}
        .brand span {{ color: var(--muted); font-size: 13px; }}
        .lookup {{ display: flex; gap: 10px; width: min(520px, 100%); }}
        .lookup input {{
          flex: 1; padding: 13px 14px; border-radius: 14px; border: 1px solid var(--stroke);
          background: rgba(2, 6, 23, 0.9); color: var(--ink);
        }}
        .lookup button {{
          padding: 13px 16px; border-radius: 14px; border: 0;
          background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #111827; font-weight: 700; cursor: pointer;
        }}
        .floating {{
          position: absolute; top: 94px; left: 18px; width: min(560px, calc(100vw - 36px));
          display: grid; gap: 14px;
        }}
        .sidepanel {{
          position: absolute; right: 18px; top: 94px; width: min(380px, calc(100vw - 36px));
          max-height: calc(100vh - 112px); overflow: auto; display: grid; gap: 14px;
        }}
        .card {{
          background: var(--panel-soft); border: 1px solid var(--stroke); border-radius: 22px; padding: 18px;
          backdrop-filter: blur(16px); box-shadow: 0 24px 70px rgba(0, 0, 0, 0.26);
        }}
        h1,h2 {{ margin-top: 0; }}
        .meta {{ display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }}
        .pill {{ background: rgba(15, 23, 42, 0.9); padding: 7px 11px; border-radius: 999px; color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.08); }}
        .hint {{ margin: 10px 0 0; color: var(--muted); font-size: 13px; line-height: 1.5; }}
        ul {{ padding-left: 18px; }}
        li {{ margin-bottom: 8px; }}
        a {{ color: #fdba74; }}
        .hero-title {{ margin-bottom: 6px; font-size: clamp(28px, 4vw, 42px); line-height: 0.95; }}
        .subtle {{ color: var(--muted); font-size: 14px; line-height: 1.6; }}
        .mini-grid {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }}
        .mini {{ padding: 12px 13px; border-radius: 16px; background: rgba(15, 23, 42, 0.74); border: 1px solid rgba(148, 163, 184, 0.08); }}
        .mini strong {{ display: block; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #fdba74; margin-bottom: 4px; }}
        .mini span {{ color: var(--ink); font-size: 18px; }}
        @media (max-width: 980px) {{
          .viewport {{ padding: 14px; }}
          .topbar {{ flex-direction: column; align-items: stretch; border-radius: 18px; }}
          .lookup {{ width: 100%; }}
          .floating {{
            position: static;
            width: 100%;
            margin-top: 14px;
          }}
          .sidepanel {{
            position: static;
            width: 100%;
            max-height: none;
            margin-top: 14px;
          }}
        }}
      </style>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    </head>
    <body>
      <div id="map"></div>
      <div class="shade"></div>
      <div class="viewport">
      <div class="topbar">
        <div class="brand">
          <strong>The Eye</strong>
          <span>Satellite-first subject workspace</span>
        </div>
        <form class="lookup" action="/lookup" method="get">
          <input type="text" name="handle" placeholder="@instagram_id" value="@{summary.subject.handle}" />
          <button type="submit">Open</button>
        </form>
      </div>
      <div class="floating">
        <div class="card">
          <h1 class="hero-title">{summary.subject.display_name}</h1>
          <p class="subtle">@{summary.subject.handle}</p>
          <div class="meta">
            <div class="pill">posts {summary.post_count}</div>
            <div class="pill">sources {summary.source_count}</div>
            <div class="pill">relationships {summary.relationship_count}</div>
            <div class="pill">risks {summary.risk_count}</div>
          </div>
          <p class="hint">Map points reflect explicit public location labels or uploaded subject data already present in the workspace. This demo does not infer hidden private location.</p>
          <div class="mini-grid">
            <div class="mini"><strong>Signals</strong><span>{summary.public_location_count}</span></div>
            <div class="mini"><strong>Active Hours</strong><span>{len(summary.active_hours_utc)}</span></div>
            <div class="mini"><strong>Topics</strong><span>{len(summary.top_topics)}</span></div>
            <div class="mini"><strong>Domains</strong><span>{len(summary.recurring_domains)}</span></div>
          </div>
        </div>
      </div>
      <div class="sidepanel">
        <div class="card">
          <h2>Top Topics</h2>
          <ul>{topic_rows}</ul>
          <h2>Location Signals</h2>
          <ul>{point_rows}</ul>
          <h2>Network Edges</h2>
          <ul>{edge_rows}</ul>
        </div>
      </div>
      </div>
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <script>
        const points = {map_data.model_dump_json()};
        const map = L.map('map', {{ zoomControl: false }}).setView([20, 0], 2);
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{{z}}/{{y}}/{{x}}', {{
          maxZoom: 18,
          attribution: 'Tiles &copy; Esri'
        }}).addTo(map);
        if (points.points.length > 0) {{
          const bounds = [];
          points.points.forEach((point) => {{
            const marker = L.circleMarker([point.lat, point.lng], {{
              radius: 8,
              weight: 2,
              color: '#fb7185',
              fillColor: '#f97316',
              fillOpacity: 0.88
            }}).addTo(map);
            marker.bindPopup(`<strong>${{point.label}}</strong><br/>${{point.precision}}<br/>posts: ${{point.observed_count}}<br/>${{point.provenance}}`);
            bounds.push([point.lat, point.lng]);
          }});
          map.fitBounds(bounds, {{ padding: [30, 30] }});
        }}
      </script>
    </body>
    </html>
    """
    return HTMLResponse(html)
