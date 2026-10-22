// RES-01 MIN-03 (BA 10-22): Retry Reservation, the list's worklist action. For the selected Item Assemblies it re-reads their stored
// status, hold status and organisation (a list row can be stale), then runs the IA_HOLD operation each one needs, one at a time:
// Created -> RECONCILE (reserves what its saved lines still miss, releases the surplus); Completed / Fully Posted still holding ->
// CLOSE; a Draft still marked -> RECONCILE (gives it back); Cancelled still marked -> RELEASE_ALL. IA_HOLD re-checks each one and
// refuses what no longer fits; one summary at the end.
const RES_HOLD = "__IA_HOLD__"; // IA_HOLD
const RES_CLOSING = ["RESERVING", "FULL", "PARTIAL", "SHORT", "REVIEW"];
(async () => {
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  const esc = (v) => s(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const selected = this.getComponent("custom_7rq6zmn4")?.$refs.crud.tableSelect || [];
  if (!selected.length) {
    this.$message.error("Please select at least one record.");
    return;
  }
  if (!/^[1-9][0-9]{0,19}$/.test(RES_HOLD)) {
    this.$message.error("Reservations are not set up.");
    return;
  }
  const ids = selected.map((r) => s(r && r.id)).filter((id) => /^[0-9]{1,20}$/.test(id));
  let stored = null;
  try {
    const res = await db
      .collection("sm_item_assembly")
      .field("id,stock_movement_no,item_assembly_status,material_hold_status,organization_id")
      .filter([{ type: "branch", operator: "all", children: [{ prop: "id", operator: "in", value: ids }, { prop: "is_deleted", operator: "equal", value: 0 }] }])
      .limit(ids.length)
      .get();
    stored = res && Array.isArray(res.data) ? res.data : null;
  } catch (e) {
    console.error("RES-01: the selected Item Assemblies could not be read", e);
  }
  if (!stored) {
    this.$message.error("The selected Item Assemblies could not be read: try again.");
    return;
  }
  const byId = {};
  stored.forEach((r) => (byId[s(r.id)] = r));
  const opOf = (status, mark) =>
    status === "Created" && mark !== ""
      ? "RECONCILE"
      : (status === "Completed" || status === "Fully Posted") && RES_CLOSING.indexOf(mark) >= 0
        ? "CLOSE"
        : status === "Draft" && mark !== "" && mark !== "NONE" && mark !== "CLOSED"
          ? "RECONCILE"
          : status === "Cancelled" && mark !== "" && mark !== "NONE"
            ? "RELEASE_ALL"
            : "";
  const run = (params) =>
    new Promise((resolve, reject) => {
      const p = this.runWorkflow(RES_HOLD, params, (res) => resolve(res), (err) => reject(err));
      if (p && typeof p.then === "function") p.then((res) => resolve(res), (err) => reject(err));
    });
  const lines = [];
  let sent = 0;
  this.showLoading("Retrying reservations...");
  try {
    for (const row of selected) {
      const id = s(row && row.id);
      const ia = byId[id];
      const label = s(ia && ia.stock_movement_no) || s(row && row.stock_movement_no) || id;
      if (!ia) {
        lines.push(label + ": no longer available");
        continue;
      }
      const status = s(ia.item_assembly_status);
      const op = opOf(status, s(ia.material_hold_status));
      if (!op) {
        lines.push(label + ": " + (status === "Processing" ? "being completed in the background" : "nothing to retry"));
        continue;
      }
      sent += 1;
      let d = null;
      try {
        const res = await run({ ia_id: id, organization_id: s(ia.organization_id), operation: op, source: "LIST" });
        d = (res && res.data) || null;
      } catch (e) {
        console.error("RES-01: the reservation retry failed", e);
      }
      lines.push(label + ": " + (s(d && d.message) || "no answer: try again"));
    }
  } finally {
    this.hideLoading();
  }
  if (sent) this.refresh();
  await this.$alert(lines.map(esc).join("<br>"), "Retry Reservation", { dangerouslyUseHTMLString: true }).catch(() => {});
})();
