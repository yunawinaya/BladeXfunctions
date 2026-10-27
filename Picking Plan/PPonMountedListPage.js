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
