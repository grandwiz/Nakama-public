# Public source and binary releases

This repository contains a clean, source-only engineering preview under the MIT license. Private Git history, accounts, installed profiles, device identifiers, screenshots, generated reports, packages and personal acceptance records are excluded. The included fillable checklist is blank.

Source publication does not certify production safety, every feature or supported third-party use. Review [capabilities](implementation-status.md), [security](security.md), [verification](verification.md), [dependency notices](third-party-notices.md) and [release signing](release-signing.md).

Before distributing binaries:

1. Provision and protect production signing identities. Preserve the identity of existing installations; a debug APK or unsigned Windows installer is a development artifact.
2. Include complete applicable dependency/artwork notices and verify built-package contents, signatures, identity, hashes and monotonically increasing versions.
3. Validate a clean machine/device installation and in-place upgrade without data loss. Deliberately test backup/recovery and post-restart health; an installer launch is insufficient.
4. Independently review exposed transport, pairing, approvals, browser/network isolation, local execution, update trust and secret retention.
5. Review provider eligibility/terms, costs and merchant restrictions. Complete live and physical acceptance only with explicit authorization. Never promise instantaneous stock, universal checkout, uninterrupted Android services or free third-party usage.

Keep vulnerability details and personal diagnostics out of public issues. Follow [SECURITY.md](../SECURITY.md); contributions follow [CONTRIBUTING.md](../CONTRIBUTING.md).
