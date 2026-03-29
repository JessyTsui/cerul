# Workers Workspace

This directory is reserved for Cerul indexing and processing workers.

- `broll/` for the lightweight stock-footage pipeline
- `knowledge/` for the knowledge-video pipeline
- `common/` for shared pipeline infrastructure

Workers own media-heavy and batch processing. They should not become a second API surface.
