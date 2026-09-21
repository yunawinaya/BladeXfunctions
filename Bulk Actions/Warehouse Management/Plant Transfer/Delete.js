// Bulk Delete Plant Transfers - soft-deletes Draft or Cancelled PTs.
//
// Draft never wrote inventory and Cancelled has already been reversed by
// PTcancelWorkflow, so there is nothing to unwind here -- this is a pure
// is_deleted flip, same as every other module's bulk delete.
//
// PT is the one Stock Movement module with a parent/child pair: cancelling an
// issuing parent also cancels its "Plant Transfer (Receiving)" child in the
// destination plant. That child carries issuing_operation_faci = destination
// plant, so it shows up in the destination's listing on its own. Deleting only
// the parent would strand it there with nothing to open it from, so a Cancelled
// parent takes its Cancelled children with it. Children are resolved in ONE
// batched query, not one per row.
(async () => {
  const listID = "plant_transfer";

  try {
    const selectedRecords =
      this.getComponent(listID)?.$refs.crud.tableSelect || [];

    if (selectedRecords.length === 0) {
      this.$message.error("Please select at least one record.");
      return;
    }

    const deletePTs = selectedRecords.filter(
      (item) =>
        item.stock_movement_status === "Draft" ||
        item.stock_movement_status === "Cancelled",
    );

    if (deletePTs.length === 0) {
      this.$message.error(
        "Please select at least one Draft or Cancelled plant transfer.",
      );
      return;
    }

    this.showLoading();

    const selectedIds = new Set(deletePTs.map((pt) => String(pt.id)));
    const cancelledIds = deletePTs
      .filter((pt) => pt.stock_movement_status === "Cancelled")
      .map((pt) => pt.id);

    // movement_type is not a list column, so the parent/child shape is not on the
    // row -- resolve it from the table. Only Cancelled children are swept: a
    // Completed receiving child means stock was actually received and its parent
    // could never have reached Cancelled anyway.
    let childrenByParent = new Map();

    if (cancelledIds.length > 0) {
      const resChildren = await db
        .collection("plant_transfer")
        .field("id,stock_movement_no,parent_id")
        .filter([
          {
            type: "branch",
            operator: "all",
            children: [
              { prop: "parent_id", operator: "in", value: cancelledIds },
              {
                prop: "stock_movement_status",
                operator: "equal",
                value: "Cancelled",
              },
              { prop: "is_deleted", operator: "equal", value: 0 },
            ],
          },
        ])
        .get()
        .catch((error) => {
          console.error("Failed to fetch receiving children:", error);
          return { data: [] };
        });

      for (const child of resChildren?.data || []) {
        // Skip a child the user already picked -- it is deleted on its own row.
        if (selectedIds.has(String(child.id))) continue;
        const key = String(child.parent_id);
        if (!childrenByParent.has(key)) childrenByParent.set(key, []);
        childrenByParent.get(key).push(child);
      }
    }

    this.hideLoading();

    const ptNumbers = deletePTs.map((item) => item.stock_movement_no);
    const childCount = [...childrenByParent.values()].reduce(
      (sum, list) => sum + list.length,
      0,
    );

    await this.$confirm(
      `You've selected ${ptNumbers.length} plant transfer(s) to delete.<br><br>` +
        `<strong>Plant Transfer Numbers:</strong><br>` +
        `${ptNumbers.join(", ")}<br><br>` +
        (childCount > 0
          ? `${childCount} cancelled receiving document(s) linked to these ` +
            `transfers will be deleted as well.<br><br>`
          : "") +
        `Do you want to proceed?`,
      "Delete Plant Transfer",
      {
        confirmButtonText: "Yes, Delete PTs",
        cancelButtonText: "No, Go Back",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      console.log("User cancelled delete operation");
      throw new Error();
    });

    this.showLoading("Deleting Plant Transfer...");

    const softDelete = (id) =>
      db.collection("plant_transfer").doc(id).update({ is_deleted: 1 });

    // The child goes first: if it fails, the parent is left alone so the pair
    // stays consistent and the user can retry the whole row.
    const results = await Promise.all(
      deletePTs.map(async (pt) => {
        try {
          for (const child of childrenByParent.get(String(pt.id)) || []) {
            await softDelete(child.id);
          }
          await softDelete(pt.id);
          return { no: pt.stock_movement_no, success: true };
        } catch (error) {
          console.error(`Failed to delete ${pt.stock_movement_no}:`, error);
          return {
            no: pt.stock_movement_no,
            success: false,
            error: error.message || "Failed to delete",
          };
        }
      }),
    );

    this.hideLoading();
    this.refresh();

    const successCount = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success);

    if (failed.length > 0) {
      this.$message.error({
        message:
          `${successCount} deleted, ${failed.length} failed:<br>` +
          failed.map((r) => `${r.no}: ${r.error}`).join("<br>"),
        dangerouslyUseHTMLString: true,
      });
    } else {
      this.$message.success(
        `Successfully deleted ${successCount} plant transfer(s).`,
      );
    }
  } catch (error) {
    this.hideLoading();
    if (error.message) {
      this.$message.error(error.message);
    }
    console.error("Error in bulk delete process:", error);
  }
})();
