from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol


class BrollAssetRepository(Protocol):
    async def asset_exists(self, source: str, source_asset_id: str) -> bool:
        ...

    async def upsert_broll_asset(
        self,
        asset: Mapping[str, Any],
        embedding: Sequence[float],
        frame_path: str | None = None,
    ) -> dict[str, Any]:
        ...

    async def mark_job_completed(
        self,
        job_id: str | None,
        artifacts: Mapping[str, Any],
    ) -> None:
        ...


@dataclass(slots=True)
class InMemoryBrollAssetRepository:
    # STUB: replace with a database-backed repository after the shared DB layer lands.
    existing_assets: set[tuple[str, str]] = field(default_factory=set)
    stored_assets: list[dict[str, Any]] = field(default_factory=list)
    completed_jobs: dict[str, dict[str, Any]] = field(default_factory=dict)

    async def asset_exists(self, source: str, source_asset_id: str) -> bool:
        return (source, source_asset_id) in self.existing_assets

    async def upsert_broll_asset(
        self,
        asset: Mapping[str, Any],
        embedding: Sequence[float],
        frame_path: str | None = None,
    ) -> dict[str, Any]:
        payload = dict(asset)
        payload["embedding"] = list(embedding)
        payload["frame_path"] = frame_path

        key = (payload["source"], payload["source_asset_id"])
        self.existing_assets.add(key)

        for index, existing_asset in enumerate(self.stored_assets):
            if (
                existing_asset["source"],
                existing_asset["source_asset_id"],
            ) == key:
                self.stored_assets[index] = payload
                return payload

        self.stored_assets.append(payload)
        return payload

    async def mark_job_completed(
        self,
        job_id: str | None,
        artifacts: Mapping[str, Any],
    ) -> None:
        if job_id is None:
            return

        self.completed_jobs[job_id] = dict(artifacts)
