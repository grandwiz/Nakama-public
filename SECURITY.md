# Security policy

Nakama is an engineering preview with powerful intended local capabilities. No version is presently certified for unattended production use. Keep host services on loopback/private networks and connect only trusted, explicitly paired devices. See [security boundaries](docs/security.md).

## Reporting a vulnerability

Use **Security → Report a vulnerability** on the GitHub repository when private vulnerability reporting is enabled. Do not place exploit details, credentials, pairing payloads, personal screenshots or private logs in public issues. If the private reporting option is unavailable, open an issue asking for a private reporting channel without disclosing the vulnerability or sensitive evidence.

Provide affected source revision/platform, a minimal synthetic reproduction, expected/actual behavior and the authority boundary involved. Do not access other users' information or perform purchases, account changes, live messages or destructive operations to prove a finding.

Maintainers should reproduce in an isolated fixture, preserve private reports, document the fix and regression evidence, and coordinate disclosure. There is no guaranteed response-time SLA or bug-bounty commitment.

## Release trust

No production binaries are included in the initial public source release. Do not treat unsigned Windows builds, debug APKs, a hash alone or an installer launch as production trust/health evidence. Signing identities, provenance and recovery acceptance are described in [release signing](docs/release-signing.md).
