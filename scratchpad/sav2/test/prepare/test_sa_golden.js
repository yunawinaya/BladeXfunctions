// node test/prepare/test_sa_golden.js
// Golden test 3 of PREPARE's movement list (CONTRACT.md section 5 ENGINE) against recorded classic STOCK_ADJUSTMENT runs
// (fixtures/sa_runs_<env>.json, fetch_sa_runs.py): the ADD_INVENTORY / SUBTRACT_INVENTORY runs each one made ARE the
// workflow_node_ABYSBRCw / p9gVSMG0 inputs (loop bodies are not traced). Run by run, movement by movement, in order:
//  3a  the lifted qrsgEz2F / GmKmvMGe on the run's RECORDED context (its pageStatus, O4tWJ5JH output = the loop source,
//      get_node_Rs3nGg9f / add_node_Yk7ukSPp) -> saPlanMovement = the recorded params minus itemData;
//  3b  PREPARE's own FORM path: the Stock Adjustment re-read now with prepare/sql.py (fixtures/sa_rows_<env>.json, fetch_sa_rows.py)
//      -> saAdaptHeader / saAdaptLines -> saPlanContext (pageStatus Edit, Draft, the stored header) -> the same movements;
//  3c  REVIEW end to end: a recorded v10 STOCK_COUNT review (fixtures/sc_runs_<env>.json) -> saReviewChain on its recorded reads ->
//      saDoc's lines + the completing SA run's header -> the movements that SA run made.
// Comparison: direction = the callee (ADD / SUBTRACT); every other key equal to the recorded param after dropping the keys the
// movement holds as null (the platform drops a null param) and movement_key / direction; quantity compared as a number.
const fs = require("fs");
const path = require("path");
const { load, J } = require("./load.js");

const FX = path.join(__dirname, "fixtures");
const M = load(["lib/lift/runtime.js", "code/shared/sa_common.js", "code/shared/fingerprint.js", "code/shared/review_chain.js", "lift/lifted_prepare.js",
  "code/prepare/adapter.js", "code/prepare/plan.js"], ["__withContext", "__run", "saPlanLoop", "saPlanMovement", "saPlanContext", "saAdaptHeader", "saAdaptLines", "saReviewChain"]);

let fails = 0;
let passes = 0;
const notes = {};
const ok = (label, cond, extra) => {
  if (cond) passes++;
  else fails++;
  if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + label + (cond || extra === undefined ? "" : "\n     " + String(extra).slice(0, 1600)));
};
const note = (k) => (notes[k] = (notes[k] || 0) + 1);
const sorted = (o) => Object.keys(o).sort().reduce((r, k) => ((r[k] = o[k]), r), {});
// a movement as the classic's sub-workflow received it: no movement_key / direction, null keys dropped
const asParams = (mv) => {
  const o = {};
  for (const k of Object.keys(mv)) if (k !== "movement_key" && k !== "direction" && mv[k] !== null && mv[k] !== undefined) o[k] = mv[k];
  return o;
};
const compare = (tag, movements, children, partial) => {
  const n = partial ? Math.min(children.length, movements.length) : movements.length;
  if (!partial) ok(tag + " movement count " + movements.length + " = recorded " + children.length, movements.length === children.length,
    JSON.stringify(movements.map((m) => m.direction + " " + m.quantity)) + "\n     rec " + JSON.stringify(children.map((c) => c.wf + " " + c.params.quantity)));
  let same = 0;
  for (let i = 0; i < n && i < children.length; i++) {
    const got = asParams(movements[i]);
    const want = Object.assign({}, children[i].params);
    const dirOk = movements[i].direction === children[i].wf;
    const qOk = Number(got.quantity) === Number(want.quantity);
    got.quantity = Number(got.quantity);
    want.quantity = Number(want.quantity);
    const a = JSON.stringify(sorted(got));
    const b = JSON.stringify(sorted(want));
    if (dirOk && qOk && a === b) same++;
    else ok(tag + " M" + (i + 1) + " = recorded " + children[i].wf + " " + children[i].id, false, "dir " + movements[i].direction + "/" + children[i].wf + "\n     got  " + a + "\n     want " + b);
  }
  if (n) ok(tag + " " + same + "/" + n + " movements equal the recorded params" + (partial ? " (run failed mid-loop: its first " + n + ")" : ""), same === n);
  return same === n;
};

let runs3a = 0, runs3b = 0, runs3c = 0, matched3a = 0, matched3b = 0, matched3c = 0, mv3a = 0;
for (const env of ["dev", "prod"]) {
  const runs = J(fs.readFileSync(path.join(FX, "sa_runs_" + env + ".json"), "utf8"));
  const rowsFile = path.join(FX, "sa_rows_" + env + ".json");
  const reread = fs.existsSync(rowsFile) ? J(fs.readFileSync(rowsFile, "utf8")) : {};
  const scFile = path.join(FX, "sc_runs_" + env + ".json");
  const scRuns = fs.existsSync(scFile) ? JSON.parse(fs.readFileSync(scFile, "utf8")) : [];
  for (const run of runs) {
    if (run.saveAs !== "Completed") continue;
    const tag = env + " " + run.id + " (" + run.tenant + ", " + run.pageStatus + ")";
    const partial = run.exit !== "return_node_ribqfzwc";
    const fill = run.nodes.code_node_O4tWJ5JH && run.nodes.code_node_O4tWJ5JH.data;
    if (!fill || !fill.allData) {
      note("no recorded O4tWJ5JH");
      continue;
    }
    const lines = fill.allData.stock_adjustment || [];
    // 3a: the recorded context
    runs3a++;
    const ctx = { "workflowparams:pageStatus": run.pageStatus, "workflowparams:saveAs": run.saveAs, "node:code_node_O4tWJ5JH": { data: fill },
      "node:search_node_SAItems": { data: { total: 0, count: 0, data: [] } } };
    if (run.nodes.get_node_Rs3nGg9f) ctx["node:get_node_Rs3nGg9f"] = run.nodes.get_node_Rs3nGg9f;
    if (run.nodes.add_node_Yk7ukSPp) ctx["node:add_node_Yk7ukSPp"] = run.nodes.add_node_Yk7ukSPp;
    let mv;
    try {
      mv = M.saPlanLoop(lines, ctx).map((x, i) => M.saPlanMovement("M" + (i + 1), x.q, x.g));
    } catch (e) {
      ok(tag + " 3a loop runs", false, e.stack);
      continue;
    }
    mv3a += mv.length;
    if (compare(tag + " 3a", mv, run.children, partial)) matched3a++;
    // 3b: PREPARE's FORM path on the stored rows (a Completed SA's lines are what the classic wrote)
    const rr = reread[run.id];
    if (rr && rr.hdr && rr.hdr.length) {
      runs3b++;
      const header = M.saAdaptHeader(J(rr.hdr[0].j));
      const stored = M.saAdaptLines(rr.lines);
      let mv2;
      try {
        mv2 = M.saPlanLoop(stored, M.saPlanContext(header)).map((x, i) => M.saPlanMovement("M" + (i + 1), x.q, x.g));
      } catch (e) {
        ok(tag + " 3b loop runs", false, e.stack);
        continue;
      }
      // the number the run completed under (its insert / read-back); a later renumbering (seen: posting re-issued ADJ-2609-020 as
      // ADJ-2609-022 a day later) is a change since the run - every other field is still compared
      const recNo = String(((run.nodes.get_node_Rs3nGg9f || {}).data || {}).data ? run.nodes.get_node_Rs3nGg9f.data.data.adjustment_no
        : (((run.nodes.add_node_Yk7ukSPp || {}).data || [])[0] || {}).adjustment_no || "");
      if (recNo && header.adjustment_no !== recNo) {
        note("3b: SA renumbered since the run (" + recNo + " -> " + header.adjustment_no + ")");
        for (const m of mv2) if (m.trx_no === header.adjustment_no) m.trx_no = recNo;
      }
      if (compare(tag + " 3b", mv2, run.children, partial)) matched3b++;
    } else note("3b: SA not re-read");
  }
  // 3c: REVIEW end to end (v10 review runs and the classic completion of the SA they built)
  for (const sc of scRuns) {
    const cap = sc.nodes.code_capture_sa && JSON.parse(sc.nodes.code_capture_sa.response).data;
    const saId = cap && String(cap.stockAdjustmentId || "");
    const build = sc.nodes.code_review_build_sa;
    if (!saId || !build) continue;
    const req = J(build.request);
    if (!/sql_review_costs/.test(req.code)) continue; // pre-v10 build code: another build
    const saRun = runs.find((r) => r.allData && String(r.allData.id) === saId && r.saveAs === "Completed");
    if (!saRun) {
      note("3c: no completing SA run recorded");
      continue;
    }
    runs3c++;
    const tag = env + " SC " + sc.id + " -> SA run " + saRun.id;
    const wp = J(sc.request).workflowparams;
    const vm = req.variableMap;
    const ctx = {};
    for (const k of Object.keys(vm)) {
      if (/^node:code_review_prep\./.test(k) || /^workflowparams:/.test(k)) continue;
      const dot = k.indexOf(".", k.indexOf(":") + 1);
      const base = k.slice(0, dot);
      const parts = k.slice(dot + 1).split(".");
      let o = (ctx[base] = ctx[base] || {});
      for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] || {};
      o[parts[parts.length - 1]] = vm[k];
    }
    const chain = M.saReviewChain({ scRecord: wp.allData, createAdjustment: wp.createAdjustment, organizationId: wp.organizationId, nickname: wp.nickname,
      adjustmentDate: wp.adjustmentDate, reads: {}, adapted: ctx });
    const header = saRun.nodes.get_node_Rs3nGg9f.data.data;
    const mv = M.saPlanLoop(chain.saDoc.stock_adjustment, M.saPlanContext(header)).map((x, i) => M.saPlanMovement("M" + (i + 1), x.q, x.g));
    if (compare(tag + " 3c", mv, saRun.children, saRun.exit !== "return_node_ribqfzwc")) matched3c++;
  }
}
console.log("notes", JSON.stringify(notes));
console.log(`SA golden: 3a ${matched3a}/${runs3a} runs (${mv3a} movements), 3b ${matched3b}/${runs3b} runs, 3c ${matched3c}/${runs3c} reviews; ${passes} checks passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
