const url = new URL(window.location.href);
const type = url.searchParams.get("type");
const id = url.searchParams.get("id");

if (type && id) {
  this.toView({
    title: type.charAt(0).toUpperCase() + type.slice(1),
    target: "1935556443668959233", //table id for picking
    targetType: "Table",
    mode: "drawer",
    ...(type === "view" ? { viewMode: "disabled" } : {}),
    type: type,
    data: {
      id: id,
    },
  });
}

(async () => {
  try {
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    const pickingSetupResponse = await db
      .collection("picking_setup")
      .where({
        organization_id: organizationId,
        picking_required: 1,
      })
      .get();

    if (pickingSetupResponse.data.length > 0) {
      if (pickingSetupResponse.data[0].picking_after === "Goods Delivery") {
        this.display("custom_41s73hyl");
        this.hide("tabs_picking");
      } else if (pickingSetupResponse.data[0].picking_after === "Sales Order") {
        this.display("tabs_picking");
        this.hide("custom_41s73hyl");
      } else {
        this.display("tabs_picking");
        this.hide("custom_41s73hyl");
      }
    } else {
      this.hide("tabs_picking");
      this.display("custom_41s73hyl");
    }
  } catch (error) {
    console.error("Error in PPonMountedListPage:", error);
  }
})();

// Picking V2: no scheduled worker - every open of the list starts the background confirmations / force completes and the
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
  if (typeof window.setInterval !== "function") return;
  // one beat per window: a re-mounted list replaces it; it stops once the page leaves the list
  const home = new URL(window.location.href).pathname;
  if (window.pkV2GdcBeat) window.clearInterval(window.pkV2GdcBeat);
  window.pkV2GdcBeat = window.setInterval(() => {
    if (new URL(window.location.href).pathname !== home) {
      window.clearInterval(window.pkV2GdcBeat);
      window.pkV2GdcBeat = null;
      return;
    }
    kick();
  }, 60000);
})();
