# Prepare locked project dependencies

Managed projects now inspect dependency setup after implementation and before checks. A supported root npm project requests a fresh exact PC approval for `npm ci`. An autonomous task can also discover setup and request the same operation for its selected project. Android can show and request work; approval remains on Windows.

The approval binds the project, requester, complete `package.json` and `package-lock.json` bytes, Node/npm runtime and private runner configuration. These are checked again immediately before launch, including after queued task persistence. There is no arbitrary install command, package-name argument or service-grant bypass.

The operation replaces `node_modules` and downloads public packages. It disables lifecycle scripts, audit, funding, update notifications and npm fetch retries. The runner uses empty private configuration, a separate cache/temp directory and a minimal environment without account secrets or inherited proxy/npm settings. It runs with the Windows user's file access; it is not an operating-system or network sandbox.

## Supported inputs

- A root npm manifest and matching lockfile version 2 or 3, with bounded ordinary package entries and SHA-512 integrity values.
- Public HTTPS tarballs from `registry.npmjs.org`, with ordinary registry version specifications.
- An installed supported Node/npm runtime, outside the project workspace.

Workspaces, overrides, private registries, root `.npmrc`, alternate lockfiles, linked folders, git/local/URL dependencies and bundled packages require another reviewed workflow. Nakama does not remove that configuration to make it pass. Missing lockfiles are not generated, and models must never invent integrity hashes. Packages requiring native builds or postinstall setup may not work with lifecycle scripts disabled.

A valid project declaring no npm dependencies skips preparation with an explicit record. A valid manifest with no lockfile but an ordinary existing `node_modules` can continue as **unverified manual setup**. Malformed or unsupported configuration cannot use that exception. This does not certify that manually installed dependencies match the source.

## Recorded results

The coordinator waits for actual child-process close and a saved terminal outcome. Exit zero also requires unchanged package/lockfile hashes and the expected ordinary `node_modules` directory. This establishes a limited preparation receipt; it does not inspect every installed file or prove that the application works.

Within one managed workflow, a prior successful preparation can be reused when its hashes match and `node_modules` remains available. The reuse is labelled; it does not freeze dependencies against outside changes. Changed hashes require another exact approval. Checks still run after each implementation/repair round and both independent reviewers receive the dependency evidence.

Rejected, expired, interrupted, failed or unverified preparation stops for attention. It does not trigger an automatic reinstall or spend the worker repair budget. Stop cancels pending authority and requests termination of the owned process; it cannot undo package files already replaced. Restart never silently replays the installation.

## Local website benchmark

The owner's first autonomy benchmark is **build and verify a website locally**. Managed planning, questions, implementation, approved preparation/checks and both reviews remain one flow. The general task manager can then request an exact-approved plain Vite/Next preview, use the existing isolated browser for separate page observations, and stop its own preview before another check. It cannot take ownership of a manually started or different task's preview.

This is not yet one fully accepted end-to-end website workflow. Missing-lockfile creation, native dependency setup, generated-output policy, automatic transition from managed delivery to browser acceptance, and independent functional acceptance remain unfinished. Existing `dist`/`build` snapshot exclusions are unchanged; `.next`, coverage and TypeScript metadata may conservatively interrupt managed review. A preview launch is not proof of port ownership, page readiness or a working site. Current general-task outcomes remain review required.

Real project-agent acceptance requires eligible accounts and explicit authorisation. No substitute paid provider or automatic scheduled retry is enabled. Local verification uses synthetic responders and disposable fixtures.
