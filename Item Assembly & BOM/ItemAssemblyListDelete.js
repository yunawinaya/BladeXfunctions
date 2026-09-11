(async () => {
  try {
    const row = arguments[0]?.row;
    if (!row || !row.id) {
      this.$message.error("No Item Assembly selected.");
      return;
    }

    const label = row.stock_movement_no || row.id;
    const status = row.item_assembly_status;

    // Once an assembly is completed the components have left stock and the
    // assembled item has been received; deleting the document would strand both.
    if (status === "Completed" || status === "Fully Posted") {
      this.$message.error(
        `Item Assembly ${label} is ${status} and cannot be deleted.`
      );
      return;
    }

    // stock_movement_no is free text under the Manual Input serial rule, so it
    // cannot go into an HTML confirm unescaped.
    const escapeHtml = (value) =>
      String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    await this.$confirm(
      `Delete Item Assembly <strong>${escapeHtml(
        label
      )}</strong>?<br>This cannot be undone.`,
      "Item Assembly Deletion",
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
      .collection("sm_item_assembly")
      .doc(row.id)
      .update({ is_deleted: 1 });

    // Both subforms are real child tables; leaving them behind orphans them.
    const CHILD_TABLES = [
      "sm_item_assembly_tlm8ve69_sub",
      "sm_item_assembly_mw10kf66_sub",
    ];

    await Promise.all(
      CHILD_TABLES.map(async (table) => {
        const children = await db
          .collection(table)
          .where({ sm_item_assembly_id: row.id, is_deleted: 0 })
          .get()
          .catch(() => ({ data: [] }));

        await Promise.all(
          (children.data || []).map((child) =>
            db
              .collection(table)
              .doc(child.id)
              .update({ is_deleted: 1 })
              .catch((error) =>
                console.error(`Error deleting ${table} row:`, error)
              )
          )
        );
      })
    );

    this.refresh();
    this.$message.success(`Item Assembly ${label} deleted.`);
  } catch (error) {
    if (error?.message === "cancelled") return;
    console.error(error);
    this.$message.error(error?.message || "Failed to delete the Item Assembly");
  }
})();
