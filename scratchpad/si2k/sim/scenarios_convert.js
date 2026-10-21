// Synthetic paths through GD_Convert_SI / SO_Convert_SI, old vs lean, against the same world: every end code, cash orders, bundles
// (nested, and flat rows pointing back through parent_id), the deduct-return setup, the auto path's cap, single vs multiple, draft.
// Usage: node scenarios_convert.js <GD old> <GD new> <SO old> <SO new>
"use strict";
const fs = require("fs");
const { Engine } = require("./engine_cv.js");
const { CvWorld, clone, keep } = require("./world_cv.js");

const [gdOldF, gdNewF, soOldF, soNewF] = process.argv.slice(2);
const rd = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const GD_OLD = rd(gdOldF), GD_NEW = rd(gdNewF), SO_OLD = rd(soOldF), SO_NEW = rd(soNewF);

const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined && v[k] !== null) o[k] = canon(v[k]);
    return o;
  }
  return v;
};
const J = (v) => JSON.stringify(canon(v)).replace(/"sales_invoice_date":"[^"]*"/g, '"sales_invoice_date":"D"');

let n = 0;
const id = () => String(2200000000000000000n + BigInt(++n) * 4096n);
const ORG = "2061000000000000001", PLANT = "2061000000000000002", PLANT2 = "2061000000000000003", CUST = "2062000000000000001", CUST2 = "2062000000000000002";
const UOM = "2063000000000000001", CAT = "2064000000000000001", TERM = "2065000000000000001", REP = "2066000000000000001", AREA = "2067000000000000001";

const soLine = (o) => Object.assign({ id: id(), so_quantity: 10, so_item_price: 12.5, so_discount: 0, so_discount_amount: 0, so_tax_amount: 7.5,
  so_amount: 132.5, so_gross: 125, so_discount_uom: "Amount", invoice_qty: 0, sales_person_id: REP, so_item_uom: UOM, so_desc: "desc", payment_term_id: TERM,
  so_tax_inclusive: 0, so_tax_percentage: 6, item_name: "2068000000000000001", item_id: "ITEM-A", customer_id: CUST, area_id: AREA,
  item_category_id: CAT, custom_fields: { a: 1 }, further_description: "fd", line_remark_1: "r1" }, o || {});
const soHead = (o) => Object.assign({ id: id(), so_no: "SO-" + n, so_status: "Issued", so_type: "Credit", customer_name: CUST, organization_id: ORG,
  plant_name: PLANT, so_currency: "MYR", exchange_rate: 1, exchange_rate_currency: "MYR", cust_billing_address: "B", cust_shipping_address: "S",
  so_sales_person: REP, so_payment_term: TERM, so_description: "d", so_area_id: AREA, acc_integration_type: "No Accounting", customer_credit_limit: 1000,
  overdue_limit: 0, outstanding_balance: 5, overdue_inv_total_amount: 0, is_accurate: 1, so_total_gross: 125, so_total_discount: 0, so_total_tax: 7.5,
  so_total: 132.5, myr_total_amount: 132.5, so_tnc: "tnc", billing_address_name: "BN", shipping_address_city: "KL", project_id: "2069000000000000001" }, o || {});
const gdLine = (sl, so, o) => Object.assign({ id: id(), so_line_item_id: sl.id, line_so_id: so.id, gd_qty: 4, good_delivery_uom_id: UOM, more_desc: "m",
  item_category_id: CAT, material_name: "Item A", material_id: "2068000000000000001", customer_id: CUST, area_id: AREA, custom_fields: { b: 2 },
  line_remark_2: "x" }, o || {});
const gdHead = (sos, o) => Object.assign({ id: id(), delivery_no: "GD-" + n, gd_status: "Completed", so_id: sos.map((s) => s.id),
  so_no: sos.map((s) => s.so_no).join(", "), plant_id: PLANT, customer_name: CUST, organization_id: ORG, currency_code: "MYR",
  gd_billing_address: "B", gd_shipping_address: "S", sales_person: [REP], document_description: "dd", gd_area_id: AREA,
  acc_integration_type: "No Accounting", customer_credit_limit: 1000, overdue_limit: 0, outstanding_balance: 5, is_accurate: 1, order_tnc: "t",
  order_remark3: "r3", billing_address_city: "PJ", project_id: "2069000000000000001" }, o || {});

const run = (doc, w, params) => {
  try {
    const r = new Engine(doc, w, {}).run(clone(params));
    return { out: r.outcome, saved: w.saved };
  } catch (e) {
    return { out: { crash: String(e.message).split("\n")[0] }, saved: w.saved };
  }
};

// a world with these documents; flatOld: the old reads hand bundle items over as flat rows (parent_id), not under `children`
const world = (gds, sos, opts) => () => {
  opts = opts || {};
  const w = new CvWorld({ tenantId: "000000", kind: opts.kind, recorded: opts.recorded || {} });
  for (const s of sos) w.so[s.h.id] = { header: clone(s.h), lines: clone(s.l) };
  for (const g of gds) w.gd[g.h.id] = { header: clone(g.h), lines: clone(g.l) };
  if (opts.flatOld) {
    const flat = (store, lineKey, pick) => (a) => {
      const rows = (Array.isArray(a.id) ? a.id : [a.id]).map(String).filter((x) => store[x] && (!pick || pick(store[x], a))).sort()
        .map((x) => Object.assign(keep(store[x].header), { [lineKey]: store[x].lines.map(keep) }));
      return { total: rows.length, count: rows.length, data: rows };
    };
    if (opts.kind === "SO") {
      w.read.search_node_AHtHRmqi = flat(w.so, "table_so");
      w.read.search_node_bOF3TVA2 = flat(w.so, "table_so", (d) => d.header.so_status !== "Draft");
    } else {
      w.read.search_node_AHtHRmqi = flat(w.gd, "table_gd");
      w.read.search_node_bOF3TVA2 = flat(w.gd, "table_gd", (d, a) => d.header.gd_status === a.gd_status);
      w.read.search_node_Ivek0yYx = flat(w.so, "table_so");
    }
  }
  return w;
};

const results = [];
const scenario = (name, kind, make, params, expect) => {
  const [o, nw] = kind === "GD" ? [GD_OLD, GD_NEW] : [SO_OLD, SO_NEW];
  const a = run(o, make(), params);
  const b = run(nw, make(), params);
  const same = J(a.out) === J(b.out) && J(a.saved) === J(b.saved);
  const code = a.out.crash ? "crash" : a.out.code + (a.out.data && a.out.data.skipped ? "/skipped" : "");
  const ok = same && (!expect || expect(a));
  results.push({ name, ok, same, code, invoices: a.saved.length, lines: a.saved.map((s) => (s.table_si || []).length + "+" +
    (s.table_si || []).reduce((t, l) => t + ((l.children || []).length), 0)).join(",") });
};

// ---------------------------------------------------------------- GD_Convert_SI
{
  const so = soHead(), l1 = soLine(), l2 = soLine({ so_quantity: 5, invoice_qty: 3 });
  const S = { h: so, l: [l1, l2].map((x) => Object.assign({}, x)) };
  const g = gdHead([so]), gl = [gdLine(l1, so), gdLine(l2, so, { gd_qty: 4 })];
  const G = { h: g, l: gl };
  const P = { ids: [g.id], convert_to: "completed", is_multiple: "multiple", filter_draft: "no" };
  scenario("GD plain convert", "GD", world([G], [S]), P, (a) => a.out.code === 200 && a.saved.length === 1);
  scenario("GD draft convert", "GD", world([G], [S]), Object.assign({}, P, { convert_to: "draft", auto_pi: "skip" }), (a) => a.saved[0].si_status === "Draft");
  scenario("GD auto: cap at the order line's remainder", "GD", world([G], [S]), Object.assign({}, P, { source: "auto" }),
    (a) => a.saved[0].table_si.some((l) => l.invoice_qty === "2.00000000"));
  const full = Object.assign({}, l1, { invoice_qty: 10 });
  scenario("GD auto: fully invoiced line skipped", "GD", world([{ h: g, l: [gdLine(full, so, { id: gl[0].id })] }], [{ h: so, l: [full] }]),
    Object.assign({}, P, { source: "auto" }), (a) => a.out.data && a.out.data.skipped);
  const g2 = gdHead([so], { gd_status: "Created" });
  const G2 = { h: g2, l: [gdLine(l1, so)] };
  scenario("GD 401: a Created GD", "GD", world([G, G2], [S]), Object.assign({}, P, { ids: [g.id, g2.id] }), (a) => a.out.code === 401);
  scenario("GD auto: a Created GD filtered out, not 401", "GD", world([G, G2], [S]), Object.assign({}, P, { ids: [g.id, g2.id], source: "auto" }),
    (a) => a.out.code === 200 && a.saved.length === 1);
  scenario("GD auto: only a Created GD -> nothing to invoice", "GD", world([G2], [S]), Object.assign({}, P, { ids: [g2.id], source: "auto" }),
    (a) => a.out.data && a.out.data.skipped);
  const dup = { search_node_d39M3W6h: { total: 1, count: 1, data: [{ id: id(), gd_id: [g.id], si_status: "Completed" }] } };
  scenario("GD 402: already invoiced", "GD", world([G], [S], { recorded: dup }), P, (a) => a.out.code === 402);
  scenario("GD auto 402 -> 200 skipped", "GD", world([G], [S], { recorded: dup }), Object.assign({}, P, { source: "auto" }), (a) => a.out.data && a.out.data.skipped);
  const so2 = soHead({ customer_name: CUST2 }), l3 = soLine({ customer_id: CUST2 });
  const S2 = { h: so2, l: [l3] };
  const g3 = gdHead([so2], { customer_name: CUST2 });
  const G3 = { h: g3, l: [gdLine(l3, so2)] };
  scenario("GD 403: single, two customers", "GD", world([G, G3], [S, S2]), Object.assign({}, P, { ids: [g.id, g3.id], is_multiple: "single" }), (a) => a.out.code === 403);
  const g4 = gdHead([so], { plant_id: PLANT2 });
  const G4 = { h: g4, l: [gdLine(l1, so)] };
  scenario("GD 403: single, two plants", "GD", world([G, G4], [S]), Object.assign({}, P, { ids: [g.id, g4.id], is_multiple: "single" }), (a) => a.out.code === 403);
  scenario("GD multiple: two customers, two invoices", "GD", world([G, G3], [S, S2]), Object.assign({}, P, { ids: [g.id, g3.id] }), (a) => a.saved.length === 2);
  const g5 = gdHead([so]);
  const G5 = { h: g5, l: [gdLine(l1, so, { gd_qty: 1 })] };
  scenario("GD single: two GDs, one invoice", "GD", world([G, G5], [S]), Object.assign({}, P, { ids: [g.id, g5.id], is_multiple: "single" }),
    (a) => a.saved.length === 1 && a.saved[0].table_si.length === 3);
  const desc = { h: gdHead([so]), l: [] };
  desc.l = [gdLine({ id: "" }, so, { so_line_item_id: undefined, material_id: undefined })];
  scenario("GD nothing to invoice (description row only)", "GD", world([desc], [S]), Object.assign({}, P, { ids: [desc.h.id] }), (a) => a.out.data && a.out.data.skipped);
  // cash
  const cso = soHead({ so_type: "Cash" }), cl = soLine();
  const C = { h: cso, l: [cl] };
  const cg = gdHead([cso]);
  scenario("GD cash-only GD left out", "GD", world([{ h: cg, l: [gdLine(cl, cso)] }], [C]), Object.assign({}, P, { ids: [cg.id] }), (a) => a.out.data && a.out.data.skipped);
  const mg = gdHead([so, cso]);
  scenario("GD mixed cash + credit: cash lines and order dropped", "GD", world([{ h: mg, l: [gdLine(l1, so), gdLine(cl, cso)] }], [S, C]),
    Object.assign({}, P, { ids: [mg.id] }), (a) => a.saved.length === 1 && a.saved[0].so_id.length === 1 && a.saved[0].table_si.length === 1);
  // bundles
  const bso = soHead(), bl = soLine({ item_name: undefined, item_id: undefined, item_bundle_id: "2070000000000000001", so_item_price: 100, so_amount: 100, so_tax_amount: 0 });
  const bi1 = soLine({ parent_id: bl.id, item_bundle_id: "2070000000000000001", so_quantity: 20 }), bi2 = soLine({ parent_id: bl.id, item_bundle_id: "2070000000000000001", so_quantity: 30 });
  const BS = { h: bso, l: [bl, bi1, bi2] };
  const bg = gdHead([bso]);
  const bgl = gdLine(bl, bso, { material_id: undefined, item_bundle_id: "2070000000000000001", gd_qty: 10 });
  const BG = { h: bg, l: [bgl, gdLine(bi1, bso, { parent_id: bgl.id, item_bundle_id: "2070000000000000001", gd_qty: 20 }),
    gdLine(bi2, bso, { parent_id: bgl.id, item_bundle_id: "2070000000000000001", gd_qty: 30 })] };
  const BP = Object.assign({}, P, { ids: [bg.id] });
  scenario("GD bundle (nested read)", "GD", world([BG], [BS]), BP, (a) => a.saved[0].table_si.length === 1 && a.saved[0].table_si[0].children.length === 2);
  scenario("GD bundle (flat rows in the old read)", "GD", world([BG], [BS], { flatOld: true }), BP, (a) => a.saved[0].table_si[0].children.length === 2);
  scenario("GD bundle, auto, capped", "GD", world([BG], [{ h: bso, l: [Object.assign({}, bl, { invoice_qty: 4 }), bi1, bi2] }]), Object.assign({}, BP, { source: "auto" }),
    (a) => a.saved[0].table_si[0].invoice_qty === "6.00000000");
  // deduct-return
  const sr = { get_node_srSetup1: { count: 1, data: { return_billing_method: "Deduct from Invoice" } } };
  const rl = soLine({ return_qty: 2 });
  const rS = { h: so, l: [rl] };
  const rg = gdHead([so]);
  scenario("GD deduct-return", "GD", world([{ h: rg, l: [gdLine(rl, so, { gd_qty: 4, return_qty: 1 })] }], [rS], { recorded: sr }), Object.assign({}, P, { ids: [rg.id] }),
    (a) => a.saved[0].table_si[0].invoice_qty === "3.00000000");
  scenario("GD deduct-return: fully returned -> nothing", "GD", world([{ h: rg, l: [gdLine(rl, so, { gd_qty: 4, return_qty: 4 })] }], [rS], { recorded: sr }),
    Object.assign({}, P, { ids: [rg.id] }), (a) => a.out.data && a.out.data.skipped);
  scenario("GD auto_pi confirmed", "GD", world([G], [S]), Object.assign({}, P, { auto_pi: "confirmed" }), (a) => a.saved[0].auto_pi_confirmed === true);
}

// ---------------------------------------------------------------- SO_Convert_SI
{
  const so = soHead(), l1 = soLine(), l2 = soLine({ so_quantity: 3 });
  const S = { h: so, l: [l1, l2] };
  const P = { so_ids: [so.id], convert_to: "completed", is_multiple: "multiple", filter_draft: "no" };
  const W = (sos, opts) => world([], sos, Object.assign({ kind: "SO" }, opts || {}));
  scenario("SO plain convert", "SO", W([S]), P, (a) => a.out.code === 200 && a.saved.length === 1 && a.saved[0].table_si.length === 2);
  scenario("SO draft convert", "SO", W([S]), Object.assign({}, P, { convert_to: "draft" }), (a) => a.saved[0].si_status === "Draft");
  const dso = soHead({ so_status: "Draft" });
  const D = { h: dso, l: [soLine()] };
  scenario("SO 401: a Draft SO", "SO", W([S, D]), Object.assign({}, P, { so_ids: [so.id, dso.id] }), (a) => a.out.code === 401);
  scenario("SO Draft filtered out (proceed)", "SO", W([S, D]), Object.assign({}, P, { so_ids: [so.id, dso.id], filter_draft: "yes" }), (a) => a.saved.length === 1);
  scenario("SO only Draft, proceed -> crash (v56 too)", "SO", W([D]), Object.assign({}, P, { so_ids: [dso.id], filter_draft: "yes" }), (a) => a.out.crash);
  const dup = { search_node_d39M3W6h: { total: 1, count: 1, data: [{ id: id(), so_id: [so.id] }] } };
  scenario("SO 402: already invoiced", "SO", W([S], { recorded: dup }), P, (a) => a.out.code === 402);
  const so2 = soHead({ customer_name: CUST2 });
  const S2 = { h: so2, l: [soLine()] };
  scenario("SO 405: single, two customers", "SO", W([S, S2]), Object.assign({}, P, { so_ids: [so.id, so2.id], is_multiple: "single" }), (a) => a.out.code === 405);
  const so3 = soHead({ plant_name: PLANT2 });
  const S3 = { h: so3, l: [soLine(), soLine()] };
  scenario("SO single, two plants -> organization", "SO", W([S, S3]), Object.assign({}, P, { so_ids: [so.id, so3.id], is_multiple: "single" }),
    (a) => a.saved.length === 1 && a.saved[0].plant_id === ORG && a.saved[0].table_si.length === 4);
  scenario("SO single, plant given", "SO", W([S, S3]), Object.assign({}, P, { so_ids: [so.id, so3.id], is_multiple: "single", plant_id: PLANT2 }), (a) => a.saved[0].plant_id === PLANT2);
  scenario("SO multiple, two invoices", "SO", W([S, S2]), Object.assign({}, P, { so_ids: [so.id, so2.id] }), (a) => a.saved.length === 2);
  const bso = soHead(), bl = soLine({ item_name: undefined, item_id: undefined, item_bundle_id: "2070000000000000001", so_discount: undefined });
  const bi = [soLine({ parent_id: bl.id, item_bundle_id: "2070000000000000001" }), soLine({ parent_id: bl.id, item_bundle_id: "2070000000000000001" })];
  const B = { h: bso, l: [bl].concat(bi) };
  scenario("SO bundle (nested read)", "SO", W([B]), Object.assign({}, P, { so_ids: [bso.id] }), (a) => a.saved[0].table_si[0].children.length === 2);
  scenario("SO bundle (flat rows in the old read)", "SO", W([B], { flatOld: true }), Object.assign({}, P, { so_ids: [bso.id] }), (a) => a.saved[0].table_si[0].children.length === 2);
  const sr = { get_node_srSetup1: { count: 1, data: { return_billing_method: "Deduct from Invoice" } } };
  const rS = { h: so, l: [soLine({ return_qty: 4 }), soLine({ so_quantity: 2, return_qty: 2 })] };
  scenario("SO deduct-return (fully returned line dropped)", "SO", W([rS], { recorded: sr }), P, (a) => a.saved[0].table_si.length === 1 && a.saved[0].table_si[0].invoice_qty === "6.00000000");
  scenario("SO auto_pi skip", "SO", W([S]), Object.assign({}, P, { auto_pi: "skip" }), (a) => a.saved[0].auto_pi_skip === true);
}

let bad = 0;
for (const r of results) {
  if (!r.ok) bad++;
  console.log("%s %s -> %s, %d invoice(s) [%s]%s", r.ok ? "ok  " : "FAIL", r.name.padEnd(56), r.code, r.invoices, r.lines, r.same ? "" : "  OLD != LEAN");
}
console.log("%d scenarios, %d failed", results.length, bad);
