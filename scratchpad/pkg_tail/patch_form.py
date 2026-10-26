# Packing form (dev v205 = prod v205): no worker is scheduled on the server, so the browser drives a background completion.
# - pkgV2_onSave_Completed (eventScript[14]): after the submit, follow the job until it ends (was: one worker start).
# - mounted (eventScript[0]) pkgV2ShowJobState: an open job is followed the same way; any open of a Packing without a job
#   of its own also starts the worker once without naming a job (at most every 2 min per browser) - the oldest due job.
# Usage: python3 -I patch_form.py   (from base/: writes the two .js mirrors and Packing/PackingFullJSON.json)
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
B = lambda f: os.path.join(HERE, "base", f)

FOLLOW_SAVE = r'''
// Follow one background completion: start the worker for the job until it ends or 10 minutes pass. The answer carries no
// next-attempt time, so a lock retry waits the server's backoff (2 s doubling to 30 s), an operation still running 10 s, the
// hand-over after the stock call 1.5 s; a start that did not take the job (not due yet / another run has it) reads the job
// through SUBMIT STATUS. One follower per job in this browser.
const PKG_V2_OPEN = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_PACKING"];
const pkgV2FollowJob = (jobId, packingId, organizationId, onEnd) => {
  let following = {};
  try {
    following = window.__pkgV2Following = window.__pkgV2Following || {};
  } catch (e) {
    following = {};
  }
  if (following[jobId]) return;
  following[jobId] = 1;
  const until = Date.now() + 10 * 60 * 1000;
  let idle = 0;
  const step = async () => {
    const res = await pkgV2Call(PKG_V2_WF.WORKER, { job_id: jobId });
    const w = res.ok ? res.data || {} : {};
    let st = String(w.job_id || "") === jobId ? String(w.job_status || "") : "";
    let msg = String(w.result_message || "");
    let attempts = 0;
    try {
      attempts = Number((JSON.parse(w.jobs || "[]")[0] || {}).attempt_count) || 0;
    } catch (e) {
      attempts = 0;
    }
    if (!st) {
      const s = await pkgV2Call(PKG_V2_WF.SUBMIT, { packing_id: packingId, organization_id: organizationId, operation: "STATUS" });
      if (s.ok && String((s.data || {}).job_id || "") === jobId) {
        st = String(s.data.job_status || "");
        msg = String(s.data.result_message || msg);
      }
      idle += 1;
    } else idle = 0;
    if (st && PKG_V2_OPEN.indexOf(st) < 0) {
      delete following[jobId];
      return onEnd(st, msg);
    }
    if (Date.now() > until) {
      delete following[jobId];
      return;
    }
    const code = String(w.result_code || "");
    const wait = code === "PK_INVENTORY_IN_PROGRESS" ? 10000 : /RETRY/.test(code) ? Math.min(30000, 2000 * Math.pow(2, Math.max(0, attempts - 1))) + 500 : idle ? Math.min(30000, 3000 * idle) : 1500;
    setTimeout(step, wait);
  };
  step();
};
'''

OLD_KICK = '''    // start the worker now; its scheduled run is the safety net, so a failed start is only logged
    try {
      this.runWorkflow(
        PKG_V2_WF.WORKER,
        { job_id: String(out.job_id) },
        () => {
          if (this.parentGenerateForm) this.parentGenerateForm.refresh();
        },
        (e) => console.error("Packing V2: worker start failed - the scheduled worker picks the job up", e),
      );
    } catch (e) {
      console.error("Packing V2: worker could not be started", e);
    }
'''
NEW_KICK = '''    // no worker is scheduled on the server: this browser starts it until the job ends; a job left open (browser closed) is
    // taken by the next open of any Packing
    pkgV2FollowJob(String(out.job_id), String(data.id), organizationId, (st, msg) => {
      if (this.parentGenerateForm) this.parentGenerateForm.refresh();
      if (st === "COMPLETED") this.$message.success("Packing " + (data.packing_no || "") + " completed.");
      else if (st === "FAILED") this.$message.error("Packing " + (data.packing_no || "") + " was not completed: " + (msg || "unknown reason"));
      else if (st === "REQUIRES_REVIEW") this.$message.error("Packing " + (data.packing_no || "") + " stopped half-way and is under review: " + msg + " Please contact support.");
    });
'''

MOUNTED_NEW = r'''// Packing V2: the Packing's latest background completion, read through PACKING_ASYNC_SUBMIT (STATUS: the browser cannot
// read gd_async_job). While it is open the save buttons are hidden and this browser follows it to the end; FAILED / under
// review is reported once. No worker is scheduled on the server, so any open of a Packing without a job of its own also
// starts the worker once without naming a job (at most every 2 minutes in this browser): it takes the oldest due job, so a
// completion whose browser was closed still finishes.
const PKG_V2 = { SUBMIT: "2109924558618333185", WORKER: "2109924593737240578" };
const PKG_V2_OPEN = ["QUEUED", "VALIDATING", "READY_TO_COMMIT", "COMMITTING_PACKING"];
const pkgV2Run = (workflowId, params) =>
  new Promise((resolve) => {
    try {
      this.runWorkflow(
        workflowId,
        params,
        (res) => resolve((res && res.data) || null),
        (err) => {
          console.error("Packing V2: " + workflowId + " call failed", err);
          resolve(null);
        },
      );
    } catch (e) {
      resolve(null);
    }
  });
// start the worker for the job until it ends or 10 minutes pass; the answer carries no next-attempt time, so a lock retry
// waits the server's backoff (2 s doubling to 30 s), an operation still running 10 s, the hand-over after the stock call
// 1.5 s; a start that did not take the job (not due yet / another run has it) reads the job through STATUS
const pkgV2FollowJob = (jobId, packingId, organizationId, onEnd) => {
  let following = {};
  try {
    following = window.__pkgV2Following = window.__pkgV2Following || {};
  } catch (e) {
    following = {};
  }
  if (following[jobId]) return;
  following[jobId] = 1;
  const until = Date.now() + 10 * 60 * 1000;
  let idle = 0;
  const step = async () => {
    const w = (await pkgV2Run(PKG_V2.WORKER, { job_id: jobId })) || {};
    let st = String(w.job_id || "") === jobId ? String(w.job_status || "") : "";
    let msg = String(w.result_message || "");
    let attempts = 0;
    try {
      attempts = Number((JSON.parse(w.jobs || "[]")[0] || {}).attempt_count) || 0;
    } catch (e) {
      attempts = 0;
    }
    if (!st) {
      const s = (await pkgV2Run(PKG_V2.SUBMIT, { packing_id: packingId, organization_id: organizationId, operation: "STATUS" })) || {};
      if (String(s.job_id || "") === jobId) {
        st = String(s.job_status || "");
        msg = String(s.result_message || msg);
      }
      idle += 1;
    } else idle = 0;
    if (st && PKG_V2_OPEN.indexOf(st) < 0) {
      delete following[jobId];
      return onEnd(st, msg);
    }
    if (Date.now() > until) {
      delete following[jobId];
      return;
    }
    const code = String(w.result_code || "");
    const wait = code === "PK_INVENTORY_IN_PROGRESS" ? 10000 : /RETRY/.test(code) ? Math.min(30000, 2000 * Math.pow(2, Math.max(0, attempts - 1))) + 500 : idle ? Math.min(30000, 3000 * idle) : 1500;
    setTimeout(step, wait);
  };
  step();
};
const pkgV2Drain = () => {
  try {
    if (Date.now() - (Number(window.localStorage.getItem("pkgv2_drain_at")) || 0) < 120000) return;
    window.localStorage.setItem("pkgv2_drain_at", String(Date.now()));
  } catch (e) {
    // storage blocked: started anyway
  }
  pkgV2Run(PKG_V2.WORKER, {});
};
const pkgV2ShowJobState = async () => {
  const id = this.getValue("id");
  if (!id || PKG_V2.SUBMIT.indexOf("__") === 0) return;
  let organizationId = String(this.getValue("organization_id") || "");
  if (!organizationId) {
    organizationId = String(this.getVarGlobal("deptParentId") || "");
    if (!organizationId || organizationId === "0") organizationId = String(this.getVarSystem("deptIds") || "").split(",")[0];
  }
  const job = await pkgV2Run(PKG_V2.SUBMIT, { packing_id: String(id), organization_id: organizationId, operation: "STATUS" });
  if (!job || !job.job_id) return pkgV2Drain();
  const seenKey = "pkgv2_seen_" + job.job_id;
  const markSeen = () => {
    try {
      window.localStorage.setItem(seenKey, "1");
    } catch (e) {
      // storage blocked: reported again on the next open
    }
  };
  if (PKG_V2_OPEN.includes(job.job_status)) {
    this.hide(["button_save_as_draft", "button_created", "button_completed"]);
    this.$message.warning("This Packing is being completed in the background (" + (job.result_message || job.job_status) + "). Reopen it in a moment.");
    pkgV2FollowJob(String(job.job_id), String(id), organizationId, (st, msg) => {
      markSeen();
      if (st === "COMPLETED") this.$message.success("The Packing was completed in the background. Reopen it to see it.");
      else if (st === "FAILED") this.$message.error("The last completion was not saved: " + (msg || "unknown reason"));
      else if (st === "REQUIRES_REVIEW") this.$message.error("The last completion stopped half-way and is under review: " + msg + " Please contact support.");
    });
    return;
  }
  pkgV2Drain();
  let seen = false;
  try {
    seen = window.localStorage.getItem(seenKey) === "1";
  } catch (e) {
    seen = false;
  }
  markSeen();
  if (seen) return;
  if (job.job_status === "FAILED") this.$message.error("The last completion was not saved: " + (job.result_message || "unknown reason"));
  else if (job.job_status === "REQUIRES_REVIEW") this.$message.error("The last completion stopped half-way and is under review: " + job.result_message + " Please contact support.");
};'''

save_old = open(B("pkgV2_onSave_Completed.js"), encoding="utf-8").read()
anchor = "\nconst setFlag = (k, v) => {"
assert save_old.count(anchor) == 1 and save_old.count(OLD_KICK) == 1
save_new = save_old.replace(anchor, FOLLOW_SAVE + anchor).replace(OLD_KICK, NEW_KICK)

mount_old = open(B("PackingOnMounted.js"), encoding="utf-8").read()
start = mount_old.index("// Packing V2: the Packing's latest background completion")
end = mount_old.index("\n\n// Main execution function")
assert mount_old.count("// Packing V2: the Packing's latest background completion") == 1 and start < end
mount_new = mount_old[:start] + MOUNTED_NEW + mount_old[end:]

form_raw = open(B("PackingFullJSON.v205.json"), encoding="utf-8").read()
form = json.loads(form_raw)
es = form["config"]["eventScript"]
assert es[0]["name"] == "mounted" and es[0]["func"] == mount_old and es[0]["type"] == "js"
assert es[14]["name"] == "pkgV2_onSave_Completed" and es[14]["func"] == save_old and es[14]["type"] == "js"
for old, new in ((mount_old, mount_new), (save_old, save_new)):
    enc_old = json.dumps(old, ensure_ascii=False)
    assert form_raw.count(enc_old) == 1, "embedded copy not found once"
    form_raw = form_raw.replace(enc_old, json.dumps(new, ensure_ascii=False))
check = json.loads(form_raw)["config"]["eventScript"]
assert check[0]["func"] == mount_new and check[14]["func"] == save_new

open(os.path.join(REPO, "Packing", "AsyncV2", "pkgV2_onSave_Completed.js"), "w", encoding="utf-8").write(save_new)
open(os.path.join(REPO, "Packing", "PackingOnMounted.js"), "w", encoding="utf-8").write(mount_new)
open(os.path.join(REPO, "Packing", "PackingFullJSON.json"), "w", encoding="utf-8").write(form_raw)
print("form: mounted + pkgV2_onSave_Completed patched; .js mirrors written")
