// lotIatr_onClick_receive - Location Transfer form, onClick of button_receive (IA transfer request, ENH-20261027-001): a reserved request
// (its Item Assembly Created, scratchpad/iatr/RESERVED_REQUEST_PLAN.md Task 10, D5 / D7 / D10) opens the Receive dialog - Good / Defect /
// reason per line, per batch for a line that came in several; a request of a Draft Item Assembly confirms, then the Completed save runs
// (LOT V2's COMPLETE, as it was dispatched)
(async () => {
  const v = this.getValues();
  const s = (x) => (x === undefined || x === null ? "" : String(x)).trim();
  const num = (x) => {
    const y = parseFloat(x);
    return isFinite(y) ? Number(y.toFixed(8)) : 0;
  };
  let ia = null;
  try {
    const res = await db.collection("sm_item_assembly").where({ id: s(v.source_ia_id), is_deleted: 0 }).field("item_assembly_status").get();
    ia = ((res && res.data) || [])[0] || null;
  } catch (e) {
    console.error("Receive: the Item Assembly could not be read", e);
    this.$message.error("The Item Assembly of this transfer request could not be read: please try again.");
    return;
  }
  this.models["_iatr_receipts"] = null;
  if (!ia || s(ia.item_assembly_status) !== "Created") {
    try {
      await this.$confirm("Receive " + (s(v.stock_movement_no) || "this transfer request") + "? The dispatched materials move from In Transit into the production bin, as they were dispatched.",
        "Receive transfer request", { confirmButtonText: "Receive", cancelButtonText: "Not now", type: "warning" });
    } catch (e) {
      return;
    }
    await this.triggerEvent("lotV2_onClick_save_completed");
    return;
  }
  // one row per line and dispatched batch, in the order picked; everything good to start
  const rows = [];
  (Array.isArray(v.stock_movement) ? v.stock_movement : []).forEach((l, i) => {
    let picks = [];
    try {
      picks = JSON.parse(s(l.temp_qty_data) || "[]");
    } catch (e) {
      picks = [];
    }
    const by = {};
    const order = [];
    for (const p of Array.isArray(picks) ? picks : []) {
      const qty = num(p && p.sm_quantity);
      if (!(qty > 0)) continue;
      const b = s(p.batch_id);
      if (!(b in by)) {
        by[b] = 0;
        order.push(b);
      }
      by[b] = num(by[b] + qty);
    }
    for (const b of order) {
      rows.push({ line_id: s(l.id), line_no: s(l.line_index) || String(i + 1), item: s(l.item_name) || s(l.item_selection), batch_id: b, batch: "", dispatched: by[b], good: by[b],
        defect: 0, reason: "" });
    }
  });
  if (!rows.length) {
    this.$message.warning("Nothing was dispatched on this transfer request.");
    return;
  }
  const ids = Array.from(new Set(rows.map((r) => r.batch_id).filter((x) => x)));
  if (ids.length) {
    try {
      const res = await db.collection("batch").filter([{ type: "branch", operator: "all", children: [{ prop: "id", operator: "in", value: ids }] }]).field("batch_number").get();
      const no = {};
      for (const x of (res && res.data) || []) no[s(x.id)] = s(x.batch_number);
      rows.forEach((r) => (r.batch = r.batch_id ? no[r.batch_id] || r.batch_id : ""));
    } catch (e) {
      rows.forEach((r) => (r.batch = r.batch_id));
    }
  }
  // a dialog's children are addressed through it
  this.setData({ "iatr_receive_dialog.iatr_receive_table": rows });
  await this.openDialog("iatr_receive_dialog");
})();
