# Dependency and artwork notices

The source license is [MIT](../LICENSE). Provider accounts, services and trademarks have separate terms described in [NOTICE.md](../NOTICE.md). This review prepares a source publication; it does not clear the current preview binaries for public distribution.

## npm runtime inventory

The checked-in [runtime notice text](third-party-runtime-notices.txt) copies the installed dependencies' complete root license, copyright and notice files. Its [machine-readable inventory](third-party-runtime-inventory.json) binds the copies to the exact `package-lock.json` hash, package versions, installation paths and original notice-file hashes. The current inventory has **156 production lockfile placements and 148 package/version/notice groups**. Every installed runtime version matched its locked version, and every group had a license text.

Declared licenses in this snapshot are MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0 and 0BSD. Declarations are an inventory aid; the copied text remains authoritative. Lucide's file also includes the MIT notice for its Feather-derived icons. `reflect-metadata` and `tslib` copyright notices are included separately from their license files. Duplicate package versions with differing notice content are never silently combined.

Run these commands from the repository after a locked dependency installation:

```text
node scripts/release-notices.mjs --write
node scripts/release-notices.mjs --check
```

`--write` regenerates only the two notice files. Review their diff before committing. `--check` is read-only and fails for missing or changed text, missing license files, changed installed versions, package links, or new/inconsistent license declarations. It makes no registry request and runs no dependency scripts. A passing check covers the production npm source inventory only. It is not a security advisory scan, a legal opinion, or a complete binary bill of materials.

The npm inventory excludes development tools, Electron/Chromium native components, Android components and separately installed provider CLIs. Build-tool dependencies must be reviewed if they or their files are redistributed. Bundled Kling MCP code inherits the notices of its bundled runtime dependencies; keeping Kling disabled does not remove that distribution obligation.

## Windows distribution gate

The reviewed private Windows preview contains dependency license files inside `app.asar` and Electron/Chromium notices beside the executable. Its package allowlist omits Nakama's root `LICENSE` and `NOTICE.md`; there is no complete, readily accessible combined notice file beside the executable. Do not treat that preview package as notice-complete for public distribution.

A future unpacked distribution must contain exact copies at these names:

| Distribution file | Reviewed source |
| --- | --- |
| `LICENSE.nakama.txt` | `LICENSE` |
| `NOTICE.nakama.md` | `NOTICE.md` |
| `THIRD_PARTY_NOTICES.txt` | `docs/third-party-runtime-notices.txt` |
| `LICENSE.electron.txt` | `node_modules/electron/dist/LICENSE` |
| `LICENSES.chromium.html` | `node_modules/electron/dist/LICENSES.chromium.html` |

```text
node scripts/release-notices.mjs --binary windows output/installers/win-unpacked
```

This compares those files with their current local sources. It does not inspect an installer extraction, establish that a build is reproducible, approve a publisher signature, or review every native binary component. Preserve Electron's supplied distribution notices, then inspect the final installer and its extracted files as part of the release process.

## Android remains incomplete

The Android dependency audit identified these merged license entries in an engineering-preview APK:

- `META-INF/androidx/annotation/annotation/LICENSE.txt`
- `META-INF/androidx/collection/collection-ktx/LICENSE.txt`
- `META-INF/androidx/collection/collection/LICENSE.txt`

It contains many additional AndroidX runtime version records and Kotlin coroutine code. Those three entries do not establish a complete notice set, and no Nakama license/notice asset is currently included. The eight direct runtime declarations are below; they are **not a resolved transitive dependency graph**. Compose may select platform artifacts and transitive resolution may select other versions.

| Direct Gradle declaration | Declared version |
| --- | --- |
| `androidx.core:core-ktx` | `1.16.0` |
| `androidx.activity:activity-compose` | `1.10.1` |
| `androidx.compose.ui:ui` | `1.8.2` |
| `androidx.compose.ui:ui-tooling-preview` | `1.8.2` |
| `androidx.compose.foundation:foundation` | `1.8.2` |
| `androidx.compose.material3:material3` | `1.3.2` |
| `androidx.lifecycle:lifecycle-runtime-ktx` | `2.7.0` |
| `org.jetbrains.kotlinx:kotlinx-coroutines-android` | `1.10.2` |

The local artifact cache inspected during this review had no POM file for any of those exact declarations. Cached AAR/JAR availability alone cannot supply complete license provenance. Before a public APK release, export the actual `releaseRuntimeClasspath` component/artifact graph, retain each selected artifact's POM/module metadata and license/notice text, review any inherited or missing declarations, and package a readable notice asset with Nakama's license. Verify that asset in the final signed APK and retain the reviewed graph and hashes with the release. The debug preview additionally includes tooling dependencies that must be accounted for if it is ever distributed.

```text
node scripts/release-notices.mjs --binary android
```

This gate deliberately fails while the Android inventory and packaged notice verification are unresolved. It cannot be bypassed by supplying a self-declared “complete” flag. The npm notice file must not be relabelled as Android's notice bundle.

## Artwork and provider provenance

The Nakama mascot is the repository's editable original vector in `apps/desktop/assets/mascot.svg`. `scripts/build-icons.cjs` deterministically derives its PNG/ICO using Electron; Android's `ic_nakama.xml` and the checklist drawing are local vector implementations. No downloaded provider logo or third-party raster asset was identified in these app-artwork sources. The design requirement mentions inspiration from a referenced companion; this review does not establish trademark clearance or independent originality beyond the available source provenance. Retain the source and generator, and review any replacement artwork before publication.

Interface icons come from Lucide; its full Lucide/Feather notices are in the npm bundle. Provider names identify integrations and imply no affiliation or bundled service rights. Official Codex, Claude Code and optional Kling clients are separately installed; Nakama does not relicense those clients, account access or model output. Do not bundle their executables or authentication profiles without a separate redistribution review. Recheck eligibility, extra-usage settings and provider terms at release time; this notice inventory does not guarantee that an account or integration is eligible.
