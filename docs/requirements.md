# Product requirements and boundaries

Nakama is a personal Windows/Android assistant. Its direction is general computer, browser and application autonomy, with a first development benchmark of building and verifying a website locally. It must preserve configurable provider/model roles, user preferences and existing local data.

- One user-facing assistant coordinates a manager, planning/development workers and two independent reviews. Required questions return through the manager; dependent work waits for answers.
- Local personal tools and deterministic monitoring avoid model calls where possible. No automatic paid fallback, quota-reset trigger or retry authorises new provider work.
- Monitoring supports user-selected public shop URLs/languages, scoped application evidence, explicit pause/resume, backoff, expiry and current-record alerts. Unknown evidence stays unknown.
- Shopping uses separate persistent private sessions. Users sign in and confirm delivery details privately. Agents never receive passwords, addresses, payment information or private page pixels. A narrowly approved cart attempt stops before payment/order placement; unsupported shops require manual handoff.
- Dynamic upgrade prepares an isolated candidate, requires actual checks and both reviews, validates trusted signed artifacts, saves recovery copies and requests exact local PC installation approval. Uncertain handoff is never replayed.
- Paired devices are revocable and permission-scoped. Android observation requires explicit visible expiring consent. Remote input, autonomous input and private human control are distinct authorities.
- Credentials, pairing records, cookies, location/history, reports, personal checklist values and signing keys stay outside source. Never reuse installed profiles as disposable fixtures.
- Product UI and documentation must distinguish implementation, synthetic checks, live acceptance and installed-version evidence. Unrestricted input, universal shopping, automated website delivery, production update health and automatic rollback remain unfinished.

See [current status](implementation-status.md), [API contract](api-contract.md), [verification](verification.md) and [security](security.md).
