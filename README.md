# Threat Response Platform Beta

Minimal `case platform + API` for post-breach evidence handling, attribution scoring, and human-approved defensive response orchestration.

## Features

- Case creation with explicit authority scope
- Evidence artifact ingestion with provenance and chain-of-custody fields
- Entity graph storage and linked findings
- Confidence-based attribution assessments
- Response actions that require scope validation and approval
- Audit log for mutations and action approvals

## Run

```bash
uvicorn app.main:app --reload
```

## Test

```bash
python -m pytest
```
