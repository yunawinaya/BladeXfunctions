(async () => {
  try {
    this.showLoading();
    const allListID = "custom_9zz4lqcj";

    const selectedRecords =
      this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    if (!selectedRecords || selectedRecords.length === 0) {
      this.hideLoading();
      this.$message.error("Please select at least one record.");
      return;
    }

    // Filter for Completed pickings only
    const completedPickings = selectedRecords.filter(
      (item) => item.to_status === "Completed",
    );

    if (completedPickings.length === 0) {
      this.$message.error("Please select at least one completed picking.");
      this.hideLoading();
      return;
    }

    // Filter out pickings where Delivery has been delivered
    const deliveredPickings = completedPickings.filter(
      (item) =>
        item.delivery_status === "Fully Delivered" ||
        item.delivery_status === "Partially Delivered",
    );

    if (deliveredPickings.length > 0) {
      const deliveredList = deliveredPickings
        .map(
          (item) => `${item.to_id} (Delivery Status: ${item.delivery_status})`,
        )
        .join(", ");

      if (deliveredPickings.length === completedPickings.length) {
        this.$message.error(
          `Cannot revert: Goods Delivery already delivered for ${deliveredList}`,
        );
        this.hideLoading();
        return;
      }

      this.$message.warning(`Skipping delivered pickings: ${deliveredList}`);
    }

    const validPickings = completedPickings.filter(
      (item) =>
        item.delivery_status !== "Fully Delivered" &&
        item.delivery_status !== "Partially Delivered",
    );

    const pickingNumbers = validPickings.map((item) => item.to_id);

    await this.$confirm(
      `You've selected ${
        pickingNumbers.length
      } picking(s) to revert to Created. <br> <strong>Picking Numbers:</strong> <br>${pickingNumbers.join(
        ", ",
      )} <br><br><strong>Warning:</strong> Reverting will change the picking status back to Created and remove picking records.<br><br>Do you want to proceed?`,
      "Revert Completed Picking",
      {
        confirmButtonText: "Proceed",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      },
    ).catch(() => {
      console.log("User clicked Cancel or closed the dialog");
      throw new Error();
    });

    // ===== Helpers =====

    // Match forward workflow's mergePickedTempQtyData key (includes HU)
    const pickedKey = (locationId, batchId, huId) => {
      const normBatch =
        batchId === "undefined" || batchId === null || batchId === undefined
          ? "none"
          : batchId;
      const huKey = huId || "no_hu";
      return (locationId || "no-location") + "_" + normBatch + "_" + huKey;
    };

    // For temp_qty_data the forward workflow matches by location + batch only
    // (the move logic in code_node_AGoxWP7x doesn't filter by HU). Mirror that.
    const tempLocBatchMatch = (entry, locId, batchId) => {
      const eBatch =
        entry.batch_id === "undefined" ||
        entry.batch_id === null ||
        entry.batch_id === undefined
          ? null
          : entry.batch_id;
      const sBatch =
        batchId === "undefined" || batchId === null || batchId === undefined
          ? null
          : batchId;
      return entry.location_id === locId && eBatch === sBatch;
    };

    const parseQtyArray = (raw) => {
      if (!raw) return [];
      if (Array.isArray(raw)) return raw;
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (e) {
        return [];
      }
    };

    // View stock generator matching forward workflow's PP-side format
    // (Total / DETAILS or LOOSE STOCK + HANDLING UNIT)
    const buildViewStock = (entries, uom) => {
      const active = entries.filter((e) => (e.to_quantity || 0) > 0);
      if (active.length === 0) {
        return "Total: 0 " + uom + "\n\nDETAILS:\nNo stock allocated";
      }
      const looseEntries = active.filter((e) => !e.handling_unit_id);
      const huEntries = active.filter((e) => e.handling_unit_id);
      const total = active.reduce((s, e) => s + (e.to_quantity || 0), 0);
      const fmtBatch = (e) =>
        e.batch_id ? "\n[Batch: " + e.batch_id + "]" : "";
      const looseSection = looseEntries
        .map(
          (e, i) =>
            i +
            1 +
            ". " +
            (e.location_id || "") +
            ": " +
            e.to_quantity +
            " " +
            uom +
            fmtBatch(e),
        )
        .join("\n");
      const huSection = huEntries
        .map(
          (e, i) =>
            i +
            1 +
            ". " +
            (e.handling_unit_id || "") +
            ": " +
            e.to_quantity +
            " " +
            uom +
            fmtBatch(e),
        )
        .join("\n");
      let result = "Total: " + total + " " + uom + "\n\n";
      if (looseEntries.length > 0 && huEntries.length > 0) {
        result +=
          "LOOSE STOCK:\n" + looseSection + "\n\nHANDLING UNIT:\n" + huSection;
      } else if (huEntries.length > 0) {
        result += "HANDLING UNIT:\n" + huSection;
      } else {
        result += "DETAILS:\n" + looseSection;
      }
      return result;
    };

    // ===== Process each picking =====
    const results = [];

    for (const pickingItem of validPickings) {
      const id = pickingItem.id;

      try {
        // Fetch the full transfer_order from DB — the grid's tableSelect rows
        // don't reliably include nested arrays like table_picking_items.
        const toFetch = await db.collection("transfer_order").doc(id).get();
        const fullPicking =
          toFetch.data && toFetch.data.length > 0
            ? toFetch.data[0]
            : pickingItem;

        // to_no shape differs between the grid (resolved objects {id, to_no})
        // and the DB fetch (often raw id strings). Prefer the grid's resolved
        // version if available; otherwise normalize whatever DB gives us.
        const rawToNo =
          (pickingItem.to_no && pickingItem.to_no.length > 0
            ? pickingItem.to_no
            : fullPicking.to_no) || [];
        const ppIds = rawToNo
          .map((pp) => (typeof pp === "string" ? pp : pp && pp.id))
          .filter(Boolean);
        const pickingItems = fullPicking.table_picking_items || [];
        const pickingRecords = fullPicking.table_picking_records || [];

        // ---- Step A: Reset transfer_order header ----
        const resetItems = pickingItems.map((item) =>
          item.line_status === "Cancelled"
            ? item
            : { ...item, line_status: "Open" },
        );

        await db.collection("transfer_order").doc(id).update({
          to_status: "Created",
          table_picking_items: resetItems,
          table_picking_records: [],
        });

        console.log(
          `Updated transfer_order ${id} to_status to Created and reset header items`,
        );

        // ---- Step B: Soft-delete transfer_order_vrqs3cmr_sub records ----
        const subResult = await db
          .collection("transfer_order_vrqs3cmr_sub")
          .where({ transfer_order_id: id })
          .get();

        if (subResult.data && subResult.data.length > 0) {
          await Promise.all(
            subResult.data.map((subRecord) =>
              db
                .collection("transfer_order_vrqs3cmr_sub")
                .doc(subRecord.id)
                .update({ is_deleted: 1 }),
            ),
          );
          console.log(
            `Soft deleted ${subResult.data.length} sub records for transfer_order ${id}`,
          );
        }

        // ---- Step C: Build session contribution per PP line ----
        const sessionByToLineId = {};
        for (const rec of pickingRecords) {
          const toLineId = rec.to_line_id;
          if (!toLineId) continue;
          const qty = rec.store_out_qty || 0;
          if (qty <= 0) continue;

          if (!sessionByToLineId[toLineId]) {
            sessionByToLineId[toLineId] = { pickedEntries: [], moves: [] };
          }
          // Picked breakdown lives at the final destination (target or source)
          sessionByToLineId[toLineId].pickedEntries.push({
            location_id: rec.target_location || rec.source_bin,
            batch_id: rec.target_batch || rec.batch_no || null,
            handling_unit_id: rec.handling_unit_id || null,
            to_quantity: qty,
          });
          // Track move for temp_qty_data reversal
          sessionByToLineId[toLineId].moves.push({
            source_bin: rec.source_bin,
            batch_no: rec.batch_no || null,
            target_location: rec.target_location,
            target_batch: rec.target_batch || null,
            handling_unit_id: rec.handling_unit_id || null,
            qty,
          });
        }

        // ---- Step D: Cache other TOs per PP that have touched this PP line ----
        // Used to decide whether to restore from prev_temp_qty_data or run
        // move-reversal. Any other TO that ran its workflow against this PP
        // line (In Progress or Completed) will have overwritten the PP line's
        // prev_temp_qty_data snapshot.
        const otherTouchedTOsByPP = {};
        for (const ppId of ppIds) {
          const result = await db
            .collection("transfer_order")
            .filter([
              {
                type: "branch",
                operator: "all",
                children: [
                  { prop: "to_no", operator: "in", value: [ppId] },
                  {
                    prop: "organization_id",
                    operator: "equal",
                    value: fullPicking.organization_id,
                  },
                  {
                    prop: "to_status",
                    operator: "in",
                    value: ["In Progress", "Completed"],
                  },
                ],
              },
            ])
            .get();
          otherTouchedTOsByPP[ppId] = (result.data || []).filter(
            (to) => to.id !== id,
          );
        }

        const hasOtherTouchedLine = (ppLineId) => {
          for (const ppId of ppIds) {
            const otherTOs = otherTouchedTOsByPP[ppId] || [];
            for (const otherTO of otherTOs) {
              const otherRecs = otherTO.table_picking_records || [];
              if (otherRecs.some((r) => r.to_line_id === ppLineId)) {
                return true;
              }
            }
          }
          return false;
        };

        // ---- Step E: Revert picking_plan_fwii8mvb_sub lines ----
        const toLineIds = [
          ...new Set(
            pickingItems
              .filter(
                (item) => item.to_line_id && item.line_status !== "Cancelled",
              )
              .map((item) => item.to_line_id),
          ),
        ];

        if (toLineIds.length > 0) {
          const ppLineResults = await Promise.all(
            toLineIds.map((lineId) =>
              db.collection("picking_plan_fwii8mvb_sub").doc(lineId).get(),
            ),
          );

          for (const ppLineResult of ppLineResults) {
            if (!ppLineResult.data || ppLineResult.data.length === 0) continue;
            const ppLine = ppLineResult.data[0];
            const session = sessionByToLineId[ppLine.id];

            if (!session) {
              // No records from this TO for this line (e.g., cancelled mid-flight)
              continue;
            }

            const uom = ppLine.to_uom || "PCS";

            // ===== Subtract session from picked_temp_qty_data (Bugs 2, 3) =====
            const existingPickedArr = parseQtyArray(
              ppLine.picked_temp_qty_data,
            );
            const pickedMap = new Map();
            for (const item of existingPickedArr) {
              const key = pickedKey(
                item.location_id,
                item.batch_id,
                item.handling_unit_id,
              );
              pickedMap.set(key, { ...item });
            }
            for (const entry of session.pickedEntries) {
              const key = pickedKey(
                entry.location_id,
                entry.batch_id,
                entry.handling_unit_id,
              );
              if (pickedMap.has(key)) {
                const cur = pickedMap.get(key);
                cur.to_quantity = (cur.to_quantity || 0) - entry.to_quantity;
                if (cur.to_quantity <= 0) {
                  pickedMap.delete(key);
                }
              }
            }
            const newPickedArr = Array.from(pickedMap.values());
            const newPickedQty = newPickedArr.reduce(
              (s, e) => s + (e.to_quantity || 0),
              0,
            );
            const newPickedViewStock =
              newPickedArr.length === 0
                ? ""
                : buildViewStock(newPickedArr, uom);

            // ===== Reverse this TO's moves on temp_qty_data (Bugs 4, 7) =====
            const hasOtherTouched = hasOtherTouchedLine(ppLine.id);
            const prevTempData = ppLine.prev_temp_qty_data;
            const canUsePrev =
              !hasOtherTouched &&
              prevTempData &&
              prevTempData !== "[]" &&
              prevTempData !== "";

            let newTempArr;
            let revertPath;

            if (canUsePrev) {
              newTempArr = parseQtyArray(prevTempData);
              revertPath = "restore-from-prev";
            } else {
              // Move-reversal on current temp_qty_data
              newTempArr = parseQtyArray(ppLine.temp_qty_data);
              for (const move of session.moves) {
                const hasLocationChange =
                  move.source_bin &&
                  move.target_location &&
                  move.source_bin !== move.target_location;
                const hasBatchChange =
                  move.batch_no &&
                  move.target_batch &&
                  move.batch_no !== move.target_batch;

                if (!hasLocationChange && !hasBatchChange) continue;
                if (move.qty <= 0) continue;

                // Subtract from target (post-move position)
                const targetIdx = newTempArr.findIndex((e) =>
                  tempLocBatchMatch(e, move.target_location, move.target_batch),
                );
                if (targetIdx !== -1) {
                  const t = newTempArr[targetIdx];
                  t.to_quantity = (t.to_quantity || 0) - move.qty;
                  if (typeof t.unrestricted_qty === "number") {
                    t.unrestricted_qty = Math.max(
                      0,
                      t.unrestricted_qty - move.qty,
                    );
                  }
                  if (typeof t.balance_quantity === "number") {
                    t.balance_quantity = Math.max(
                      0,
                      t.balance_quantity - move.qty,
                    );
                  }
                }

                // Add back to source (pre-move position)
                const sourceIdx = newTempArr.findIndex((e) =>
                  tempLocBatchMatch(e, move.source_bin, move.batch_no),
                );
                if (sourceIdx !== -1) {
                  const s = newTempArr[sourceIdx];
                  s.to_quantity = (s.to_quantity || 0) + move.qty;
                  s.unrestricted_qty = (s.unrestricted_qty || 0) + move.qty;
                  s.balance_quantity = (s.balance_quantity || 0) + move.qty;
                } else {
                  // Source entry was fully consumed by forward move — recreate
                  newTempArr.push({
                    material_id: ppLine.material_id,
                    location_id: move.source_bin,
                    batch_id: move.batch_no || null,
                    block_qty: 0,
                    reserved_qty: 0,
                    unrestricted_qty: move.qty,
                    qualityinsp_qty: 0,
                    intransit_qty: 0,
                    balance_quantity: move.qty,
                    plant_id: ppLine.plant_id,
                    organization_id: ppLine.organization_id,
                    is_deleted: 0,
                    to_quantity: move.qty,
                  });
                }
              }
              newTempArr = newTempArr.filter((e) => (e.to_quantity || 0) > 0);
              revertPath = hasOtherTouched
                ? "move-reversal (other TOs touched this line)"
                : prevTempData
                  ? "move-reversal (prev_temp_qty_data empty)"
                  : "move-reversal (prev_temp_qty_data missing)";
            }

            const newViewStock = buildViewStock(newTempArr, uom);

            // ===== Recompute picking_status =====
            const toQty = parseFloat(ppLine.to_qty || 0);
            let newPickingStatus;
            if (newPickedQty >= toQty && toQty > 0) {
              newPickingStatus = "Completed";
            } else if (newPickedQty > 0) {
              newPickingStatus = "In Progress";
            } else {
              newPickingStatus = "Created";
            }

            // ===== Write update =====
            await db
              .collection("picking_plan_fwii8mvb_sub")
              .doc(ppLine.id)
              .update({
                temp_qty_data: JSON.stringify(newTempArr),
                prev_temp_qty_data: null,
                view_stock: newViewStock,
                picked_qty: newPickedQty,
                picked_temp_qty_data: JSON.stringify(newPickedArr),
                picked_view_stock: newPickedViewStock,
                picking_status: newPickingStatus,
                is_force_complete: 0,
              });

            console.log(
              `Reverted picking_plan_fwii8mvb_sub ${ppLine.id} via ${revertPath}: picked_qty ${ppLine.picked_qty || 0} -> ${newPickedQty}, status -> ${newPickingStatus}`,
            );
          }
        }

        // ---- Step F: Revert picking_plan header (only if no other TOs) ----
        for (const ppId of ppIds) {
          const otherTOResult = await db
            .collection("transfer_order")
            .filter([
              {
                type: "branch",
                operator: "all",
                children: [
                  { prop: "to_no", operator: "in", value: [ppId] },
                  {
                    prop: "organization_id",
                    operator: "equal",
                    value: fullPicking.organization_id,
                  },
                ],
              },
            ])
            .get();

          const otherTOs = (otherTOResult.data || []).filter(
            (to) => to.id !== id,
          );

          if (otherTOs.length === 0) {
            await db.collection("picking_plan").doc(ppId).update({
              to_status: "Created",
              picking_status: "Created",
            });
            console.log(
              `Updated picking_plan ${ppId} to_status and picking_status to Created`,
            );
          } else {
            console.log(
              `Other transfer_order(s) found referencing PP ${ppId}, skipping picking_plan update`,
            );
          }
        }

        results.push({ to_id: pickingItem.to_id, success: true });
      } catch (error) {
        console.error(`Error reverting picking ${pickingItem.to_id}:`, error);
        results.push({
          to_id: pickingItem.to_id,
          success: false,
          error: error.message || "Failed to revert",
        });
      }
    }

    // Summary
    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    if (failCount > 0) {
      const failedItems = results
        .filter((r) => !r.success)
        .map((r) => `${r.to_id}: ${r.error}`)
        .join(", ");
      this.$message.error(
        `${successCount} succeeded, ${failCount} failed: ${failedItems}`,
      );
    } else {
      this.$message.success(
        `All ${successCount} Picking(s) reverted to Created successfully`,
      );
    }

    this.hideLoading();
    this.refresh();
    this.hide("custom_41s73hyl");
  } catch (error) {
    this.hideLoading();
    console.error(error);
  }
})();
