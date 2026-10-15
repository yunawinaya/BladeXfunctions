// onUpload_poLines - Purchase Order form, onUploadSuccess of import_po_lines (Import Lines, Excel).
// PO_LINE_IMPORT checks every row (nothing is written) and answers the lines as Batch Add builds them; they go into table_po
// at once - after the lines already there, or in their place - with one recalculation, as Batch Add's confirm does.
const PO_LINE_IMPORT_ID = "2110564093187756034";

(async () => {
  const clear = () => this.setData({ import_po_lines: "" });
  const esc = (v) =>
    String(v === null || v === undefined ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const run = (params) =>
    new Promise((resolve, reject) => {
      this.runWorkflow(PO_LINE_IMPORT_ID, params, (res) => resolve(res), (err) => reject(err));
    });
  const copyRow = (row) => (Array.isArray(row.children) ? { ...row, children: row.children.map(copyRow) } : { ...row });
  // a line another document already draws on: received, invoiced or returned
  const inUse = (row) =>
    ["received_qty", "created_received_qty", "invoice_qty", "return_quantity", "created_return_qty"].some((k) => (parseFloat(row[k]) || 0) > 0);

  try {
    if (this.isView) return clear();
    const excelRows = arguments[0] && Array.isArray(arguments[0].value) ? arguments[0].value : [];
    if (excelRows.length === 0) {
      clear();
      this.$message.warning("The file has no lines.");
      return;
    }
    let organizationId = this.getValue("organization_id") || this.getVarGlobal("deptParentId");
    if (!organizationId || organizationId === "0") organizationId = this.getVarSystem("deptIds");

    this.showLoading("Reading " + excelRows.length + " line(s)...");
    let res;
    try {
      res = await run({
        rows: excelRows,
        organization_id: String(organizationId || ""),
        supplier_id: String(this.getValue("po_supplier_id") || ""),
        plant_id: String(this.getValue("po_plant") || ""),
      });
    } finally {
      this.hideLoading();
    }
    const out = (res && res.data && res.data.code !== undefined ? res.data : res && res.data && res.data.data) || {};
    if (String(out.code) !== "200") {
      let errors = [];
      try {
        errors = JSON.parse(out.errors || "[]");
      } catch (e) {
        errors = [];
      }
      const more = (parseInt(out.error_count, 10) || 0) - errors.length;
      const list = errors.map((e) => "Row " + esc(e.row) + ": " + esc(e.message)).join("<br>");
      clear();
      await this.$alert(
        esc(out.message || "The file could not be imported.") + (list ? "<br><br>" + list : "") + (more > 0 ? "<br>... and " + more + " more" : ""),
        "Import Lines",
        { type: "error", dangerouslyUseHTMLString: true },
      ).catch(() => {});
      return;
    }

    const imported = JSON.parse(out.rows || "[]");
    const altUom = JSON.parse(out.alt_uom || "{}");
    const taxOpen = new Set(JSON.parse(out.tax_open || "[]"));
    const current = (this.getValue("table_po") || []).map(copyRow);
    const filled = current.filter((row) => row.item_id || row.item_bundle_id);

    let replace = filled.length === 0;
    if (!replace) {
      const locked = current.filter(inUse).length;
      if (locked > 0) {
        await this.$confirm(
          `${imported.length} line(s) will be added after the ${filled.length} line(s) already on this purchase order (${locked} of them are received, invoiced or returned, so they cannot be replaced).`,
          "Import Lines",
          { confirmButtonText: "Add", cancelButtonText: "Cancel", type: "info" },
        );
      } else {
        const choice = await this.$confirm(
          `This purchase order already has ${filled.length} line(s). Add the file's ${imported.length} line(s) after them, or replace them?`,
          "Import Lines",
          { confirmButtonText: "Add after", cancelButtonText: "Replace", distinguishCancelAndClose: true, type: "warning" },
        )
          .then(() => "add")
          .catch((action) => (action === "cancel" ? "replace" : "close"));
        if (choice === "close") return clear();
        replace = choice === "replace";
      }
    }

    const stamp = Date.now().toString(36);
    const added = imported.map((row, i) =>
      Object.assign(row, { alt_uom: altUom[row.item_id] || "", fm_key: stamp + i.toString(36) + Math.random().toString(36).slice(2, 6) }),
    );
    // Replace drops every row; a purchase order with no line yet (a new one's empty first row) is not asked
    const rows = (replace ? [] : current).concat(added);
    const header = this.triggerEvent("POcalculation", { calcRows: rows });
    await this.setData({ table_po: rows, ...header });
    clear();

    // Lines of items with a purchase tax of their own and no tax code keep Tax Rate open, as Batch Add leaves them
    const keys = new Set(added.filter((row, i) => taxOpen.has(i)).map((row) => row.fm_key));
    setTimeout(async () => {
      await this.triggerEvent("syncBundleChildButtons");
      if (keys.size === 0) return;
      const paths = [];
      (this.getValue("table_po") || []).forEach((row, index) => {
        if (keys.has(row.fm_key) && !row.tax_preference) paths.push(`table_po.${index}.tax_percent`);
      });
      if (paths.length > 0) this.disabled(paths, false);
    }, 50);

    this.$message.success(`${added.length} line(s) imported` + (out.message ? ` (${out.message})` : ""));
  } catch (error) {
    this.hideLoading();
    clear();
    if (error) {
      console.error("Import Lines:", error);
      if (error.message) this.$message.error(error.message);
    }
  }
})();
