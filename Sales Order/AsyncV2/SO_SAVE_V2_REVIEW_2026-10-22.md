# SO Save V2 on dev: review (2026-10-22)

**What was reviewed:** the SO Save V2 build that is live on dev, read against the hand-off brief
([SO_SAVE_V2_HANDOFF.md](SO_SAVE_V2_HANDOFF.md)) and our platform notes. All times are MYT.

| Live on dev | Version |
|---|---|
| SO_SAVE_SUBMIT | v6 |
| SO_SAVE_WORKER | v9 (findings from v8; v9 only adds chained stages) |
| SO_SAVE_PREPARE | v7 |
| SO_SAVE_COMMIT | v7 |
| SO_SAVE_RUN | v3 |
| SO form | v1247 |

**What it found:** two blockers, sixteen major issues and twelve minor ones, plus problems with how
versions were published (section 2).

**How to read it:** each finding gives:
- the node it rests on and the code that shows it;
- a concrete failure;
- a fix.

Findings come from three independent code reviews plus checks against dev data. The ones marked
*medium* are projections or need concurrency to show.

The lifted classic code is not where the problems are. Every lifted function is identical to the
deployed classic version (diffed):
- 9 nodes of SO_SAVE v170;
- the SO_CASCADE v27 nodes;
- 2 nodes of GLOBAL_ALLOCATION v34.

The issues are in the job, lock and hold glue around it.

## 1. Tonight's cut

- **The switch is ON on dev.** SO form v1247 (published 12:18 today) sets `SO_SAVE_V2_ENABLED = true`.
  The full deployment promotes dev to prod as it stands, so V2 ships ON tonight unless the switch is
  set to `false` first.
- **Recommendation: ship it OFF.** Set `SO_SAVE_V2_ENABLED = false` before the cut, so the form uses
  today's classic save. Keep building on dev, and switch it ON in a later release, once:
  - B1 and B2 are fixed;
  - the guards in other workflows (section 5) exist;
  - the tests in section 4 pass.

  The reason: with V2 ON, a sales order can stay locked indefinitely after a normal interruption (B1).
  A delivery completed meanwhile can also be silently overwritten by the save (M8).
- The product owner makes this call.

## 2. Publishing on dev

### The CLI moved (10-22, ~12:20)

The CN team moved `sudu-lowcode` from `sumes-cli.dev.mes.sudu.ai` to `https://dev.mes.sudu.ai/api`,
and sumes-cli is now their own test environment.

- **Set-up:**
  - read profile: `sudu-lowcode profile add dev-main --endpoint https://dev.mes.sudu.ai/api --mirror dev-main`;
  - write profile: add `dev-main-write` the same way, plus `--allow-writes`;
  - log in to each with `login --private`, using your own Xanto account, not admin;
  - re-pull your app before changing anything.
- **Stop using the old `dev` / `dev-write` profiles.** The two environments keep separate caches.
- **If you published through sumes-cli before you switched,** dev.mes (where the forms run) may have
  kept running the version it last loaded. Treat form test results from that time with care, and
  re-test after your next publish through dev.mes.

### How your versions were published, and what it broke

Every version of your five workflows has no `draft` rows in `su_code_workflow_history`. So they were
published by CLI compile, not through the platform's createVersion / addDraft / publish.

Each workflow also has a stray `designing` row left over:

| Workflow | Stray row |
|---|---|
| SUBMIT, WORKER, PREPARE | `v3`, 10-21 12:11 |
| COMMIT | `v3`, 10-21 16:38, next to its published `v3` |

After a compile publish, the platform's createVersion numbers the next draft from the last version
it made itself. That is what happened on GD_EDIT_COMMIT, a GD Edit V2 workflow owned by another session:

1. Your E5 fix went in as v10 (09:16) and v11 (09:23), both by compile.
2. At 14:07 the owner's normal publish got a new draft numbered **v10**, below the live v11, and failed.
3. It left a stray draft and needed a manual workaround (publishing into that draft).

The fix itself was good. The owner has taken it into their own source, so it is kept.

### Going forward

- **Don't publish into another owner's workflows:** GD_EDIT_*, GD_COMPLETE_*, INVENTORY_BULK_APPLY,
  and so on. Send the change to the owner (through the product owner) so it lands in their source and
  their next build doesn't drop it.
- **After each publish,** check `su_code_workflow_history`: your new row should be `enabled`, with no
  `designing` row left behind.
- **Publish each workflow by one route,** now `sudu-lowcode --profile dev-main-write compile ...`.
- **Share your builder.** Your builder (`scripts/build-so-save-v2.mjs`, going by the code) is not in
  the shared repo. Without it, nobody else can rebuild or patch these workflows.

## 3. Findings

### Blockers

**B1. Nothing runs a job once the form stops following it.**
- **Where:** in SO_SAVE_WORKER, `code_node_SWguard` refuses a run without a job id:
  `if (!digits(inp.jobId)) return reject("job_id: digits")`.
  - SO form v1247 follows a job for `SOV2_FOLLOW_MS = 120000`, then says
    "It will open read-only until it is done." and closes.
  - The form's `mounted` has no `is_processing` or follow code, so that message isn't true.
  - The SO list (v532) never calls these workflows.
- **Failure:** the job stays open with `is_processing = 1`, and every later save of that SO answers
  BUSY, after any of these:
  - a save that takes longer than 120 s;
  - a crash (the 300 s lease outlasts the follow window);
  - a closed tab;
  - an unanswered 413 / 414 (AWAITING_CONFIRMATION never expires).

  If the job stops between COMMIT S2 and S3, it is worse: the SO lines are saved while the GD holds
  expire (900 s) and get cancelled, so the SO and its deliveries disagree.
- **Seen on dev:** job …3762 crashed in COMMIT at 10-21 16:52:33, and nothing ran it until a manual
  call at 17:00:16.
- **Fix:**
  - Make `job_id` optional, so the worker polls due jobs.
  - Kick the worker from the SO list's `mounted`, the way the GD list does (`gdc_list_mounted.js`).
  - When an SO with `is_processing = 1` is opened, make the form read-only and follow its job.
  - Expire AWAITING_CONFIRMATION through the FAILED path (unlock and cancel the holds).

**B2. Editing a Draft loses a document number the user changed.**
- **Where:**
  - PREPARE `code_node_SPplan` skips the number columns on edits:
    `... || SO_HEADER_NUMBER.indexOf(c) >= 0) continue;`.
  - COMMIT `code_node_SCa`, step S0N, takes the stored rule for edits: `rule = s(n.stored_so_no_type)`.
- **What happens:** on a Draft, the form lets the user switch the numbering rule (`so_no_type`) or
  type a number under Manual Input. Classic (`code_node_X4j8BSXd`) keeps what the user typed; V2
  issues a number from the stored rule.
  - A Draft switched to Manual Input "ABC-1" and then issued gets a number from the old rule.
  - A manual "D-1" retyped as "D-2" is never written.
  - 55 of 2,415 SOs on dev use manual numbering.
- **Fix:** on an edit, honour the typed `so_no` / `so_no_type` when they differ from the stored ones:
  write the typed number, or use the new rule, with the check in M10. Or answer NOT_ELIGIBLE so
  classic saves it.

### Major: stuck jobs and locks

**M1. A lost SUBMIT leaves an orphan job.** SUBMIT `code_node_SSdue`
(`route: mine ? "DUE" : "LOST"`).
- Two saves of one SO about 1 s apart:
  1. B takes `LOCK|n+2`, sees A's job as a racer, cancels itself and unlocks.
  2. A is told "could not be queued" (LOST), but its QUEUED job stays open.
  3. Every later save of the SO answers BUSY.
  4. If anyone follows A, PREPARE answers 409 forever (`lock_ref` ≠ `idempotency_key`), with no
     attempt count.
- **Fix:** on LOST, cancel your own job; re-check open jobs just before the lock insert; count
  no-progress stage answers as attempts.

**M2. A long message crashes PREPARE on dev.** `gd_async_job.progress_message` is `varchar(255)`, and
dev runs `STRICT_TRANS_TABLES` (checked).
- **How it overflows:**
  - the 414 question is about 152 fixed characters plus one `label: a -> b` per raised line;
  - the 406 reason adds one `label on GD: reason` per failed line;
  - two raised lines with normal descriptions already pass 255.
- **Failure:**
  1. `update_node_SBjob` / `SAjob` / `SGjob` fails, the WORKER run crashes, and the lease isn't
     released.
  2. It retries every 300 s and ends FAILED `SOV2_RETRIES` after 5 attempts.
  3. The user never sees the question or the reason, and the SO is BUSY for 20–25 minutes.
- Prod is not strict (`NO_ENGINE_SUBSTITUTION`), so there the text is only cut off. No SAVE_SO job on
  dev has reached 413 / 414 / 406 yet.
- **Fix:** cap it at 250 characters, as GD Edit V2 does (`.slice(0, 250)`). The full text already goes
  to `error_message` / `error_details`, which are longtext.

### Major: GD holds

**M3. Holds can expire in the middle of a commit.**
- **Why:**
  - GD Edit V2 holds last 900 s (`fcHold ? 1800 : 900`).
  - The WORKER sends `source: "CASCADE"`, and there is no `SOV2|` hold length (brief §12).
  - COMMIT checks HELD only in S0, and writes S0 DONE before the header write, so a resumed run skips
    the check.
  - Phase B is one 250-op part per worker call: 8 calls at 2,000 lines, while the form follows for
    about 120 s.
- **Failure:** the job sits unkicked for 15 minutes. S3 RELEASE then cancels the expired hold and gets
  NONE. The SO lines are saved and the GD change is not; the job goes to review with the SO locked.
- **Fix:**
  - give `SOV2|` holds 30–60 minutes (ask the GD Edit V2 owner);
  - re-check or extend the holds at each phase;
  - write S0 DONE together with S1.

**M4. The release step can't safely re-run.**
- **Where:** COMMIT `code_node_SCrel`:
  `const bad = res.releases.filter((r) => String(r.route) !== "RELEASED");`.
- **Failure:** GD_EDIT_SUBMIT answers NONE once a job is past HELD. A retry after a crash therefore
  calls an already-released GD "bad", and the job goes REQUIRES_REVIEW with the SO locked. A transient
  BUSY 409 also goes straight to review.
- **Fix:**
  - read the hold jobs first;
  - count a job at READY_TO_COMMIT or later, with a RELEASE step for this `cascade_ref`, as released;
  - retry on BUSY.

**M5. Holds are not reliably cancelled.**
- **Where:**
  - A HOLD-stage 413 (`soWorkHold2`) parks the job with the earlier GDs still HELD, but CANCEL
    (`soSubmitConfirm`) answers "nothing was written: questions come before any hold".
  - `soWorkEnd` cancels `pick.holds` but never `pending`.
  - The terminal job row is written before the cancel loop, so a CANCEL_HELD that answers BUSY or
    crashes is never retried.
- **Failure:** GD1 is held, a picker confirms on GD2, GD Edit V2 answers 413, and the user clicks
  Cancel. GD1 stays Processing for at least 15 minutes, and the user's retry answers BUSY.
- **Fix:**
  - route CANCEL through the worker's end path;
  - include `pending`;
  - write the terminal row last;
  - get the `SOV2|` orphan rule into GD Edit V2 (brief §12).

**M6. The HOLD stage trusts GD_EDIT_WORKER's answer.**
- **Where:** WORKER `code_node_SWh2`: `if (st === "HELD")…`, and anything else is `MORE`.
- **Failure:** GD_EDIT_WORKER's poll returns only due, unleased jobs. If someone else already held the
  GD job (a GD list mount, or a retry after a crash), the answer comes back with an empty
  `job_status`. The SO job then spins until the 900 s hold expires, and fails with 406.
- **Fix:** read the GD job's own row (status, `cascade_ref`) from `gd_async_job`.

**M7. Released GD edits wait for someone to kick them.** COMMIT only releases them.
- **Seen on dev:** GD edit 2112838980390039554 was released at 10-21 17:30:48 and committed at
  10-22 09:47:27, so GD/20261021/105 sat in Processing for about 16 hours.
- **Fix:** have the WORKER run GD_EDIT_WORKER for each released job, one per call.
- *Medium confidence: the client may not have been wired to kick it yet at the time.*

### Major: other writers and retries

**M8. COMMIT never checks the line before-images that PREPARE stores.**
- **Where:**
  - PREPARE stores `{ op: "U", id, set, before }` (`code_node_SPplan`).
  - COMMIT's `soCommitB` writes `soCommitFull(was, o.set, ...)` and never reads `o.before`.
  - S0 checks only the header cells and the set of line ids.
- **Why it matters:**
  - Whole-row line updates rewrite `outstanding_quantity` and `line_status`.
  - Completing a delivery writes those too: classic GOODS_DELIVERY `update_node_wEJC3qKB`, and GD
    Edit / GD Completed V2.
  - None of the GD submits checks `is_processing` or SAVE_SO jobs (section 5).
- **Failure (simulated):** another GD of the SO completes mid-commit, and COMMIT writes outstanding 8
  on a line that is now delivered 5.
- **Fix:**
  - check every line op's `before` in S0, with one SQL read (fail cleanly before S1);
  - compare again in S2 (review on a mismatch);
  - build the guards.

**M9. Two workers can run the same stage.**
- **Where:**
  - WORKER `code_node_SWpick`: `const dead = !!s(f.lease_owner) || num(f.claim_taken) > 0;` treats an
    in-flight claim as dead at once.
  - `update_node_SWrelease` clears `lease_owner` without checking the owner.
  - `SO_WORK_LEASE_S = 300`, where the brief says 10 minutes.
  - PREPARE and COMMIT job updates don't re-check `row_version`.
- **Failures:**
  - A double click or two tabs: both runs do PREPARE / COMMIT.
  - A stage longer than 300 s on dev: a second worker claims it, then the first run's release clears
    the second's lease.
  - Inserts carry no before-image, so duplicate lines are possible.
- **Fix:**
  - copy the GD kit's rule (a claim row counts as live for 10 minutes, and the job is skipped);
  - use an owner-checked release;
  - use a lease of at least 10 minutes.

**M10. A duplicate typed number strands a new SO.**
- **Where:** COMMIT S0N writes the typed `so_no` against the UNIQUE key `(so_no, organization_id)`.
  SUBMIT and PREPARE never check it.
- **Failure:**
  1. The write crashes, then there are 5 retries on 5-minute leases, then REQUIRES_REVIEW.
  2. The SO stays `SOV2-…` and locked.
  3. Classic fails at once, with an error the user can act on.
- **Fix:** check uniqueness in SUBMIT (answer 400), and re-check in S0.
- *Medium-high confidence.*

**M11. A retry can post twice.** COMMIT S5 writes each DONE row after its call.
- **Failures:**
  - A crash between the call and its DONE row: the retry posts to accounting again, or re-applies the
    reorder deltas.
  - An S5 failure retries 5 times, then goes REQUIRES_REVIEW. That blocks later edits of an SO that is
    already saved.
- **Fix:**
  - claim the step before the call (unique insert);
  - check whether the post already happened before posting again;
  - don't lock the SO for an after-save failure.
- *Rated minor in the review; raised here because a double accounting post is costly.*

### Major: size and time at 2,000 lines

**M12. NOT_ELIGIBLE falls back to classic at any size.**
- **Where:** SUBMIT `soSubmitGuard` answers `answer("NOT_ELIGIBLE", "300", "SOV2_AUTO_SI" ...)` before
  the BUSY facts, and the form then calls `submitClassic(data)`.
  - SO_SAVE v170 has no line guard.
  - The only v171 is an unchanged designer draft (10-21 14:40).
- **Failures:**
  - A 2,000-line SO with auto SI, approval, a Picking Plan, or new lines on an SO with deliveries runs
    classic SO_SAVE at full size. That is the 10-16 crash.
  - An auto-SI save of an SO that a V2 job holds runs classic SO_SAVE, which ignores `is_processing`.
- **Fix:**
  - answer 400 above 500 lines when NOT_ELIGIBLE, or add the brief's 500-line guard to classic SO_SAVE;
  - test auto SI after the BUSY facts.

**M13. The ALLOC step is quadratic.**
- **Where:** PREPARE `code_node_SAalloc`:
  `results = list(run_cdCollect({ get_cd_alloc: soCacheText(results), ... }).results);`.
- Each request stringifies and re-parses the whole result so far.
- **Measured under Node:**

  | Requests | Time |
  |---|---|
  | 500 | 1.0 s |
  | 1,000 | 3.9 s |
  | 2,000 | 15.8 s |

  The platform measured about 7× slower, so about 2 minutes on dev at 2,000.
- **Fix:**
  - call cdCollect with `"[]"` for each request and concatenate the results (11 ms at 2,000);
  - optionally, index the allocation rows by material.

**M14. SUBMIT carries the whole request in every node.** Every later code node takes
`[{{node:code_node_SSguard.data}}][0]`, which includes `partRows`.
- **Size:** one line is 1,840 bytes, and six nodes each record the request again. That projects to
  30–35 MB in one synchronous call at 2,000 lines.
- **Fix:** put `partRows` in its own node, read only by `add_node_SSparts`, and pass the other nodes
  only scalars.
- *Medium: projection.*

**M15. SO_SAVE_RUN chains stages on elapsed time only.**
- **Where:** `num(now) - num(start.t0) < SO_RUN_BUDGET_MS` (8 s), with up to 6 worker runs. v9 adds up
  to 4 more stages per run, so one request can hold up to 30 stages.
- **Failures:**
  - A HOLD submit followed by a GD prepare can land in one request, and brief §3.4 says never nest GD
    prepares. That is more likely on prod, which is faster.
  - A stage that has started is not bounded, so the request can pass 55 s.
- **Fix:** stop the chain after any HOLD or GD call, and for large jobs; budget by `line_count`.
- *Medium confidence.*

### Major: prod only (dev testing can't catch these)

**M16. The new-Draft lookup reads the wrong clock on prod.**
- **Where:**
  1. COMMIT `sql_node_SCjob` takes `db_now` from `NOW(3)`.
  2. `draftSince` is built from it.
  3. `sql_node_SCfind2` matches `s.create_time >= draftSince`.
- **Why:** dev's MySQL clock is MYT and prod's is UTC (checked today: dev `NOW()` 14:49, prod 06:49),
  while the platform stores `create_time` in MYT.
  - On prod the window opens 8 hours early.
  - `already` ignores `lock_ref`, so another stuck Draft of the same user can be adopted, and the job
    goes to review.
- Due times and leases are fine: they are written and read on the same `NOW(3)` clock. SUBMIT's
  COMPLETED window already uses `CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')`.
- **Fix:** take `db_now` from `CONVERT_TZ(UTC_TIMESTAMP(3), '+00:00', '+08:00')` in all four
  workflows, in one publish, so leases stay on one clock. Or mark the inserted row with the job.

### Minor

- **m1. New SOs are never deduplicated.** A new SO's idempotency key is the run nonce
  (`"SOA-" + guard.nonce`), so the unique index never deduplicates. Two near-simultaneous submits can
  create two SOs.
- **m2. The cancel path runs too early.** The `cancel_requested` end path in `soWorkPick` runs before
  the lease check. It is dead today, since nothing sets the flag.
- **m3. Two tabs can strand a job.** CONFIRM from two tabs (PROCEED and CANCEL) can leave the job
  QUEUED with `is_processing = 0`. PREPARE then answers 409 forever.
- **m4. No backoff.** The worker ignores stage answers, so a stage that makes no progress reruns at
  once, with no attempt count or backoff.
- **m5. A lock mismatch never ends the job.** PREPARE `code_node_SPgate` answers
  `route: "STOP" ... reason: "lock"`, so the job loops at PREPARING and SUBMIT answers BUSY for that
  SO for good (for example after support resets `is_processing`). End it FAILED or REQUIRES_REVIEW,
  without unlocking.
- **m6. Statuses come from the client's copy** (inherited from classic): `line_status` and the header
  `so_status`. GOODS_DELIVERY writes both, so a stale tab reverts Completed / Processing. V2's
  owned-column lists could close this cheaply.
- **m7. Parts are never retired** from `gd_publish_step`: about 7.4 MB kept per 2,000-line new SO.
- **m8. Phase C echoes the whole SO** (`code_node_SCc` `soData`): 3.35 MB of 8.30 MB at 2,004 lines.
  Downstream only needs id, `so_no`, `so_status` and `posted_status`.
- **m9. Inserted lines are never read back.** A new SO's lines aren't checked afterwards, not even by
  count.
- **m10. Running out of retries leaves the SO locked.** When retries run out at READY_TO_COMMIT, the
  WORKER ends REQUIRES_REVIEW without unlocking or cancelling holds. The brief says FAILED before
  COMMITTING_SO.
- **m11. A harmless forward reference.** `code_node_SCrejres` reads `code_node_SCgate`, which hasn't
  run yet. `soCommitResult` falls back, and only malformed input reaches that path. Pass `{}`.
- **m12. Undeclared return keys.** About 290 code-node return keys across the five workflows aren't
  declared in `response_json`. None is read downstream (checked), so they are harmless, but trimming
  them shrinks the run records.

**SQL injection (checked):** the platform pastes SQL placeholders in as raw text. Every value of
yours that reaches SQL is checked first:
- ids are digits only;
- the nonce is alphanumeric (`/^[0-9A-Za-z]{1,24}$/`);
- `gRef` is checked by regex.

Keep that rule for every new placeholder.

## 4. What dev shows (14:51)

**SAVE_SO jobs: 29.**

| Result | Jobs | Notes |
|---|---|---|
| Completed | 22 | |
| Failed | 6 | 4 × `SOV2_STALE` at 12:05–12:06, Clone; fixed by PREPARE v7 |
| | | 2 × `SOV2_NOT_ELIGIBLE`, classic fallback, by design |
| Requires review | 1 | `SOV2_NUMBER` ("the document number did not read back", 10:19), still open |

**One 2,000-line run so far:** a new SO of 2,004 lines (14:32, job 2113156489359720449,
SO/20261022/088) completed in 23 s.

| Phase | Size | Time |
|---|---|---|
| PREPARE | 9.0 MB, 11 parts | 1.3 s |
| COMMIT phase A | 9.15 MB | 15.5 s |
| COMMIT phase C | 8.30 MB | 4.3 s |

**Other runs:**
- the WORKER crashed inside COMMIT once (10-21 16:52, "arraycopy: last destination index…");
- one SUBMIT run has been InExecute since 10-21 14:43.

**Not run on dev yet:**
- an edit of more than a few lines;
- a cascade at size, or with several GDs;
- a multi-part edit (only `S2|001` ever ran);
- line deletes and bundle children;
- the quotation step;
- more than one hold;
- a live 413 / 414 / 406;
- two tabs or a double click;
- a crash in the middle of a step.

## 5. In the brief, not built yet

- **§4 guards in other workflows:** no other writer reads `sales_order.is_processing` or SAVE_SO jobs.
  That includes GD_COMPLETE_SUBMIT v9, GD_CANCEL_SUBMIT v3, GD_EDIT_SUBMIT v11, Force Complete and
  classic GOODS_DELIVERY. Most of these belong to other owners, so ask them.
- **Classic SO_SAVE's 500-line guard** (see M12).
- **The SO form and list:**
  - the form opening read-only and following its job;
  - the list's "Saving" state and worker kick (see B1).
- **GD Edit V2:** the `SOV2|` hold length, the orphan rule, and `so_job` handling of SAVE_SO (brief §12;
  the GD Edit V2 owner's workflows).
- **Pass B:** new item lines on an SO with deliveries answer NOT_ELIGIBLE, so classic saves them.
- **The mobile contract.**
- **Column-pruned reads and fork-join:**
  - PREPARE reads whole documents, one after another;
  - every non-cancelled GD is read whole in each of the three cascade steps.

## 6. Keep

- **Faithful lifting.** The classic checks keep the same codes, order and texts, and the credit-limit
  parameters are identical. The hand re-implementation of classic's branching matches the live
  if-conditions, and the GLOBAL_ALLOCATION emulation even trips v34's own row-limit guards exactly as
  classic does.
- **Sound locks and claims.**
  - The lock and claim gates sit on real unique indexes.
  - Step markers are unique claims on (tenant, job, step).
  - PREPARE fences on `row_version` and on owning the latest lock.
  - FAILED (unlock, then cancel holds) is cleanly separated from REVIEW (stays locked).
- **A good plan design.**
  - The plan is cell-level, and its owned and number columns match brief §6.1.
  - S0N adopts a number already issued when it resumes.
  - Inserts are idempotent by `line_index`.
  - One shared library is used across the code nodes, and every copy agrees (hash-checked).

## 7. Suggested order of work

1. Decide the switch for tonight (section 1).
2. Fix B1 (a driver for jobs: worker poll, list kick, follow on open, expiry) and B2 (the typed number).
3. Fix M8 (the before-image check in COMMIT S0) and get the guards in other workflows, coordinating
   with the GD owners.
4. Fix the holds: M3–M7 and the GD Edit V2 changes (with its owner).
5. Fix concurrency: M1, M9, M10, M11 and m1–m5.
6. Fix size and time: M2, M12–M15 and m7–m8.
7. Fix the prod clock: M16.
8. Run the missing tests in section 4. A 2,000-line edit with a cascade is the case V2 exists for.

---
**About this review:** done by our team on 2026-10-22, with three independent code reviews (SUBMIT +
RUN + WORKER, PREPARE, COMMIT) plus checks against dev data. The extracted code and the reviewers'
working notes are in the BladeXfunctions repo under `scratchpad/sosv2_review/`:
`notes_submit_worker.md`, `notes_prepare.md`, `notes_commit.md`.
