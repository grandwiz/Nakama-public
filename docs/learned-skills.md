# Learned skills

Nakama keeps reusable methods in a local **Learned skills** library. Core Memory holds personal preferences and personality notes; skills hold practical steps, their intended use and their source. This is saved context shared with the configured agents, not foundation-model training or proof that Nakama has acquired a new tool or verified expertise.

Open **Learned skills** on Windows or **Tools → Learned skills** on a permitted paired Android device. The PC stores the shared library. Review, edit, pause or forget an entry there. No skill can authorise a deployment, project deletion, message, call, paid generation or other action. Existing tools, account restrictions and approval gates still apply.

## Teach a method

The editor accepts a title, description, when to use the method, ordered steps and optional tags. Explicitly taught methods are ready for relevant reuse unless disabled. You can also send this exact single-line command to automatic Nakama chat:

```text
Teach skill: Accessible form review | When: reviewing accessible forms and keyboard navigation | Steps: Check visible field labels; Walk keyboard focus order; State which browser checks remain unrun
```

This command is handled locally, without invoking a model. It recognises direct teaching only, not text quoted from a document, email, worker output or old conversation. A malformed request asks for clarification and does not claim a skill was saved. Teaching content is kept in the skill entry rather than copied into chat history; the conversation receives a saved-skill receipt. Recognised credential text is rejected. The library is not a secret store.

Other direct commands include `Open learned skills`, `List skills`, `Pause skill learning`, `Resume skill learning`, `Pause skill reuse`, `Resume skill reuse`, `Enable skill TITLE`, `Disable skill TITLE`, `Accept skill TITLE` and `Forget skill TITLE`. A title must identify exactly one saved entry. Accept a candidate only after inspecting its method and source.

## Learning from a project

After a managed workflow completes its writers, both reviewers pass the current static-review round and the manager delivers, Nakama may save one **candidate** from the approved work-item method. It records the originating workflow, project, task IDs and review round. This is deterministic extraction from existing receipts: there is no additional learning model call.

Candidates start disabled. Editing one does not activate it. Inspect the steps, remove project-specific details, and explicitly accept the method before agents can reuse it. A candidate can be incomplete, mistaken or contain adversarial instructions, even when its source project passed static review. Static reviews do not establish that tests, commands, deployments or device acceptance ran. Full libraries and unsuitable or credential-bearing methods are skipped without changing the project's delivery result.

Forgetting a candidate removes it from the library and removes its retained selection receipts. A persisted workflow marker prevents the same delivery from silently recreating it. Original project files and conversation/task history remain intact. New workflow runs can produce their own candidates.

## Reuse and controls

Before each model task, a local matcher compares the current request with ready, enabled skills' titles, tags and intended use. It requires an exact saved title or at least two meaningful matching terms. It selects at most three methods with a combined JSON payload of at most 4,200 characters. Unrelated methods, unreviewed candidates and disabled entries are excluded. Large methods that cannot fit this bound are omitted; an empty match adds no skills prompt.

The same selection is available to fast interaction, detailed conversation, planning, development and review tasks. This does not add an agent, inference call or tool. The prompt labels skill content as optional untrusted reference data, subordinate to the current request and host rules. Its instructions explicitly reject attempts to change permissions, approvals, identity or reporting. Model compliance still requires normal review; storing or accepting instructions does not make them infallible.

The library shows how often a skill was **selected for a task**, with the latest selection time. Up to 100 selection receipts record skill IDs, task ID, optional workflow ID and role. These are not proof that a provider read or followed the steps, or that work succeeded. Pause, deletion, edits and device access are rechecked after task-start persistence; a previously selected reference may therefore be withheld before the provider starts.

- **Learn useful methods** pauses automatic teaching capture and workflow candidate creation. Manual editor changes remain available.
- **Reuse relevant skills** pauses prompt reuse, independently of learning.
- Turning **conversation memory** off is a master pause for both automatic skill learning and reuse. It does not delete the library or change the two saved skill preferences.
- Skills are shared only with the Windows owner or a paired Android device with both Google and project access. Google-disabled devices, project-disabled devices and Chrome credentials receive no skill content or selection receipts. Permission changes are checked again inside queued mutations.

## API and bounds

`GET /api/skills` and the permitted `state.skillLibrary` projection return:

```text
{ version: 1, learningEnabled, reuseEnabled, skills: [...], receipts: [...], limits: {...} }
```

Each skill has `id`, `title`, `description`, `whenToUse`, `steps`, `tags`, `enabled`, `status` (`ready` or `candidate`), `source`, `createdAt`, `updatedAt`, `useCount`, and optional `reviewedAt`/`lastUsedAt`. Source is host-controlled and includes `kind` (`user_taught`, `user_edited`, or `reviewed_workflow`) and `detail`; workflow candidates add provenance IDs and `reviewRound`. Editing a workflow candidate preserves its provenance. Clients cannot supply status, provenance or usage counts.

| Operation | Request |
| --- | --- |
| Read library / entry | `GET /api/skills` or `GET /api/skills/:id` |
| Create explicitly taught skill | `POST /api/skills` with title, description, whenToUse, steps, optional tags/enabled |
| Edit / enable / disable | `PATCH /api/skills/:id` with a subset of editable fields |
| Accept candidate | `POST /api/skills/:id/accept` with `{}`; sets ready, enabled and reviewedAt |
| Forget one / all | `DELETE /api/skills/:id` or `DELETE /api/skills` |
| Learning/reuse controls | `PATCH /api/skills/settings` with learningEnabled and/or reuseEnabled booleans |

The collection is limited to 50 skills; title 80 characters, description and whenToUse 500 each, 1–12 steps of 500 characters each, and up to eight tags of 40 characters each. Text is normalised to ordinary whitespace. Unknown fields, malformed arrays, duplicate titles, invalid enable flags and recognised credentials fail without replacing existing entries. Candidate `enabled: true` is rejected until acceptance.

## Verification and remaining acceptance

`tests/learned-skills.test.mjs` covers migrations, CRUD/persistence, schema bounds, permission revocation, explicit local capture, secret rejection, independent pauses, relevant bounded selection, candidate provenance and acceptance, deletion markers, prompt framing and selection receipts. A synthetic full project workflow verifies reuse in planners, workers and reviewers, plus candidate creation at delivery, with the original seven model-fixture calls and no additional learning call. Live model effectiveness and the quality of future candidate methods remain user acceptance work.
