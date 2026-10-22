// An invoice saved from the SI form, checked in the mock runtime: the form state the save sent (SI_SAVE's request `data`) gets a
// full SIcalculation pass in the v387 form and in the lean v388 form. oldVsNew (decisive) lists where the two calculations disagree;
// diffs lists what a fresh v387 pass would change in the saved state (context: the old form saved such states too).
// Usage: node check_saved_form.js < request.json   (the run's request_json_data, or { data })
"use strict";
const fs = require("fs");
const { makeForm, clone } = require("./client_test.js");

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const f = Number(v);
  return Number.isFinite(f) ? Math.round(f * 1e6) / 1e6 : v;
};
const LINE = ["unit_price", "invoice_qty", "gross", "si_discount", "discount_amount", "tax_percent", "tax_amount", "si_amount", "si_tax_inclusive"];
const HEAD = ["invoice_subtotal", "invoice_total_discount", "invoice_taxes_amount", "invoice_total", "myr_total_amount"];

(async () => {
  const raw = JSON.parse(fs.readFileSync(0, "utf8"));
  const req = typeof raw === "string" ? JSON.parse(raw) : raw;
  const wp = req.workflowparams || req.request_json || req;
  const data = typeof wp.data === "string" ? JSON.parse(wp.data) : wp.data;
  const pass = async (version) => {
    const f = makeForm(version, clone(data), {}, { fmkey: "rows", args: "B" });
    await f.run("SIcalculation", {});
    await f.drain();
    return f.model;
  };
  const flat = (rows) => (rows || []).flatMap((r) => [r].concat(Array.isArray(r.children) ? r.children : []));
  const compare = (a, b, la, lb) => {
    const out = [];
    const ra = flat(a.table_si);
    const rb = flat(b.table_si);
    ra.forEach((r, i) => {
      for (const k of LINE) if (num(r[k]) !== num((rb[i] || {})[k])) out.push(`line ${i + 1} ${k}: ${la} ${r[k]} | ${lb} ${(rb[i] || {})[k]}`);
    });
    for (const k of HEAD) if (num(a[k]) !== num(b[k])) out.push(`header ${k}: ${la} ${a[k]} | ${lb} ${b[k]}`);
    return out;
  };
  const oldModel = await pass("old");
  const newModel = await pass("new");
  const before = flat(data.table_si);
  // decisive: the lean and the live-before calculation agree on this invoice; context: what a fresh pass would change
  const oldVsNew = compare(oldModel, newModel, "v387", "v388");
  const diffs = compare(data, oldModel, "saved", "v387");
  process.stdout.write(JSON.stringify({ lines: before.length, oldVsNew, diffs }));
})().catch((e) => {
  process.stdout.write(JSON.stringify({ error: String(e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e) }));
});
