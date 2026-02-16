# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [1.0.0-beta.1] - 2026-02-16

### Added
- Enterprise hardening baseline: v2 auth context, RBAC-aware self-hosted API shape, audit/ops endpoints, and gateway test coverage.
- CI workflow with lint/typecheck/test/build gates.
- Security/compliance/operations documentation scaffolding.
- Consumer-facing README with image/art placeholders.

### Changed
- Package versioning promoted from initial dev metadata to `1.0.0-beta.1`.
- Android release defaults hardened (`allowBackup=false`, minify/resource shrinking in release).
- Provider/client contracts upgraded for structured entitlement responses and auth context propagation.

[1.0.0-beta.1]: https://github.com/brendan612/armadillo/releases/tag/v1.0.0-beta.1
