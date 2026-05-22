from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator, model_validator


def utc_now() -> datetime:
    return datetime.now(UTC)


def make_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


class SourceClass(str, Enum):
    CUSTOMER_OWNED = "customer_owned"
    PUBLIC_INTEL = "public_intel"
    PROVIDER_RESPONSE = "provider_response"


class ConfidenceLevel(str, Enum):
    CONFIRMED = "confirmed"
    LIKELY = "likely"
    POSSIBLE = "possible"
    UNVERIFIED = "unverified"


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class ResponseActionType(str, Enum):
    SESSION_REVOCATION = "session_revocation"
    TOKEN_INVALIDATION = "token_invalidation"
    ACCOUNT_RECOVERY = "account_recovery"
    IOC_BLOCKLIST = "ioc_blocklist"
    DECOY_ACTIVATION = "decoy_activation"
    PROVIDER_ABUSE_SUBMISSION = "provider_abuse_submission"
    HOSTING_TAKEDOWN_REQUEST = "hosting_takedown_request"
    LEGAL_HOLD_PACKAGE = "legal_hold_package"
    LAW_ENFORCEMENT_REFERRAL = "law_enforcement_referral"


class EntityType(str, Enum):
    ACCOUNT = "account"
    SESSION = "session"
    IDENTITY = "identity"
    IP = "ip"
    DOMAIN = "domain"
    HOST = "host"
    ARTIFACT = "artifact"
    CAMPAIGN = "campaign"


class AuthorityScope(BaseModel):
    legal_basis: str = Field(min_length=3)
    customer_id: str = Field(min_length=2)
    asset_scope: list[str] = Field(min_length=1)
    approved_response_targets: list[str] = Field(
        default_factory=list,
        description="Allowed owned assets or provider/legal coordination channels.",
    )
    retention_classification: str = Field(min_length=2)
    collector: str = Field(min_length=2)

    @field_validator("asset_scope", "approved_response_targets")
    @classmethod
    def clean_items(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip() for item in value if item.strip()]
        if value is not None and not cleaned and value != []:
            raise ValueError("List values must not be blank")
        return cleaned


class CaseCreate(BaseModel):
    title: str = Field(min_length=3)
    incident_type: str = Field(min_length=3)
    summary: str = Field(min_length=10)
    authority_scope: AuthorityScope
    analysts: list[str] = Field(min_length=1)
    reviewers: list[str] = Field(min_length=1)


class Case(BaseModel):
    case_id: str
    title: str
    incident_type: str
    summary: str
    authority_scope: AuthorityScope
    analysts: list[str]
    reviewers: list[str]
    created_at: datetime
    updated_at: datetime


class EvidenceArtifactCreate(BaseModel):
    source_class: SourceClass
    artifact_type: str = Field(min_length=2)
    source_name: str = Field(min_length=2)
    content_summary: str = Field(min_length=5)
    provenance: str = Field(min_length=3)
    source_reliability: int = Field(ge=1, le=5)
    collected_by: str = Field(min_length=2)
    hash_sha256: str = Field(min_length=16)
    related_assets: list[str] = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("related_assets")
    @classmethod
    def related_assets_not_blank(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip() for item in value if item.strip()]
        if not cleaned:
            raise ValueError("related_assets must include at least one asset")
        return cleaned


class EvidenceArtifact(BaseModel):
    artifact_id: str
    case_id: str
    source_class: SourceClass
    artifact_type: str
    source_name: str
    content_summary: str
    provenance: str
    source_reliability: int
    collected_by: str
    hash_sha256: str
    related_assets: list[str]
    metadata: dict[str, Any]
    ingested_at: datetime


class EntityCreate(BaseModel):
    entity_type: EntityType
    value: str = Field(min_length=2)
    display_name: str = Field(min_length=2)
    provenance: str = Field(min_length=3)
    source_reliability: int = Field(ge=1, le=5)
    confidence: ConfidenceLevel = ConfidenceLevel.POSSIBLE
    artifact_ids: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class Entity(BaseModel):
    entity_id: str
    case_id: str
    entity_type: EntityType
    value: str
    display_name: str
    provenance: str
    source_reliability: int
    confidence: ConfidenceLevel
    artifact_ids: list[str]
    tags: list[str]
    created_at: datetime


class EntityLinkCreate(BaseModel):
    from_entity_id: str
    to_entity_id: str
    relationship: str = Field(min_length=2)
    evidence_artifact_ids: list[str] = Field(default_factory=list)
    confidence: ConfidenceLevel = ConfidenceLevel.POSSIBLE


class EntityLink(BaseModel):
    link_id: str
    case_id: str
    from_entity_id: str
    to_entity_id: str
    relationship: str
    evidence_artifact_ids: list[str]
    confidence: ConfidenceLevel
    created_at: datetime


class FindingCreate(BaseModel):
    title: str = Field(min_length=3)
    summary: str = Field(min_length=10)
    entity_ids: list[str] = Field(min_length=1)
    evidence_artifact_ids: list[str] = Field(min_length=1)
    contradictory_evidence: list[str] = Field(default_factory=list)
    confidence: ConfidenceLevel


class Finding(BaseModel):
    finding_id: str
    case_id: str
    title: str
    summary: str
    entity_ids: list[str]
    evidence_artifact_ids: list[str]
    contradictory_evidence: list[str]
    confidence: ConfidenceLevel
    created_at: datetime


class AttributionAssessmentCreate(BaseModel):
    actor_label: str = Field(min_length=3)
    summary: str = Field(min_length=10)
    finding_ids: list[str] = Field(min_length=1)
    confidence: ConfidenceLevel
    rationale: str = Field(min_length=10)


class AttributionAssessment(BaseModel):
    assessment_id: str
    case_id: str
    actor_label: str
    summary: str
    finding_ids: list[str]
    confidence: ConfidenceLevel
    rationale: str
    created_at: datetime


class ResponseActionCreate(BaseModel):
    action_type: ResponseActionType
    title: str = Field(min_length=3)
    target: str = Field(min_length=2)
    justification: str = Field(min_length=10)
    finding_ids: list[str] = Field(min_length=1)
    requested_by: str = Field(min_length=2)
    execution_notes: str = ""


class ResponseAction(BaseModel):
    action_id: str
    case_id: str
    action_type: ResponseActionType
    title: str
    target: str
    justification: str
    finding_ids: list[str]
    requested_by: str
    execution_notes: str
    approval_status: ApprovalStatus
    created_at: datetime
    updated_at: datetime


class ApprovalRecordCreate(BaseModel):
    reviewer: str = Field(min_length=2)
    approve: bool
    notes: str = Field(min_length=3)


class ApprovalRecord(BaseModel):
    approval_id: str
    case_id: str
    action_id: str
    reviewer: str
    approve: bool
    notes: str
    created_at: datetime


class AuditEvent(BaseModel):
    audit_id: str
    case_id: str
    actor: str
    event_type: str
    details: dict[str, Any]
    created_at: datetime


class ReportBundle(BaseModel):
    case_id: str
    generated_at: datetime
    case_summary: str
    findings: list[Finding]
    attribution_assessments: list[AttributionAssessment]
    pending_actions: list[ResponseAction]
    approved_actions: list[ResponseAction]
    artifacts: list[EvidenceArtifact]
    entities: list[Entity]
    audit_events: list[AuditEvent]


class GraphView(BaseModel):
    case: Case
    artifacts: list[EvidenceArtifact]
    entities: list[Entity]
    links: list[EntityLink]
    findings: list[Finding]
    attribution_assessments: list[AttributionAssessment]
    actions: list[ResponseAction]


class AnalysisSummary(BaseModel):
    case_id: str
    finding_count: int
    entity_count: int
    artifact_count: int
    action_count: int
    top_confidence: ConfidenceLevel
    recommendations: list[str]


class ErrorResponse(BaseModel):
    detail: str


class ResponseTargetPolicy(BaseModel):
    target: str
    target_allowed: bool
    reason: str


class HealthResponse(BaseModel):
    status: str


class CountermeasurePolicyError(ValueError):
    """Raised when a response action exceeds the allowed defensive scope."""


def compare_confidence(levels: list[ConfidenceLevel]) -> ConfidenceLevel:
    order = [
        ConfidenceLevel.UNVERIFIED,
        ConfidenceLevel.POSSIBLE,
        ConfidenceLevel.LIKELY,
        ConfidenceLevel.CONFIRMED,
    ]
    highest = ConfidenceLevel.UNVERIFIED
    for level in levels:
        if order.index(level) > order.index(highest):
            highest = level
    return highest


def ensure_defensive_target(target: str) -> ResponseTargetPolicy:
    lower = target.lower()
    banned_markers = ["http://", "https://", "ssh://", "rdp://", "ftp://", "attacker", "exploit", "payload"]
    if any(marker in lower for marker in banned_markers):
        return ResponseTargetPolicy(
            target=target,
            target_allowed=False,
            reason="Target looks like an external technical action rather than an authorized defensive channel.",
        )
    return ResponseTargetPolicy(
        target=target,
        target_allowed=True,
        reason="Target appears consistent with defensive orchestration or provider/legal coordination.",
    )


class ScopeAwareAction(BaseModel):
    action: ResponseActionCreate
    authority_scope: AuthorityScope

    @model_validator(mode="after")
    def validate_target(self) -> "ScopeAwareAction":
        policy = ensure_defensive_target(self.action.target)
        if not policy.target_allowed:
            raise CountermeasurePolicyError(policy.reason)
        allowed_targets = set(self.authority_scope.asset_scope) | set(self.authority_scope.approved_response_targets)
        if self.action.target not in allowed_targets:
            raise CountermeasurePolicyError("Target is outside the approved response target list.")
        return self


class ProcessingBasis(str, Enum):
    PUBLIC_MONITORING = "public_monitoring"
    CONSENT_BASED = "consent_based"
    THREAT_INVESTIGATION = "threat_investigation"


class SubjectType(str, Enum):
    PUBLIC_ACCOUNT = "public_account"
    CREATOR = "creator"
    BRAND = "brand"
    ORG = "org"


class SourceKind(str, Enum):
    OFFICIAL_API = "official_api"
    PUBLIC_URL = "public_url"
    SEARCH_ENRICHMENT = "search_enrichment"
    USER_UPLOAD = "user_upload"
    MANUAL_NOTE = "manual_note"


class LocationPrecision(str, Enum):
    CITY = "city"
    REGION = "region"
    VENUE = "venue"


class RelationshipType(str, Enum):
    PUBLIC_INTERACTION = "public_interaction"
    CO_APPEARANCE = "co_appearance"
    DECLARED_AFFILIATION = "declared_affiliation"


class RiskType(str, Enum):
    IMPERSONATION = "impersonation"
    LINK_RISK = "link_risk"
    COORDINATED_ACTIVITY = "coordinated_activity"
    SUSPICIOUS_CLUSTER = "suspicious_cluster"


class AlertSeverity(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class SubjectCreate(BaseModel):
    handle: str = Field(min_length=2)
    display_name: str = Field(min_length=2)
    subject_type: SubjectType
    processing_basis: ProcessingBasis
    notes: str = ""


class Subject(BaseModel):
    subject_id: str
    handle: str
    display_name: str
    subject_type: SubjectType
    processing_basis: ProcessingBasis
    notes: str
    created_at: datetime
    updated_at: datetime


class AccountProfile(BaseModel):
    subject_id: str
    bio: str = ""
    declared_location: str = ""
    external_links: list[str] = Field(default_factory=list)
    language_hints: list[str] = Field(default_factory=list)
    profile_image_url: str | None = None


class ObservedPost(BaseModel):
    post_id: str = Field(min_length=2)
    posted_at: datetime
    caption: str = ""
    hashtags: list[str] = Field(default_factory=list)
    mentions: list[str] = Field(default_factory=list)
    linked_domains: list[str] = Field(default_factory=list)
    public_location_name: str | None = None
    public_location_label: str | None = None
    public_location_lat: float | None = None
    public_location_lng: float | None = None
    language_hint: str | None = None


class SubjectSourceCreate(BaseModel):
    source_kind: SourceKind
    label: str = Field(min_length=2)
    source_url: str | None = None
    description: str = ""
    observed_posts: list[ObservedPost] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SubjectSource(BaseModel):
    source_id: str
    subject_id: str
    source_kind: SourceKind
    label: str
    source_url: str | None = None
    description: str
    observed_posts: list[ObservedPost]
    metadata: dict[str, Any]
    ingested_at: datetime


class TopicSignal(BaseModel):
    signal_id: str
    subject_id: str
    topic: str
    weight: int
    provenance: str


class LocationSignal(BaseModel):
    signal_id: str
    subject_id: str
    label: str
    precision: LocationPrecision
    lat: float
    lng: float
    observed_count: int
    provenance: str
    explicit: bool = True


class RelationshipSignal(BaseModel):
    signal_id: str
    subject_id: str
    related_handle: str
    relationship_type: RelationshipType
    strength: int
    provenance: str


class RiskSignal(BaseModel):
    signal_id: str
    subject_id: str
    risk_type: RiskType
    severity: AlertSeverity
    title: str
    summary: str
    provenance: str


class SubjectSummary(BaseModel):
    subject: Subject
    source_count: int
    post_count: int
    top_topics: list[TopicSignal]
    active_hours_utc: list[int]
    language_mix: dict[str, int]
    recurring_domains: dict[str, int]
    public_location_count: int
    relationship_count: int
    risk_count: int


class MapPoint(BaseModel):
    label: str
    precision: LocationPrecision
    lat: float
    lng: float
    observed_count: int
    provenance: str


class SubjectMapView(BaseModel):
    subject_id: str
    points: list[MapPoint]


class GraphNode(BaseModel):
    node_id: str
    label: str
    kind: str
    weight: int = 1


class GraphEdge(BaseModel):
    source: str
    target: str
    label: str
    weight: int = 1


class SubjectGraphView(BaseModel):
    subject_id: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class SubjectAnalysisSummary(BaseModel):
    subject_id: str
    post_count: int
    topic_count: int
    relationship_count: int
    location_count: int
    risk_count: int
    recommendations: list[str]


class WatchlistCreate(BaseModel):
    name: str = Field(min_length=2)
    description: str = ""
    subject_ids: list[str] = Field(default_factory=list)
    risk_types: list[RiskType] = Field(default_factory=list)


class Watchlist(BaseModel):
    watchlist_id: str
    name: str
    description: str
    subject_ids: list[str]
    risk_types: list[RiskType]
    created_at: datetime


class Alert(BaseModel):
    alert_id: str
    subject_id: str
    watchlist_id: str | None = None
    severity: AlertSeverity
    title: str
    summary: str
    risk_type: RiskType
    created_at: datetime
