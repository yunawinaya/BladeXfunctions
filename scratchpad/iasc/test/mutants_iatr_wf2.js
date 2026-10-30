// node scratchpad/iasc/test/mutants_iatr_wf2.js - each mutant of the BUILT IA_SAVE v16 / IA_V2_SUBMIT v8 (transfer requests from a reserved
// IA, classic/patch_v16.py + submit/patch_v8.py; the repo's Item Assembly & BOM/SmallCycle files) must make test_v16_sim.js / sim_submit_v8.js
// fail. A text mutant replaces its JSON-escaped anchor ("all" = every inlined copy); a function mutant edits the parsed workflow.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const IASC = path.join(__dirname, "..");
const REPO = path.join(IASC, "..", "..");
const BUILT = path.join(REPO, "Item Assembly & BOM", "SmallCycle");
const J = (s) => JSON.stringify(s).slice(1, -1);
// v15 / v7 built once (the tests' bases)
const base = (script, file) => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "iatr-wf2-base-"));
  const r = spawnSync("python3", [path.join(IASC, script), "--write"], { env: Object.assign({}, process.env, { IASC_OUT: out }), encoding: "utf8" });
  if (r.status !== 0) throw new Error(script + ": " + r.stderr.slice(-800));
  return path.join(out, file);
};
const TARGET = {
  SAVE: { file: "IA_SAVE.json", env: "IA_V16", test: "test_v16_sim.js", base: { IA_V15: base("classic/patch_v15.py", "IA_SAVE.json") } },
  SUBMIT: { file: "IA_V2_SUBMIT.json", env: "IA_V8", test: "sim_submit_v8.js", base: { IA_V7: base("submit/patch_v7.py", "IA_V2_SUBMIT.json") } },
};
const node = (doc, id) => {
  let hit = null;
  const walk = (n) => {
    if (hit || !n || typeof n !== "object") return;
    if (n.id === id && n.type) hit = n;
    else Object.values(n).forEach(walk);
  };
  walk(doc.nodes);
  return hit;
};
const undeclare = (id, name) => (doc) => {
  const d = node(doc, id).data;
  const before = d.response_json.length;
  d.response_json = d.response_json.filter((r) => r.name !== name);
  if (d.response_json.length !== before - 1) throw new Error("no " + name + " declared on " + id);
};
const SAVE_IN = "{{node:code_node_IAguardIn.data.";
const SUB_G = "{{node:code_node_ISguard.data.";
const MUTANTS = [
  // ---- IA_SAVE: the read
  ["SAVE", "the read's gate always closed", J("IF('" + SAVE_IN + "trRead}}' = 'YES' OR"), J("IF('NO' = 'YES' OR")],
  ["SAVE", "another IA's requests", J("rq.source_ia_id = '" + SAVE_IN + "iaId}}'"), J("rq.source_ia_id = '0'")],
  ["SAVE", "any tenant's requests", J("WHERE rq.tenant_id = '" + SAVE_IN + "tenantId}}' AND rq.is_deleted = 0"), J("WHERE rq.is_deleted = 0")],
  ["SAVE", "deleted requests read", J("rq.tenant_id = '" + SAVE_IN + "tenantId}}' AND rq.is_deleted = 0"), J("rq.tenant_id = '" + SAVE_IN + "tenantId}}'")],
  ["SAVE", "any purpose read", J("AND rq.transfer_purpose = 'IA_SUPPLY' AND"), J("AND")],
  ["SAVE", "deleted request lines read", J("AND rl.is_deleted = 0) rx"), J(") rx")],
  ["SAVE", "the last line's bin", J("MIN(rl.id) AS first_id"), J("MAX(rl.id) AS first_id")],
  ["SAVE", "the items of no line", J("ri.id IN (" + SAVE_IN + "trItems}})"), J("ri.id IN (0)")],
  ["SAVE", "the read's iatr column not declared (the platform drops it)", undeclare("sql_node_IAguard", "iatr")],
  // ---- IA_SAVE: the input and the decision
  ["SAVE", "no line's items asked for", J("  trItems: iaGuardTrItems,\n"), J('  trItems: "0",\n')],
  ["SAVE", "trItems not declared", undeclare("code_node_IAguardIn", "trItems")],
  ["SAVE", "the decision reads no request", J("iatrg2Decide(iatrg2Read(iaGuardTrRaw),"), J("iatrg2Decide(iatrg2Read(null),")],
  ["SAVE", "the outcome: the Draft path ignored", J('iatrg2Outcome(iaS(iaGuardOut.trDraft) === "YES"'), J("iatrg2Outcome(false")],
  ["SAVE", "a refusal not returned", J("refuse400: iaGuardBusy || iaGuardBig || iaGuardTr.refuse ?"), J("refuse400: iaGuardBusy || iaGuardBig ?")],
  // ---- IA_SAVE: the staging node
  ["SAVE", "the staging check never taken", J("'{{node:code_node_IAguardStored.data.iatrPicks}}' == 'YES'"), J("'{{node:code_node_IAguardStored.data.iatrPicks}}' == 'NEVER'")],
  ["SAVE", "the staging refusal never returned", J("'{{node:code_node_IAtrPicks.data.route}}' == 'STOP'"), J("'{{node:code_node_IAtrPicks.data.route}}' == 'NEVER'")],
  ["SAVE", "the staging check of no line", J("iatrg2Staging(iatrg2Doc.stock_movement, iatrg2Got, null)"), J("iatrg2Staging([], iatrg2Got, null)")],
  ["SAVE", "the staging node reads no request", J("const iatrg2Got = iatrg2Read(iatrg2Row.iatr);"), J("const iatrg2Got = iatrg2Read(null);")],
  // ---- IA_V2_SUBMIT: the facts read
  ["SUBMIT", "the read's gate always closed", J(SUB_G + "iaId}} > 0 AND '" + SUB_G + "operation}}' = 'SUBMIT'"), J("0 > 0 AND '" + SUB_G + "operation}}' = 'SUBMIT'"), "all"],
  ["SUBMIT", "another IA's requests", J("rq.source_ia_id = '" + SUB_G + "iaId}}'"), J("rq.source_ia_id = '0'")],
  ["SUBMIT", "any tenant's requests", J("rq.tenant_id = '" + SUB_G + "tenantId}}' AND rq.is_deleted = 0"), J("rq.is_deleted = 0")],
  ["SUBMIT", "deleted requests read", J("rq.tenant_id = '" + SUB_G + "tenantId}}' AND rq.is_deleted = 0"), J("rq.tenant_id = '" + SUB_G + "tenantId}}'")],
  ["SUBMIT", "any purpose read", J("AND rq.transfer_purpose = 'IA_SUPPLY' AND"), J("AND")],
  ["SUBMIT", "deleted request lines read", J("AND rl.is_deleted = 0) rx"), J(") rx")],
  ["SUBMIT", "the last line's bin", J("MIN(rl.id) AS first_id"), J("MAX(rl.id) AS first_id")],
  ["SUBMIT", "the facts' iatr column not declared (the platform drops it)", undeclare("sql_node_ISfacts", "iatr")],
  // ---- IA_V2_SUBMIT: the entry and the gate
  ["SUBMIT", "the entry does not refuse", J('    if (tr.refuse) return Object.assign(base, answer("STOP", "400", tr.message, { errorCode: tr.code }));\n'), ""],
  ["SUBMIT", "the entry reads no request", J('iatrg2Decide(iatrg2Read(f.iatr), "COMPLETED", stored)'), J('iatrg2Decide(iatrg2Read(null), "COMPLETED", stored)')],
  ["SUBMIT", "the gate does not refuse a line off the staging bin", J('    if (!tp.ok) return out("STOP", "400", tp.message, tp.code);\n'), ""],
  ["SUBMIT", "the gate checks no line", J("iatrg2Staging(lines, trReq, byItem)"), J("iatrg2Staging([], trReq, byItem)")],
  ["SUBMIT", "the gate ignores its own items", J("iatrg2Staging(lines, trReq, byItem)"), J("iatrg2Staging(lines, trReq, null)")],
  ["SUBMIT", "the gate gets no facts", J("  facts: [{{node:sql_node_ISfacts.data}}][0] });\n"), J("  facts: [] });\n")],
];
const text = {};
for (const t of Object.keys(TARGET)) text[t] = fs.readFileSync(path.join(BUILT, TARGET[t].file), "utf8");
let survived = 0;
for (const [t, name, from, to, mode] of MUTANTS) {
  let out;
  if (typeof from === "function") {
    const doc = JSON.parse(text[t]);
    from(doc);
    out = JSON.stringify(doc, null, 1) + "\n";
  } else {
    const k = text[t].split(from).length - 1;
    if (k < 1 || (mode !== "all" && k !== 1)) {
      console.log("BROKEN mutant (anchor found " + k + " times): " + t + " " + name);
      survived++;
      continue;
    }
    out = mode === "all" ? text[t].split(from).join(to) : text[t].replace(from, () => to);
  }
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "iatr-wf2-m-")), TARGET[t].file);
  fs.writeFileSync(f, out);
  const env = Object.assign({}, process.env, TARGET[t].base, { [TARGET[t].env]: f });
  const r = spawnSync(process.execPath, [path.join(__dirname, TARGET[t].test)], { env: env, encoding: "utf8" });
  if (r.status === 0) {
    survived++;
    console.log("SURVIVED: " + t + " " + name);
  } else console.log("killed   " + t + " " + name);
}
console.log((survived ? "FAILED " + survived + " of " : "ok - all killed: ") + MUTANTS.length + " mutants");
process.exit(survived ? 1 : 0);
