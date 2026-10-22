# SO Save V2 review: SUBMIT / RUN / WORKER + clients (2026-10-22)

Scope: SO_SAVE_SUBMIT v6, SO_SAVE_RUN v3, SO_SAVE_WORKER v8 (live is now **v9**, enabled 2026-10-22 14:25:51:
adds `code_node_SWnext1..4` = up to 4 more PREPARE/COMMIT stages per run while `Date.now() - t0 < 6000`; nothing
else changed, so every v8 finding holds for v9). Review copies in `live/` match `su_code_workflow.script_json`
node for node. SO form = `su_code_tables_history` id 2113122916105245959 (v1247, enabled 2026-10-22 12:18:57),
scripts `draft` (es19), `Issued` (es20), `onClick_a2lq37fj` (es49); `SO_SAVE_V2_ENABLED = true`.
SO list page 1901872125787099137 v532: no V2 ids, no SAVE_SO, no is_processing.

## Dev facts used
- 28 SAVE_SO jobs on dev, max line_count 3: no 2,000-line V2 run exists.
- gd_publish_step unique `Job Step` (tenant_id, job_id, step_name); gd_async_job unique (tenant_id, organization_id, idempotency_key).
- Job 2112829373449973762: worker run 2112829382148960257 failed in wf_SWcommit ("arraycopy: last destination index")
  at 16:52:33; next worker call 17:00:16 (manual). Nothing drove it in between.
- GD edit job 2112838980390039554 (cascade_ref SOV2|2112838958218948609): queued 10-21 17:30:41, finished 10-22 09:47:27.
- SUBMIT run 2113118662899073026 (3 lines): guard response 33 KB; SSentry / SScredit / SSdecide / SSpost / SSdue /
  SSdoneres requests 60-74 KB each, all containing `partRows`; line = 1,840 bytes in the stored part.
- Clone saved as Draft failed SOV2_STALE 4/4 at 12:05; PREPARE/COMMIT v7 re-enabled 12:18:56 with
  `const id = edit ? s(l.id) : ""` (Clone ids ignored). Clone Issued since then: 8/8 COMPLETED. Not a finding.
- Live GD_EDIT_PREPARE v8: `hold = addSeconds(e.dbNow, fcHold ? 1800 : 900)`; no "SOV2" anywhere in
  GD_EDIT_SUBMIT v11 / GD_EDIT_WORKER v7.
- None of SO_SAVE v170, GOODS_DELIVERY, PICKING_PLAN, SO_CANCEL, SO_AUTO_GD, GD_ASYNC_SUBMIT, GD_COMPLETE/EDIT/
  CANCEL/REVERT_SUBMIT, GD_SO_CONVERT_CHECK, SQT_CASCADE, PO_SAVE reads sales_order.is_processing or SAVE_SO.
- SO_SAVE v170 has no line-count refusal.
- CHECK_APPROVAL v42 SO rule (code_node_im8qPr6e) reads only cl_result, min/max_price_result, so_no, sqt_id:
  header-only `approvalData` is equivalent to classic's full soData.
- Classic 404 (search_node_TmnClGAM / UmwyM0pM): so_id in [id] + Draft; V2 SQL equivalent.
- Lifted code_cd_plan never raises 413 ("A pick REVERSAL is deliberately NOT detected here ... GD returns its 413");
  413 only comes from GD_EDIT_SUBMIT's gate during HOLD -> AWAITING_CONFIRMATION (handled by the form).
- GD_EDIT_WORKER poll: only due + unleased jobs (`next_attempt_at <= NOW(3)`, `lease_expires_at <= NOW(3)`),
  so a HELD (not expired) job gives an IDLE plan and `job_status: ""`.
- GD kit claim liveness: `(cw.id IS NOT NULL AND cw.started_at > n.t - INTERVAL 10 MINUTE) AS claim_live` -> skip.
  GD after_prepare writes only when `s(job.lease_owner) === guard.leaseOwner`; counted retry + backoff otherwise.

## Findings (ranked)
B1 no driver after the form stops following (worker needs job_id; no list kick; mounted ignores is_processing;
   AWAITING_CONFIRMATION never expires). Stuck SO, holds expire, half-committed SO vs GD.
M1 SUBMIT LOST orphan: QUEUED job never cancelled -> SO BUSY forever; RACE winner cancels itself + unlocks.
M2 holds not cancelled: CONFIRM CANCEL after HOLD-stage 413; `pending` excluded; terminal row written before cancel
   loop; CANCEL_HELD BUSY not retried; no SOV2 orphan rule in GD Edit V2.
M3 HOLD stage trusts GD_EDIT_WORKER's answer (blank for an already-HELD job) -> spins until the 900 s hold expires.
M4 claim gate bypass (claim row treated dead at once), unconditional lease release, 300 s lease.
M5 SUBMIT records the payload ~9x (~30-35 MB at 2,000 lines projected).
M6 RUN (6 runs / 8 s) x v9 chain (5 stages / 6 s): time-start budgets only; nests GD submit + GD prepare.
M7 NOT_ELIGIBLE -> classic at any size (no 500 guard in SO_SAVE); auto-SI NOT_ELIGIBLE answered before BUSY.
m1 Add idempotency key = run nonce; m2 cancel_requested path unclaimed (dead today); m3 CONFIRM two-tab race;
m4 stage answers ignored, no-progress stages loop without attempts/backoff.
