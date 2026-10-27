// test_list_mounted.js [file]: the Picking list's mounted handler (Picking Plan/PPonMountedListPage.js, or [file]) on a mock
// page: besides the Picking / GD Edit worker kicks, an open list starts GD_COMPLETE_WORKER (the tenant's due completions) at
// once and on a one-minute beat, at most once a minute per browser, and the beat stops when the page leaves the list (stage 1e).
const fs = require("fs");
const { eq, done } = require("../../gdc/pkv2tools/harness.js");
const SRC = fs.readFileSync(process.argv[2] || __dirname + "/../../../Picking Plan/PPonMountedListPage.js", "utf8");
const GDC = "2110182645714518018";

const store = {};
const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
const win = { location: { href: "https://erp.example/app/page/1935635853539348481" }, beats: [], cleared: [], pkV2GdcBeat: null };
win.setInterval = (fn, ms) => { win.beats.push({ fn: fn, ms: ms }); return win.beats.length; };
win.clearInterval = (id) => win.cleared.push(id);
const db = { collection: () => ({ where: () => ({ get: async () => ({ data: [] }) }) }) };
const calls = [];
const ctx = {
  runWorkflow: (id, params) => calls.push([id, JSON.stringify(params)]),
  toView: () => {}, display: () => {}, hide: () => {},
  getVarGlobal: () => "77", getVarSystem: () => "77",
};
const mount = () => new Function("db", "window", "localStorage", "console", SRC).call(ctx, db, win, ls, { log: () => {}, error: () => {} });
const gdc = () => calls.filter((c) => c[0] === GDC);

mount();
eq("on open: GD_COMPLETE_WORKER {} (the tenant's due completions), besides the existing kicks", [gdc().map((c) => c[1]), calls.some((c) => c[0] === "2109531412499251201")],
  [["{}"], true]);
eq("a one-minute beat", win.beats.map((b) => b.ms), [60000]);
mount();
eq("a second open within the minute (another tab): no extra sweep; its beat replaces the first", [gdc().length, win.cleared, win.beats.length], [1, [1], 2]);
store.pkv2_gdc_kick_at = String(Date.now() - 61000);
win.beats[1].fn();
eq("the beat after a minute sweeps again", gdc().length, 2);
win.beats[1].fn();
eq("a beat inside the minute does not", gdc().length, 2);
win.location.href = "https://erp.example/app/page/other";
store.pkv2_gdc_kick_at = String(Date.now() - 61000);
win.beats[1].fn();
eq("the page left the list: the beat stops, no sweep", [gdc().length, win.cleared.length, win.pkV2GdcBeat], [2, 2, null]);
done();
