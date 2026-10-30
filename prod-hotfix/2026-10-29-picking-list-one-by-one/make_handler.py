"""Write PPonMountedListPage.one_by_one.js: prod v77's Picking list mounted handler with its three worker starts chained.

The open used to start PICKING_ASYNC_WORKER, GD_EDIT_WORKER and GD_COMPLETE_WORKER in the same instant; workflows loading their
scripts at the same moment after a backend restart can stay "script for node[...] is not loaded" (10-28/29). Now each starts
1 s after the previous one answers, or after 60 s with no answer. The 60-s GD_COMPLETE beat is unchanged.
usage: python3 make_handler.py
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "PPonMountedListPage.prod_v77.js")).read()

OLD = '''// Picking V2: no scheduled worker - every open of the list starts the background confirmations / force completes and the
// delivery edits a force complete waits on (each worker takes only its due jobs; a run in progress holds its job's lease)
try {
  this.runWorkflow("2109531412499251201", { job_id: "" }, () => {}, (e) => console.error("Picking V2: worker start failed", e));
  this.runWorkflow("2110618789356687361", { job_id: "" }, () => {}, (e) => console.error("GD Edit V2: worker start failed", e));
} catch (e) {
  console.error("Picking V2: the workers could not be started", e);
}

// Auto Complete GD (stage 1e): an open Picking list also starts queued delivery completions (GD_COMPLETE_WORKER, the tenant's due
// jobs) at once and about once a minute per browser. A worker's answer can be lost on a long run (Kenhin 10-27), so nothing waits on it
(() => {
  const KEY = "pkv2_gdc_kick_at";
  const kick = () => {
    let last = 0;
    try {
      last = Number(localStorage.getItem(KEY) || 0);
    } catch (e) {}
    if (Date.now() - last < 55000) return;
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch (e) {}
    try {
      this.runWorkflow("2110182645714518018", {}, () => {}, (e) => console.error("GD Complete V2: sweep failed", e));
    } catch (e) {
      console.error("GD Complete V2: sweep could not be started", e);
    }
  };
  kick();
'''

NEW = '''// Picking V2: no scheduled worker - every open of the list starts the background confirmations / force completes and the
// delivery edits a force complete waits on (each worker takes only its due jobs; a run in progress holds its job's lease)
// Auto Complete GD (stage 1e): an open Picking list also starts queued delivery completions (GD_COMPLETE_WORKER, the tenant's due
// jobs) on open and about once a minute per browser. A worker's answer can be lost on a long run (Kenhin 10-27), so nothing waits on it
// for long. One worker at a time (10-29): the three starts no longer go out together - workflows loading their scripts at the same
// moment after a backend restart can stay "script for node[...] is not loaded". Each starts 1 s after the previous one answers,
// or after 60 s with no answer.
(() => {
  const KEY = "pkv2_gdc_kick_at";
  // answered: called once, when the sweep answers or is not started
  const kick = (answered) => {
    const done = () => {
      if (answered) answered();
      answered = null;
    };
    let last = 0;
    try {
      last = Number(localStorage.getItem(KEY) || 0);
    } catch (e) {}
    if (Date.now() - last < 55000) return done();
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch (e) {}
    try {
      this.runWorkflow("2110182645714518018", {}, () => done(), (e) => {
        console.error("GD Complete V2: sweep failed", e);
        done();
      });
    } catch (e) {
      console.error("GD Complete V2: sweep could not be started", e);
      done();
    }
  };
  const start = (workflowId, label) => (answered) => {
    try {
      this.runWorkflow(workflowId, { job_id: "" }, () => answered(), (e) => {
        console.error(label + ": worker start failed", e);
        answered();
      });
    } catch (e) {
      console.error(label + ": the worker could not be started", e);
      answered();
    }
  };
  const steps = [start("2109531412499251201", "Picking V2"), start("2110618789356687361", "GD Edit V2"), kick];
  const next = (i) => {
    if (i >= steps.length) return;
    let gone = false;
    let lost = null;
    const go = () => {
      if (gone) return;
      gone = true;
      window.clearTimeout(lost);
      window.setTimeout(() => next(i + 1), 1000);
    };
    lost = window.setTimeout(go, 60000);
    steps[i](go);
  };
  next(0);
'''

assert src.count(OLD) == 1, "prod v77's kick block is not found exactly once"
out = src.replace(OLD, NEW)
open(os.path.join(HERE, "PPonMountedListPage.one_by_one.js"), "w").write(out)
print("wrote PPonMountedListPage.one_by_one.js:", len(src), "->", len(out), "chars")
