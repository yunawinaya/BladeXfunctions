// replay_cf_0654.js: the prod case that sent GD2610-0654 (502801) to review on 10-23, through E2 as recorded. The read-back
// after the write and the lines on the retry, with the new reads' cf_defs row: the check passes, the retry finds its write
// landed. Without the row (the old reads) both fail as they did on prod. Exit 0 only if every expectation holds.
const fs = require("fs"), vm = require("vm");
const R = "/Users/yunawinaya/Developer/BladeXfunctions/";
const D = __dirname + "/..";
const FX = JSON.parse(fs.readFileSync(__dirname + "/fixtures/cf_0654.json", "utf8"));
const F = JSON.parse(fs.readFileSync(R + "scratchpad/gdc/lift/fields.json", "utf8"));
const K = { header: F.goods_delivery, line: F.goods_delivery_fwii8mvb_sub };
let src = [R + "scratchpad/gdc/code/prepare/adapter.js", D + "/code/prepare/plan_edit.js"].map((f) => fs.readFileSync(f, "utf8")).join("\n");
for (const f of ["_common.js", "e2.js"]) src += "\n" + fs.readFileSync(D + "/code/commit/" + f, "utf8");
const sb = { JSON, Math, Number, String, Array, Object, Set, Map, parseFloat, parseInt, isNaN, isFinite, Boolean, Error, RegExp, Date, console };
vm.createContext(sb);
vm.runInContext(src, sb);
const call = (fn, ...args) => { sb.__A = JSON.parse(JSON.stringify(args)); return JSON.parse(JSON.stringify(vm.runInContext(fn + "(...__A)", sb))); };
const gdl = vm.runInContext("parseJ", sb)(FX.gdlPartRows[0].result_ref);
const defs = { cf_defs: FX.cf_defs };
const cases = [
  ["check after the write, with cf_defs", call("commitE2Check", FX.entry, gdl, FX.e2back.concat([defs])).route, "OK"],
  ["retry plan, with cf_defs: the write landed", call("commitE2Plan", FX.entry, gdl, FX.e2laRetry.concat([defs]), K).job_status !== "REQUIRES_REVIEW" ? "landed" : "review", "landed"],
  ["first plan, with cf_defs: the patch is written", String(call("commitE2Plan", FX.entry, gdl, FX.e2laFirst.concat([defs]), K).patchCount), "1"],
  ["check without cf_defs (as on prod)", call("commitE2Check", FX.entry, gdl, FX.e2back).result_code, "GDE_STEP_RETRY"],
  ["retry plan without cf_defs (as on prod)", call("commitE2Plan", FX.entry, gdl, FX.e2laRetry, K).job_status, "REQUIRES_REVIEW"],
];
let ok = true;
for (const [name, got, want] of cases) { const pass = got === want; ok = ok && pass; console.log((pass ? "ok   " : "FAIL ") + name + ": " + got); }
console.log(ok ? "5/5 passed" : "replay FAILED");
process.exit(ok ? 0 : 1);
