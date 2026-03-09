# Database Workspace

This directory is reserved for Cerul database assets that are safe to keep in the public repository.

- `migrations/` for schema changes
- `seeds/` for local development or demo seed data

For the current stage of Cerul, prefer simple SQL migrations first. A separate ORM schema layer is not required yet.

Do not commit production exports, private datasets, or one-off local dumps here.
