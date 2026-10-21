(async () => {
  try {
    const row = arguments[0]?.row;
    if (!row || !row.id) {
      this.$message.error("No Item Disassembly selected.");
      return;
    }

    const label = row.stock_movement_no || row.id;
    // List rows carry dictionary fields as { dict_key }, the form as a plain string.
    const statusOf = (value) => value?.dict_key ?? value;
    const status = statusOf(row.item_disassembly_status);

    // Once a disassembly is completed the source item has left stock and the
    // recovered components have been received; deleting the document would
    // strand both. A Processing one is being completed in the background.
    const UNDELETABLE = ["Completed", "Fully Posted", "Processing"];
    if (UNDELETABLE.includes(status)) {
      this.$message.error(
        `Item Disassembly ${label} is ${status} and cannot be deleted.`
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
      `Delete Item Disassembly <strong>${escapeHtml(
        label
      )}</strong>?<br>This cannot be undone.`,
      "Item Disassembly Deletion",
      {
        confirmButtonText: "Delete",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      }
    ).catch(() => {
      throw new Error("cancelled");
    });

    // The grid can be stale (a background job may hold it now): the stored status decides.
    const storedRes = await db
      .collection("sm_item_disassembly")
      .where({ id: row.id, is_deleted: 0 })
      .field("item_disassembly_status")
      .get();
    const stored = (storedRes && storedRes.data && storedRes.data[0]) || null;
    const storedStatus = stored ? statusOf(stored.item_disassembly_status) : "";
    if (!stored || UNDELETABLE.includes(storedStatus)) {
      this.$message.error(
        stored
          ? `Item Disassembly ${label} is ${storedStatus} and cannot be deleted.`
          : `Item Disassembly ${label} is no longer available.`
      );
      this.refresh();
      return;
    }

    await db
      .collection("sm_item_disassembly")
      .doc(row.id)
      .update({ is_deleted: 1 });

    // Both subforms are real child tables; leaving them behind orphans them.
    const CHILD_TABLES = [
      "sm_item_disassembly_tlm8ve69_sub",
      "sm_item_disassembly_mw10kf66_sub",
    ];

    await Promise.all(
      CHILD_TABLES.map(async (table) => {
        const children = await db
          .collection(table)
          .where({ sm_item_disassembly_id: row.id, is_deleted: 0 })
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
    this.$message.success(`Item Disassembly ${label} deleted.`);
  } catch (error) {
    if (error?.message === "cancelled") return;
    console.error(error);
    this.$message.error(
      error?.message || "Failed to delete the Item Disassembly"
    );
  }
})();
