(async () => {
  try {
    const row = arguments[0]?.row;
    if (!row || !row.id) {
      this.$message.error("No Bill of Materials selected.");
      return;
    }

    const label = row.parent_mat_bom_version || row.id;

    // A BOM a production order was built from must not disappear under it.
    const inUse = await db
      .collection("production_order")
      .where({ bom_id: row.id, is_deleted: 0 })
      .get()
      .catch(() => ({ data: [] }));

    if (inUse.data && inUse.data.length > 0) {
      this.$message.error(
        `BOM ${label} is used by ${inUse.data.length} production order(s) and cannot be deleted.`
      );
      return;
    }

    const warning =
      row.parent_mat_is_default === 1
        ? "<br><strong>This is the default BOM for its material.</strong>"
        : "";

    await this.$confirm(
      `Delete Bill of Materials <strong>${label}</strong>?${warning}<br>This cannot be undone.`,
      "Bill of Materials Deletion",
      {
        confirmButtonText: "Delete",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      }
    ).catch(() => {
      throw new Error("cancelled");
    });

    await db
      .collection("bill_of_materials")
      .doc(row.id)
      .update({ is_deleted: 1 });

    // Soft-delete the sub-material rows too. Leaving them behind is how the
    // 40 orphaned child rows already in this table were created.
    const children = await db
      .collection("bill_of_materials_ttux02kq_sub")
      .where({ bill_of_materials_id: row.id, is_deleted: 0 })
      .get()
      .catch(() => ({ data: [] }));

    await Promise.all(
      (children.data || []).map((child) =>
        db
          .collection("bill_of_materials_ttux02kq_sub")
          .doc(child.id)
          .update({ is_deleted: 1 })
          .catch((error) =>
            console.error("Error deleting sub material row:", error)
          )
      )
    );

    this.refresh();
    this.$message.success(`Bill of Materials ${label} deleted.`);
  } catch (error) {
    if (error?.message === "cancelled") return;
    console.error(error);
    this.$message.error(
      error?.message || "Failed to delete the Bill of Materials"
    );
  }
})();
