// The Location Transfer form patch (scratchpad/iatr/lot_client/patch_lot_ui.py) against the live v113 (base/lot_form_v113.json):
//   phase fields: the 12 request fields (hidden, data-bound, fresh keys, no events, the column types the workflows write) + "Requested" in
//   the status filter, and NOTHING else - the output minus them is v113 widget for widget, every event script unchanged.
//   node scratchpad/iatr/test/test_lot_ui.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const IATR = path.join(__dirname, "..");

let n = 0;
let fails = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eq = (label, got, want) => {
  n++;
  if (same(got, want)) return;
  fails++;
  console.log("FAIL " + label + "\n  got  " + JSON.stringify(got).slice(0, 1200) + "\n  want " + JSON.stringify(want).slice(0, 1200));
};
const canon = (x) => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.keys(x).sort().reduce((o, k) => Object.assign(o, { [k]: canon(x[k]) }), {}) : x);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iatr-ui-"));
const b = spawnSync("python3", [path.join(IATR, "lot_client", "patch_lot_ui.py"), "--write"], { env: Object.assign({}, process.env, { IATR_UI_OUT: dir }), encoding: "utf8" });
if (b.status !== 0) throw new Error(b.stderr.slice(-800));
const OUT = JSON.parse(fs.readFileSync(path.join(dir, "fields", "LOTform.json"), "utf8"));
const BASE = JSON.parse(fs.readFileSync(path.join(IATR, "base", "lot_form_v113.json"), "utf8"));
// the 12 request fields (10-28) + the 4 of reserved requests (RESERVED_REQUEST_PLAN.md Task 3: the replacement link, the line defects)
const ADDED = { transfer_purpose: "input", source_ia_id: "input", source_ia_no: "input", source_ia_fp: "input", source_ia_rev: "input", requested_by: "input",
  requested_at: "input", replaces_id: "input", request_log: "textarea", required_date: "date", source_ia_line_id: "input", source_ref_key: "input",
  replacement_for_id: "input", defect_reason: "input", defect_qty: "number", defect_detail: "textarea" };

const all = (doc) => {
  const out = [];
  const walk = (x) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") {
      if (typeof x.model === "string" && x.type) out.push(x);
      Object.values(x).forEach(walk);
    }
  };
  walk(doc.list);
  return out;
};
const got = all(OUT).filter((w) => w.model in ADDED);
eq("fields: the 16, once each", got.map((w) => w.model).sort(), Object.keys(ADDED).sort());
eq("fields: their types (input = varchar, textarea = longtext, date = datetime, number = decimal)", got.map((w) => [w.model, w.type]).sort(), Object.entries(ADDED).sort());
eq("fields: hidden and data-bound", got.filter((w) => w.options.hidden !== true || w.options.dataBind !== true).map((w) => w.model), []);
eq("fields: no event bound", got.filter((w) => w.events && Object.values(w.events).some((v) => v)).map((w) => w.model), []);
eq("fields: their names", got.filter((w) => !w.name).map((w) => w.model), []);
const baseKeys = new Set(all(BASE).map((w) => w.key));
eq("fields: fresh 8-character keys, never one v113 holds", got.filter((w) => !/^[a-z][a-z0-9]{7}$/.test(w.key) || baseKeys.has(w.key)).map((w) => w.model), []);
const lineModels = (doc) => all(doc).filter((w) => w.model === "stock_movement")[0].tableColumns.map((c) => c.model);
eq("fields: the five line fields appended last to the lines table", lineModels(OUT).slice(-5), ["source_ia_line_id", "source_ref_key", "defect_reason", "defect_qty",
  "defect_detail"]);
const leafs = (doc) => all(doc).filter((w) => w.model === "stock_movement_status")[0].options.datasource.rules.list[0].children[1].children.map((c) => c.value);
eq("status: Requested added to its dictionary filter", leafs(OUT), leafs(BASE).concat(["Requested"]));

// everything else is v113
const strip = JSON.parse(JSON.stringify(OUT));
const drop = (x) => {
  if (Array.isArray(x)) {
    for (let i = x.length - 1; i >= 0; i--) if (x[i] && typeof x[i] === "object" && x[i].model in ADDED && x[i].type) x.splice(i, 1);
    x.forEach(drop);
  } else if (x && typeof x === "object") Object.values(x).forEach(drop);
};
drop(strip.list);
all(strip).filter((w) => w.model === "stock_movement_status")[0].options.datasource.rules.list[0].children[1].children.pop();
eq("everything else: v113 widget for widget", JSON.stringify(canon(strip.list)) === JSON.stringify(canon(BASE.list)), true);
eq("every event script and the config: v113", JSON.stringify(canon(OUT.config)) === JSON.stringify(canon(BASE.config)), true);

console.log((fails ? "FAILED " + fails : "ok") + " - " + n + " checks");
process.exit(fails ? 1 : 0);
