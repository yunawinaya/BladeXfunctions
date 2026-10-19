// node test/prepare/test_review_golden.js [fixtures/sc_runs_dev.json fixtures/sc_runs_prod.json]
// Golden test (a) of the shared review chain (CONTRACT.md section 16) on recorded STOCK_COUNT Review runs (fetch_sc_runs.py):
//  a1  every lifted body on its RECORDED inputs (the trace's variableMap = the values the platform substituted) reproduces the
//      recorded output byte for byte: the v10 bodies of code/shared/review_chain.js when the run ran the v10 code, else the
//      run's own recorded code lifted the same way (proves the runtime's output rules on older runs too);
//  a2  saReviewChain on the run's request + its recorded fetch outputs (as the build received them) reproduces the recorded
//      prep / required / build / mark / fillback outputs (v10 runs), and saDoc = O4tWJ5JH(build) + split;
//  a3  saSplitLines / saAdjDetails units (the recorded lines never exceed 50 entries: synthetic lines).
const fs = require("fs");
const path = require("path");
const { load, src, J, SAV2 } = require("./load.js");

const FILES = process.argv.slice(2).length ? process.argv.slice(2) : ["fixtures/sc_runs_dev.json", "fixtures/sc_runs_prod.json"].map((f) => path.join(__dirname, f));
const LIFTED = ["code_review_prep", "code_review_required", "code_review_build_sa", "code_review_mark", "code_fillback"];
const BASE = {};
(function walk(o) {
  if (Array.isArray(o)) return o.forEach(walk);
  if (o && typeof o === "object") {
    if (typeof o.id === "string" && o.data && o.type) BASE[o.id] = o;
    Object.values(o).forEach(walk);
  }
})(JSON.parse(fs.readFileSync(path.join(SAV2, "base", "STOCK_COUNT.v10.json"), "utf8")));

let fails = 0;
let passes = 0;
const ok = (label, cond, extra) => {
  if (cond) passes++;
  else fails++;
  if (!cond || process.env.VERBOSE) console.log((cond ? "ok   " : "FAIL ") + label + (cond || extra === undefined ? "" : "\n     " + String(extra).slice(0, 1500)));
};
// the first difference between two JSON texts (for a readable failure)
const diffAt = (a, b) => {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return "at " + i + ": got ..." + a.slice(Math.max(0, i - 80), i + 120) + "\n     want ..." + b.slice(Math.max(0, i - 80), i + 120);
};

// lib/lift/lift.py's rewrite, for a run's own recorded code
const liftText = (id, code, decl) => {
  const body = code.replace(/\{\{([^{}]+?)\}\}/g, (m, t) => "__v(" + JSON.stringify(t) + ")");
  return `__N[${JSON.stringify(id)}] = { decl: ${JSON.stringify(decl)}, fn: function () {\nconst console = __QUIET;\n${body}\n} };\n`;
};
const FILES_JS = ["lib/lift/runtime.js", "code/shared/sa_common.js", "code/shared/fingerprint.js", "code/shared/review_chain.js", "code/prepare/adapter.js", "code/prepare/plan.js"];
const NAMES = ["__N", "__run", "__withContext", "saReviewChain", "saReviewAdapt", "saSplitLines", "saAdjDetails", "saReviewIds", "saPlanScPart", "scLineFingerprint"];
const shared = load(FILES_JS, NAMES);
const withExtra = (extra) => new Function(FILES_JS.map(src).join("\n") + "\n" + extra + "\nreturn { " + NAMES.join(", ") + " };")();

// a trace variableMap ({ "node:x.data.a": v, "workflowparams:k": v }) -> the runtime context (__CTX["node:x"] = { data: { a: v } })
const ctxOf = (vm) => {
  const ctx = {};
  for (const key of Object.keys(vm)) {
    const dot = key.indexOf(".", key.indexOf(":") + 1);
    if (dot < 0) {
      ctx[key] = vm[key];
      continue;
    }
    const base = key.slice(0, dot);
    const parts = key.slice(dot + 1).split(".");
    let o = (ctx[base] = ctx[base] || {});
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] = o[parts[i]] && typeof o[parts[i]] === "object" ? o[parts[i]] : {};
    o[parts[parts.length - 1]] = vm[key];
  }
  return ctx;
};
const respData = (n) => JSON.parse(n.response).data;
const stable = (v) => JSON.stringify(v);

let v10Runs = 0;
let oldRuns = 0;
for (const file of FILES) {
  for (const run of JSON.parse(fs.readFileSync(file, "utf8"))) {
    const tag = run.env + " " + run.id + " (" + run.tenant + ")";
    const isV10 = LIFTED.every((id) => !run.nodes[id] || J(run.nodes[id].request).code === BASE[id].data.script.code);
    if (isV10) v10Runs++;
    else oldRuns++;
    // a1: each lifted body on its recorded inputs
    for (const id of LIFTED) {
      const n = run.nodes[id];
      if (!n) continue;
      const req = J(n.request);
      const decl = (req.responseConfig || []).map((r) => [r.name, r.bsonType || "any"]);
      const same = req.code === BASE[id].data.script.code;
      const mod = same ? shared : withExtra(liftText(id, req.code, decl));
      if (!same && JSON.stringify(decl) !== JSON.stringify(mod.__N[id].decl)) ok(tag + " a1 " + id + " recorded decl", false, JSON.stringify(decl));
      let got;
      try {
        got = mod.__withContext(ctxOf(req.variableMap || {}), () => mod.__run(id));
      } catch (e) {
        ok(tag + " a1 " + id + " runs", false, e.stack);
        continue;
      }
      const want = respData(n);
      ok(tag + " a1 " + id + (same ? " (v10 body)" : " (recorded code)") + " = recorded output", stable(got) === stable(want), diffAt(stable(got), stable(want)));
    }
    // a4: PREPARE's SC part from the chain's fill-back (A3 writes it): the 23 update_node_sc props, item_list / previous_status (and
    // every other header prop the record carries) exactly the incoming record's - never dropped to null
    {
      const wp0 = J(run.request).workflowparams;
      const rec = wp0.allData;
      const res0 = shared.saReviewChain({ scRecord: JSON.parse(JSON.stringify(rec)), createAdjustment: wp0.createAdjustment, organizationId: wp0.organizationId,
        nickname: wp0.nickname, adjustmentDate: wp0.adjustmentDate, reads: {}, adapted: {} });
      const part = shared.saPlanScPart(res0.scAfter, "SCF1:0:x");
      const keep = ["item_list", "previous_status", "count_type", "count_method", "assignees", "user_assignees", "blind_count", "plant_id", "stock_count_remark"];
      const lost = keep.filter((k) => rec[k] !== undefined && rec[k] !== null && JSON.stringify(part[k]) !== JSON.stringify(rec[k]));
      ok(tag + " a4 SC part: 23 props, " + keep.filter((k) => rec[k] !== undefined && rec[k] !== null).length + " carried props = the incoming record's (item_list " +
        (rec.item_list === undefined ? "absent" : "present") + ", previous_status " + (rec.previous_status === undefined ? "absent" : "present") + ")",
      Object.keys(part).length === 25 && !lost.length && part.afterFingerprint === shared.scLineFingerprint(part.table_stock_count), "lost " + lost.join(", "));
      if (run.nodes.code_fillback) {
        const fb = respData(run.nodes.code_fillback).entry;
        ok(tag + " a4 SC part props = the classic update_node_sc's (recorded fill-back)", ["item_list", "previous_status", "stock_count_status", "review_status", "adjustment_status",
          "total_counted", "total_variance", "table_stock_count"].every((k) => JSON.stringify(part[k]) === JSON.stringify(fb[k] === undefined ? null : fb[k])));
      }
    }
    if (!isV10) continue;
    // a2: the whole chain on the run's request + the recorded fetch outputs (as the build received them)
    const wp = J(run.request).workflowparams;
    const vm = J(run.nodes.code_review_build_sa.request).variableMap;
    const fetched = ctxOf(Object.fromEntries(Object.entries(vm).filter(([k]) => !/^node:code_review_prep\./.test(k) && !/^workflowparams:/.test(k))));
    let res;
    try {
      res = shared.saReviewChain({ scRecord: wp.allData, createAdjustment: wp.createAdjustment, organizationId: wp.organizationId, nickname: wp.nickname,
        adjustmentDate: wp.adjustmentDate, reads: {}, adapted: fetched });
    } catch (e) {
      ok(tag + " a2 chain runs", false, e.stack);
      continue;
    }
    for (const [key, id, pick] of [["prep", "code_review_prep", (r) => r], ["required", "code_review_required", (r) => r], ["built", "code_review_build_sa", (r) => r],
      ["scAfter", "code_fillback", (r) => r.entry]]) {
      if (!run.nodes[id]) continue; // a failed build ends the classic run before mark / fillback
      const want = pick(respData(run.nodes[id]));
      ok(tag + " a2 chain." + key + " = recorded " + id, stable(res[key]) === stable(want), diffAt(stable(res[key]), stable(want)));
    }
    if (run.nodes.code_review_mark) {
      const markWant = respData(run.nodes.code_review_mark).entry;
      // fillback only renumbers line_index and sets organization_id: mark's lines are fillback's lines minus line_index
      ok(tag + " a2 mark ran (doProcess " + res.prep.doProcess + ")", Number(res.prep.doProcess) === 1 && (markWant.table_stock_count || []).length === (res.scAfter.table_stock_count || []).length);
    }
    const b = respData(run.nodes.code_review_build_sa);
    if (b.hasError !== 1 && b.hasLines === 1) {
      const lines = res.saDoc && res.saDoc.stock_adjustment;
      const built = b.stockAdjustmentDoc.stock_adjustment;
      ok(tag + " a2 saDoc lines = built lines + O4tWJ5JH (unit_price q8, plant_id, line_index)", Array.isArray(lines) && lines.length === built.length &&
        lines.every((l, i) => l.balance_index === built[i].balance_index && l.adj_summary === built[i].adj_summary && l.total_quantity === built[i].total_quantity &&
          l.line_index === i + 1 && l.plant_id === b.stockAdjustmentDoc.plant_id && l.unit_price === Number((parseFloat(built[i].unit_price) || 0).toFixed(8))),
      JSON.stringify(lines && lines[0]).slice(0, 600));
      ok(tag + " a2 saDoc header: Draft, 'issued', posted_status Unposted", res.saDoc.stock_adjustment_status === "Draft" && res.saDoc.adjustment_no === "issued" &&
        res.saDoc.posted_status === "Unposted", JSON.stringify({ s: res.saDoc.stock_adjustment_status, n: res.saDoc.adjustment_no, p: res.saDoc.posted_status }));
      const entries = built.reduce((t, l) => t + JSON.parse(l.balance_index).length, 0);
      ok(tag + " a2 counts", res.counts.lines === built.length && res.counts.entries === entries, JSON.stringify(res.counts));
    } else {
      ok(tag + " a2 no saDoc on a failed / empty build", res.saDoc === null);
    }
    // the insert the classic made = the build's doc (add_node_sa's request)
    if (run.nodes.add_node_sa) {
      const ins = J(run.nodes.add_node_sa.request).data[0];
      ok(tag + " a2 add_node_sa wrote the build's lines", stable(ins.stock_adjustment) === stable(res.built.stockAdjustmentDoc.stock_adjustment),
        diffAt(stable(ins.stock_adjustment), stable(res.built.stockAdjustmentDoc.stock_adjustment)));
    }
  }
}

// a3: the split
{
  const { saSplitLines, saAdjDetails } = shared;
  const mk = (n, batch) => {
    const entries = [];
    const details = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const q = Number(((i % 7) + 0.125).toFixed(8));
      entries.push({ balance_id: String(2000000000000000000 + i), material_id: "2072251040571387906", location_id: "20653500547725" + String(10000 + i), batch_id: batch ? "2056919801992785922" : null,
        category: "Unrestricted", movement_type: i % 3 ? "Out" : "In", sa_quantity: q });
      total = Number((total + q).toFixed(8));
      details.push(`Bin ${i}: ${q} UNIT (UNR) - ${i % 3 ? "OUT" : "IN"}` + (batch ? `\n[B-${i}]` : ""));
    }
    return { material_id: "2072251040571387906", uom_id: "2018906563477008392", total_quantity: total, unit_price: 0, plant_id: "1", line_index: 1,
      balance_index: JSON.stringify(entries), adj_summary: `Total: ${total} UNIT\nDETAILS:\n${details.map((d, i) => `${i + 1}. ${d}`).join("\n")}` };
  };
  const small = mk(50, false);
  const big = mk(123, true);
  const doc = { plant_id: "1", stock_adjustment: [small, big, mk(3, false)] };
  const out = saSplitLines(doc).stock_adjustment;
  ok("a3 split: 50 stays one line, 123 -> 50 + 50 + 23, line_index renumbered", out.length === 5 && out.map((l) => JSON.parse(l.balance_index).length).join() === "50,50,50,23,3" &&
    out.map((l) => l.line_index).join() === "1,2,3,4,5", out.map((l) => JSON.parse(l.balance_index).length).join());
  const parts = out.slice(1, 4);
  const all = JSON.parse(big.balance_index);
  ok("a3 split: the slices concatenate to the original entries, in order", JSON.stringify(parts.flatMap((l) => JSON.parse(l.balance_index))) === JSON.stringify(all));
  const seq = (es) => es.reduce((t, e) => Number((t + e.sa_quantity).toFixed(8)), 0);
  ok("a3 split: total_quantity = the sequential q8 sum of each slice", parts.every((l) => l.total_quantity === seq(JSON.parse(l.balance_index))));
  const want = (es, from) => `Total: ${seq(es)} UNIT\nDETAILS:\n` + es.map((e, i) => `${i + 1}. Bin ${from + i}: ${e.sa_quantity} UNIT (UNR) - ${(from + i) % 3 ? "OUT" : "IN"}\n[B-${from + i}]`).join("\n");
  ok("a3 split: adj_summary rebuilt in the build's format, details renumbered per slice", parts.every((l, k) => l.adj_summary === want(JSON.parse(l.balance_index), 50 * k)),
    parts[2].adj_summary.slice(0, 300));
  ok("a3 split: the other columns copied", parts.every((l) => l.material_id === big.material_id && l.unit_price === 0 && l.plant_id === "1" && l.uom_id === big.uom_id));
  ok("a3 split: a line of <= 50 entries is the same object content", JSON.stringify(out[0]) === JSON.stringify(Object.assign({}, small, { line_index: 1 })));
  let threw = "";
  try {
    saAdjDetails(Object.assign({}, big, { adj_summary: big.adj_summary.replace("2. Bin 1", "2. Bin 1x").replace(": 1.125 UNIT", ": 9.125 UNIT") }), all);
  } catch (e) {
    threw = e.message;
  }
  ok("a3 split: a summary that does not match its entries throws", /detail 2 is not its entry's/.test(threw), threw);
  const noUom = mk(60, false);
  noUom.adj_summary = noUom.adj_summary.replace(/ UNIT/g, " ");
  const o2 = saSplitLines({ stock_adjustment: [noUom] }).stock_adjustment;
  ok("a3 split: an empty UOM name keeps the build's double space", o2.length === 2 && /^Total: \S+ \nDETAILS:\n1\. Bin 0: 0\.125  \(UNR\) - IN/.test(o2[0].adj_summary), o2[0].adj_summary.slice(0, 80));
}

console.log(`review chain golden: ${v10Runs} v10 runs + ${oldRuns} older-code runs; ${passes} checks passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
