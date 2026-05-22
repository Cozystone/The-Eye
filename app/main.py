from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import HTMLResponse

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
    get_subject_map,
    get_subject_summary,
    list_alerts,
)

app = FastAPI(
    title="Threat Response Platform Beta",
    version="0.1.0",
    description="Post-breach threat response plus public account intelligence map platform.",
)


@app.get("/")
def root() -> dict[str, object]:
    return {
        "name": "Threat Response Platform Beta",
        "status": "ok",
        "docs": "/docs",
        "health": "/health",
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
        body {{ font-family: Arial, sans-serif; margin: 0; background: #0f172a; color: #e2e8f0; }}
        .grid {{ display: grid; grid-template-columns: 1.2fr 1fr; gap: 16px; padding: 20px; }}
        .card {{ background: #111827; border: 1px solid #334155; border-radius: 12px; padding: 16px; }}
        h1,h2 {{ margin-top: 0; }}
        .map {{ height: 420px; border-radius: 12px; overflow: hidden; }}
        .meta {{ display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }}
        .pill {{ background: #1e293b; padding: 6px 10px; border-radius: 999px; }}
        ul {{ padding-left: 18px; }}
      </style>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    </head>
    <body>
      <div class="grid">
        <div class="card">
          <h1>{summary.subject.display_name}</h1>
          <p>@{summary.subject.handle}</p>
          <div class="meta">
            <div class="pill">posts {summary.post_count}</div>
            <div class="pill">sources {summary.source_count}</div>
            <div class="pill">relationships {summary.relationship_count}</div>
            <div class="pill">risks {summary.risk_count}</div>
          </div>
          <div id="map" class="map"></div>
        </div>
        <div class="card">
          <h2>Top Topics</h2>
          <ul>{topic_rows}</ul>
          <h2>Location Signals</h2>
          <ul>{point_rows}</ul>
          <h2>Network Edges</h2>
          <ul>{edge_rows}</ul>
        </div>
      </div>
      <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
      <script>
        const points = {map_data.model_dump_json()};
        const map = L.map('map').setView([20, 0], 2);
        L.tileLayer('https://tile.openstreetmap.org/{{z}}/{{x}}/{{y}}.png', {{
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap'
        }}).addTo(map);
        if (points.points.length > 0) {{
          const bounds = [];
          points.points.forEach((point) => {{
            const marker = L.marker([point.lat, point.lng]).addTo(map);
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
