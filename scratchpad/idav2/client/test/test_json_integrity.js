// JSON integrity: only the intended paths changed (undo them -> the base exactly); every classic handler byte-identical; each
// changed script = its base plus exactly the intended edits (undone here independently of the builder); the verbatim lifts
// (validateForSave, confirmBomVariance, the classic posting code); the client copies of code/shared/ida_common.js; the repo .js
// mirrors = the embedded strings; the shipped state; unique keys and valid event bindings; every new or changed script compiles.
//   node test/test_json_integrity.js
const fs = require("fs");
const path = require("path");
const H = require("./harness");
const { check, same } = H;

const F0 = H.readJSON(H.FILES.formBase);
const F1 = H.readJSON(H.FILES.form);
const L0 = H.readJSON(H.FILES.listBase);
const L1 = H.readJSON(H.FILES.list);
const FON = H.readJSON(H.FILES.formOn);
const LON = H.readJSON(H.FILES.listOn);
const read = (p) => fs.readFileSync(p, "utf8");
const SRC = path.join(__dirname, "../src");
const SHARED = path.join(H.IDAV2, "code/shared/ida_common.js");
const once = (text, a, b, what) => {
  if (text.split(a).length - 1 !== 1) throw new Error("not once (" + what + "): " + a.slice(0, 100));
  return text.replace(a, () => b);
};
// an edit that is not where it should be fails the check instead of ending the run
const safely = (f) => (...a) => {
  try {
    return f(...a);
  } catch (e) {
    return "UNDO FAILED: " + e.message;
  }
};
const newKeys = (doc, base) => doc.config.eventScript.map((e) => e.key).filter((k) => !base.config.eventScript.some((e) => e.key === k));
const CHANGED_FORM = ["mounted", "ida_src_item", "e9ib2r8i"];
const CHANGED_LIST = ["mounted", "q82pv0wg", "ee9v0c1h"];
const READS = read(path.join(SRC, "ida_reads.js")).trimEnd();
const ITEM_FIELDS = "material_code,material_name,material_desc,based_uom,serial_number_management,item_batch_management,batch_number_genaration,table_uom_conversion,table_default_bin";

// the intended edits, undone: [built text, base text] pairs (the mounted block is the one the shipped switches produce)
const undoMounted = safely((func) => {
  const sw = H.shippedState(func);
  const block = H.variant(read(path.join(SRC, "idaV2_mounted_block.js")).replace(/__IDA_V2_SUBMIT__|__IDA_V2_WORKER__/g, "0").replace(/__ASYNC_IDA_ENABLED__/g, "false"),
    { master: sw.switches.IDA_BG_ENABLED }, Object.assign({}, H.OFF_IDS, sw.ids));
  let t = once(func, '    Processing: "processing_status",\n', "", "badge map");
  t = once(t, '        } else if (status === "Processing") {\n          // a background job holds it: read-only, no save or post button\n' +
    '          this.hide(["button_draft", "button_completed", "comp_post_button", "button_post"]);\n          lockComponentsTable();\n', "", "Processing branch");
  t = once(t, block, "", "block");
  return once(t, "\n\n    idaBackgroundView(pageStatus, status);\n", "\n", "call");
});
const undoExplode = safely((func, base) => {
  const fetchOld = base.slice(base.indexOf("    const fetchByIds = async (collection, ids) => {"), base.indexOf("\n\n    const [parentRes, bomRes]")) + "\n";
  let t = once(func, READS + "\n// every Item column this handler reads (.field() also prunes the Item subform joins)\nconst IDA_ITEM_FIELDS = \"" + ITEM_FIELDS + "\";\n\n", "", "reads helper");
  t = once(t, "    const fetchByIds = (collection, ids, fields) => idaReadIds(collection, ids, fields);\n", fetchOld, "fetchByIds");
  t = once(t, 'fetchByIds("item", [itemId], IDA_ITEM_FIELDS),', 'fetchByIds("item", [itemId]),', "BOM item");
  t = once(t, 'await fetchByIds("item", componentIds, IDA_ITEM_FIELDS);', 'await fetchByIds("item", componentIds);', "components");
  t = once(t, '            ])\n            .field("plant_id")\n            .limit(IDA_READ_MAX)\n', "            ])\n", "HUs");
  t = t.split("          .limit(IDA_READ_MAX)\n").join("");
  t = t.replace(/\n( +)\.limit\(1\)\n/g, "\n");
  return t;
});
const undoPost = safely((func) => once(func, read(path.join(SRC, "ida_onClick_post_stored.js")),
  "    const resAI = await db\n      .collection(\"accounting_integration\")\n      .where({ organization_id: organizationId })\n      .get();\n    const aiData = resAI.data[0];\n", "post"));
const undoDelete = safely((func) => {
  let t = once(func, read(path.join(SRC, "ida_list_delete_stored.js")), "", "re-read");
  return once(t, "    // strand both. A Processing one is being completed in the background.\n    const UNDELETABLE = [\"Completed\", \"Fully Posted\", \"Processing\"];\n    if (UNDELETABLE.includes(status)) {\n",
    "    // strand both.\n    if (status === \"Completed\" || status === \"Fully Posted\") {\n", "guard");
});
const undoListPost = safely((func) => {
  let t = once(func, READS + "\n\n", "", "reads helper");
  return once(t, read(path.join(SRC, "ida_list_post_stored.js")),
    "    const resAI = await db\n      .collection(\"accounting_integration\")\n      .where({ organization_id: organizationID })\n      .get();\n\n", "stored");
});

const sameEvents = (name, a, b, changed, added) => {
  const kb = b.config.eventScript.map((e) => e.key);
  const ka = a.config.eventScript.map((e) => e.key);
  check(name + ": events = base + the added ones at the end", same(kb.slice(0, ka.length), ka) && same(kb.slice(ka.length), added), kb.slice(ka.length));
  for (const e of a.config.eventScript) {
    if (changed.indexOf(e.key) >= 0) continue;
    check(name + ": event " + e.name + " byte-identical", JSON.stringify(b.config.eventScript.find((x) => x.key === e.key)) === JSON.stringify(e));
  }
};
// every widget key and event key unique; every widget event bound to an existing event (list actions: their custom events)
const keysAndBindings = (label, doc) => {
  const keys = [];
  const bad = [];
  const ev = new Set(doc.config.eventScript.map((e) => e.key));
  const walk = (n) => {
    if (Array.isArray(n)) n.forEach(walk);
    else if (n && typeof n === "object") {
      if (typeof n.key === "string" && (n.model || n.type)) keys.push(n.key);
      if ((n.model || n.type) && n.events && typeof n.events === "object" && !Array.isArray(n.events)) {
        for (const [k, v] of Object.entries(n.events)) if (typeof v === "string" && v && !ev.has(v)) bad.push([n.key, k, v]);
      }
      if (Array.isArray(n.events)) for (const x of n.events) if (x && x.key && !/^func_/.test(x.name || "") && !ev.has(x.key)) bad.push([n.title, x.key]);
      Object.values(n).forEach(walk);
    }
  };
  walk(doc.list);
  const all = keys.concat(doc.config.eventScript.map((e) => e.key));
  check(label + ": every widget / event key unique", all.length === new Set(all).size, all.filter((k, i) => all.indexOf(k) !== i));
  check(label + ": every event binding names an existing event", bad.length === 0, bad);
  return all;
};

for (const [label, A, B] of [["form (shipped)", F0, F1], ["form (ON preview)", F0, FON]]) {
  const added = newKeys(B, A);
  sameEvents(label, A, B, CHANGED_FORM, added);
  check(label + ": the added events are the two button handlers (js)", same(added.map((k) => H.byKey(B, k).name), ["idaV2_onClick_completed", "idaV2_onClick_completed_post"]) &&
    added.every((k) => H.byKey(B, k).type === "js"));
  for (const n of ["onClick_saveAsCompleted", "onClick_saveAsCompletedPost", "onClick_saveAsDraft", "onConfirm_batchAddItem", "onAfterUpdate_item", "onClick_select_stock"]) {
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
  check(label + ": the three new widgets exist once each", ["processing_status", "ida_v2_job_id", "ida_idem_key"].every(del) && ["processing_status", "ida_v2_job_id", "ida_idem_key"].every((m) => !H.findModel(u.list, m)));
  H.findModel(u.list, "button_completed").events.onClick = "iasvcomp";
  H.findModel(u.list, "comp_post_button").events.onClick = "aymq6q8z";
  const sel = H.findModel(u.list, "item_disassembly_status", "4cjp73ay");
  const anyb = sel.options.datasource.rules.list[0].children[1].children;
  const leaf = anyb[4];
  check(label + ": the status filter gained Processing (dict_key equal, in the any branch, parent 1914242988707749889, a new 13-digit id)",
    same(anyb.map((x) => x.value), ["Draft", "Issued", "Completed", "Fully Posted", "Processing"]) && leaf.prop === "dict_key" && leaf.operator === "equal" && leaf.type === "leaf" &&
    leaf.parentId === 1747862390323 && /^[0-9]{13}$/.test(String(leaf.id)) && JSON.stringify(F0).indexOf(String(leaf.id)) < 0 &&
    sel.options.datasource.rules.list[0].children[0].value === "1914242988707749889");
  anyb.splice(4, 1);
  check(label + ": every other widget byte-identical, config apart from events identical", JSON.stringify(u.list) === JSON.stringify(A.list) &&
    JSON.stringify(Object.assign({}, u.config, { eventScript: [] })) === JSON.stringify(Object.assign({}, A.config, { eventScript: [] })));
  // the new widgets
  const tmpl = H.findModel(A.list, "page_status");
  for (const m of ["ida_v2_job_id", "ida_idem_key"]) {
    const f = H.findModel(B.list, m);
    const t2 = H.clone(tmpl);
    t2.name = f.name;
    t2.key = f.key;
    t2.model = m;
    t2.options.remoteFunc = "func_" + f.key;
    t2.options.remoteOption = "option_" + f.key;
    check(label + ": " + m + " = a clone of page_status (hidden input, dataBind, own remote ids, no events / rules), top level after page_status",
      same(f, t2) && f.type === "input" && f.options.hidden === true && f.options.dataBind === true && same(f.rules, []) &&
      B.list.indexOf(f) === B.list.indexOf(H.findModel(B.list, "page_status")) + (m === "ida_v2_job_id" ? 1 : 2));
  }
  const badge = H.findModel(B.list, "processing_status");
  const flex = H.findModel(B.list, "flex_2det1nd2").list;
  check(label + ": processing_status badge (html, hidden, display only, after fullyposted_status, the list's colours)", badge.type === "html" && badge.options.hidden === true &&
    badge.options.dataBind === false && badge.options.defaultValue.indexOf('<div class="processing-button">Processing</div>') > 0 &&
    badge.options.defaultValue.indexOf("border: 2px solid #FFBB00;") > 0 && flex.indexOf(badge) === flex.indexOf(H.findModel(B.list, "fullyposted_status")) + 1);
  const all = keysAndBindings(label, B);
  const fresh = added.concat(["processing_status", "ida_v2_job_id", "ida_idem_key"].map((m) => H.findModel(B.list, m).key));
  check(label + ": the 5 new keys are 8-char and unique in the form", fresh.every((k) => /^[a-z][a-z0-9]{7}$/.test(k) && all.filter((x) => x === k).length === 1), fresh);
  // the changed scripts: base + exactly the intended edits
  check(label + ": mounted = base + the badge case, the Processing branch, the block and its call", undoMounted(H.byName(B, "mounted").func) === H.byName(A, "mounted").func);
  const e0 = H.byKey(A, "ida_src_item").func;
  check(label + ": onChange_idaSourceItem = base + the chunked / projected / limited reads only", undoExplode(H.byKey(B, "ida_src_item").func, e0) === e0);
  check(label + ": onClick_post = base + the stored-status re-read", undoPost(H.byKey(B, "e9ib2r8i").func) === H.byKey(A, "e9ib2r8i").func);
  for (const k of CHANGED_FORM) check(label + ": " + k + " keeps its name / type", same(Object.assign({}, H.byKey(B, k), { func: "" }), Object.assign({}, H.byKey(A, k), { func: "" })));
}

// ---- the two click handlers, the verbatim lifts, the shared copies
{
  const c = H.byName(F1, "idaV2_onClick_completed").func;
  const p = H.byName(F1, "idaV2_onClick_completed_post").func;
  check("the two click handlers differ only in their name line, IDA_CLASSIC and IDA_BUTTON_POSTS", p ===
    c.replace("// idaV2_onClick_completed - Item Disassembly form, onClick of button_completed ", "// idaV2_onClick_completed_post - Item Disassembly form, onClick of comp_post_button ")
      .replace('const IDA_CLASSIC = "onClick_saveAsCompleted";', 'const IDA_CLASSIC = "onClick_saveAsCompletedPost";').replace("const IDA_BUTTON_POSTS = false;", "const IDA_BUTTON_POSTS = true;"));
  const comp0 = H.byName(F0, "onClick_saveAsCompleted").func;
  const post0 = H.byName(F0, "onClick_saveAsCompletedPost").func;
  const slice = (t, a, b) => t.slice(t.indexOf(a), t.indexOf(b, t.indexOf(a))).trimEnd();
  const vfs = slice(comp0, "// sm_item_balance is the Select Stock dialog: it is not saved", "\n\n// The BOM seeds");
  const bom = slice(comp0, "// The BOM seeds the component table", "\n\n(async () => {");
  check("validateForSave: verbatim from the classic (both classics), once in the handler", vfs.length > 500 && c.split(vfs).length === 2 && post0.indexOf(vfs) > 0);
  const bomEsc = bom.replace("const label = line.item_name || line.item_selection;", "const label = idaEscHtml(line.item_name || line.item_selection);")
    .replace("`Removed: ${sub.sub_material_name || sub.bom_material_code}`", "`Removed: ${idaEscHtml(sub.sub_material_name || sub.bom_material_code)}`")
    .replace("`These components differ from BOM ${bom.parent_mat_bom_version}:<br><br>`", "`These components differ from BOM ${idaEscHtml(bom.parent_mat_bom_version)}:<br><br>`");
  check("confirmBomVariance: the classic's (both classics) with only its 3 names HTML-escaped, once in the handler", bom.length > 2000 && post0.indexOf(bom) > 0 &&
    bomEsc.split("idaEscHtml(").length === 4 && c.split(bomEsc).length === 2 && c.split("const idaEscHtml = (value) =>").length === 2);
  const posting = slice(post0, "const postToAccounting = async", "\n\n// sm_item_balance is the Select Stock dialog");
  const close = slice(post0, "const closeDialog = () => {", "\n\n// this.validate() rejects");
  check("the classic posting code (AGENT id, closeDialog, postToAccounting): verbatim, inside idaClassicPost", c.indexOf("const idaClassicPost = (() => {\n// The accounting agent task queue shared by all V2 post functions.\nconst AGENT_TASK_WORKFLOW_ID = \"2013511169625042946\";\n\n" + close + "\n\n" + posting + "\n\nreturn postToAccounting;\n})();") > 0);
  check("the V2 path validates with validateForSave, never a bare this.validate()", c.indexOf("      await validateForSave();\n") > 0 && c.split("this.validate()").length === 2);
  // the client copies of code/shared/ida_common.js: verbatim statements, the same behaviour, the same texts
  const shared = read(SHARED);
  const mine = read(path.join(SRC, "ida_shared_client.js"));
  for (const n of ["idaS", "idaParseJ", "idaList", "idaJsonList", "idaPicks", "idaPickCount", "idaRecoveryLines", "idaMoveCount", "idaHasHu", "idaPickHasSerial", "IDA_V2_MIN_MOVES"]) {
    const grab = (t) => {
      const start = t.indexOf("const " + n + " =");
      if (start < 0) return null;
      const next = t.slice(start + 1).search(/\n(const |\/\/|if \(typeof module)/);
      return t.slice(start, start + 1 + next);
    };
    check("client copy " + n + " = code/shared/ida_common.js's statement, verbatim, in the handler", grab(mine) !== null && grab(mine) === grab(shared) && c.indexOf(grab(mine)) >= 0, n);
  }
  const lib = require(SHARED);
  const local = new Function(mine + "\nreturn { idaMoveCount, idaHasHu, idaPickHasSerial, idaPickCount, IDA_V2_MIN_MOVES, IDA_TEXT };")();
  const big = "[" + Array.from({ length: 3 }, (_, i) => '{"balance_id":2112748971830149' + (100 + i) + ',"sm_quantity":' + (i ? 1 : 0) + "}").join(",") + "]";
  const samples = [{}, { temp_qty_data: "" }, { temp_qty_data: "[bad" }, { temp_qty_data: big }, { temp_qty_data: [{ sm_quantity: 3 }, { sm_quantity: "0" }] },
    { temp_qty_data: '[{"sm_quantity":2,"handling_unit_id":"H1"}]' }, { temp_qty_data: '[{"sm_quantity":2,"serial_number":" "}]' }, { temp_qty_data: '[{"sm_quantity":0,"serial_number":"S"}]' },
    { temp_hu_data: "[{}]" }, { temp_hu_data: "[]" }, { table_hu: [] }, { table_hu: [{ handling_unit_id: "H" }] }, { table_hu: "[]" }];
  const lineSets = [undefined, [], [{ item_selection: "A" }, { item_selection: "" }, { item_selection: null }, null, { item_selection: " " }, { item_selection: 5 }]];
  check("client copies behave as the module (moves, HU, serial) on edge cases", samples.every((h) => lineSets.every((l) => local.idaMoveCount(h, l) === lib.idaMoveCount(h, l)) &&
    local.idaHasHu(h) === lib.idaHasHu(h) && local.idaPickHasSerial(h) === lib.idaPickHasSerial(h)) && local.IDA_V2_MIN_MOVES === lib.IDA_V2_MIN_MOVES);
  check("client texts = IDA_TEXT's (busy, queueFailed, postLater)", ["busy", "queueFailed", "postLater"].every((k) => local.IDA_TEXT[k] === lib.IDA_TEXT[k]) && Object.keys(local.IDA_TEXT).length === 3);
  // CONTRACT section 3: the key's hash16 = idaFpHash (code/shared/fingerprint.js)
  const fp = require(path.join(H.IDAV2, "code/shared/fingerprint.js"));
  const hash16 = new Function(c.slice(c.indexOf("const hash16 = (text) => {"), c.indexOf("const orgOf =")) + "\nreturn hash16;")();
  check("the idempotency key's hash16 = idaFpHash", ["", "a", "Item Disassembly 汉字", JSON.stringify({ x: [1, "三"] }), "x".repeat(100000)].every((t) => hash16(t) === fp.idaFpHash(t)));
}

// ---- the list
for (const [label, A, B] of [["list (shipped)", L0, L1], ["list (ON preview)", L0, LON]]) {
  sameEvents(label, A, B, CHANGED_LIST, []);
  const u = H.clone(B);
  u.list[0].options.customProps.rowActions[1].hidden = A.list[0].options.customProps.rowActions[1].hidden;
  check(label + ": every widget byte-identical but the Edit action's hidden", JSON.stringify(u.list) === JSON.stringify(A.list) &&
    JSON.stringify(Object.assign({}, u.config, { eventScript: [] })) === JSON.stringify(Object.assign({}, A.config, { eventScript: [] })));
  check(label + ": mounted became a js event", H.byName(B, "mounted").type === "js" && H.byName(A, "mounted").func === "");
  check(label + ": Delete = base + the Processing refusal and the stored-status re-read", undoDelete(H.byKey(B, "q82pv0wg").func) === H.byKey(A, "q82pv0wg").func);
  check(label + ": bulk Post = base + the read helper and the stored-status re-read", undoListPost(H.byKey(B, "ee9v0c1h").func) === H.byKey(A, "ee9v0c1h").func);
  keysAndBindings(label, B);
}

// ---- the repo mirrors are the embedded strings
const OUT = H.OUT;
const mirrors = [["idaV2_onClick_completed.js", H.byName(F1, "idaV2_onClick_completed").func], ["idaV2_onClick_completed_post.js", H.byName(F1, "idaV2_onClick_completed_post").func],
  ["idaForm_mounted.js", H.byName(F1, "mounted").func], ["idaForm_onChange_idaSourceItem.js", H.byKey(F1, "ida_src_item").func], ["idaForm_onClick_post.js", H.byKey(F1, "e9ib2r8i").func],
  ["idaList_mounted.js", H.byName(L1, "mounted").func], ["idaList_delete.js", H.byKey(L1, "q82pv0wg").func], ["idaList_onItemDisassemblyPostfunc_ee9v0c1h.js", H.byKey(L1, "ee9v0c1h").func]];
for (const [f, text] of mirrors) check("mirror " + f, read(path.join(OUT, f)) === text);

// ---- shipped OFF with the ids.json ids; ON preview ON with the same ids; no placeholder, no platform token; every script compiles
const scripts = (F, L) => [["idaV2_onClick_completed", H.byName(F, "idaV2_onClick_completed").func], ["idaV2_onClick_completed_post", H.byName(F, "idaV2_onClick_completed_post").func],
  ["form mounted", H.byName(F, "mounted").func], ["onChange_idaSourceItem", H.byKey(F, "ida_src_item").func], ["form onClick_post", H.byKey(F, "e9ib2r8i").func],
  ["list mounted", H.byName(L, "mounted").func], ["list delete", H.byKey(L, "q82pv0wg").func], ["list bulk Post", H.byKey(L, "ee9v0c1h").func]];
for (const [label, F, L, on] of [["shipped", F1, L1, H.EXPECT_ON], ["ON preview", FON, LON, true]]) {
  for (const [name, code] of scripts(F, L)) {
    let ok = true;
    try {
      H.compile(H.world(), code, false);
    } catch (e) {
      ok = false;
    }
    check(label + " " + name + ": compiles, no placeholder left, no {{...}} token, no marker", ok && !/__[A-Z][A-Z0-9_]*__/.test(code) && code.indexOf("{{") < 0 && code.indexOf("/*@@") < 0);
    const st = H.shippedState(code);
    if (Object.keys(st.switches).length) {
      check(label + " " + name + ": every switch " + (on ? "ON" : "OFF"), Object.values(st.switches).every((v) => v === on), st.switches);
      check(label + " " + name + ": the workflow ids are ids.json's", Object.keys(st.ids).length > 0 && Object.entries(st.ids).every(([k, v]) => v === H.IDS[k]), st.ids);
    }
    const want = (process.env.IDA_EXPECT_ACTIONS || "COMPLETE,COMPLETE_POST").split(",");
    if (st.actions) check(label + " " + name + ": actions on = " + want.join("+") + " (the master switch decides)", ["COMPLETE", "COMPLETE_POST"].every((a) => st.actions[a] === want.includes(a)), st.actions);
  }
}
H.done("JSON integrity");
