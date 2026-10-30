// lotRr_onConfirm_receive - Location Transfer form, the Receive dialog confirmed (reserved requests, scratchpad/iatr/RESERVED_REQUEST_PLAN.md
// Task 10): its rows checked as SUBMIT checks them (rrReceivePlan: Good + Defect = dispatched, anything lost counts as Defect; a defect needs
// its reason; one reason per line), then the Completed save runs with them (form.iatr_receipts: { <line id>: { good, defect, reason,
// batches?: { <batch id>: { good, defect } } } }, quantities as text)
(async () => {
  const s = (x) => (x === undefined || x === null ? "" : String(x)).trim();
  const num = (x) => {
    const y = parseFloat(x);
    return isFinite(y) ? Number(y.toFixed(8)) : NaN;
  };
  const q = (x) => String(Number((Number(x) || 0).toFixed(8)));
  const rows = (this.getValues().iatr_receive_dialog || {}).iatr_receive_table;
  const lines = {};
  const order = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || !s(r.line_id)) continue;
    const name = "Line " + s(r.line_no) + " (" + s(r.item);
    const label = name + (s(r.batch) ? ", batch " + s(r.batch) : "") + ")";
    const good = num(r.good);
    const defect = s(r.defect) === "" ? 0 : num(r.defect);
    const sent = num(r.dispatched);
    if (!isFinite(good) || !isFinite(defect) || good < 0 || defect < 0) {
      this.$message.warning(label + ": Good and Defect are quantities of 0 or more.");
      return;
    }
    if (Math.abs(good + defect - sent) > 1e-8) {
      this.$message.warning(label + ": Good + Defect must equal the " + sent + " dispatched - anything lost counts as Defect.");
      return;
    }
    if (defect > 0 && !s(r.reason)) {
      this.$message.warning(label + ": choose the reason for the defect.");
      return;
    }
    const id = s(r.line_id);
    if (!lines[id]) {
      lines[id] = { good: 0, defect: 0, reason: "", batches: {}, batched: false, name: name + ")" };
      order.push(id);
    }
    const L = lines[id];
    if (defect > 0) {
      if (L.reason && L.reason !== s(r.reason)) {
        this.$message.warning(L.name + ": one reason per line - choose the same reason for its batches.");
        return;
      }
      L.reason = s(r.reason);
    }
    L.good += good;
    L.defect += defect;
    if (s(r.batch_id)) {
      L.batched = true;
      L.batches[s(r.batch_id)] = { good: q(good), defect: q(defect) };
    }
  }
  if (!order.length) {
    this.$message.warning("Nothing to receive: this transfer request has no dispatched lines.");
    return;
  }
  const receipts = {};
  for (const id of order) {
    const L = lines[id];
    receipts[id] = { good: q(L.good), defect: q(L.defect), reason: L.reason };
    if (L.batched) receipts[id].batches = L.batches;
  }
  this.models["_iatr_receipts"] = receipts;
  await this.closeDialog("iatr_receive_dialog");
  await this.triggerEvent("lotV2_onClick_save_completed");
})();
