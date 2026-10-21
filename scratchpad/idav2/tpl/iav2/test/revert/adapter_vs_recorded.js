// (b) Revert V2's PREPARE / SUBMIT functions on every recorded classic run, its reads rebuilt in Revert V2's own SQL row shapes
// (_rows.js), reproduce what the classic did:
//   - the adapter's prep (header shown as the job's prevStatus Completed) = the recorded code_node_iaRvPrep output, exactly;
//   - the plan's build = the recorded code_node_iaRvBuild output, exactly, except itemData (V2 reads the item columns the build
//     uses, not whole rows; itemData is the classic's pass-through to SUBTRACT / ADD and is not part of a V2 movement);
//   - ENGINE = the classic's own child calls (su_code_workflow_inst of SUBTRACT_INVENTORY / ADD_INVENTORY), call by call: the
//     same parameters minus index / itemData / batch_number, plus movement_key M<index + 1>, direction, parent_trx_no "" (a null
//     parameter the platform dropped = a null in the movement);
//   - COST = the rows the classic's update nodes wrote (fifoDeleteId / waDeleteId / waUpdateId + its values), BATCH = batchDeletes;
//   - SUBMIT's gate: the refused run -> STOP 400 IA_RV_REFUSED with the classic's text; the others -> NOT_ELIGIBLE "classic" at
//     min_picks 50, GO (with the live rows and IM1) without it.
// usage: node adapter_vs_recorded.js [fixture dir; default H.FIXTURES, outside the repo]
const H = require("./_harness");
const X = require("./_rows");
const dir = process.argv[2] || H.FIXTURES;
const FILES = ["code/revert/prepare/adapter.js", "code/revert/prepare/prep.js", "code/revert/prepare/plan.js", "code/revert/submit/_common.js", "code/revert/submit/gate.js"];
const NAMES = ["iarvRunPrep", "iarvPrepNode", "iarvPlanNode", "iarvGate", "iarvSqlRows", "iarvJRows", "iarvHeaderSeen", "iaMovesFingerprint"];
const noItemData = (b) => Object.assign({}, b, { subtracts: (b.subtracts || []).map((x) => Object.assign({}, x, { itemData: null })), adds: (b.adds || []).map((x) => Object.assign({}, x, { itemData: null })) });
const all = H.runs(dir);
if (!all.length) {
  console.log("NOTICE: no recorded run fixture: adapter vs recorded skipped");
  process.exit(0);
}
let built = 0;
let calls = 0;
for (const r of all) {
  const recPrep = X.resp(r, "code_node_iaRvPrep");
  const recBuild = X.resp(r, "code_node_iaRvBuild");
  if (!recPrep) {
    console.log("skip " + r.env + " " + r.id + " (" + r.exit + "): the classic stopped before prep");
    continue;
  }
  const docDate = recBuild && ((recBuild.subtracts || [])[0] || (recBuild.adds || [])[0]) ? Date.parse(((recBuild.subtracts || [])[0] || recBuild.adds[0]).doc_date) : undefined;
  const sb = H.load(FILES, docDate, NAMES);
  const S = X.rowsFor(r);
  const fp = sb.iaMovesFingerprint(H.intoBox(sb, S.moves));
  const tag = r.env + " " + r.id;
  // ---- SUBMIT gate on the stored IA (its recorded status)
  const guard = (minPicks) => ({ iaId: String(r.params.ia_id), formOrg: String(r.params.organization_id), minPicks: minPicks });
  const gEntry = { route: "GO", iaNo: String(r.params.ia_no), organizationId: String(r.params.organization_id), plantId: String(recPrep.plantId || ""),
    storedStatus: JSON.parse(S.storedHdr[0].j).item_assembly_status };
  const gs = { hdr: S.storedHdr, moves: S.moves, batch: S.batch, serial: [] };
  const g50 = H.fromBox(sb.iarvGate(H.intoBox(sb, guard(50)), H.intoBox(sb, gEntry), H.intoBox(sb, gs)));
  const g0 = H.fromBox(sb.iarvGate(H.intoBox(sb, guard(0)), H.intoBox(sb, gEntry), H.intoBox(sb, gs)));
  const live = (recPrep.liveOut || []).length + (recPrep.liveIn || []).length;
  if (Number(recPrep.refuse) === 1) {
    H.ok(g50.route === "STOP" && g50.code === "400" && g50.errorCode === "IA_RV_REFUSED" && g50.message === recPrep.refuseMessage, tag + ": SUBMIT gate refuses with the classic's text", g50);
  } else {
    H.ok(g50.route === "NOT_ELIGIBLE" && g50.reason === "classic" && g50.liveRows === live, tag + ": SUBMIT gate at min_picks 50 -> NOT_ELIGIBLE classic (" + live + " live rows)", g50);
    H.ok(g0.route === "GO" && g0.liveRows === live && g0.liveOut === (recPrep.liveOut || []).length && g0.movesFingerprint === fp && g0.prevStatus === "Completed",
      tag + ": SUBMIT gate without min_picks -> GO, the live rows and IM1", g0);
  }
  if (Number(recPrep.refuse) === 1) {
    // PREPARE sees the IA as Completed (the job's prevStatus): the stored posted status still refuses it there
    const e = X.entryFor(r, S, fp);
    const pr = H.fromBox(sb.iarvPrepNode(H.intoBox(sb, e), H.intoBox(sb, S), H.intoBox(sb, {})));
    H.ok(pr.route === "FAIL" && pr.code === "IA_RV_REFUSED" && pr.unlockOk === 1, tag + ": PREPARE on the refused IA -> FAILED IA_RV_REFUSED + unlock", pr);
    console.log("ok   " + tag + ": refused (" + recPrep.refuseMessage + ")");
    continue;
  }
  // ---- PREPARE prep: the adapter's lifted prep = the recorded one; the prep node GO with the round-2 ids
  const e = X.entryFor(r, S, fp);
  const hdrSeen = sb.iarvHeaderSeen(H.intoBox(sb, JSON.parse(S.hdr[0].j)), e.organizationId, "Completed");
  const run = H.fromBox(sb.iarvRunPrep(hdrSeen, sb.iarvSqlRows(H.intoBox(sb, S.moves)), sb.iarvJRows(H.intoBox(sb, S.batch)),
    H.intoBox(sb, { iaId: e.iaId, iaNo: String(r.params.ia_no), organizationId: e.organizationId })).prep);
  const d1 = H.diff(run, recPrep);
  H.ok(!d1, tag + ": the adapter's prep (status shown as Completed) = the recorded prep", d1);
  const pr = H.fromBox(sb.iarvPrepNode(H.intoBox(sb, e), H.intoBox(sb, S), H.intoBox(sb, {})));
  H.ok(pr.route === "GO" && pr.liveRows === live && pr.movesFingerprint === fp, tag + ": prep node GO", pr);
  const csv = (a) => ["0"].concat((a || []).filter((x) => x !== "-1")).join(",");
  H.ok(pr.assembledIdsCsv === csv(recPrep.assembledIds) && pr.itemIdsCsv === csv(recPrep.itemIds) && pr.batchIdsCsv === csv(recPrep.batchIds) && pr.plantIdSql === recPrep.plantIdSql
    && pr.iaIdSql === recPrep.iaIdSql && pr.orgSql === recPrep.orgSql, tag + ": round-2 ids = the classic's (assembled / items / batches / plant / ia / org)", pr);
  // ---- PREPARE plan: the build, the parts
  const plan = sb.iarvPlanNode(H.intoBox(sb, e), H.intoBox(sb, pr), H.intoBox(sb, S), H.intoBox(sb, { debug: true }));
  const P = H.fromBox(plan);
  H.ok(P.route === "READY", tag + ": plan READY", P);
  if (P.route !== "READY") continue;
  built++;
  const b = H.fromBox(plan.__build);
  const d2 = H.diff(noItemData(b), noItemData(recBuild));
  H.ok(!d2, tag + ": the plan's build = the recorded build (itemData aside)", d2);
  const parts = H.fromBox(plan.__parts);
  // ENGINE vs the classic's child calls, one by one
  const kids = (r.children || []).filter((c) => c.workflow === "SUBTRACT_INVENTORY" || c.workflow === "ADD_INVENTORY");
  const mv = parts.ENGINE.movements;
  H.ok(parts.ENGINE.operation_key === "IAV|" + X.JOB && parts.ENGINE.mode === "APPLY" && parts.ENGINE.organization_id === e.organizationId, tag + ": ENGINE header (IAV|<job>, APPLY, org)", parts.ENGINE);
  H.ok(mv.length === kids.length && kids.length === (recBuild.subtracts || []).length + (recBuild.adds || []).length, tag + ": one movement per classic call (" + kids.length + ")", { mv: mv.length, kids: kids.length });
  for (let i = 0; i < Math.min(mv.length, kids.length); i++) {
    const c = kids[i].params;
    const dir = kids[i].workflow === "SUBTRACT_INVENTORY" ? "SUBTRACT" : "ADD";
    const want = { movement_key: "M" + (Number(c.index) + 1), direction: dir, plant_id: c.plant_id, organization_id: c.organization_id, material_id: c.material_id, quantity: c.quantity,
      material_uom: c.material_uom, unit_price: c.unit_price, transaction_type: c.transaction_type, trx_no: c.trx_no, inventory_category: c.inventory_category, location_id: c.location_id,
      batch_id: c.batch_id === undefined ? null : c.batch_id, doc_date: c.doc_date, isMovingInv: c.isMovingInv, parent_trx_no: "" };
    if (dir === "ADD") {
      want.handling_unit_id = c.handling_unit_id === undefined ? null : c.handling_unit_id;
      H.ok(c.batch_number === "-", tag + " call " + i + ": the classic's ADD sent batch_number '-' (no new batch; V2 sends none)", c.batch_number);
    }
    const dd = H.diff(mv[i], want);
    H.ok(!dd, tag + " M" + (i + 1) + ": = the classic's " + kids[i].workflow + " call " + kids[i].id + " (minus index / itemData / batch_number)", dd);
    calls++;
  }
  // COST / BATCH / HDR / LABELS
  const fifoRow = (id) => (S.fifo.find((f) => f.id === id) || {});
  const dec = (v) => (v === undefined || v === null || v === "" ? null : Number((parseFloat(v) || 0).toFixed(8)).toFixed(8));
  const wantFifo = (recBuild.subtracts || []).filter((x) => Number(x.hasFifoDelete) === 1).map((x) => ({ id: x.fifoDeleteId, material_id: x.material_id,
    before: { fifo_initial_quantity: dec(fifoRow(x.fifoDeleteId).fifo_initial_quantity), fifo_available_quantity: dec(fifoRow(x.fifoDeleteId).fifo_available_quantity) }, after: { is_deleted: 1 } }));
  H.ok(!H.diff(parts.COST.fifo, wantFifo), tag + ": COST.fifo = the layers update_node_iaRvFifoDel removed", H.diff(parts.COST.fifo, wantFifo));
  const wantWaDel = (recBuild.subtracts || []).filter((x) => Number(x.hasWaDelete) === 1).map((x) => x.waDeleteId);
  const wantWaUpd = (recBuild.subtracts || []).filter((x) => Number(x.hasWaUpdate) === 1).map((x) => ({ id: x.waUpdateId, after: { wa_quantity: x.waQuantity, wa_cost_price: x.waCostPrice } }));
  H.ok(H.canon(parts.COST.waDelete.map((w) => w.id)) === H.canon(wantWaDel) && H.canon(parts.COST.waRestate.map((w) => ({ id: w.id, after: w.after }))) === H.canon(wantWaUpd),
    tag + ": COST.waDelete / waRestate = update_node_iaRvWaDel / _WaUpd's rows and values", parts.COST);
  H.ok(parts.COST.material_id === String(recPrep.assembledItemId) && parts.COST.plant_id === String(recPrep.plantId), tag + ": COST of the assembled item at the plant", parts.COST);
  H.ok(H.canon(parts.BATCH.batchDeletes) === H.canon((recBuild.batchDeletes || []).map((x) => x.id)), tag + ": BATCH = the build's batchDeletes", parts.BATCH);
  H.ok(parts.HDR.id === e.iaId && parts.HDR.after.item_assembly_status === "Draft" && parts.HDR.after.posted_status === "" && parts.HDR.before.item_assembly_status === "Processing",
    tag + ": HDR = update_node_iaRvIa's write (Draft, posted_status blank)", parts.HDR);
  H.ok(Object.keys(parts.LABELS).length === mv.length && mv.every((m) => parts.LABELS[m.movement_key] && parts.LABELS[m.movement_key].side === (m.direction === "SUBTRACT" ? "out" : "in")),
    tag + ": LABELS for every movement (out = the assembled item taken back, in = a component returned)", parts.LABELS);
  const man = JSON.parse(P.payload);
  H.ok(man.job_id === X.JOB && man.ia_id === e.iaId && /^IM1:/.test(man.movesFingerprint) && man.movesFingerprint === fp && ["ENGINE", "COST", "BATCH", "HDR", "LABELS"].every((k) => (man.parts[k] || []).length === 1)
    && man.counts.movements === mv.length && man.counts.liveRows === live, tag + ": manifest (job, ia, IM1, five parts, counts)", man);
  H.ok(P.needPlan === (mv.length ? "YES" : "NO") && H.canon(P.movements) === H.canon(mv) && P.operationKey === "IAV|" + X.JOB, tag + ": the PLAN call inputs = the ENGINE part", P.needPlan);
  console.log("ok   " + tag + ": prep + build reproduced; " + mv.length + " movement(s) = the classic's calls; COST " + parts.COST.fifo.length + "/" + parts.COST.waDelete.length + "/"
    + parts.COST.waRestate.length + ", BATCH " + parts.BATCH.batchDeletes.length);
}
H.ok(built === all.filter((r) => X.resp(r, "code_node_iaRvBuild")).length && calls > 0, "every recorded revert planned and every classic call matched", { built: built, calls: calls });
H.done("adapter vs recorded (" + built + " runs planned, " + calls + " classic calls matched)");
