// RES-01 Cancel from the list (user 10-22, like the Goods Delivery list): the selected Created Item Assemblies are cancelled one at a
// time. Their stored status is re-read first (a list row can be stale) and only the Created ones are sent; IA_HOLD CANCEL releases what
// each one holds and only then sets it Cancelled (a release that does not finish leaves it Created and says so); one summary at the end
const RES_HOLD = "2112752274794217473"; // IA_HOLD
(async () => {
  const s = (v) => (v === undefined || v === null ? "" : String(v));
  const esc = (v) => s(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const selected = this.getComponent("custom_7rq6zmn4")?.$refs.crud.tableSelect || [];
  if (!selected.length) {
    this.$message.error("Please select at least one record.");
    return;
  }
  if (!/^[1-9][0-9]{0,19}$/.test(RES_HOLD)) {
    this.$message.error("Cancel is not set up.");
    return;
  }
  const ids = selected.map((r) => s(r && r.id)).filter((id) => /^[0-9]{1,20}$/.test(id));
  let stored = null;
  try {
    const res = await db
      .collection("sm_item_assembly")
      .field("id,stock_movement_no,item_assembly_status,organization_id")
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
  const whyNot = (status) =>
    status === "Draft" ? "a Draft is deleted, not cancelled"
      : status === "Completed" || status === "Fully Posted" ? "completed: revert it instead"
        : status === "Cancelled" ? "already cancelled"
          : status === "Processing" ? "being completed in the background"
            : "is " + (status || "unknown") + ": only a Created Item Assembly can be cancelled";
  const todo = selected.filter((r) => s((byId[s(r && r.id)] || {}).item_assembly_status) === "Created");
  if (!todo.length) {
    this.$message.warning("None of the selected Item Assemblies is Created: only a Created Item Assembly can be cancelled.");
    return;
  }
  const n = todo.length;
  const left = selected.length - n;
  try {
    await this.$confirm(`Cancel ${n} Item ${n === 1 ? "Assembly" : "Assemblies"}? ${n === 1 ? "Its" : "Their"} reserved materials are released and ${n === 1 ? "it" : "they"} can no longer be changed.` +
      (left ? ` ${left} of the selected ${left === 1 ? "is" : "are"} not Created and ${left === 1 ? "is" : "are"} left as ${left === 1 ? "it is" : "they are"}.` : ""),
    "Cancel Item Assemblies", { confirmButtonText: n === 1 ? "Cancel it" : "Cancel them", cancelButtonText: n === 1 ? "Keep it" : "Keep them", type: "warning" });
  } catch (e) {
    return;
  }
  const run = (params) =>
    new Promise((resolve, reject) => {
      const p = this.runWorkflow(RES_HOLD, params, (res) => resolve(res), (err) => reject(err));
      if (p && typeof p.then === "function") p.then((res) => resolve(res), (err) => reject(err));
    });
  const cancelOne = async (id, org) => {
    try {
      const res = await run({ ia_id: id, organization_id: org, operation: "CANCEL", source: "LIST" });
      return (res && res.data) || null;
    } catch (e) {
      console.error("RES-01: the cancel failed", e);
      return null;
    }
  };
  const lines = [];
  let sent = 0;
  this.showLoading("Cancelling...");
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
      if (status !== "Created") {
        lines.push(label + ": " + whyNot(status));
        continue;
      }
      sent += 1;
      // a reservation of this IA still running answers 409: waited for, as the list's delete does
      let d = await cancelOne(id, s(ia.organization_id));
      for (let i = 0; i < 3 && d && s(d.code) === "409"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        d = await cancelOne(id, s(ia.organization_id));
      }
      let r = null;
      try {
        r = d && s(d.result_json) ? JSON.parse(s(d.result_json)) : null;
      } catch (e) {
        r = null;
      }
      lines.push(label + ": " + (d && s(d.code) === "200" && r && r.cancelled === true ? "cancelled" : s(d && d.message) || "no answer: try again"));
    }
  } finally {
    this.hideLoading();
  }
  if (sent) this.refresh();
  await this.$alert(lines.map(esc).join("<br>"), "Cancel Item Assemblies", { dangerouslyUseHTMLString: true }).catch(() => {});
})();
