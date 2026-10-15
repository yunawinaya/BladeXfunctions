const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

// The save payload without what PO_SAVE never reads: each line's copies of the item's UOM table (alt_uom is kept as one
// JSON layer with the four keys Goods Receiving reads - it gained a layer on every form load - and table_uom_conversion
// is dropped), the header fields Fillback copies onto every line itself, and the status banners. Built once; the
// workflow's prompts re-send this same object.
const poSlimPayload = (values) => {
  const dropHeader = ["draft_status", "issued_status", "processing_status", "completed_status", "cancelled_status"];
  const dropLine = ["table_uom_conversion", "supplier_id", "plant_id", "payment_term_id", "shipping_preference_id", "billing_state_id",
    "billing_country_id", "shipping_state_id", "shipping_country_id", "organization_id", "po_created_by"];
  const altUom = (v) => {
    if (v === undefined || v === null || v === "") return v;
    try {
      let x = v;
      for (let i = 0; i < 64 && typeof x === "string"; i++) x = JSON.parse(x);
      const keep = (c) => (c && typeof c === "object" ? { alt_uom_id: c.alt_uom_id, alt_qty: c.alt_qty, base_qty: c.base_qty, base_uom_id: c.base_uom_id } : c);
      return JSON.stringify(Array.isArray(x) ? x.map(keep) : keep(x));
    } catch (e) {
      return v;
    }
  };
  const slimLine = (row) => {
    const out = {};
    for (const k of Object.keys(row || {})) if (!dropLine.includes(k)) out[k] = row[k];
    if ("alt_uom" in out) out.alt_uom = altUom(out.alt_uom);
    if (Array.isArray(row && row.children)) out.children = row.children.map(slimLine);
    return out;
  };
  const out = {};
  for (const k of Object.keys(values || {})) if (!dropHeader.includes(k)) out[k] = values[k];
  out.table_po = Array.isArray(values && values.table_po) ? values.table_po.map(slimLine) : values && values.table_po;
  return out;
};

(async () => {
  this.showLoading("Saving Purchase Orders...");
  this.models["po_status"] = "Draft";
  console.log("this.models", this.models);

  const cleanData = poSlimPayload(this.models);

  await this.runWorkflow(
    "2069257894280118274",
    { allData: cleanData },
    (res) => {
      this.$message.success(`${this.isEdit ? "Update" : "Add"} successfully`);
      closeDialog();
    },
    (err) => {
      this.hideLoading();
      this.$message.error(err || err.toString());
      console.error(err);
    },
  );
})();
