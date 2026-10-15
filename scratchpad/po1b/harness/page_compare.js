// PROPOSAL check: Batch Add Item (Procurement) page v28 vs the batched-read patch, in the mock form / db.
// usage: node page_compare.js <fixtures_dir> [--big]
"use strict";
const fs = require("fs");
const path = require("path");
const { makeDb, makeForm, compileForm, settle, install, clone, Filter, timers } = require("./mock");

const out = (...a) => process.stdout.write(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ") + "\n");
console.log = () => {};
const unhandled = [];
process.on("unhandledRejection", (e) => unhandled.push(String(e && e.message ? e.message : e)));

const FX = process.argv[2];
const BIG = process.argv.includes("--big");
const P = path.join(__dirname, "..", "batch_add_page");
const OLD = compileForm(JSON.parse(fs.readFileSync(path.join(P, "page_v28.json"), "utf8")), Filter);
const NEW = compileForm(JSON.parse(fs.readFileSync(path.join(P, "page_v28_patched.json"), "utf8")), Filter);
const { items: ITEMS, big_ids: BIG_IDS } = JSON.parse(fs.readFileSync(path.join(FX, "items.json"), "utf8"));
const ORG = ITEMS[BIG_IDS[0]].organization_id;

let fails = 0;
const check = (label, cond, extra) => {
  out((cond ? "ok   " : "FAIL ") + label + (extra ? "  " + extra : ""));
  if (!cond) fails++;
};

async function run(compiled, models, name, args) {
  const dbApi = makeDb({ Item: ITEMS });
  install(dbApi);
  const selection = [];
  const crud = { tableSelect: (args && args.tableSelect) || [], clearSelection: () => selection.push("clear"), toggleSelection: (rows) => selection.push(rows.map((r) => r.id)) };
  const form = makeForm(models, { compiled, db: dbApi.db, globals: { deptParentId: "0" }, system: { deptIds: ORG }, components: { item_table: { $refs: { crud } } } });
  unhandled.length = 0;
  const t0 = Date.now();
  form.__run(name, args);
  for (let stable = 0, last = ""; stable < 4; ) {
    await settle(5);
    const s = JSON.stringify(form.__snapshot().counts) + dbApi.log.length + timers.pending.size;
    stable = s === last && timers.pending.size === 0 ? stable + 1 : 0;
    last = s;
  }
  const snap = form.__snapshot();
  return { models: snap.models, messages: snap.messages, selection, db: dbApi.counts.c, unhandled: unhandled.slice(), ms: Date.now() - t0 };
}

const reads = (r) => `Item reads ${Object.entries(r.db).filter(([k]) => /^Item:(doc|query|in)/.test(k)).map(([k, v]) => k.slice(5) + "=" + v).join(" ") || 0}${r.db["Item:maxInIds"] ? ", max ids/query " + r.db["Item:maxInIds"] : ""}`;
const same = (a, b) => JSON.stringify([a.models.item_array, a.models.item_code_array, a.selection]) === JSON.stringify([b.models.item_array, b.models.item_code_array, b.selection]);

(async () => {
  const codes = (n) => BIG_IDS.slice(0, n).map((id) => ITEMS[id].material_code);
  out("== Paste item codes (onClick_itemCodeInput)");
  for (const n of BIG ? [60, 2000] : [60]) {
    const list = codes(n);
    list.splice(5, 0, list[2]); // a code pasted twice
    const models = { item_code: list.join("\n"), item_array: [], item_code_array: "" };
    const A = await run(OLD, models, "onClick_itemCodeInput");
    const B = await run(NEW, models, "onClick_itemCodeInput");
    check(`${n} codes (one twice): same item_array, code list and selection`, same(A, B), `items ${B.models.item_array.length}; old ${reads(A)}, ${A.ms} ms; new ${reads(B)}, ${B.ms} ms`);
  }
  {
    const list = codes(10);
    for (const [label, text] of [["an unknown code", [...list.slice(0, 4), "NO-SUCH-CODE", ...list.slice(4)].join("\n")], ["a trailing blank line", list.join("\n") + "\n"]]) {
      const models = { item_code: text, item_array: [], item_code_array: "" };
      const A = await run(OLD, models, "onClick_itemCodeInput");
      const B = await run(NEW, models, "onClick_itemCodeInput");
      // the old pushes into the live item_array until it throws: the code list and selection never update
      check(`${label}: old throws part-way (no code list / selection), new adds all ${B.models.item_array.length} known items`,
        A.unhandled.length === 1 && A.models.item_code_array === "" && A.selection.length === 0 &&
          B.unhandled.length === 0 && B.models.item_array.length === 10 && B.models.item_code_array.split("\n").length === 10 && B.selection.length === 2,
        `old: threw "${A.unhandled[0] || "-"}" with ${A.models.item_array.length} items pushed | new messages: ${JSON.stringify(B.messages)}`);
    }
  }
  out("== Select all on a page (headerClick) and checkbox selection (checkboxEvent)");
  {
    const ids = BIG_IDS.slice(0, 40);
    const picked = (id) => ({ id, material_code: ITEMS[id].material_code });
    const pre = [ids[0], ids[1], ids[2]].map((id) => ({ id, material_code: ITEMS[id].material_code, material_name: "kept" }));
    const header = { item_array: clone(pre), item_code_array: "" };
    const tableSelect = ids.slice(0, 10).map(picked);
    const A = await run(OLD, header, "onItemTableheaderClick_1l2un0x7", { tableSelect });
    const B = await run(NEW, header, "onItemTableheaderClick_1l2un0x7", { tableSelect });
    check("header click over 10 rows (3 already picked -> removed, 7 added)", same(A, B), `items ${B.models.item_array.length}; old ${reads(A)}; new ${reads(B)}`);
    const sel = [...ids.slice(0, 30), ids[3]].map(picked);
    const box = { item_array: clone(pre).concat([{ id: "gone", material_code: "X" }]), item_code_array: "" };
    const C = await run(OLD, box, "onItemTablecheckboxEvent_tg37ka6k", { $eventArgs: [sel] });
    const D = await run(NEW, box, "onItemTablecheckboxEvent_tg37ka6k", { $eventArgs: [sel] });
    check("checkbox selection of 30 rows (3 kept, 1 unselected, 27 added, one row twice)", same(C, D), `items ${D.models.item_array.length}; old ${reads(C)}; new ${reads(D)}`);
  }
  out("\nfailures: " + fails);
  process.exit(fails ? 1 : 0);
})();
