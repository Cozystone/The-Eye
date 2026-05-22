from __future__ import annotations

from datetime import UTC, datetime
from collections import Counter

from fastapi import HTTPException, status

from app.models import (
    AccountProfile,
    AnalysisSummary,
    Alert,
    AlertSeverity,
    ApprovalRecord,
    ApprovalRecordCreate,
    ApprovalStatus,
    AttributionAssessment,
    AttributionAssessmentCreate,
    AuditEvent,
    Case,
    CaseCreate,
    ConfidenceLevel,
    Entity,
    EntityCreate,
    EntityLink,
    EntityLinkCreate,
    EvidenceArtifact,
    EvidenceArtifactCreate,
    Finding,
    FindingCreate,
    GraphView,
    GraphNode,
    GraphEdge,
    LocationPrecision,
    LocationSignal,
    MapPoint,
    ObservedPost,
    ProcessingBasis,
    ReportBundle,
    RelationshipSignal,
    RelationshipType,
    RiskSignal,
    RiskType,
    ResponseAction,
    ResponseActionCreate,
    SourceKind,
    ScopeAwareAction,
    Subject,
    SubjectAnalysisSummary,
    SubjectCreate,
    SubjectGraphView,
    SubjectMapView,
    SubjectSource,
    SubjectSourceCreate,
    SubjectSummary,
    TopicSignal,
    Watchlist,
    WatchlistCreate,
    compare_confidence,
    make_id,
    utc_now,
)
from app.store import store


def subject_id_for_handle(handle: str) -> str:
    normalized = handle.strip().lstrip("@").lower()
    safe = "".join(ch if ch.isalnum() else "-" for ch in normalized).strip("-")
    safe = "-".join(part for part in safe.split("-") if part)
    return f"subject-{safe or 'workspace'}"


def require_case(case_id: str) -> Case:
    if case_id not in store.cases:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found")
    return store.cases[case_id]


def require_subject(subject_id: str) -> Subject:
    if subject_id not in store.subjects:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subject not found")
    return store.subjects[subject_id]


def append_audit(case_id: str, actor: str, event_type: str, details: dict) -> AuditEvent:
    event = AuditEvent(
        audit_id=make_id("audit"),
        case_id=case_id,
        actor=actor,
        event_type=event_type,
        details=details,
        created_at=utc_now(),
    )
    store.audit[case_id].append(event)
    return event


def create_case(payload: CaseCreate) -> Case:
    case = Case(
        case_id=make_id("case"),
        title=payload.title,
        incident_type=payload.incident_type,
        summary=payload.summary,
        authority_scope=payload.authority_scope,
        analysts=payload.analysts,
        reviewers=payload.reviewers,
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    store.cases[case.case_id] = case
    append_audit(case.case_id, payload.authority_scope.collector, "case_created", {"title": case.title})
    return case


def ensure_assets_in_scope(case: Case, assets: list[str]) -> None:
    allowed = set(case.authority_scope.asset_scope)
    invalid = [asset for asset in assets if asset not in allowed]
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Assets outside case scope: {', '.join(invalid)}",
        )


def create_artifact(case_id: str, payload: EvidenceArtifactCreate) -> EvidenceArtifact:
    case = require_case(case_id)
    ensure_assets_in_scope(case, payload.related_assets)
    artifact = EvidenceArtifact(
        artifact_id=make_id("artifact"),
        case_id=case_id,
        source_class=payload.source_class,
        artifact_type=payload.artifact_type,
        source_name=payload.source_name,
        content_summary=payload.content_summary,
        provenance=payload.provenance,
        source_reliability=payload.source_reliability,
        collected_by=payload.collected_by,
        hash_sha256=payload.hash_sha256,
        related_assets=payload.related_assets,
        metadata=payload.metadata,
        ingested_at=utc_now(),
    )
    store.artifacts[case_id].append(artifact)
    append_audit(case_id, payload.collected_by, "artifact_ingested", {"artifact_id": artifact.artifact_id})
    return artifact


def create_entity(case_id: str, payload: EntityCreate) -> Entity:
    require_case(case_id)
    entity = Entity(
        entity_id=make_id("entity"),
        case_id=case_id,
        entity_type=payload.entity_type,
        value=payload.value,
        display_name=payload.display_name,
        provenance=payload.provenance,
        source_reliability=payload.source_reliability,
        confidence=payload.confidence,
        artifact_ids=payload.artifact_ids,
        tags=payload.tags,
        created_at=utc_now(),
    )
    store.entities[case_id].append(entity)
    append_audit(case_id, "system", "entity_created", {"entity_id": entity.entity_id, "value": entity.value})
    return entity


def create_link(case_id: str, payload: EntityLinkCreate) -> EntityLink:
    require_case(case_id)
    link = EntityLink(
        link_id=make_id("link"),
        case_id=case_id,
        from_entity_id=payload.from_entity_id,
        to_entity_id=payload.to_entity_id,
        relationship=payload.relationship,
        evidence_artifact_ids=payload.evidence_artifact_ids,
        confidence=payload.confidence,
        created_at=utc_now(),
    )
    store.links[case_id].append(link)
    append_audit(case_id, "system", "entity_link_created", {"link_id": link.link_id})
    return link


def create_finding(case_id: str, payload: FindingCreate) -> Finding:
    require_case(case_id)
    finding = Finding(
        finding_id=make_id("finding"),
        case_id=case_id,
        title=payload.title,
        summary=payload.summary,
        entity_ids=payload.entity_ids,
        evidence_artifact_ids=payload.evidence_artifact_ids,
        contradictory_evidence=payload.contradictory_evidence,
        confidence=payload.confidence,
        created_at=utc_now(),
    )
    store.findings[case_id].append(finding)
    append_audit(case_id, "system", "finding_created", {"finding_id": finding.finding_id})
    return finding


def create_assessment(case_id: str, payload: AttributionAssessmentCreate) -> AttributionAssessment:
    require_case(case_id)
    assessment = AttributionAssessment(
        assessment_id=make_id("assess"),
        case_id=case_id,
        actor_label=payload.actor_label,
        summary=payload.summary,
        finding_ids=payload.finding_ids,
        confidence=payload.confidence,
        rationale=payload.rationale,
        created_at=utc_now(),
    )
    store.assessments[case_id].append(assessment)
    append_audit(case_id, "system", "assessment_created", {"assessment_id": assessment.assessment_id})
    return assessment


def create_action(case_id: str, payload: ResponseActionCreate) -> ResponseAction:
    case = require_case(case_id)
    try:
        ScopeAwareAction(action=payload, authority_scope=case.authority_scope)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    action = ResponseAction(
        action_id=make_id("action"),
        case_id=case_id,
        action_type=payload.action_type,
        title=payload.title,
        target=payload.target,
        justification=payload.justification,
        finding_ids=payload.finding_ids,
        requested_by=payload.requested_by,
        execution_notes=payload.execution_notes,
        approval_status=ApprovalStatus.PENDING,
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    store.actions[case_id].append(action)
    append_audit(case_id, payload.requested_by, "action_requested", {"action_id": action.action_id, "target": action.target})
    return action


def approve_action(case_id: str, action_id: str, payload: ApprovalRecordCreate) -> ApprovalRecord:
    case = require_case(case_id)
    if payload.reviewer not in case.reviewers:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Reviewer is not assigned to this case")

    action = next((item for item in store.actions[case_id] if item.action_id == action_id), None)
    if action is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Action not found")

    action.approval_status = ApprovalStatus.APPROVED if payload.approve else ApprovalStatus.REJECTED
    action.updated_at = utc_now()
    approval = ApprovalRecord(
        approval_id=make_id("approval"),
        case_id=case_id,
        action_id=action_id,
        reviewer=payload.reviewer,
        approve=payload.approve,
        notes=payload.notes,
        created_at=utc_now(),
    )
    store.approvals[case_id].append(approval)
    append_audit(case_id, payload.reviewer, "action_reviewed", {"action_id": action_id, "status": action.approval_status})
    return approval


def get_graph(case_id: str) -> GraphView:
    case = require_case(case_id)
    return GraphView(
        case=case,
        artifacts=store.artifacts[case_id],
        entities=store.entities[case_id],
        links=store.links[case_id],
        findings=store.findings[case_id],
        attribution_assessments=store.assessments[case_id],
        actions=store.actions[case_id],
    )


def analyze_case(case_id: str) -> AnalysisSummary:
    require_case(case_id)
    findings = store.findings[case_id]
    confidences = [finding.confidence for finding in findings]
    top = compare_confidence(confidences) if confidences else ConfidenceLevel.UNVERIFIED

    recommendations: list[str] = []
    if any(entity.entity_type.value == "session" for entity in store.entities[case_id]):
        recommendations.append("Review active sessions and queue session/token invalidation for confirmed malicious access.")
    if any(entity.entity_type.value == "domain" for entity in store.entities[case_id]):
        recommendations.append("Prepare provider abuse or hosting takedown package for suspicious infrastructure.")
    if not recommendations:
        recommendations.append("Collect additional telemetry before escalating attribution confidence.")

    append_audit(case_id, "system", "case_analyzed", {"finding_count": len(findings)})
    return AnalysisSummary(
        case_id=case_id,
        finding_count=len(findings),
        entity_count=len(store.entities[case_id]),
        artifact_count=len(store.artifacts[case_id]),
        action_count=len(store.actions[case_id]),
        top_confidence=top,
        recommendations=recommendations,
    )


def build_report(case_id: str) -> ReportBundle:
    case = require_case(case_id)
    approved = [action for action in store.actions[case_id] if action.approval_status == ApprovalStatus.APPROVED]
    pending = [action for action in store.actions[case_id] if action.approval_status == ApprovalStatus.PENDING]
    append_audit(case_id, "system", "report_generated", {"approved_actions": len(approved)})
    return ReportBundle(
        case_id=case.case_id,
        generated_at=utc_now(),
        case_summary=case.summary,
        findings=store.findings[case_id],
        attribution_assessments=store.assessments[case_id],
        pending_actions=pending,
        approved_actions=approved,
        artifacts=store.artifacts[case_id],
        entities=store.entities[case_id],
        audit_events=store.audit[case_id],
    )


def create_subject(payload: SubjectCreate) -> Subject:
    normalized_handle = payload.handle.strip().lstrip("@").lower()
    subject_id = subject_id_for_handle(normalized_handle)
    existing = store.subjects.get(subject_id)
    if existing is not None:
        return existing
    subject = Subject(
        subject_id=subject_id,
        handle=normalized_handle,
        display_name=payload.display_name,
        subject_type=payload.subject_type,
        processing_basis=payload.processing_basis,
        notes=payload.notes,
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    store.subjects[subject.subject_id] = subject
    store.subject_profiles[subject.subject_id] = AccountProfile(subject_id=subject.subject_id)
    return subject


def create_subject_source(subject_id: str, payload: SubjectSourceCreate) -> SubjectSource:
    subject = require_subject(subject_id)
    source = SubjectSource(
        source_id=make_id("source"),
        subject_id=subject_id,
        source_kind=payload.source_kind,
        label=payload.label,
        source_url=payload.source_url,
        description=payload.description,
        observed_posts=payload.observed_posts,
        metadata=payload.metadata,
        ingested_at=utc_now(),
    )
    store.subject_sources[subject_id].append(source)
    subject.updated_at = utc_now()
    return source


def _derive_topic_signals(subject_id: str, posts: list[ObservedPost]) -> list[TopicSignal]:
    topics = Counter()
    for post in posts:
        for tag in post.hashtags:
            cleaned = tag.strip().lstrip("#").lower()
            if cleaned:
                topics[cleaned] += 1
        words = [word.strip(".,!?").lower() for word in post.caption.split()]
        for word in words:
            if len(word) >= 6 and word.isalpha():
                topics[word] += 1
    return [
        TopicSignal(
            signal_id=make_id("topic"),
            subject_id=subject_id,
            topic=topic,
            weight=count,
            provenance="derived_from_public_posts",
        )
        for topic, count in topics.most_common(10)
    ]


def _derive_location_signals(subject_id: str, posts: list[ObservedPost]) -> list[LocationSignal]:
    grouped: dict[tuple[str, float, float], list[ObservedPost]] = {}
    for post in posts:
        if post.public_location_label and post.public_location_lat is not None and post.public_location_lng is not None:
            key = (post.public_location_label, post.public_location_lat, post.public_location_lng)
            grouped.setdefault(key, []).append(post)
    signals: list[LocationSignal] = []
    for (label, lat, lng), source_posts in grouped.items():
        precision = LocationPrecision.VENUE if any(p.public_location_name for p in source_posts) else LocationPrecision.CITY
        signals.append(
            LocationSignal(
                signal_id=make_id("loc"),
                subject_id=subject_id,
                label=label,
                precision=precision,
                lat=lat,
                lng=lng,
                observed_count=len(source_posts),
                provenance="explicit_public_location_tag",
                explicit=True,
            )
        )
    return signals


def _derive_relationship_signals(subject_id: str, subject_handle: str, posts: list[ObservedPost]) -> list[RelationshipSignal]:
    mentions = Counter()
    for post in posts:
        for mention in post.mentions:
            cleaned = mention.strip().lstrip("@").lower()
            if cleaned and cleaned != subject_handle.lower():
                mentions[cleaned] += 1
    return [
        RelationshipSignal(
            signal_id=make_id("rel"),
            subject_id=subject_id,
            related_handle=handle,
            relationship_type=RelationshipType.PUBLIC_INTERACTION,
            strength=count,
            provenance="public_mentions_and_tags",
        )
        for handle, count in mentions.most_common(15)
    ]


def _derive_risk_signals(subject_id: str, subject_handle: str, posts: list[ObservedPost]) -> list[RiskSignal]:
    domains = Counter()
    risks: list[RiskSignal] = []
    for post in posts:
        for domain in post.linked_domains:
            cleaned = domain.strip().lower()
            if cleaned:
                domains[cleaned] += 1
                if any(marker in cleaned for marker in ["bit.ly", "tinyurl", "t.me", "telegram"]):
                    risks.append(
                        RiskSignal(
                            signal_id=make_id("risk"),
                            subject_id=subject_id,
                            risk_type=RiskType.LINK_RISK,
                            severity=AlertSeverity.MEDIUM,
                            title="Short-link or redirect pattern observed",
                            summary=f"Public posts linked repeatedly to {cleaned}, which may warrant manual review.",
                            provenance="linked_domain_frequency",
                        )
                    )
    if subject_handle.count(".") > 1 or "_" * 3 in subject_handle:
        risks.append(
            RiskSignal(
                signal_id=make_id("risk"),
                subject_id=subject_id,
                risk_type=RiskType.IMPERSONATION,
                severity=AlertSeverity.LOW,
                title="Handle pattern may merit impersonation review",
                summary="The public handle format looks unusually decorated and should be manually reviewed if tied to a brand or public figure.",
                provenance="handle_pattern_heuristic",
            )
        )
    return risks


def analyze_subject(subject_id: str) -> SubjectAnalysisSummary:
    subject = require_subject(subject_id)
    posts = [post for source in store.subject_sources[subject_id] for post in source.observed_posts]

    store.topic_signals[subject_id] = _derive_topic_signals(subject_id, posts)
    store.location_signals[subject_id] = _derive_location_signals(subject_id, posts)
    store.relationship_signals[subject_id] = _derive_relationship_signals(subject_id, subject.handle, posts)
    store.risk_signals[subject_id] = _derive_risk_signals(subject_id, subject.handle, posts)

    matching_watchlists = [
        watchlist
        for watchlist in store.watchlists.values()
        if subject_id in watchlist.subject_ids
    ]
    for watchlist in matching_watchlists:
        for risk in store.risk_signals[subject_id]:
            if not watchlist.risk_types or risk.risk_type in watchlist.risk_types:
                if not any(existing.subject_id == subject_id and existing.watchlist_id == watchlist.watchlist_id and existing.title == risk.title for existing in store.alerts):
                    store.alerts.append(
                        Alert(
                            alert_id=make_id("alert"),
                            subject_id=subject_id,
                            watchlist_id=watchlist.watchlist_id,
                            severity=risk.severity,
                            title=risk.title,
                            summary=risk.summary,
                            risk_type=risk.risk_type,
                            created_at=utc_now(),
                        )
                    )

    recommendations = [
        "Review provenance-backed location signals on the map before drawing operational conclusions.",
        "Use public interaction edges as observed network signals, not private relationship proof.",
    ]
    if store.risk_signals[subject_id]:
        recommendations.append("Prioritize manual review of generated risk signals and linked domains.")

    return SubjectAnalysisSummary(
        subject_id=subject_id,
        post_count=len(posts),
        topic_count=len(store.topic_signals[subject_id]),
        relationship_count=len(store.relationship_signals[subject_id]),
        location_count=len(store.location_signals[subject_id]),
        risk_count=len(store.risk_signals[subject_id]),
        recommendations=recommendations,
    )


def get_subject_summary(subject_id: str) -> SubjectSummary:
    subject = require_subject(subject_id)
    posts = [post for source in store.subject_sources[subject_id] for post in source.observed_posts]
    if not store.topic_signals[subject_id] and posts:
        analyze_subject(subject_id)
    language_mix = Counter(post.language_hint for post in posts if post.language_hint)
    domains = Counter(domain for post in posts for domain in post.linked_domains)
    active_hours = sorted({post.posted_at.hour for post in posts})
    return SubjectSummary(
        subject=subject,
        source_count=len(store.subject_sources[subject_id]),
        post_count=len(posts),
        top_topics=store.topic_signals[subject_id][:5],
        active_hours_utc=active_hours,
        language_mix=dict(language_mix),
        recurring_domains=dict(domains.most_common(10)),
        public_location_count=len(store.location_signals[subject_id]),
        relationship_count=len(store.relationship_signals[subject_id]),
        risk_count=len(store.risk_signals[subject_id]),
    )


def get_subject_map(subject_id: str) -> SubjectMapView:
    require_subject(subject_id)
    points = [
        MapPoint(
            label=signal.label,
            precision=signal.precision,
            lat=signal.lat,
            lng=signal.lng,
            observed_count=signal.observed_count,
            provenance=signal.provenance,
        )
        for signal in store.location_signals[subject_id]
    ]
    return SubjectMapView(subject_id=subject_id, points=points)


def get_subject_graph(subject_id: str) -> SubjectGraphView:
    subject = require_subject(subject_id)
    nodes = [
        GraphNode(node_id=f"subject:{subject.subject_id}", label=subject.handle, kind="subject", weight=1),
    ]
    edges: list[GraphEdge] = []
    for topic in store.topic_signals[subject_id]:
        node_id = f"topic:{topic.topic}"
        nodes.append(GraphNode(node_id=node_id, label=topic.topic, kind="topic", weight=topic.weight))
        edges.append(GraphEdge(source=f"subject:{subject.subject_id}", target=node_id, label="posts_about", weight=topic.weight))
    for rel in store.relationship_signals[subject_id]:
        node_id = f"handle:{rel.related_handle}"
        nodes.append(GraphNode(node_id=node_id, label=rel.related_handle, kind="public_handle", weight=rel.strength))
        edges.append(GraphEdge(source=f"subject:{subject.subject_id}", target=node_id, label=rel.relationship_type.value, weight=rel.strength))
    for risk in store.risk_signals[subject_id]:
        node_id = f"risk:{risk.signal_id}"
        nodes.append(GraphNode(node_id=node_id, label=risk.title, kind="risk", weight=1))
        edges.append(GraphEdge(source=f"subject:{subject.subject_id}", target=node_id, label=risk.risk_type.value, weight=1))
    deduped_nodes = list({node.node_id: node for node in nodes}.values())
    return SubjectGraphView(subject_id=subject_id, nodes=deduped_nodes, edges=edges)


def create_watchlist(payload: WatchlistCreate) -> Watchlist:
    for subject_id in payload.subject_ids:
        require_subject(subject_id)
    watchlist = Watchlist(
        watchlist_id=make_id("watch"),
        name=payload.name,
        description=payload.description,
        subject_ids=payload.subject_ids,
        risk_types=payload.risk_types,
        created_at=utc_now(),
    )
    store.watchlists[watchlist.watchlist_id] = watchlist
    return watchlist


def list_alerts() -> list[Alert]:
    return sorted(store.alerts, key=lambda item: item.created_at, reverse=True)


def seed_demo_subject() -> Subject:
    existing = next((subject for subject in store.subjects.values() if subject.handle == "citysignals.media"), None)
    if existing is not None:
        if not store.subject_sources[existing.subject_id]:
            _populate_demo_subject(existing.subject_id)
        return existing

    subject = create_subject(
        SubjectCreate(
            handle="citysignals.media",
            display_name="City Signals Media",
            subject_type="brand",
            processing_basis=ProcessingBasis.PUBLIC_MONITORING,
            notes="Built-in demo subject for map and graph exploration.",
        )
    )
    _populate_demo_subject(subject.subject_id)
    return subject


def get_or_create_subject_by_handle(handle: str) -> Subject:
    normalized = handle.strip().lstrip("@").lower()
    if not normalized:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Handle is required")

    existing = store.subjects.get(subject_id_for_handle(normalized))
    if existing is not None:
        if normalized in {"citysignals.media", "demo", "sample"} and not store.subject_sources[existing.subject_id]:
            _populate_demo_subject(existing.subject_id)
        return existing

    display_name = normalized.replace(".", " ").replace("_", " ").title()
    subject = create_subject(
        SubjectCreate(
            handle=normalized,
            display_name=display_name or normalized,
            subject_type="public_account",
            processing_basis=ProcessingBasis.PUBLIC_MONITORING,
            notes="Workspace created from handle lookup.",
        )
    )
    if normalized in {"citysignals.media", "demo", "sample"}:
        _populate_demo_subject(subject.subject_id)
    return subject


def _populate_demo_subject(subject_id: str) -> None:
    if store.subject_sources[subject_id]:
        return

    create_subject_source(
        subject_id,
        SubjectSourceCreate(
            source_kind=SourceKind.PUBLIC_URL,
            label="Instagram public page snapshot",
            source_url="https://example.com/citysignals.media",
            description="Demo public page metadata for map and network intelligence.",
            observed_posts=[
                ObservedPost(
                    post_id="p1",
                    posted_at=datetime(2026, 5, 20, 10, 15, tzinfo=UTC),
                    caption="Coffee crawl through Seoul with #brunch #design #cafes",
                    hashtags=["brunch", "design", "cafes"],
                    mentions=["urbanframes", "roasterlab"],
                    linked_domains=["citysignals.co", "bit.ly/citysignals-map"],
                    public_location_name="Yeonnam",
                    public_location_label="Seoul, KR",
                    public_location_lat=37.5665,
                    public_location_lng=126.9780,
                    language_hint="en",
                ),
                ObservedPost(
                    post_id="p2",
                    posted_at=datetime(2026, 5, 21, 14, 30, tzinfo=UTC),
                    caption="Studio visit and founder interview with #design #founders",
                    hashtags=["design", "founders"],
                    mentions=["urbanframes"],
                    linked_domains=["citysignals.co"],
                    public_location_label="Seoul, KR",
                    public_location_lat=37.5665,
                    public_location_lng=126.9780,
                    language_hint="en",
                ),
                ObservedPost(
                    post_id="p3",
                    posted_at=datetime(2026, 5, 23, 3, 45, tzinfo=UTC),
                    caption="Night market textures and signage study #street #visualculture",
                    hashtags=["street", "visualculture"],
                    mentions=["nightframes", "urbanframes"],
                    linked_domains=["telegram.me/demo-channel"],
                    public_location_label="Busan, KR",
                    public_location_lat=35.1796,
                    public_location_lng=129.0756,
                    language_hint="en",
                ),
            ],
            metadata={"captured_by": "demo_seed"},
        ),
    )

    create_watchlist(
        WatchlistCreate(
            name="Demo link risk review",
            description="Highlights public accounts with short-link or messaging-link patterns.",
            subject_ids=[subject_id],
            risk_types=[RiskType.LINK_RISK],
        )
    )
    analyze_subject(subject_id)
