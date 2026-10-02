# Contributor continuation notes

Read the [capability status](implementation-status.md), [verification record](verification.md), [security boundaries](security.md) and current Git diff before changing behavior. This public repository starts from a clean source snapshot; older private development objects and personal acceptance records are not included.

The host owns saved local state and permission checks. Electron provides the private browser, Windows observation and user-controlled adapters. Android uses pinned host connections and explicit device permissions. Preserve existing roles, preferences, accounts and project identities when evolving schemas.

Monitoring and self-maintenance have dedicated [monitoring](monitoring.md), [upgrade](dynamic-upgrade.md) and [signing](release-signing.md) guides. Review asynchronous permission checks after captures and network operations, single-use write receipts, expiry/restart behavior and maintenance quiescence whenever extending them.

Use disposable synthetic fixtures for development. Live accounts, models, shopping, deployment, billing and physical-device input require their own explicit authorization. A successful local test, provider receipt, installer launch or static review is not functional acceptance.

Keep generated output and private acceptance data out of Git. Public binaries need production signing, dependency notices and deliberate clean-install/recovery acceptance; source publication does not establish those checks. See [contribution guidance](../CONTRIBUTING.md).
