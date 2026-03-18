from .access import require_admin_access
from .models import (
    AdminSummaryResponse,
    AdminTargetsResponse,
    AdminTargetsUpsertRequest,
)
from .service import (
    delete_target,
    fetch_admin_summary,
    fetch_content_summary,
    fetch_ingestion_summary,
    fetch_requests_summary,
    fetch_targets_summary,
    fetch_users_summary,
    upsert_targets,
)

__all__ = [
    "AdminSummaryResponse",
    "AdminTargetsResponse",
    "AdminTargetsUpsertRequest",
    "delete_target",
    "fetch_admin_summary",
    "fetch_content_summary",
    "fetch_ingestion_summary",
    "fetch_requests_summary",
    "fetch_targets_summary",
    "fetch_users_summary",
    "require_admin_access",
    "upsert_targets",
]
