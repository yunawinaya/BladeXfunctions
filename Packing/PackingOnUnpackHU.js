// Unpack action on a table_hu row (custom row-action button, NOT the platform's
// built-in row Delete). This handler must splice the row out itself.
// Paste into the `PackingOnUnpackHU` handler slot (key j6g72duk).
//
// Behavior by row kind:
//   Completed → call repack workflow (process_type: "Unload"). Keep the row,
//               clear its temp_data / counts, set hu_status "Unpacked". The
//               handling_unit record stays (now empty). Remove the row from
//               the packing doc's recorded table_hu.
//   Locked    → find source HU in table_hu_source by source_hu_id,
//               flip hu_status back to "Unpacked" on header + all item rows.
//   Generated → temp_data is dropped with the row; recompute catches up.
//
// After row removal (Locked / Generated):
//   - Fix selected_hu_index: -1 if we removed the selected row, or
//     shifted down by one if the deleted row was before the selected one.
//   - Fire PackingRecomputeSource so table_item_source projects cleanly.

(async () => {
  try {
    const rowIndex =
      arguments[0] && typeof arguments[0].index === "number"
        ? arguments[0].index
        : arguments[0] && arguments[0].rowIndex;
    const data = this.getValues();
    const tableHu = data.table_hu || [];
    const row =
      (arguments[0] && arguments[0].row) ||
      tableHu[rowIndex];

    if (!row || rowIndex === undefined || rowIndex === null) {
      this.$message.warning("Row not found.");
      return;
    }

    const existingEntries = JSON.parse(row.temp_data || "[]");

    // ============================================================
    // Completed HU → trigger Unload workflow, keep row as empty HU
    // ============================================================
    if (row.hu_status === "Completed") {
      if (!row.handling_unit_id) {
        this.$message.warning(
          "Completed row has no handling_unit_id; cannot unload.",
        );
        return;
      }

      // Locked-Completed: no workflow. Revert row status + source locks +
      // remove from packing DB. Items stay inside the source HU.
      if (row.hu_row_type === "locked") {
        try {
          await this.$confirm(
            `Un-complete HU ${row.handling_no || rowIndex + 1}? The HU stays picked but will no longer be marked completed.`,
            "Confirm",
            {
              confirmButtonText: "Un-complete",
              cancelButtonText: "Cancel",
              type: "warning",
            },
          );
        } catch {
          return;
        }

        this.showLoading("Un-completing HU...");
        try {
          const lockedUpdates = {};
          if (row.source_hu_id) {
            const huSource = data.table_hu_source || [];
            for (let i = 0; i < huSource.length; i++) {
              const r = huSource[i];
              if (
                r.handling_unit_id === row.source_hu_id &&
                (r.row_type === "header" || r.row_type === "item")
              ) {
                lockedUpdates[`table_hu_source.${i}.hu_status`] = "Picked";
              }
            }
          }
          lockedUpdates[`table_hu.${rowIndex}.hu_status`] = "Packed";
          await this.setData(lockedUpdates);

          const lockedPackingId = this.getValue("id");

          // DB records only Completed rows (ledger). This row's hu_status was
          // just reverted to "Packed" via setData above, so filtering drops it.
          const ledgerTableHu = (this.getValue("table_hu") || []).filter(
            (r) => r.hu_status === "Completed",
          );
          await db
            .collection("packing")
            .doc(lockedPackingId)
            .update({
              table_hu: ledgerTableHu,
              table_hu_source: this.getValue("table_hu_source") || [],
              table_item_source: this.getValue("table_item_source") || [],
            });

          this.hideLoading();
          this.$message.success(
            `HU ${row.handling_no || rowIndex + 1} un-completed.`,
          );
        } catch (e) {
          this.hideLoading();
          throw e;
        }
        return;
      }

      if (existingEntries.length === 0) {
        this.$message.warning("HU is already empty.");
        return;
      }

      try {
        await this.$confirm(
          `Unload HU ${row.handling_no || rowIndex + 1}? ${existingEntries.length} item(s) will be moved out of the HU; the HU will remain as an empty row.`,
          "Confirm Unload",
          {
            confirmButtonText: "Unload",
            cancelButtonText: "Cancel",
            type: "warning",
          },
        );
      } catch {
        return;
      }

      this.showLoading("Unloading HU...");

      const packingId = this.getValue("id");
      const packingNo = this.getValue("packing_no");
      const plantId = this.getValue("plant_id") || row.plant_id;
      const orgId = this.getValue("organization_id") || row.organization_id;

      // Split nested HUs from direct items. Nested children's inventory
      // stays under their own handling_unit_id — we only unlink them from
      // the parent by clearing parent_hu_id after the workflow succeeds.
      const directItems = existingEntries.filter(
        (it) => it.type !== "nested_hu",
      );
      const nestedHus = existingEntries.filter(
        (it) => it.type === "nested_hu",
      );

      const items = [];
      for (const it of directItems) {
        // Packing temp_data stores bin_location / batch_no (form-relation field
        // names); their stored values are the bin id / batch id.
        const isBatch = !!it.batch_no;
        const collection = isBatch ? "item_batch_balance" : "item_balance";
        const filter = {
          plant_id: plantId,
          material_id: it.item_id,
          location_id: it.bin_location,
        };
        if (isBatch) filter.batch_id = it.batch_no;

        const res = await db.collection(collection).where(filter).get();
        const balanceRow = (res && res.data && res.data[0]) || {};

        items.push({
          material_id: it.item_id,
          material_uom: it.item_uom,
          location_id: it.bin_location,
          batch_id: it.batch_no || null,
          balance_id: balanceRow.id || "",
          quantity: parseFloat(it.total_quantity) || 0,
        });
      }

      const sourceHu = {
        id: row.handling_unit_id,
        handling_no: row.handling_no,
        hu_material_id: row.hu_material_id,
        hu_type: row.hu_type,
        hu_quantity: row.hu_quantity || 1,
        hu_uom: row.hu_uom,
        storage_location_id: row.storage_location_id,
        location_id: row.location_id,
        parent_hu_id: row.parent_hu_id || "",
        hu_status: "Packed",
      };

      const firstGdRef =
        directItems[0] ||
        (nestedHus[0] && (nestedHus[0].children || [])[0]) ||
        null;
      const parentTrxNo = (firstGdRef && firstGdRef.gd_no) || "";

      const params = {
        plant_id: plantId,
        organization_id: orgId,
        process_type: "Unload",
        trx_no: packingNo,
        parent_trx_no: parentTrxNo,
        items: items,
        source_hu: sourceHu,
        target_hu: null,
        target_storage_location_id: row.storage_location_id,
        target_location_id: row.location_id,
        remark: row.remark || "",
        transaction_type: "Packing",
      };

      let workflowResult;
      await this.runWorkflow(
        "2043602532898443266",
        params,
        (res) => {
          workflowResult = res;
        },
        (err) => {
          workflowResult = err;
        },
      );

      if (
        !workflowResult ||
        !workflowResult.data ||
        String(workflowResult.data.code) !== "200"
      ) {
        this.hideLoading();
        this.$message.error(
          (workflowResult &&
            workflowResult.data &&
            workflowResult.data.message) ||
            "Failed to unload HU",
        );
        return;
      }

      // Unlink nested child HUs from this parent.
      for (const nested of nestedHus) {
        if (!nested.nested_hu_id) continue;
        await db
          .collection("handling_unit")
          .doc(nested.nested_hu_id)
          .update({ parent_hu_id: "" });
      }

      // Revert source HU locks (Completed / Picked → Unpacked) for Locked
      // and any nested_hu entries.
      const sourceHuIdsToRevert = new Set();
      if (row.hu_row_type === "locked" && row.source_hu_id) {
        sourceHuIdsToRevert.add(row.source_hu_id);
      }
      for (const entry of existingEntries) {
        if (entry.type === "nested_hu" && entry.nested_hu_id) {
          sourceHuIdsToRevert.add(entry.nested_hu_id);
        }
      }

      const updates = {};
      if (sourceHuIdsToRevert.size > 0) {
        const huSource = data.table_hu_source || [];
        for (let i = 0; i < huSource.length; i++) {
          const r = huSource[i];
          if (
            sourceHuIdsToRevert.has(r.handling_unit_id) &&
            (r.row_type === "header" || r.row_type === "item")
          ) {
            updates[`table_hu_source.${i}.hu_status`] = "Unpacked";
          }
        }
      }

      // Clear row contents; keep handling_unit_id + handling_no.
      updates[`table_hu.${rowIndex}.temp_data`] = "[]";
      updates[`table_hu.${rowIndex}.item_count`] = 0;
      updates[`table_hu.${rowIndex}.total_quantity`] = 0;
      updates[`table_hu.${rowIndex}.hu_status`] = "Unpacked";

      await this.setData(updates);
      await this.triggerEvent("PackingRecomputeSource");

      // DB records only Completed rows (ledger). This row's hu_status was
      // just flipped to "Unpacked" via setData above, so filtering drops it.
      const ledgerTableHu = (this.getValue("table_hu") || []).filter(
        (r) => r.hu_status === "Completed",
      );
      await db
        .collection("packing")
        .doc(packingId)
        .update({
          table_hu: ledgerTableHu,
          table_hu_source: this.getValue("table_hu_source") || [],
          table_item_source: this.getValue("table_item_source") || [],
        });

      this.hideLoading();
      this.$message.success(
        `HU ${row.handling_no || rowIndex + 1} unloaded.`,
      );
      return;
    }

    // ============================================================
    // Non-Completed rows — original splice-out behavior
    // ============================================================

    // Guard against accidental data loss when the HU contains items.
    if (existingEntries.length > 0) {
      try {
        await this.$confirm(
          `Unpack HU ${row.handling_no || rowIndex + 1}? ${existingEntries.length} item(s) will be removed from this packing.`,
          "Confirm Unpack",
          {
            confirmButtonText: "Unpack",
            cancelButtonText: "Cancel",
            type: "warning",
          },
        );
      } catch {
        // User cancelled
        return;
      }
    }

    const updates = {};

    // Collect handling_unit_ids to revert to "Unpacked" in table_hu_source:
    //   - Locked row: the Locked row's source_hu_id (Flow B / Select Existing)
    //   - Nested HU entries in temp_data: each nested_hu_id (Pick to Parent HU)
    const sourceHuIdsToRevert = new Set();
    if (row.hu_row_type === "locked" && row.source_hu_id) {
      sourceHuIdsToRevert.add(row.source_hu_id);
    }
    for (const entry of existingEntries) {
      if (entry.type === "nested_hu" && entry.nested_hu_id) {
        sourceHuIdsToRevert.add(entry.nested_hu_id);
      }
    }

    if (sourceHuIdsToRevert.size > 0) {
      const huSource = data.table_hu_source || [];
      for (let i = 0; i < huSource.length; i++) {
        const r = huSource[i];
        if (
          sourceHuIdsToRevert.has(r.handling_unit_id) &&
          (r.row_type === "header" || r.row_type === "item")
        ) {
          updates[`table_hu_source.${i}.hu_status`] = "Unpacked";
        }
      }
    }

    const newTableHu = tableHu.filter((_, i) => i !== rowIndex);
    updates.table_hu = newTableHu;

    const selectedHuIndex = Number(this.getValue("selected_hu_index"));
    if (selectedHuIndex === rowIndex) {
      updates.selected_hu_index = -1;
    } else if (selectedHuIndex > rowIndex) {
      updates.selected_hu_index = selectedHuIndex - 1;
    }

    await this.setData(updates);
    await this.triggerEvent("PackingRecomputeSource");

    this.$message.success(
      `HU ${row.handling_no || rowIndex + 1} unpacked.`,
    );
  } catch (error) {
    console.error("PackingOnUnpackHU error:", error);
    this.hideLoading();
    this.$message.error(error.message || String(error));
  }
})();
