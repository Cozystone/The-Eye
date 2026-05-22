from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def make_case() -> str:
    response = client.post(
        "/cases",
        json={
            "title": "Credential theft against customer portal",
            "incident_type": "account_takeover",
            "summary": "Customer observed session hijack and malicious password reset activity across the portal.",
            "authority_scope": {
                "legal_basis": "MSA-IR-2026",
                "customer_id": "cust-001",
                "asset_scope": ["portal.example", "api.example"],
                "approved_response_targets": [
                    "portal.example",
                    "provider-abuse:hosting-co",
                    "legal-hold:customer-counsel",
                ],
                "retention_classification": "confidential-ir",
                "collector": "analyst_a",
            },
            "analysts": ["analyst_a"],
            "reviewers": ["reviewer_a"],
        },
    )
    assert response.status_code == 200
    return response.json()["case_id"]


def test_case_workflow_end_to_end() -> None:
    case_id = make_case()

    artifact = client.post(
        f"/cases/{case_id}/artifacts",
        json={
            "source_class": "customer_owned",
            "artifact_type": "auth_log",
            "source_name": "portal-sso",
            "content_summary": "Suspicious login from new ASN followed by password reset.",
            "provenance": "sso_export_2026-05-22",
            "source_reliability": 5,
            "collected_by": "analyst_a",
            "hash_sha256": "abcd1234efgh5678ijkl9012mnop3456",
            "related_assets": ["portal.example"],
            "metadata": {"session_id": "sess-77", "ip": "203.0.113.10"},
        },
    )
    assert artifact.status_code == 200
    artifact_id = artifact.json()["artifact_id"]

    session_entity = client.post(
        f"/cases/{case_id}/entities",
        json={
            "entity_type": "session",
            "value": "sess-77",
            "display_name": "Suspicious portal session",
            "provenance": "artifact-derived",
            "source_reliability": 5,
            "confidence": "likely",
            "artifact_ids": [artifact_id],
            "tags": ["session_hijack"],
        },
    )
    assert session_entity.status_code == 200

    ip_entity = client.post(
        f"/cases/{case_id}/entities",
        json={
            "entity_type": "ip",
            "value": "203.0.113.10",
            "display_name": "Source IP 203.0.113.10",
            "provenance": "artifact-derived",
            "source_reliability": 4,
            "confidence": "possible",
            "artifact_ids": [artifact_id],
            "tags": ["new_asn"],
        },
    )
    assert ip_entity.status_code == 200

    link = client.post(
        f"/cases/{case_id}/links",
        json={
            "from_entity_id": session_entity.json()["entity_id"],
            "to_entity_id": ip_entity.json()["entity_id"],
            "relationship": "originated_from",
            "evidence_artifact_ids": [artifact_id],
            "confidence": "likely",
        },
    )
    assert link.status_code == 200

    finding = client.post(
        f"/cases/{case_id}/findings",
        json={
            "title": "Likely session hijack",
            "summary": "The affected account shows a new session and password reset sequence consistent with takeover.",
            "entity_ids": [session_entity.json()["entity_id"], ip_entity.json()["entity_id"]],
            "evidence_artifact_ids": [artifact_id],
            "contradictory_evidence": [],
            "confidence": "likely",
        },
    )
    assert finding.status_code == 200
    finding_id = finding.json()["finding_id"]

    assessment = client.post(
        f"/cases/{case_id}/assessments",
        json={
            "actor_label": "Cluster-A suspicious infrastructure",
            "summary": "Observed infrastructure reuse suggests linkage to a recurring credential theft cluster.",
            "finding_ids": [finding_id],
            "confidence": "possible",
            "rationale": "The IP appears in the same timing window and shares indicators with prior cases.",
        },
    )
    assert assessment.status_code == 200

    action = client.post(
        f"/cases/{case_id}/actions",
        json={
            "action_type": "session_revocation",
            "title": "Revoke hijacked session",
            "target": "portal.example",
            "justification": "The portal session is linked to likely malicious access and should be invalidated.",
            "finding_ids": [finding_id],
            "requested_by": "analyst_a",
            "execution_notes": "Coordinate with customer IAM team.",
        },
    )
    assert action.status_code == 200
    action_id = action.json()["action_id"]

    approval = client.post(
        f"/cases/{case_id}/actions/{action_id}/approve",
        json={"reviewer": "reviewer_a", "approve": True, "notes": "Approved for customer-owned portal only."},
    )
    assert approval.status_code == 200

    analysis = client.post(f"/cases/{case_id}/analyze")
    assert analysis.status_code == 200
    assert analysis.json()["top_confidence"] == "likely"

    graph = client.get(f"/cases/{case_id}/graph")
    assert graph.status_code == 200
    assert len(graph.json()["entities"]) == 2

    report = client.post(f"/cases/{case_id}/reports")
    assert report.status_code == 200
    assert len(report.json()["approved_actions"]) == 1
    assert len(report.json()["audit_events"]) >= 6


def test_reject_artifact_outside_scope() -> None:
    case_id = make_case()
    response = client.post(
        f"/cases/{case_id}/artifacts",
        json={
            "source_class": "customer_owned",
            "artifact_type": "dns_log",
            "source_name": "resolver",
            "content_summary": "DNS query for attacker domain observed from unmanaged asset.",
            "provenance": "resolver_batch",
            "source_reliability": 4,
            "collected_by": "analyst_a",
            "hash_sha256": "ffff1234efgh5678ijkl9012mnop3456",
            "related_assets": ["unknown.example"],
            "metadata": {},
        },
    )
    assert response.status_code == 400
    assert "outside case scope" in response.json()["detail"]


def test_reject_action_outside_approved_targets() -> None:
    case_id = make_case()
    response = client.post(
        f"/cases/{case_id}/actions",
        json={
            "action_type": "hosting_takedown_request",
            "title": "Touch external host directly",
            "target": "https://attacker.example/panel",
            "justification": "Attempt direct action on suspicious host.",
            "finding_ids": ["finding_fake"],
            "requested_by": "analyst_a",
            "execution_notes": "",
        },
    )
    assert response.status_code == 400


def make_subject() -> str:
    response = client.post(
        "/subjects",
        json={
            "handle": "citysignals.media",
            "display_name": "City Signals Media",
            "subject_type": "brand",
            "processing_basis": "public_monitoring",
            "notes": "Public monitoring workspace subject.",
        },
    )
    assert response.status_code == 200
    return response.json()["subject_id"]


def test_subject_public_intelligence_workflow() -> None:
    subject_id = make_subject()
    source = client.post(
        f"/subjects/{subject_id}/sources",
        json={
            "source_kind": "public_url",
            "label": "Instagram public page snapshot",
            "source_url": "https://example.com/citysignals.media",
            "description": "Manually captured public post metadata.",
            "observed_posts": [
                {
                    "post_id": "p1",
                    "posted_at": "2026-05-20T10:15:00Z",
                    "caption": "Coffee crawl through Seoul with #brunch #design #cafes",
                    "hashtags": ["brunch", "design", "cafes"],
                    "mentions": ["urbanframes", "roasterlab"],
                    "linked_domains": ["citysignals.co", "bit.ly/citysignals-map"],
                    "public_location_name": "Yeonnam",
                    "public_location_label": "Seoul, KR",
                    "public_location_lat": 37.5665,
                    "public_location_lng": 126.9780,
                    "language_hint": "en",
                },
                {
                    "post_id": "p2",
                    "posted_at": "2026-05-21T14:30:00Z",
                    "caption": "Studio visit and founder interview with #design #founders",
                    "hashtags": ["design", "founders"],
                    "mentions": ["urbanframes"],
                    "linked_domains": ["citysignals.co"],
                    "public_location_label": "Seoul, KR",
                    "public_location_lat": 37.5665,
                    "public_location_lng": 126.9780,
                    "language_hint": "en",
                },
            ],
            "metadata": {"captured_by": "analyst_demo"},
        },
    )
    assert source.status_code == 200

    analysis = client.post(f"/subjects/{subject_id}/analyze")
    assert analysis.status_code == 200
    assert analysis.json()["post_count"] == 2
    assert analysis.json()["location_count"] >= 1

    summary = client.get(f"/subjects/{subject_id}/summary")
    assert summary.status_code == 200
    data = summary.json()
    assert data["post_count"] == 2
    assert data["relationship_count"] >= 1
    assert "en" in data["language_mix"]

    graph = client.get(f"/subjects/{subject_id}/graph")
    assert graph.status_code == 200
    assert len(graph.json()["nodes"]) >= 3

    map_view = client.get(f"/subjects/{subject_id}/map")
    assert map_view.status_code == 200
    assert len(map_view.json()["points"]) >= 1

    watch = client.post(
        "/watchlists",
        json={
            "name": "Link risk review",
            "description": "Track short-link based public accounts.",
            "subject_ids": [subject_id],
            "risk_types": ["link_risk"],
        },
    )
    assert watch.status_code == 200

    # Re-run analysis after watchlist creation so alerts materialize.
    analysis_again = client.post(f"/subjects/{subject_id}/analyze")
    assert analysis_again.status_code == 200

    alerts = client.get("/alerts")
    assert alerts.status_code == 200
    assert any(alert["subject_id"] == subject_id for alert in alerts.json())

    ui = client.get(f"/ui/subjects/{subject_id}")
    assert ui.status_code == 200
    assert "City Signals Media" in ui.text


def test_root_and_demo_routes() -> None:
    root = client.get("/")
    assert root.status_code == 200
    assert "@instagram_id" in root.text
    assert "위성" in root.text

    api_root = client.get("/api")
    assert api_root.status_code == 200
    assert api_root.json()["demo"] == "/demo"

    seed = client.get("/demo/seed")
    assert seed.status_code == 200
    subject_id = seed.json()["subject_id"]
    assert seed.json()["demo_url"] == f"/ui/subjects/{subject_id}"

    demo = client.get("/demo", follow_redirects=False)
    assert demo.status_code == 307
    assert demo.headers["location"].startswith("/ui/subjects/")

    lookup = client.get("/lookup?handle=@citysignals.media", follow_redirects=False)
    assert lookup.status_code == 307
    assert lookup.headers["location"].startswith("/ui/subjects/")

    favicon = client.get("/favicon.ico")
    assert favicon.status_code == 200
    assert "<svg" in favicon.text

    stale = client.get("/ui/subjects/subject_e465f1713827", follow_redirects=False)
    assert stale.status_code == 307
    assert stale.headers["location"].startswith("/ui/subjects/subject-citysignals-media")

    empty_lookup = client.get("/lookup?handle=@new_handle", follow_redirects=True)
    assert empty_lookup.status_code == 200
    assert "실제 수집 소스가 연결되지 않아" in empty_lookup.text
    assert "게시물 0" in empty_lookup.text
