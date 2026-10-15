// test_plan.js <fixture.json> [...]: code/prepare/plan_edit.js (GD_EDIT_PREPARE's planner) on a recorded Edit + Save as
// Created run, the recorded reads as its reads (the GD as stored = the recorded get_node_xTRvHWB8, locked: Processing
// under this job, its Picking held by us), the edit = geDelta(form, stored). Every payload part must reproduce what the
// classic save did in that run:
//  GDL + GDH applied to the stored GD == the recorded read-back (get_node_Cef6vdH4)
//  RES == code_node_QrF4F4Hx's updates (an omitted key written NULL) / creates, before = the row as read
//  ENGINE == code_node_QrF4F4Hx's movements through condition_or_node_zvMyWcqT's mapping
//  SO: the lifted SO nodes re-run on the recorded SO reads from the frozen part == code_node_UMQapdjk / lwB2FVe0
//  PICK: stored Picking rows + the diff == code_node_6L2Ozea8's arrays; STAMP == the stamps
//  AFTER: the reorder deltas == the recorded code_node_f8qELJUF
// The chain runs each run's RECORDED node code (its own version; edit_parity.js's harness), so a difference is the
// planner's assembly, never code drift. delivery_cost is the listed deliberate difference (V2 does not blank it).
const fs = require("fs"), vm = require("vm"), path = require("path"), assert = require("assert");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = __dirname + "/..";
const P = (t) => JSON.parse(String(t).replace(/"(?:[^"\\]|\\.)*"|-?\d{16,}(?![.\deE])/g, (m) => (m[0] === '"' ? m : '"' + m + '"')));
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const F = JSON.parse(fs.readFileSync(R + "scratchpad/gdc/lift/fields.json", "utf8"));
const KINDS = { header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub, res: F.on_reserved_gd, pickItem: F.transfer_order_jz8m9w3h_sub, pickRec: F.transfer_order_vrqs3cmr_sub, pick: F.transfer_order };
const SRC = [R + "scratchpad/gdc/lift/runtime.js", D + "/lift/lifted_edit.js", R + "scratchpad/gdc/code/prepare/chain.js", D + "/code/prepare/chain_edit.js",
  D + "/code/submit/delta.js", D + "/code/prepare/apply_delta.js", D + "/code/prepare/plan_edit.js", D + "/code/commit/so_edit.js"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
const S0 = { total: 0, count: 0, data: [] }, G0 = { count: 0, data: {} };
// the DB's view of a value: what a column stores ("" / null / absent alike, decimals by value)
const dbv = (v) => {
  if (Array.isArray(v)) return v.map(dbv);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) { const x = dbv(v[k]); if (x !== null && x !== undefined && x !== "") o[k] = x; } return o; }
  if (typeof v === "string" && v.trim() !== "" && /^-?\d+(\.\d+)?$/.test(v) && v.length < 16) return Number(v);
  return v;
};
const clock = (t) => t.replace(/"(created_at|updated_at)":"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d"/g, '"$1":"<NOW>"');
const same = (a, b) => clock(JSON.stringify(dbv(canon(a)))) === clock(JSON.stringify(dbv(canon(b))));
let fails = 0, n = 0;
for (const file of process.argv.slice(2)) {
  const fx = JSON.parse(fs.readFileSync(file, "utf8"));
  const rec = {}, recCallee = {}, recReorder = {};
  for (const [src, into] of [[fx.head, rec], [fx.unused, recCallee], [fx.reorder, recReorder]]) if (src) for (const x of JSON.parse(src.nodes_data || "[]")) if (x.node_id && into[x.node_id] === undefined) { try { into[x.node_id] = P(x.response_json_data || "{}").data; } catch (e) { /* skip */ } }
  const storedRec = rec["get_node_xTRvHWB8"] && rec["get_node_xTRvHWB8"].data && rec["get_node_xTRvHWB8"].data.id ? rec["get_node_xTRvHWB8"].data : null;
  if (!storedRec || !fx.unused || !rec["get_node_Cef6vdH4"]) continue;
  n++;
  const label = path.basename(file).slice(0, 19) + " " + fx.doc_no;
  const errs = [];
  try {
    const params = P(fx.head.request_json_data).workflowparams;
    const sb = { console: { log() {}, error() {} }, JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp,
      Date: class extends Date { constructor(...a) { if (a.length) super(...a); else super(1791880000000); } static now() { return 1791880000000; } } };
    vm.createContext(sb);
    vm.runInContext(SRC, sb);
    // the run's own code over the lifted bodies
    const rewrite = (code) => code.replace(/\{\{([^{}]+?)\}\}/g, (m, k) => "__v(" + JSON.stringify(k) + ")");
    const codes = [];
    for (const src of [fx.head, fx.unused, fx.reorder]) if (src) for (const x of JSON.parse(src.nodes_data || "[]")) if (x.node_type === "code-node" && x.request_json_data) {
      const rq = P(x.request_json_data);
      codes.push({ id: x.node_id, code: rewrite(rq.code), decl: (rq.responseConfig || []).map((r) => [r.name, r.bsonType]) });
    }
    sb.__CODES = codes;
    vm.runInContext('for (const c of __CODES) __N[c.id] = { decl: c.decl, fn: new Function("const console = __QUIET;\\n" + c.code) };', sb);
    const g = (id, d) => (rec[id] === undefined ? d : rec[id]);
    // the job's view: SUBMIT computed the delta, locked the GD (Processing) and its Picking (is_processing 1 at a version)
    sb.__F = params.allData; sb.__S = storedRec; sb.__K = KINDS;
    const delta = vm.runInContext("geDelta(__F, __S, __K)", sb);
    const stored = JSON.parse(JSON.stringify(storedRec));
    stored.gd_status = "Processing";
    const pick = JSON.parse(JSON.stringify(g("get_pick_for_reconcile", G0)));
    const pickVersion = pick && pick.data && pick.data.id ? "2026-10-15 10:00:00.000" : "";
    if (pickVersion) { pick.data.is_processing = 1; pick.data.update_time = pickVersion; }
    const jobId = "2110999999999999999";
    sb.__E = { jobId, tenantId: fx.tenant_id, nonce: "a1b2c3d4", idempotencyKey: "GDE|" + storedRec.id + "|1", gdId: String(storedRec.id), organizationId: String(storedRec.organization_id),
      request: { v: 1, source: "FORM", stored_status: storedRec.gd_status, submitted_by: "1", picking_version: pickVersion,
        answers: { needCL: params.needCL || "required", continueZero: params.continueZero || "", confirmPickReversal: params.confirmPickReversal || "" }, delta } };
    sb.__R = { stored, lock: { step_name: "LOCK|1", result_ref: "GDE|" + storedRec.id + "|1" },
      linkage: g("search_gr_linkage", S0), pickingSetup: g("get_node_iFPuvJX2", G0), itemFlags: g("sql_node_ItemFlags", []), packingSetup: g("get_packing_setup", G0),
      pick, activePickings: g("search_node_NBAQ9gsj", S0), binNames: g("search_bin_names", S0), soLines: g("search_node_SOLine8kQ2", S0), cleanupSoLines: g("search_node_DnZIKKVH", S0),
      soHeaders: g("search_node_FVhsTRDu", S0), pickingFormat: g("get_node_zna6o03F", G0), itemDatas: recCallee["sql_node_ItemDatas"] || [], allocated: recCallee["search_node_r3NiR6B7"] || S0,
      pending: recCallee["search_node_QdY1FLLA"] || S0, extraReads: {}, calleeExtraReads: {} };
    for (const x of JSON.parse(fx.head.nodes_data)) if (/^(search|sql|get)-node$/.test(x.node_type || "") && !(x.node_id in sb.__R)) sb.__R.extraReads[x.node_id] = rec[x.node_id];
    for (const x of JSON.parse(fx.unused.nodes_data)) if (/^(search|sql|get)-node$/.test(x.node_type || "")) sb.__R.calleeExtraReads[x.node_id] = recCallee[x.node_id];
    const res = vm.runInContext("gePlan(__E, __R, __K)", sb);
    if (res.route !== "ENGINE") throw new Error("route " + res.route + " " + res.code + " " + res.message);
    const parts = res.parts;

    // GDL + GDH on the stored GD == the recorded read-back (inserted lines matched by position)
    sb.__PT = parts;
    const applied = vm.runInContext("geApplyGdParts(__S, __PT, __K)", sb);
    const back = rec["get_node_Cef6vdH4"].data;
    const flat = (gd) => (gd.table_gd || []).flatMap((r) => [r].concat(r.children || []));
    const fa = flat(applied), fb = flat(back);
    if (fa.length !== fb.length) errs.push(`GDL: ${fa.length} lines | read-back ${fb.length}`);
    const sys = new Set(["update_time", "update_user", "create_time", "create_user", "create_dept", "tenant_id", "is_deleted", "sub_tenant_id", "id", "parent_id", "goods_delivery_id", "children", "job_line_key"]);
    for (let i = 0; i < Math.min(fa.length, fb.length); i++) for (const c of new Set([...Object.keys(fa[i]), ...Object.keys(fb[i])])) if (!sys.has(c) && !same(fa[i][c], fb[i][c])) errs.push(`GDL[${i}].${c}: ${JSON.stringify(fa[i][c])?.slice(0, 50)} | read-back ${JSON.stringify(fb[i][c])?.slice(0, 50)}`);
    for (const c of new Set([...Object.keys(applied), ...Object.keys(back)])) if (c !== "table_gd" && c !== "delivery_cost" && !sys.has(c) && !same(applied[c], back[c])) errs.push(`GDH.${c}: ${JSON.stringify(applied[c])?.slice(0, 50)} | read-back ${JSON.stringify(back[c])?.slice(0, 50)}`);

    // RES
    const exec = recCallee["code_node_QrF4F4Hx"] || {};
    const RC = ["target_gd_id", "status", "reserved_qty", "open_qty", "delivered_qty", "doc_no", "doc_id", "doc_line_id", "source_reserved_id", "item_uom"];
    const proj = (o) => Object.fromEntries(RC.map((c) => [c, o[c] === undefined ? null : o[c]]));
    const recUpd = (exec.reservedRecordUpdates || []).map((u) => ({ id: String(u.id), after: proj(u) }));
    const myUpd = parts.RES.updates.map((u) => ({ id: u.id, after: u.after }));
    if (!same(recUpd, myUpd)) errs.push(`RES updates: ${myUpd.length} | rec ${recUpd.length} (or values differ)`);
    const readRows = {};
    for (const r of (recCallee["search_node_r3NiR6B7"] || S0).data.concat((recCallee["search_node_QdY1FLLA"] || S0).data)) readRows[String(r.id)] = r;
    for (const u of parts.RES.updates) if (!same(u.before, proj(readRows[u.id] || {}))) errs.push("RES before of " + u.id + " is not the row as read");
    const recCre = (exec.reservedRecordCreates || []).map((c) => { const o = Object.assign({}, c); return o; });
    // V2 stamps reserved_date / plant_id / organization_id as add_node_ojy0rTgC does from its params (an older planner
    // already carried them on the record); job_line_key is V2's own
    const myCre = parts.RES.creates.map((c, i) => { const o = Object.assign({}, c); delete o.job_line_key; for (const k of ["reserved_date", "plant_id", "organization_id"]) if (!recCre[i] || recCre[i][k] === undefined) delete o[k]; return o; });
    if (!same(recCre, myCre)) {
      errs.push(`RES creates: ${myCre.length} | rec ${recCre.length} (or values differ)`);
      for (let i = 0; i < Math.min(recCre.length, myCre.length); i++) for (const k of new Set([...Object.keys(recCre[i]), ...Object.keys(myCre[i])])) if (!same(recCre[i][k], myCre[i][k])) errs.push(`   create[${i}].${k}: ${JSON.stringify(myCre[i][k])?.slice(0, 60)} | rec ${JSON.stringify(recCre[i][k])?.slice(0, 60)}`);
    }

    // ENGINE
    const mv = exec.inventoryMovements || [];
    const expectN = mv.reduce((k, m) => k + (["UNRESTRICTED_TO_RESERVED", "RESERVED_TO_UNRESTRICTED"].includes(String(m.movement_type)) ? 2 : 1), 0);
    if (parts.ENGINE.movements.length !== expectN) errs.push(`ENGINE: ${parts.ENGINE.movements.length} movements | expected ${expectN} from ${mv.length} planner movements`);
    if (parts.ENGINE.operation_key !== "GDE|" + jobId) errs.push("ENGINE operation_key " + parts.ENGINE.operation_key);
    const gdData = (rec["code_node_Pgtw6zFL"] || {}).gdData || {};
    for (const m of parts.ENGINE.movements) if (m.trx_no !== gdData.delivery_no || m.doc_date !== gdData.delivery_date) { errs.push("ENGINE trx_no/doc_date not the GD's"); break; }

    // SO: E4's lifted re-run on the recorded SO reads, from the frozen part
    sb.__SO = parts.SO;
    sb.__SOL = (rec["search_node_SOLine8kQ2"] || S0).data.concat((rec["search_node_DnZIKKVH"] || S0).data);
    sb.__SOH = (rec["search_node_FVhsTRDu"] || S0).data;
    sb.__SOX = sb.__R.extraReads;
    const so = vm.runInContext("geSoRun(__SO, __SOL, __SOH, __SOX)", sb);
    if (so.stop) errs.push("SO stopped: " + so.stop);
    else {
      if (!same(so.final, (rec["code_node_UMQapdjk"] || {}).finalSOTable || [])) errs.push("SO lines differ from code_node_UMQapdjk.finalSOTable");
      if (!same(so.heads, (rec["code_node_lwB2FVe0"] || {}).updatedSOList || [])) errs.push("SO headers differ from code_node_lwB2FVe0.updatedSOList");
    }

    // PICK + STAMP
    const six = rec["code_node_6L2Ozea8"], o35 = rec["code_node_o35eZx2c"];
    if (six) {
      if (parts.PICK.mode !== (Number(six.isUpdate) === 1 ? "UPDATE" : "CREATE")) errs.push("PICK mode " + parts.PICK.mode);
      if (parts.PICK.mode === "UPDATE") {
        sb.__PK = parts.PICK; sb.__STP = pick.data;
        const rebuilt = vm.runInContext("geRebuildPicking(__STP, __PK)", sb);
        if (!same(rebuilt.table_picking_items, six.updateData.table_picking_items)) errs.push("PICK items != code_node_6L2Ozea8.updateData.table_picking_items");
        if (!same(rebuilt.table_picking_records, six.updateData.table_picking_records)) errs.push("PICK records != code_node_6L2Ozea8.updateData.table_picking_records");
      } else if (!same(parts.PICK.createData, six.createData)) {
        errs.push("PICK createData != code_node_6L2Ozea8.createData");
        for (const k of new Set([...Object.keys(parts.PICK.createData || {}), ...Object.keys(six.createData || {})])) if (!same((parts.PICK.createData || {})[k], (six.createData || {})[k])) errs.push(`   createData.${k}: ${JSON.stringify((parts.PICK.createData || {})[k])?.slice(0, 70)} | rec ${JSON.stringify(six.createData[k])?.slice(0, 70)}`);
      }
      if (!same(parts.STAMP.gdPickingStatus, (six.gdUpdateData || {}).picking_status)) errs.push("STAMP header picking_status");
      if (!same(parts.STAMP.lineIds, ((o35 || {}).gdLineUpdates || []).map((x) => String(x.gd_line_id)))) errs.push("STAMP line ids");
    } else if (parts.PICK.mode !== "NONE") errs.push("PICK mode " + parts.PICK.mode + " | none in the run");

    // AFTER
    const rr = recReorder["code_node_f8qELJUF"];
    if (rr && !same((parts.AFTER.reorder || {}).deltas || [], rr.data || [])) errs.push("AFTER reorder deltas differ from code_node_f8qELJUF");
    if (!same(parts.AFTER.item_ids, ((rec["code_node_62FzZA2e"] || {}).updates || []).map((u) => String(u.id)))) errs.push("AFTER item ids");
  } catch (e) { errs.push("THREW " + (e.stack || e).toString().split("\n").slice(0, 3).join(" | ")); }
  if (errs.length) { fails++; console.log("FAIL", label); for (const e of errs.slice(0, 10)) console.log("   " + e); }
  else console.log("ok  ", label);
}
console.log(JSON.stringify({ fixtures: n, failed: fails }));
process.exit(fails || !n ? 1 : 0);
