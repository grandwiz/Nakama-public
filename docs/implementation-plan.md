# Implementation roadmap

This is an engineering preview, not a completed production system. The implemented boundaries and actual checks are recorded in [status](implementation-status.md) and [verification](verification.md).

1. Preserve local-first personal tools, configurable provider roles, manager questions, independent reviews and scoped paired-device access.
2. Improve general autonomous-task coordination and separate functional verification, retaining exact approvals and saved receipts.
3. Extend monitoring through explicitly reviewed adapters, without exposing private sessions to agents or inferring purchase authority. Accept each merchant/app flow separately.
4. Extend isolated self-maintenance toward reproducible signed artifacts, post-install health evidence and deliberate recovery, preserving application identities and user data.
5. Validate clean installation, upgrades, network loss, background behavior, accessibility, battery use and performance on a deliberate test matrix before making release claims.

Contributor work uses synthetic providers and disposable fixtures by default. Live models, payments, messages, calls, deployments, DNS and physical-device operations are never implicit tests. See [contribution guidance](../CONTRIBUTING.md) and [release signing](release-signing.md).
