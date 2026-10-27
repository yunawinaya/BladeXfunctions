// dialog_print_template > onConfirm.
(async () => {
  try {
    const accessId = this.getValue("dialog_print_template.print_template_id");
    const allowed = this.getValue("ia_print_templates");
    const template = Array.isArray(allowed) && allowed.find(t => t.id === accessId);
    if (!template) {
      this.$message.error("Please select a print template.");
      return;
    }
    const templateId = template.print_template_id;
    const ids = this.getValue("ia_print_ids");
    if (typeof ids !== "string" || !ids) throw new Error("Please select Item Assembly records again.");

    if (template.template_type === "Template") {
      const query = new URLSearchParams({ item_assembly_id: ids, name: "Item Assembly" });
      const tab = window.open(`/sucode/openpage/${encodeURIComponent(templateId)}?${query}`, "_blank");
      if (!tab) throw new Error("Please allow pop-ups and try again.");
      await this.closeDialog("dialog_print_template");
      return;
    }
    if (template.template_type !== "Label") throw new Error("Unsupported print template type.");

    const lines = [];
    for (const id of ids.split(",")) {
      // Load saved header fields; the list does not declare batch_no as a column.
      const result = await db.collection("sm_item_assembly").where({ id }).get();
      if (result?.success === false || !Array.isArray(result?.data) ||
          result.data.length !== 1 || result.data[0].id !== id) {
        throw new Error("Could not load the selected Item Assembly.");
      }
      const ia = result.data[0];
      if (String(ia.is_deleted ?? "0") !== "0") throw new Error("An Item Assembly was deleted. Please refresh.");
      const batch = String(ia.batch_no || "").trim();
      // Match MSR's batch-label policy, also excluding blank batch values.
      if (!batch || batch === "-") continue;
      const itemId = ia.item_id?.id ?? ia.item_id;
      if (typeof itemId !== "string" || !itemId) throw new Error("The assembled item ID could not be resolved.");
      lines.push({
        ia_id: id,
        ia_number: ia.stock_movement_no,
        item_id: itemId,
        item_name: ia.item_name,
        batch_no: batch,
        assembled_quantity: ia.item_qty,
        quantity: 1
      });
    }
    if (!lines.length) {
      this.$message.error("All selected Item Assembly records have no batch number.");
      return;
    }
    await this.openDialog("dialog_enter_qty");
    this.setData({
      "dialog_enter_qty.ia_line": lines,
      "dialog_enter_qty.selected_template_id": templateId
    });
    await this.closeDialog("dialog_print_template");
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "Unable to prepare printing.");
  }
})();
