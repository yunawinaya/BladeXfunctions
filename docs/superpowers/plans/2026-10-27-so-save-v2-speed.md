# SO Save V2 speed (above 100 lines) + credit check v17 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SO Save V2 cheaper for the saves it still handles (> 100 lines), make its other workflows publishable, and
fix two problems in CREDIT_LIMIT_CHECK.

**Architecture:** One Python builder (`scratchpad/sosave_perf/build.py`, already holding SUBMIT + CREDIT_LIMIT_CHECK)
patches the live JSON of every workflow from exact anchors (`must_replace`), writes `out/`, and is published to dev with
`.dbtools/wf_upload.mjs` (backups, `base` guard, smoke). Script trimming is a Node tool on acorn. Parity is proven by
replaying recorded executions: each code node's run record holds its fully substituted code and its output.

**Tech Stack:** Python 3 (builder, node diff), Node 22 + acorn 8 (shaker, unit + replay tests), MySQL 8.4 (EXPLAIN,
read-only SQL parity via `.dbtools/db`), the platform's doTest (dry-run) and run endpoints.

**Spec:** the user's list (2026-10-27): "V2 above 100 lines: folding the COMMIT phases, removing the two full-table
scans, not rewriting unchanged lines, and smaller scripts. WORKER, PREPARE and COMMIT: the same empty NO branches ...
need the same reshape. CREDIT_LIMIT_CHECK total: declared as an int, so 12.8 is checked as 12." Plus the security
review of CREDIT_LIMIT_CHECK (no tenant scope). Measurements behind each item: memory note
`project_so_save_v2_handoff.md` (10-27 section) and `Sales Order/AsyncV2/SO_SAVE_V2_REVIEW_2026-10-22.md`.

## Global Constraints

- Build on the LIVE versions only: dev SUBMIT "v5", WORKER v10, PREPARE v9, COMMIT v10, RUN v4, CREDIT_LIMIT_CHECK v16
  (prod: SUBMIT v7, CREDIT_LIMIT_CHECK new v15 = the same content). Re-check with `.dbtools/wf --dev deployed` before
  every publish.
- Every dev publish, dev write and live-test batch needs the user's explicit yes (AskUserQuestion options). Prod is a
  paste by the user from a `prod-hotfix/2026-10-27-*/` folder, handed over only after the dev live test passed end to end.
- No commits: the user handles git.
- Prod data (recorded runs, customer ids) stays in the session scratchpad; the repo gets synthetic fixtures only.
- SQL placeholders are raw text: every value that reaches SQL is validated in a code node first (digits only).
- Code-node outputs: every returned key declared in `response_json` (objects as `"any"`).
- No `??` in code nodes (the platform's JS engine is not confirmed to support it).

## Review Focus

- A real date change must still be written: `so_shipping_date` 10-20 -> 10-21 (with or without `.000`) is a change.
- A new SO resumed after a crash between its insert intent (S1I) and S1 must still find its own Draft: the rewritten
  SCfind / SCfind2 return the same rows as today for an Add.
- A helper reached only on a path prod has never run (413 / 414 confirmations, holds, cascade cancel) must survive the
  trim: the static free-identifier check, not only replay, guards it.
- A cross-tenant credit check answers "Customer Not Found" after Task 1; prod had 0 such calls in 12,593 (10-13..10-27).
- A `total` that arrives as text ("12.8", "1,234.50") must be read the way callers mean it.

---

### Task 1: CREDIT_LIMIT_CHECK v17 — decimal total, tenant scope

**Files:**
- Modify: `scratchpad/sosave_perf/build.py` (CREDIT_LIMIT_CHECK section)
- Modify: `scratchpad/sosave_perf/test/test_cl.js`
- Modify: `scratchpad/sosave_perf/test/ab_cl.mjs` (base = live v16 run, so differences are by design only)

**Interfaces:**
- Produces: `code_node_CLguard` outputs `customerIdSql` (digits or "0"), `tenantIdSql` (digits or "0");
  `sql_node_CLcust` adds `AND c.tenant_id = '{{node:code_node_CLguard.data.tenantIdSql}}'`; request_json `total`
  `bsonType: "decimal"`.

- [ ] **Step 1:** Check prod's recorded `total` formats (session scratchpad, read-only): count text values with a comma
  or non-numeric characters. If any exist, stop and report before changing the type.
- [ ] **Step 2: Failing tests** in `test_cl.js`: `guard tenant "012345" -> "012345"`, `guard tenant "07' OR '1" -> "0"`,
  `SQL is scoped to the session tenant` (`/c\.tenant_id = '\{\{node:code_node_CLguard\.data\.tenantIdSql\}\}'/`),
  `request total is decimal` (`request_json.find(f => f.name === "total").bsonType === "decimal"`).
- [ ] **Step 3:** Run `node scratchpad/sosave_perf/test/test_cl.js` — expect those 4 to FAIL.
- [ ] **Step 4:** Implement in `build.py`: guard reads `[{{system:tenantId}}][0]`, digits-only; SQL tenant clause;
  `total` -> `"decimal"`. Rebuild: `python3 scratchpad/sosave_perf/build.py`.
- [ ] **Step 5:** Run `test_cl.js` and `test/node_diff.py` — all pass (node_diff now also expects the request_json change).
- [ ] **Step 6 (dev, read-only runs, with the batch yes):** A/B v16 vs build on the 51 cases plus `total: 12.8` cases.
  Expected: identical except (a) the cross-tenant probe -> "Customer Not Found", (b) `current_credit_amount` carries .8.

### Task 2: Make WORKER / PREPARE / COMMIT publishable

**Files:**
- Modify: `scratchpad/sosave_perf/build.py` (add the three workflows; reuse `default_items()`)
- Create: `scratchpad/sosave_perf/base/SO_SAVE_WORKER.v10.json`, `SO_SAVE_PREPARE.v9.json`, `SO_SAVE_COMMIT.v10.json`
  (exact live dev `script_json`)
- Modify: `scratchpad/sosave_perf/test/node_diff.py`

**Interfaces:**
- Produces: `out/SO_SAVE_WORKER.json`, `out/SO_SAVE_PREPARE.json`, `out/SO_SAVE_COMMIT.json`; `default_items()` must find
  exactly 6 / 9 / 43 items (SUBMIT 7 stays).

- [ ] **Step 1:** Failing node_diff expectations: each of the three changes exactly its `cori_N*` default items.
- [ ] **Step 2:** Implement; rebuild; node_diff passes; `scratchpad/validate.py` findings identical to each base.
- [ ] **Step 3 (dev, with the batch yes):** doTest dry-run of each built JSON with a request that answers early
  (WORKER `{job_id: "0"}` -> REJECT; PREPARE / COMMIT `{job_id: "0", row_version: 0}`) — expect a run, not
  `请配置条件节点条件!`.

### Task 3: Stop rewriting unchanged lines (datetime cells)

**Files:**
- Modify: `scratchpad/sosave_perf/build.py` (patch `soCanonText` in every PREPARE / COMMIT code node that has it: 16 + 12)
- Create: `scratchpad/sosave_perf/test/test_canon.js`
- Create: `scratchpad/sosave_perf/test/replay.mjs` (shared by Tasks 3 and 5)

**Interfaces:**
- Produces: `soCanonText(v)` maps `YYYY-MM-DD`, `YYYY-MM-DD HH:MM:SS`, `YYYY-MM-DD[ T]HH:MM:SS.0+` to
  `YYYY-MM-DD HH:MM:SS`; everything else unchanged.
- Produces: `replay.mjs <workflow> <base.json> <out.json> <runs.json>` — for each recorded code-node execution in
  `runs.json` (rows of `su_code_workflow_inst.nodes_data`), runs the recorded substituted code and the same code with
  the build's transformation for that node, and prints per node: runs, identical, differing (with the first diff).

- [ ] **Step 1: Failing tests** in `test_canon.js` (code taken from `out/SO_SAVE_PREPARE.json`'s `code_node_SPplan`):
  `same('2026-10-20 00:00:00', '2026-10-20 00:00:00.000') === true`, `same('2026-10-20', '2026-10-20 00:00:00') === true`,
  `same('2026-10-20 00:00:00', '2026-10-21 00:00:00.000') === false`, `same('2026-10-20 00:00:00.500', '2026-10-20 00:00:00') === false`,
  `same('ABC', 'abc') === false`, `same('[1,2]', [1,2]) === true` (unchanged JSON rule).
- [ ] **Step 2:** Run — expect the first two FAIL.
- [ ] **Step 3:** Patch the rules block (one `must_replace` per copy; all copies identical after the patch). Rebuild.
- [ ] **Step 4:** `test_canon.js` passes. Replay prod PREPARE runs since 10-23 (`code_node_SPplan`): every differing run
  differs only by dropped ops / cells whose before/after are the same datetime. Report line updates before -> after.
- [ ] **Step 5:** Replay COMMIT runs: outputs identical, or differences limited to datetime-equal comparisons.

### Task 4: Remove the two full-table scans (COMMIT phase A)

**Files:**
- Modify: `scratchpad/sosave_perf/build.py` (`sql_node_SCfind`, `sql_node_SCfind2` script.code)
- Create: `scratchpad/sosave_perf/test/sql_parity.py`

**Interfaces:**
- Consumes: `code_node_SCgate.data.isEdit`, `.tempNo`, `.organizationId`, `.draftSince`, `code_node_SCguard.data.tenantId`
  (SCfind2: `code_node_SCa.data.draftSince`).
- Produces: the same select list (`id`, `so_no`, `kind`, `lock_ref`) as a `UNION` of (1) `so_no = tempNo` and the
  organization (unique key `Document Number`), (2) the Draft-adoption branch bounded by
  `s.id >= GREATEST(0, UNIX_TIMESTAMP('<draftSince>') * 1000 - 1288834974657 - 172800000) * 4194304`; both branches carry
  `'<isEdit>' = 'NO'`, branch 2 also `'<draftSince>' < '9999'`.

- [ ] **Step 1:** `sql_parity.py` runs old and new SELECT read-only with real parameters from recorded COMMIT runs (dev +
  prod; edit and add) and asserts equal row sets; runs EXPLAIN for each. Expect it to fail before the build changes.
  Add one dev parameter set that reaches the Draft branch: `draftSince` just before an existing Draft SO of a known
  `create_user` with `is_processing = 1` (if dev has none, say the branch is covered by EXPLAIN and empty-set parity only).
- [ ] **Step 2:** Implement; rebuild. Parity passes; EXPLAIN: edits read no rows ("Impossible WHERE"), adds use
  `Document Number` + PRIMARY range. Time both on prod (expect ~180 ms -> < 5 ms).

### Task 5: Smaller scripts (trim the shared library per code node)

**Files:**
- Create: `scratchpad/sosave_perf/package.json` (acorn ^8), `scratchpad/sosave_perf/shake.mjs`
- Create: `scratchpad/sosave_perf/test/test_shake.mjs`
- Modify: `scratchpad/sosave_perf/build.py` (runs `node shake.mjs` over every code node of the five workflows last)

**Interfaces:**
- Produces: `shake(code) -> code` — placeholders `{{...}}` swapped for identifiers before parsing and restored after;
  keeps every top-level statement that is not a declaration, and the declarations reachable from the
  `// ---- this node` tail (transitively, by identifier); original order and text.

- [ ] **Step 1: Failing tests** in `test_shake.mjs`: keeps a helper used only inside another kept helper; keeps a name
  used only in `typeof X`; drops an unused helper; keeps placeholders byte-exact; output parses.
- [ ] **Step 2:** Implement `shake.mjs`; tests pass.
- [ ] **Step 3:** Static check on every shaken node: no free identifier outside a fixed global list
  (JSON, Math, Object, Array, String, Number, Boolean, Date, RegExp, Error, Set, Map, Promise, console, parseFloat,
  parseInt, isNaN, isFinite, encodeURIComponent, decodeURIComponent, undefined, NaN, Infinity).
- [ ] **Step 4:** Replay every recorded execution of every code node (prod + dev): identical outputs.
- [ ] **Step 5:** Size report per workflow (expected several-fold smaller); doTest dry-run of each still runs.

### Task 6 (decision gate): Fold COMMIT phases

Today each phase (A header + number, B one line part, C after-steps) is its own COMMIT run; folding A -> B -> C into one
run for a single-part edit saves about 2 run overheads (~0.4-0.7 s each after Task 5). It needs a re-gate between phases
inside COMMIT (the gate's step map is read before phase A) and rewires 175 nodes without the original builder.
- [ ] **Step 1:** After Task 7's measurements, give the user the measured per-run overhead and a fold estimate; build
  only on their yes, as its own task with an offline flow simulation and a live crash-resume test per phase.

### Task 7: Publish to dev, live tests at real size, prod paste

**Files:**
- Create: `prod-hotfix/2026-10-27-so-save-v2-speed/` (paste files, prod bases, README with name + id per workflow)
- Modify: `Sales Order/AsyncV2/` repo copies of the five workflows; `GlobalCreditLimitCheckWorkflow.json`

- [ ] **Step 1:** `wf_upload --dry-run` with `base` per item (compile-published workflows need `designingHistoryId`).
- [ ] **Step 2 (yes):** publish; smokes: CREDIT_LIMIT_CHECK (result), SUBMIT small save (NOT_ELIGIBLE).
- [ ] **Step 3 (yes, writes test SOs on dev):** a 150-line edit changing 1 line (expect 1 line op), a 2,000-line edit
  changing 1 line in tenant 496474 (expect 1 op), a new 150-line SO, a Draft -> Issued of a 150-line SO. Record each
  job's stage timings against today's (same sizes).
- [ ] **Step 4:** Repo copies refreshed (`wf --dev deployed` IDENTICAL); prod folder built from the prod enabled
  versions (re-check identical to the bases); hand over only after Steps 2-3 passed.
