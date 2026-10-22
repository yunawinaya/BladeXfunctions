# SO_SAVE_PREPARE v7 review: working notes (2026-10-22)

Review copy `live/SO_SAVE_PREPARE.v7.json` == enabled dev v7 (sha256 of canonical JSON, checked).

## Structure
- Code nodes = common.js + lifted classic nodes (per node) + rules.js + prepare.js (+ cascade.js + ga34.js) + "this node" tail.
- Steps by job prepared_payload.stage: "" -> SO (plan), CASCADE (B1 SBdiff/SBplan), ALLOC (B2 SAalloc), PAYLOAD (B3 SGpay).
- WORKER claims (lease 300 s), calls PREPARE nested (job_id + newRv), then releases the lease whatever PREPARE answered.
- SUBMIT stores the FULL allData (R|000 header + top-level lines, 250 per part), not a delta.

## Verified good
- Lifted code byte-identical to deployed (placeholders rewritten to V["..."]):
  SO_SAVE v170: X4j8BSXd, hVnUCBf3, rPqQy5CD, CascadeGate, BtxYhPym, CfNeed1, CfFill1, CfOut1, JYYVm92x.
  SO_CASCADE v27: cd_diff, cd_plan (x3 copies), cd_allocreq (x3), cd_alloc_collect, cd_names_ids (x2), cd_payloads.
  GLOBAL_ALLOCATION v34: ItemNorm, hDa6pSw5.
- soPrepareNext reproduces classic's if-conditions (if_BA0MN7OZ, if_nvqMTmNn page_status Edit, if_yJor3Xzv).
- V2 reads == classic reads (search_cd_gds/pps filters, CdItems SQL, setup, bins/uoms/batches; GA ItemAlloc set-based).
- GA emulation: filters == v34 searches; slicing to 500/1000 trips v34's own `>=` limit guards exactly as classic does
  (platform does not apply limits). Dev has 2 material/plant pairs > 500 batch rows (tenant 000000, max 2018) and one
  with 1755 '' HU rows (496474): both fail the same way in classic and V2.
- SO_HEADER_OWNED / SO_LINE_OWNED cover handoff 6.1 exactly.
- Pass-B gate (new item lines on linked SO -> NOT_ELIGIBLE) == classic code_node_CascadeB_Gate's trigger.
- Reorder 5-field projection + dropping unchanged lines both sides: correct, REORDER_SET_REDIS code_node_1sd1QGLR is a
  linear per-key delta (latest - previous) in both its branches.
- B2/B3 staleness check (requests re-derived and compared): request order follows diff order -> deterministic.
- SQL: every placeholder digits / regex guarded; tenant-scoped; no correlated JSON_TABLE in EXISTS; ["0"] sentinels.
- Linter: only CONDITIONAL refs (get_node_SPso, sql_node_SPdocs for new SO) - handled.
- Measured: 2,004-line NEW SO, SO step 9.02 MB node data, 1.3 s, 11 parts (L 410 KB each, A 334 KB); job COMPLETED
  in ~27 s. Recorded edit plans are tight (1 U op, real cells only; header diffs from '.000' datetime fractions and
  null vs [] are harmless format-only).

## Findings
1. MAJOR progress_message overflow. gd_async_job.progress_message varchar(255); dev sql_mode STRICT_TRANS_TABLES
   (prod NO_ENGINE_SUBSTITUTION; gd_async_job not on prod yet). SBplan.js:1163 `progress_message: q.message` (414
   text: ~152 fixed chars + one "label: a -> b" per raised line -> 2 raised lines with normal descriptions > 255);
   SBplan.js:1110 `"Not saved: " + message` (406 alloc message = one "label on GD: reason" per failed line).
   GD Edit V2 caps every progress_message with .slice(0, 250) (scratchpad/gde/code/prepare/ready.js:22,31,38;
   commit/_common.js:89). Max stored length on dev = 250 (6 rows, all capped writers).
   Failure (dev): update_node_SBjob/SAjob/SGjob fails -> PREPARE crashes -> WORKER run dies, lease not released ->
   retried after 300 s, 5 times -> FAILED SOV2_RETRIES; the 414 question / 406 reason never reaches the user; SO
   BUSY ~20-25 min.
2. MAJOR ALLOC loop quadratic. SAalloc.js:2201 re-stringifies and re-parses all accumulated results per request
   (soCacheText + __V __json + JSON.parse in cdCollect + __json on return). Benchmark of the real lifted code in Node:
   N=500 1.0 s, 1000 3.9 s, 2000 15.8 s; linear alternative 11 ms. soGlobalAllocation scans: 3.4 s at 2000 requests x
   8000 rows. Platform/V8 ratio from the recorded 14:32 SPplan (608 ms vs 88 ms local, identical output) ~7x ->
   ~2 min for the node on dev. Every code node declares timeout 30000 (enforcement unverified; no dev code node seen
   > 2 s in sampled long runs).
3. MAJOR contract (COMMIT). PREPARE stores per-line before-images (SPplan.js:713-715) but COMMIT phase B never reads
   o.before (SCb.js:409-412 writes soCommitFull(was, o.set, ...)); S0 checks only H.before + line-id set
   (SCa.js:233, 238). GOODS_DELIVERY update_node_wEJC3qKB writes SO line delivered/planned/outstanding_quantity/
   line_status; outstanding_quantity is in the plan (computed from delivered at PREPARE time).
4. MINOR gate lock mismatch STOPs (SPgate.js:152) without ending the job; WORKER releases lease, claim_taken /
   lease_owner don't count it as dead -> job PREPARING forever; SUBMIT: open job -> BUSY for that SO forever.
5. MINOR job updates are unconditional (no row_version in props; update WHERE not enforced). A PREPARE outliving the
   300 s lease can overwrite a newer stage / prepared_payload (holds). Unlikely at measured speeds unless (2) stays.
6. MINOR inherited: line_status and header so_status taken from the client copy (GOODS_DELIVERY update_node_AFswLv4E
   writes so_status, update_node_wEJC3qKB writes line_status) -> stale tab reverts Completed/Processing. Same as
   classic; dev has no stale combos today.
7. MINOR parts never retired (no update/delete on gd_publish_step in PREPARE/WORKER/COMMIT); ~7.4 MB per 2,000-line
   new SO (SOR 3.3 + SOP 4.1) kept forever, more for cascades and re-runs.

## Deviations (neutral)
- Full allData on edit (no delta). Whole-document get/search reads (SO get-node; GDs whole, incl. Completed, read in
  B1, B2 and B3) instead of column-pruned SQL. Pass B -> NOT_ELIGIBLE decided in PREPARE after lock. GD Edit V2
  eligibility left to the WORKER's GD_EDIT_SUBMIT answer. G parts = whole GD form, no 500-line cap
  (classic code_cd_gde_size). 414 via AWAITING_CONFIRMATION (recommended option); 413 raised by WORKER hold step.
  Sequential reads (no condition-all fork-join).

## Not verified
- Cascade steps at 2,000 lines (only <= 0.35 MB runs on dev); multi-GD SOs (test data: 1 GD per SO).
- Whether the platform validates varchar length itself (would also fail on prod) or enforces code-node timeout.
- billing_state_Id (schema, capital I) vs classic's billing_state_id key: 97 of 506 lines set, inconclusive.
