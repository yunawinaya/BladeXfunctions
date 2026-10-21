// JSON integrity: only the intended paths changed; every classic handler byte-identical; each changed script = its base plus
// exactly the intended insertions; the repo .js mirrors = the embedded strings; shipped ON with the ids.json ids; the schema.
//   node test/test_json_integrity.js
const fs = require("fs");
const path = require("path");
const H = require("./harness");
const { check, same } = H;

const SA0 = H.readJSON(H.FILES.saFormBase);
const SA1 = H.readJSON(H.FILES.saForm);
const SAL0 = H.readJSON(H.FILES.saListBase);
const SAL1 = H.readJSON(H.FILES.saList);
const SC0 = H.readJSON(H.FILES.scFormBase);
const SC1 = H.readJSON(H.FILES.scForm);
const SCL0 = H.readJSON(H.FILES.scListBase);
const SCL1 = H.readJSON(H.FILES.scList);
const read = (p) => fs.readFileSync(p, "utf8");
const SAD = path.join(H.ROOT, "Stock Adjustment/AsyncV2");
const SCD = path.join(H.ROOT, "Stock Count/AsyncV2");
const SRC = path.join(__dirname, "../src");
const ids = H.readJSON(path.join(H.SAV2, "ids.json"));

// every eventScript entry not listed is byte-identical to the base, in the same order; listed ones are checked below
const sameEvents = (name, a, b, changed, added) => {
  const kb = b.config.eventScript.map((e) => e.key);
  const ka = a.config.eventScript.map((e) => e.key);
  check(name + ": events = base + the added ones at the end", same(kb.slice(0, ka.length), ka) && same(kb.slice(ka.length), added), { added: kb.slice(ka.length) });
  for (const e of a.config.eventScript) {
    if (changed.indexOf(e.key) >= 0) continue;
    const f = b.config.eventScript.find((x) => x.key === e.key);
    check(name + ": event " + e.name + " byte-identical", JSON.stringify(f) === JSON.stringify(e));
  }
};
const strip = (text, parts) => parts.reduce((t, [a, b]) => {
  if (t.split(a).length - 1 !== 1) throw new Error("not once: " + a.slice(0, 60));
  return t.replace(a, b);
}, text);
const newKeys = (doc, base) => doc.config.eventScript.map((e) => e.key).filter((k) => !base.config.eventScript.some((e) => e.key === k));

// ---- SA form
const saAdded = newKeys(SA1, SA0);
sameEvents("SA form", SA0, SA1, ["mounted", "uk4w8v1h"], saAdded);
for (const n of ["onClick_completed", "onClick_completed_post", "onClick_posted", "onClick_draft"]) check("SA form: " + n + " still registered under its key", H.byName(SA1, n).key === H.byName(SA0, n).key);
check("SA form: classic onClick_completed (rule 9o86bjii) byte-identical", JSON.stringify(H.byName(SA1, "onClick_completed")) === JSON.stringify(H.byName(SA0, "onClick_completed")));
const block = read(path.join(SAD, "saV2_mounted_block.js"));
const m1 = H.byName(SA1, "mounted").func;
check("SA form: mounted = base + the badge cases, the Post rule, the block and one call", strip(m1, [
  ['    case "Processing":\n      this.display(["processing_status"]);\n      break;\n    case "Cancelled":\n      this.display(["cancel_status"]);\n      break;\n', ""],
  ['    if (\n      stockAdjustmentStatus === "Fully Posted" ||\n      stockAdjustmentStatus === "Processing" ||\n      stockAdjustmentStatus === "Cancelled"\n    ) {\n', '    if (stockAdjustmentStatus === "Fully Posted") {\n'],
  [block, ""], ["\n\n    saBackgroundView(pageStatus, data);\n", "\n"]]) === H.byName(SA0, "mounted").func);
const draft0 = H.byName(SA0, "onClick_draft");
const draft1 = H.byName(SA1, "onClick_draft");
const snippet = read(path.join(SRC, "sa_draft_reread.js"));
check("SA form: onClick_draft = base + the re-read at the Edit branch only", strip(draft1.rules[0].options.func, [[snippet, ""]]) === draft0.rules[0].options.func &&
  JSON.stringify(Object.assign({}, draft1, { rules: [Object.assign({}, draft1.rules[0], { options: Object.assign({}, draft1.rules[0].options, { func: "" }) })] })) ===
  JSON.stringify(Object.assign({}, draft0, { rules: [Object.assign({}, draft0.rules[0], { options: Object.assign({}, draft0.rules[0].options, { func: "" }) })] })) &&
  draft1.rules[0].options.func.indexOf('      } else if (page_status === "Edit") {\n' + snippet) > 0);
// the widgets: undo the intended changes -> the base list exactly
{
  const u = H.clone(SA1);
  const del = (model) => {
    const walk = (n) => {
      if (Array.isArray(n)) {
        const i = n.findIndex((x) => x && x.model === model);
        if (i >= 0) return (n.splice(i, 1), true);
        return n.some(walk);
      }
      return n && typeof n === "object" ? Object.values(n).some(walk) : false;
    };
    return walk(u.list);
  };
  check("SA form: the four new widgets exist once each", ["processing_status", "cancel_status", "sa_v2_job_id", "sa_idem_key"].every(del));
  H.findModel(u.list, "button_completed").events.onClick = "9o86bjii";
  H.findModel(u.list, "button_completed_posted").events.onClick = "otmqv4xj";
  const anyb = H.findModel(u.list, "stock_adjustment_status").options.datasource.rules.list[0].children[1].children;
  check("SA form: the status filter gained Processing + Cancelled (parent 1914242988707749889)", same(anyb.map((x) => x.value), ["Draft", "Completed", "Fully Posted", "Processing", "Cancelled"]) &&
    H.findModel(u.list, "stock_adjustment_status").options.datasource.rules.list[0].children[0].value === "1914242988707749889");
  anyb.splice(3, 2);
  check("SA form: every other widget byte-identical", JSON.stringify(u.list) === JSON.stringify(SA0.list) && JSON.stringify(Object.assign({}, u.config, { eventScript: [] })) === JSON.stringify(Object.assign({}, SA0.config, { eventScript: [] })));
  const job = H.findModel(SA1.list, "sa_v2_job_id");
  const idem = H.findModel(SA1.list, "sa_idem_key");
  const tmpl = H.findModel(SA0.list, "previous_status");
  check("SA form: the hidden fields are clones of previous_status (hidden input, dataBind, own remote ids, no events)", [job, idem].every((f) => f.type === "input" && f.options.hidden === true && f.options.dataBind === true &&
    f.options.remoteFunc === "func_" + f.key && f.options.remoteOption === "option_" + f.key && same(f.events, tmpl.events) && same(f.rules, [])));
  for (const [model, label] of [["processing_status", "Processing"], ["cancel_status", "Cancelled"]]) {
    const b = H.findModel(SA1.list, model);
    check("SA form: badge " + model, b.type === "html" && b.options.hidden === true && b.options.dataBind === false && b.options.defaultValue.indexOf(">" + label + "</div>") > 0);
  }
}
// every key in the built form unique, the new keys 8 chars
{
  const keys = [];
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if (typeof n.key === "string" && (n.model || n.type)) keys.push(n.key);
      Object.values(n).forEach(walk);
    }
  };
  walk(SA1.list);
  const all = keys.concat(SA1.config.eventScript.map((e) => e.key));
  const fresh = saAdded.concat(["processing_status", "cancel_status", "sa_v2_job_id", "sa_idem_key"].map((m) => H.findModel(SA1.list, m).key));
  check("SA form: the 6 new keys are 8-char and unique in the form", fresh.every((k) => /^[a-z][a-z0-9]{7}$/.test(k) && all.filter((x) => x === k).length === 1), fresh);
}

// ---- SC form
const scAdded = newKeys(SC1, SC0);
sameEvents("SC form", SC0, SC1, ["mounted"], scAdded);
check("SC form: classic onButtonReviewClick byte-identical", JSON.stringify(H.byName(SC1, "onButtonReviewClick")) === JSON.stringify(H.byName(SC0, "onButtonReviewClick")));
const review = H.byName(SC1, "scV2_onButtonReviewClick").func;
const rblock = review.slice(0, review.indexOf("// Stock Count — Save Review (workflow trigger)"));
check("SC form: scV2_onButtonReviewClick = the V2 block + the classic body with ONE inserted line", rblock.length > 0 && strip(review.slice(rblock.length), [
  ["    if (SC_V2_ON && (await scReviewV2(data, items, allApproved, approved, createAdjustment))) return;\n\n", ""]]) === H.byName(SC0, "onButtonReviewClick").func);
const scBlock = read(path.join(SCD, "scV2_mounted_block.js"));
check("SC form: mounted = base + the block + one call", strip(H.byName(SC1, "mounted").func, [[scBlock, ""], ["\n\n  scBackgroundView(pageStatus);\n", "\n"]]) === H.byName(SC0, "mounted").func);
{
  const u = H.clone(SC1);
  H.findModel(u.list, "button_review").events.onClick = "ma2d8htp";
  check("SC form: every widget byte-identical but the Review button's binding", JSON.stringify(u.list) === JSON.stringify(SC0.list) &&
    JSON.stringify(Object.assign({}, u.config, { eventScript: [] })) === JSON.stringify(Object.assign({}, SC0.config, { eventScript: [] })));
}

// ---- lists: only mounted changed (+ the SA list's two status columns, checked in test_lists.js)
for (const [name, a, b] of [["SA list", SAL0, SAL1], ["SC list", SCL0, SCL1]]) {
  sameEvents(name, a, b, ["mounted"], []);
  check(name + ": config apart from events identical", JSON.stringify(Object.assign({}, a.config, { eventScript: [] })) === JSON.stringify(Object.assign({}, b.config, { eventScript: [] })));
}
{
  const u = H.clone(SAL1);
  u.list[0].tabs[0].list[0].options.customProps.columns[4].configCustom.content = SAL0.list[0].tabs[0].list[0].options.customProps.columns[4].configCustom.content;
  u.list[0].tabs[1].list[0].options.customProps.columns[1].configCustom.content = SAL0.list[0].tabs[1].list[0].options.customProps.columns[1].configCustom.content;
  check("SA list: every widget byte-identical but the two status columns' content", JSON.stringify(u.list) === JSON.stringify(SAL0.list));
  check("SC list: the widgets byte-identical", JSON.stringify(SCL1.list) === JSON.stringify(SCL0.list));
}

// ---- the repo mirrors are the embedded strings
check("mirror saV2_onClick_completed.js", read(path.join(SAD, "saV2_onClick_completed.js")) === H.byName(SA1, "saV2_onClick_completed").func);
check("mirror saV2_mounted_block.js (inside mounted)", H.byName(SA1, "mounted").func.indexOf(block) > 0);
check("mirror saV2_list_mounted_kick.js", read(path.join(SAD, "saV2_list_mounted_kick.js")) === H.byName(SAL1, "mounted").func);
check("mirror scV2_onButtonReviewClick.js", read(path.join(SCD, "scV2_onButtonReviewClick.js")) === review);
check("mirror scV2_mounted_block.js (inside mounted)", H.byName(SC1, "mounted").func.indexOf(scBlock) > 0);
check("mirror scV2_list_mounted_kick.js", read(path.join(SCD, "scV2_list_mounted_kick.js")) === H.byName(SCL1, "mounted").func);
check("the two SA handlers differ only in their name line and SA_CLASSIC", H.byName(SA1, "saV2_onClick_completed_post").func ===
  H.byName(SA1, "saV2_onClick_completed").func.replace("// saV2_onClick_completed - Stock Adjustment form, onClick of button_completed.", "// saV2_onClick_completed_post - Stock Adjustment form, onClick of button_completed_posted.")
    .replace('const SA_CLASSIC = "onClick_completed";', 'const SA_CLASSIC = "onClick_completed_post";'));

// ---- shipped ON with the ids from ids.json, no placeholder, no platform token, every new script compiles
const newScripts = [["saV2_onClick_completed", H.byName(SA1, "saV2_onClick_completed").func], ["saV2_onClick_completed_post", H.byName(SA1, "saV2_onClick_completed_post").func],
  ["SA mounted", H.byName(SA1, "mounted").func], ["SA draft", draft1.rules[0].options.func], ["SA list mounted", H.byName(SAL1, "mounted").func], ["scV2_onButtonReviewClick", review],
  ["SC mounted", H.byName(SC1, "mounted").func], ["SC list mounted", H.byName(SCL1, "mounted").func]];
for (const [name, code] of newScripts) {
  let ok = true;
  try {
    H.compile(H.world(), code, name === "SA draft");
  } catch (e) {
    ok = false;
  }
  check(name + ": compiles, no placeholder left, no {{...}} token", ok && !/__[A-Z][A-Z0-9_]*__/.test(code) && code.indexOf("{{") < 0);
  if (name !== "SA draft") {
    const state = H.shippedState(code);
    check(name + ": shipped with every switch ON", state !== null && state.on === true && !/ = false;/.test((code.match(/const (ASYNC_SA_ENABLED|ASYNC_SC_REVIEW_ENABLED|SA_BG_ENABLED|SCR_BG_ENABLED) = (true|false);/g) || []).join(" ")), state);
  }
}
const idsIn = (code) => (code.match(/(SUBMIT|STATUS|WORKER)(: | = )"([0-9]+)"/g) || []);
for (const [name, code] of newScripts.filter((x) => x[0] !== "SA draft")) {
  check(name + ": the workflow ids are ids.json's (" + ids.SA_V2_SUBMIT + "/" + ids.SA_V2_WORKER + ")", idsIn(code).length > 0 &&
    idsIn(code).every((x) => x.endsWith('"' + (/WORKER/.test(x) ? ids.SA_V2_WORKER : ids.SA_V2_SUBMIT) + '"')), idsIn(code));
}

// ---- the expected schema (the form publish re-derives schema_json; this is what it should come to)
{
  const s0 = H.readJSON(path.join(H.SAV2, "base/schema_stock_adjustment.json"));
  const s1 = H.readJSON(path.join(__dirname, "../out/schema_stock_adjustment.json"));
  const p = s1.properties;
  const k = Object.keys(p);
  check("schema: sa_v2_job_id / sa_idem_key right after previous_status, string input, persisted, keyed as the widgets", k.indexOf("sa_v2_job_id") === k.indexOf("previous_status") + 1 &&
    k.indexOf("sa_idem_key") === k.indexOf("previous_status") + 2 && ["sa_v2_job_id", "sa_idem_key"].every((m) => p[m].bsonType === "string" && p[m].persistField === true &&
      p[m].component.name === "input" && p[m].key === H.findModel(SA1.list, m).key));
  check("schema: the two badges, not persisted", ["processing_status", "cancel_status"].every((m) => p[m].persistField === false && p[m].component.name === "html" && p[m].key === H.findModel(SA1.list, m).key));
  check("schema: the status select's rules = the form's", same(p.stock_adjustment_status.component.rules, H.findModel(SA1.list, "stock_adjustment_status").options.datasource.rules.list));
  const u = H.clone(s1);
  ["sa_v2_job_id", "sa_idem_key", "processing_status", "cancel_status"].forEach((m) => delete u.properties[m]);
  u.properties.stock_adjustment_status.component.rules[0].children[1].children.splice(3, 2);
  check("schema: nothing else changed", JSON.stringify(u) === JSON.stringify(s0));
}
H.done("JSON integrity");
