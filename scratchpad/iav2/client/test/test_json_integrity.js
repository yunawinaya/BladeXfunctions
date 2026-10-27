// JSON integrity: only the intended paths changed (undo them -> the base exactly); every classic handler byte-identical; each
// changed script = its base plus exactly the intended insertions (or, for the four labour handlers, the pinned base text
// re-derived in client/src); the verbatim lifts (shared helpers, confirmBomVariance, the classic posting code); the repo .js
// mirrors = the embedded strings; the shipped state (OFF, ids.json ids); every new or changed script compiles.
//   node test/test_json_integrity.js
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const H = require("./harness");
const { check, same } = H;

const F0 = H.readJSON(H.FILES.formBase);
const F1 = H.readJSON(H.FILES.form);
const L0 = H.readJSON(H.FILES.listBase);
const L1 = H.readJSON(H.FILES.list);
const FON = H.readJSON(H.FILES.formOn);
const LON = H.readJSON(H.FILES.listOn);
const read = (p) => fs.readFileSync(p, "utf8");
const OUT = H.OUT;
const SRC = path.join(__dirname, "../src");
const SHARED = path.join(H.IAV2, "code/shared/ia_common.js");
const sha = (t) => crypto.createHash("sha256").update(t, "utf8").digest("hex");
const strip = (text, parts) => parts.reduce((t, [a, b]) => {
  if (t.split(a).length - 1 !== 1) throw new Error("not once: " + a.slice(0, 80));
  return t.replace(a, b);
}, text);
const newKeys = (doc, base) => doc.config.eventScript.map((e) => e.key).filter((k) => !base.config.eventScript.some((e) => e.key === k));
const CHANGED_FORM = ["mounted", "wv07g9xe", "iacqty01", "iaitem01", "iabcnf01", "evhzkk8e", "e9ib2r8i"];
const CHANGED_LIST = ["mounted", "oh26x9gl", "8r9xuzc4", "z4qy8mae", "iaprcf01"];

const sameEvents = (name, a, b, changed, added) => {
  const kb = b.config.eventScript.map((e) => e.key);
  const ka = a.config.eventScript.map((e) => e.key);
  check(name + ": events = base + the added ones at the end", same(kb.slice(0, ka.length), ka) && same(kb.slice(ka.length), added), kb.slice(ka.length));
  for (const e of a.config.eventScript) {
    if (changed.indexOf(e.key) >= 0) continue;
    check(name + ": event " + e.name + " byte-identical", JSON.stringify(b.config.eventScript.find((x) => x.key === e.key)) === JSON.stringify(e));
  }
};

for (const [label, A, B] of [["form (shipped)", F0, F1], ["form (ON preview)", F0, FON]]) {
  const added = newKeys(B, A);
  sameEvents(label, A, B, CHANGED_FORM, added);
  check(label + ": the added events are the two button handlers and onRowRemove_item", same(added.map((k) => H.byKey(B, k).name), ["iaV2_onClick_completed", "iaV2_onClick_completed_post", "onRowRemove_item"]) &&
    added.every((k) => H.byKey(B, k).type === "js"));
  for (const n of ["onClick_saveAsCompleted", "onClick_saveAsCompletedPost", "onClick_saveAsDraft"]) {
    check(label + ": classic " + n + " byte-identical under its key", JSON.stringify(H.byName(B, n)) === JSON.stringify(H.byName(A, n)));
  }
  // the widgets: undo the intended changes -> the base list exactly
  const u = H.clone(B);
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
  check(label + ": the three new widgets exist once each", ["processing_status", "ia_v2_job_id", "ia_idem_key"].every(del) && ["processing_status", "ia_v2_job_id", "ia_idem_key"].every((m) => !H.findModel(u.list, m)));
  H.findModel(u.list, "button_completed").events.onClick = "iasvcomp";
  H.findModel(u.list, "comp_post_button").events.onClick = "aymq6q8z";
  H.findModel(u.list, "stock_movement", "tlm8ve69").events.onRowRemove = "";
  const anyb = H.findModel(u.list, "item_assembly_status", "4cjp73ay").options.datasource.rules.list[0].children[1].children;
  check(label + ": the status filter gained Processing (dict_key equal, parent 1914242988707749889, a new 13-digit id)", same(anyb.map((x) => x.value), ["Draft", "Issued", "Completed", "Fully Posted", "Processing"]) &&
    anyb[4].prop === "dict_key" && anyb[4].operator === "equal" && /^[0-9]{13}$/.test(String(anyb[4].id)) && JSON.stringify(F0).indexOf(String(anyb[4].id)) < 0 &&
    H.findModel(u.list, "item_assembly_status", "4cjp73ay").options.datasource.rules.list[0].children[0].value === "1914242988707749889");
  anyb.splice(4, 1);
  check(label + ": every other widget byte-identical, config apart from events identical", JSON.stringify(u.list) === JSON.stringify(A.list) &&
    JSON.stringify(Object.assign({}, u.config, { eventScript: [] })) === JSON.stringify(Object.assign({}, A.config, { eventScript: [] })));
  // the new widgets
  const tmpl = H.findModel(A.list, "page_status");
  for (const m of ["ia_v2_job_id", "ia_idem_key"]) {
    const f = H.findModel(B.list, m);
    check(label + ": " + m + " = a clone of page_status (hidden input, dataBind, own remote ids, no events / rules), top level after page_status",
      f.type === "input" && f.options.hidden === true && f.options.dataBind === true && f.options.remoteFunc === "func_" + f.key && f.options.remoteOption === "option_" + f.key &&
      same(f.events, tmpl.events) && same(f.rules, []) && B.list.indexOf(f) === B.list.indexOf(H.findModel(B.list, "page_status")) + (m === "ia_v2_job_id" ? 1 : 2));
  }
  const badge = H.findModel(B.list, "processing_status");
  const flex = H.findModel(B.list, "flex_2det1nd2").list;
  check(label + ": processing_status badge (html, hidden, display only, after fullyposted_status)", badge.type === "html" && badge.options.hidden === true && badge.options.dataBind === false &&
    badge.options.defaultValue.indexOf('<div class="processing-button">Processing</div>') > 0 && flex.indexOf(badge) === flex.indexOf(H.findModel(B.list, "fullyposted_status")) + 1);
  // every key unique, the new ones 8-char
  const keys = [];
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if (typeof n.key === "string" && (n.model || n.type)) keys.push(n.key);
      Object.values(n).forEach(walk);
    }
  };
  walk(B.list);
  const all = keys.concat(B.config.eventScript.map((e) => e.key));
  const fresh = added.concat(["processing_status", "ia_v2_job_id", "ia_idem_key"].map((m) => H.findModel(B.list, m).key));
  check(label + ": the 6 new keys are 8-char and unique in the form", fresh.every((k) => /^[a-z][a-z0-9]{7}$/.test(k) && all.filter((x) => x === k).length === 1), fresh);
  // mounted = base + the badge case, the Processing branch, the block and one call
  const block = read(path.join(SRC, "iaV2_mounted_block.js"));
  const sw = H.shippedState(H.byName(B, "mounted").func);
  const builtBlock = H.variant(block.replace(/__IA_V2_SUBMIT__|__IA_V2_WORKER__|__IA_REVERT_V2_SUBMIT__|__IA_REVERT_V2_WORKER__/g, "0").replace(/__ASYNC_IA_ENABLED__|__ASYNC_IA_REVERT_ENABLED__/g, "false"),
    { master: sw.switches.IA_BG_ENABLED, revert: sw.switches.IA_BG_REVERT_ENABLED }, Object.assign({}, H.OFF_IDS, sw.ids));
  check(label + ": mounted = base + the Processing case, branch, block and call", strip(H.byName(B, "mounted").func, [
    ['    Processing: "processing_status",\n', ""],
    ['        } else if (status === "Processing") {\n          // a background job holds it: read-only, no save or post button\n          this.hide(["button_draft", "button_completed", "comp_post_button", "button_post"]);\n          lockComponentsTable();\n', ""],
    [builtBlock, ""], ["\n\n    iaBackgroundView(pageStatus, status);\n", "\n"]]) === H.byName(A, "mounted").func);
  // Transfer Stock: the guard is the only change
  const s0 = H.byKey(A, "evhzkk8e");
  const s1 = H.byKey(B, "evhzkk8e");
  const guard = s1.rules[1].options.func.slice(s1.rules[1].options.func.indexOf("    // a non-stock (labour / overhead) line takes its quantity as typed"));
  const guardText = guard.slice(0, guard.indexOf("    }\n") + 6);
  check(label + ": onClick_select_stock = base + the non-stock guard after the item read; its openDialog rule unchanged", same(s0.rules[0], s1.rules[0]) &&
    strip(s1.rules[1].options.func, [[guardText, ""]]) === s0.rules[1].options.func && s1.rules[1].options.func.indexOf("    if (!itemData) return;\n" + guardText) > 0 &&
    same(Object.assign({}, s1, { rules: [] }), Object.assign({}, s0, { rules: [] })));
  // the four labour handlers and the Post (review R3): the pinned base text, re-derived in client/src
  const pins = { wv07g9xe: "52c4527773c6a79a4f95badc3536181f205612796fc1c755962936d37291f898", iacqty01: "91b9609f7f9a4ed5dd95e556d8204e177035cad0aa459a6655b58eca381977c2",
    iaitem01: "ed57fa028c06cbf1a429042bdb9d87e3f6e37366acf8bdd3379c5c5705ffbe8e", iabcnf01: "57b7f0b31f43402c1aa92520efb0b9ddc32de0e10c0164764bcf8c1e98d7c0ca",
    e9ib2r8i: "8290f02013414e027e8d15396309c984b052399d2b17a3141610397c8d693654" };
  const files = { wv07g9xe: "ia_onChange_assembledItem.js", iacqty01: "ia_onChange_componentQty.js", iaitem01: "ia_onAfterUpdate_item.js", iabcnf01: "ia_onConfirm_batchAddItem.js",
    e9ib2r8i: "ia_onClick_post.js" };
  for (const [k, pin] of Object.entries(pins)) {
    const e0 = H.byKey(A, k);
    const e1 = H.byKey(B, k);
    const expected = read(path.join(SRC, files[k])).replace("/*@@IA_READS@@*/", read(path.join(SRC, "ia_reads.js")).trimEnd()).replace("/*@@IA_NONSTOCK@@*/", read(path.join(SRC, "ia_nonstock.js")).trimEnd());
    check(label + ": " + e0.name + " = client/src/" + files[k] + " with the read + non-stock helpers (base sha pinned)", sha(e0.func) === pin && e1.func === expected &&
      same(Object.assign({}, e1, { func: "" }), Object.assign({}, e0, { func: "" })));
  }
}

// ---- the two click handlers, the verbatim lifts
{
  const c = H.byName(F1, "iaV2_onClick_completed").func;
  const p = H.byName(F1, "iaV2_onClick_completed_post").func;
  check("the two click handlers differ only in their name line, IA_CLASSIC and IA_BUTTON_POSTS", p ===
    c.replace("// iaV2_onClick_completed - Item Assembly form, onClick of button_completed.", "// iaV2_onClick_completed_post - Item Assembly form, onClick of comp_post_button.")
      .replace('const IA_CLASSIC = "onClick_saveAsCompleted";', 'const IA_CLASSIC = "onClick_saveAsCompletedPost";').replace("const IA_BUTTON_POSTS = false;", "const IA_BUTTON_POSTS = true;"));
  const comp0 = H.byName(F0, "onClick_saveAsCompleted").func;
  const post0 = H.byName(F0, "onClick_saveAsCompletedPost").func;
  const bom = comp0.slice(comp0.indexOf("// The BOM seeds the component table"), comp0.indexOf("\n(async () => {")).trimEnd();
  check("confirmBomVariance: verbatim from the classic, once", c.split(bom).length === 2 && post0.indexOf(bom) > 0);
  const posting = post0.slice(post0.indexOf("const postToAccounting = async"), post0.indexOf("\n// The BOM seeds")).trimEnd();
  const close = post0.slice(post0.indexOf("const closeDialog = () => {"), post0.indexOf("\nconst findFieldMessage")).trimEnd();
  check("the classic posting code (AGENT id, closeDialog, postToAccounting): verbatim, inside iaClassicPost", c.indexOf("const iaClassicPost = (() => {\n// The accounting agent task queue shared by all V2 post functions.\nconst AGENT_TASK_WORKFLOW_ID = \"2013511169625042946\";\n\n" + close + "\n\n" + posting + "\n\nreturn postToAccounting;\n})();") > 0);
  // the shared helpers: verbatim statements of code/shared/ia_common.js, behaving as the module
  const shared = read(SHARED);
  for (const n of ["iaS", "iaParseJ", "iaList", "iaJsonList", "iaPicks", "iaPickCount", "iaLineHasHu", "IA_V2_MIN_PICKS", "IA_TEXT"]) {
    const start = shared.indexOf("const " + n + " =");
    const next = shared.slice(start + 1).search(/\n(const |\/\/|if \(typeof module)/);
    const stmt = shared.slice(start, start + 1 + next);
    check("shared " + n + ": verbatim in the handler", start >= 0 && c.indexOf(stmt) >= 0, n);
  }
  const lib = require(SHARED);
  const local = new Function(c.slice(c.indexOf("const iaS ="), c.indexOf("const iaOn =")) + "\nreturn { iaPickCount, iaLineHasHu, IA_TEXT };")();
  const samples = [[], [{ temp_qty_data: "[{\"sm_quantity\":1},{\"sm_quantity\":0},{\"sm_quantity\":\"2\"}]" }], [{ temp_qty_data: "[bad" }], [{ temp_qty_data: [{ sm_quantity: 3 }] }, { temp_hu_data: "[{}]" }]];
  check("shared helpers in the handler = the module's results", samples.every((s) => local.iaPickCount(s) === lib.iaPickCount(s) && s.every((l) => local.iaLineHasHu(l) === lib.iaLineHasHu(l))) &&
    local.IA_TEXT.postLater === lib.IA_TEXT.postLater && same(Object.keys(local.IA_TEXT), Object.keys(lib.IA_TEXT)) &&
    Object.keys(lib.IA_TEXT).every((k) => String(local.IA_TEXT[k]) === String(lib.IA_TEXT[k])));
}

// ---- the list
for (const [label, A, B] of [["list (shipped)", L0, L1], ["list (ON preview)", L0, LON]]) {
  // RES-01 MIN-03 (BA 10-22): one handler added at the end, Retry Reservation = client/src/ia_list_retryReservation.js with the IA_HOLD id
  // RES-01 Cancel from the list (user 10-22): a second handler, the bulk Cancel = client/src/ia_list_cancel.js with the IA_HOLD id
  sameEvents(label, A, B, CHANGED_LIST, ["iarsrv01", "iacncl01"]);
  const rr = H.byKey(B, "iarsrv01");
  const HOLD = String(require("../../../iasc/ids.json").IA_HOLD);
  check(label + ": the added handler is Retry Reservation, its source with the IA_HOLD id", !!rr && rr.name === "onItemAssemblyRetryReservation" && rr.type === "js" &&
    rr.func === read(path.join(SRC, "ia_list_retryReservation.js")).replace("__IA_HOLD__", HOLD));
  const cn = H.byKey(B, "iacncl01");
  check(label + ": the second added handler is the bulk Cancel, its source with the IA_HOLD id", !!cn && cn.name === "onItemAssemblyCancel" && cn.type === "js" &&
    cn.func === read(path.join(SRC, "ia_list_cancel.js")).replace("__IA_HOLD__", HOLD));
  const u = H.clone(B);
  u.list[0].options.customProps.rowActions[1].hidden = A.list[0].options.customProps.rowActions[1].hidden;
  // RES-01 Created (BA, 10-22): the status column gains one Created badge right after the Draft one (undone here)
  const sc = u.list[0].options.customProps.columns.find((c) => c.name === "item_assembly_status");
  const created = (sc.configCustom.content.match(/ <div v-if="scope\.value==='Created'"[^>]*>\{\{scope\.value\}\}<\/div>/) || [""])[0];
  check(label + ": the status column gains one Created badge, after the Draft one", !!created && sc.configCustom.content.split(created).length === 2 &&
    sc.configCustom.content.indexOf("{{scope.value}}</div>" + created) >= 0);
  sc.configCustom.content = sc.configCustom.content.replace(created, "");
  // RES-01 MIN-03: the Reservation column right after Status and the Retry Reservation button right after Revert Completed (undone here)
  const ucp = u.list[0].options.customProps;
  const rc = ucp.columns.findIndex((c) => c.name === "material_hold_status");
  const rt = ucp.toolbar.findIndex((x) => x.title === "Retry Reservation");
  check(label + ": one Reservation column after Status, one Retry Reservation button after Revert Completed", rc === 2 && ucp.columns[1].name === "item_assembly_status" &&
    ucp.columns.filter((c) => c.name === "material_hold_status").length === 1 && rt > 0 && ucp.toolbar[rt - 1].title === "Revert Completed" &&
    ucp.toolbar.filter((x) => x.title === "Retry Reservation").length === 1);
  ucp.columns.splice(rc, 1);
  // the Cancel button right after Retry Reservation (undone with it)
  check(label + ": one Cancel button right after Retry Reservation", ucp.toolbar.filter((x) => x.title === "Cancel").length === 1 && ucp.toolbar[rt + 1].title === "Cancel");
  ucp.toolbar.splice(rt, 2);
  // the product owner's designer save (list v29, 10-22 20:22): the designer's defaults appended to Post, two customProps flags (undone here)
  const DESIGNER = { styleType: "Link", btnIcon: "", hidden: "", disabled: "", eventsPrint: [], segmented_fzl86zm3: "center", dialog_top: "" };
  const post = ucp.toolbar[rt];
  const tail = (o, n) => JSON.stringify(Object.keys(o).slice(-n).map((k) => [k, o[k]]));
  check(label + ": list v29 kept: Post ends with the designer's defaults, customProps ends with is_no_drag / is_no_copy false", post.title === "Post" &&
    tail(post, 7) === JSON.stringify(Object.entries(DESIGNER)) && tail(ucp, 2) === JSON.stringify([["is_no_drag", false], ["is_no_copy", false]]), [post, tail(ucp, 2)]);
  Object.keys(DESIGNER).forEach((k) => delete post[k]);
  delete ucp.is_no_drag;
  delete ucp.is_no_copy;
  check(label + ": every widget byte-identical but the Edit action's hidden (and the Created badge, the Reservation column, the Retry button)", JSON.stringify(u.list) === JSON.stringify(A.list) &&
    JSON.stringify(Object.assign({}, u.config, { eventScript: [] })) === JSON.stringify(Object.assign({}, A.config, { eventScript: [] })));
  check(label + ": mounted became a js event", H.byName(B, "mounted").type === "js" && H.byName(A, "mounted").func === "");
}

// ---- the list's bulk Post (review R3): the pinned base text, re-derived in client/src with the read helpers
for (const [label, B] of [["list (shipped)", L1], ["list (ON preview)", LON]]) {
  const e0 = H.byKey(L0, "z4qy8mae");
  const e1 = H.byKey(B, "z4qy8mae");
  const expected = read(path.join(SRC, "ia_list_post.js")).replace("/*@@IA_READS@@*/", read(path.join(SRC, "ia_reads.js")).trimEnd());
  check(label + ": bulk Post = client/src/ia_list_post.js with the read helpers (base sha pinned)", sha(e0.func) === "f09db8a2564ab4b8f82fcb6b2bee52f32eb2f36d676ac24f7c6ded50e49eb0b6" &&
    e1.func === expected && same(Object.assign({}, e1, { func: "" }), Object.assign({}, e0, { func: "" })));
}

// ---- the dev admin's v33 / v34 edits (Assembled Item picker Description column, inventory_category required) are kept
{
  const V32 = H.readJSON(path.join(H.IAV2, "base/ia_form_v32.json"));
  const pick = (doc) => H.findModel(doc.list, "item_id", "jpngim4m").options.columns;
  const cat = (doc) => H.findModel(doc.list, "inventory_category", "iainvcat");
  for (const [label, B] of [["shipped", F1], ["ON preview", FON]]) {
    check(label + ": the v34 picker columns (3, with Description) and the required inventory_category kept", pick(B).length === 3 && same(pick(B), pick(F0)) && pick(V32).length === 2 &&
      cat(B).options.required === true && same(cat(B).rules, [{ required: true, message: "" }]) && same(cat(B), cat(F0)));
  }
}

// ---- the list's label print (IA output split, plan 10-27): the base text plus exactly its three insertions (the split rows helper, a split's
// rows instead of the header batch, one line per row); undone -> the base
for (const [label, B] of [["list (shipped)", L1], ["list (ON preview)", LON]]) {
  const undo = [["// dialog_print_template > onConfirm.\n// IA output split (plan 10-27): the rows of a split receipt that carry a batch, from the json column (or its text)\n",
    "// dialog_print_template > onConfirm.\n"],
  ["      // a split receipt: one label line per row that has a batch (its batch, its quantity)\n      const splitRows = iaLabelRows(ia.output_split);\n", ""],
  ["if (!splitRows.length && (!batch || batch === \"-\")) continue;", "if (!batch || batch === \"-\") continue;"],
  ["      for (const part of splitRows.length ? splitRows : [{ batch: batch, qty: ia.item_qty }]) {\n        lines.push({\n          ia_id: id,\n          ia_number: ia.stock_movement_no,\n" +
    "          item_id: itemId,\n          item_name: ia.item_name,\n          batch_no: part.batch,\n          assembled_quantity: part.qty,\n          quantity: 1\n        });\n      }\n",
  "      lines.push({\n        ia_id: id,\n        ia_number: ia.stock_movement_no,\n        item_id: itemId,\n        item_name: ia.item_name,\n        batch_no: batch,\n" +
    "        assembled_quantity: ia.item_qty,\n        quantity: 1\n      });\n"]];
  let text = H.byKey(B, "iaprcf01").func;
  let ok = true;
  try {
    text = strip(text, undo);
    const helper = text.slice(text.indexOf("const iaLabelRows = (v) => {"), text.indexOf("};\n", text.indexOf("const iaLabelRows = (v) => {")) + 3);
    text = text.replace(helper, "");
  } catch (e) {
    ok = String(e.message);
  }
  check(label + ": label print = the base handler plus the split's three insertions", ok === true && text === H.byKey(L0, "iaprcf01").func, ok);
}
// ---- the repo mirrors are the embedded strings
const mirrors = [["iaV2_onClick_completed.js", H.byName(F1, "iaV2_onClick_completed").func], ["iaV2_onClick_completed_post.js", H.byName(F1, "iaV2_onClick_completed_post").func],
  ["iaForm_mounted.js", H.byName(F1, "mounted").func], ["iaForm_onChange_assembledItem.js", H.byKey(F1, "wv07g9xe").func], ["iaForm_onChange_componentQty.js", H.byKey(F1, "iacqty01").func],
  ["iaForm_onAfterUpdate_item.js", H.byKey(F1, "iaitem01").func], ["iaForm_onConfirm_batchAddItem.js", H.byKey(F1, "iabcnf01").func],
  ["iaForm_onClick_select_stock.js", H.byKey(F1, "evhzkk8e").rules[1].options.func], ["iaForm_onRowRemove_item.js", H.byName(F1, "onRowRemove_item").func],
  ["iaList_mounted.js", H.byName(L1, "mounted").func], ["iaList_delete.js", H.byKey(L1, "oh26x9gl").func], ["iaList_IArevertCompleted.js", H.byKey(L1, "8r9xuzc4").func],
  ["iaForm_onClick_post.js", H.byKey(F1, "e9ib2r8i").func], ["iaList_onItemAssemblyPostfunc_z4qy8mae.js", H.byKey(L1, "z4qy8mae").func],
  ["iaList_onItemAssemblyPrintTemplateConfirm.js", H.byKey(L1, "iaprcf01").func]];
for (const [f, text] of mirrors) check("mirror " + f, read(path.join(OUT, f)) === text);

// ---- shipped OFF with the ids.json ids; ON preview ON with the same ids; no placeholder, no platform token; every script compiles
const scripts = (F, L) => [["iaV2_onClick_completed", H.byName(F, "iaV2_onClick_completed").func, false], ["iaV2_onClick_completed_post", H.byName(F, "iaV2_onClick_completed_post").func, false],
  ["form mounted", H.byName(F, "mounted").func, false], ["onChange_assembledItem", H.byKey(F, "wv07g9xe").func, false], ["onChange_componentQty", H.byKey(F, "iacqty01").func, false],
  ["onAfterUpdate_item", H.byKey(F, "iaitem01").func, false], ["onConfirm_batchAddItem", H.byKey(F, "iabcnf01").func, false], ["onClick_select_stock", H.sourceOf(H.byKey(F, "evhzkk8e")), true],
  ["onRowRemove_item", H.byName(F, "onRowRemove_item").func, false], ["list mounted", H.byName(L, "mounted").func, false], ["list delete", H.byKey(L, "oh26x9gl").func, false],
  ["list IArevertCompleted", H.byKey(L, "8r9xuzc4").func, false], ["form onClick_post", H.byKey(F, "e9ib2r8i").func, false], ["list bulk Post", H.byKey(L, "z4qy8mae").func, false],
  ["list label print", H.byKey(L, "iaprcf01").func, false]];
for (const [label, F, L, on] of [["shipped", F1, L1, H.EXPECT_ON], ["ON preview", FON, LON, true]]) {
  for (const [name, code, isRule] of scripts(F, L)) {
    let ok = true;
    try {
      H.compile(H.world(), code, isRule);
    } catch (e) {
      ok = false;
    }
    check(label + " " + name + ": compiles, no placeholder left, no {{...}} token, no marker", ok && !/__[A-Z][A-Z0-9_]*__/.test(code) && code.indexOf("{{") < 0 && code.indexOf("/*@@") < 0);
    const st = H.shippedState(code);
    if (Object.keys(st.switches).length) {
      check(label + " " + name + ": every switch " + (on ? "ON" : "OFF"), Object.values(st.switches).every((v) => v === on), st.switches);
      check(label + " " + name + ": the workflow ids are ids.json's", Object.keys(st.ids).length > 0 && Object.entries(st.ids).every(([k, v]) => v === H.IDS[k]), st.ids);
    }
    if (st.actions) check(label + " " + name + ": both actions on (the master switch decides)", st.actions.COMPLETE === true && st.actions.COMPLETE_POST === true);
  }
}
H.done("JSON integrity");
