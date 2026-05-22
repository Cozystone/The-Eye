from __future__ import annotations

from collections import defaultdict

from app.models import (
    AttributionAssessment,
    AuditEvent,
    Case,
    AccountProfile,
    Alert,
    Entity,
    EntityLink,
    EvidenceArtifact,
    Finding,
    ResponseAction,
    ApprovalRecord,
    LocationSignal,
    RelationshipSignal,
    RiskSignal,
    Subject,
    SubjectSource,
    TopicSignal,
    Watchlist,
)


class InMemoryStore:
    def __init__(self) -> None:
        self.cases: dict[str, Case] = {}
        self.artifacts: dict[str, list[EvidenceArtifact]] = defaultdict(list)
        self.entities: dict[str, list[Entity]] = defaultdict(list)
        self.links: dict[str, list[EntityLink]] = defaultdict(list)
        self.findings: dict[str, list[Finding]] = defaultdict(list)
        self.assessments: dict[str, list[AttributionAssessment]] = defaultdict(list)
        self.actions: dict[str, list[ResponseAction]] = defaultdict(list)
        self.approvals: dict[str, list[ApprovalRecord]] = defaultdict(list)
        self.audit: dict[str, list[AuditEvent]] = defaultdict(list)
        self.subjects: dict[str, Subject] = {}
        self.subject_profiles: dict[str, AccountProfile] = {}
        self.subject_sources: dict[str, list[SubjectSource]] = defaultdict(list)
        self.topic_signals: dict[str, list[TopicSignal]] = defaultdict(list)
        self.location_signals: dict[str, list[LocationSignal]] = defaultdict(list)
        self.relationship_signals: dict[str, list[RelationshipSignal]] = defaultdict(list)
        self.risk_signals: dict[str, list[RiskSignal]] = defaultdict(list)
        self.watchlists: dict[str, Watchlist] = {}
        self.alerts: list[Alert] = []


store = InMemoryStore()
