const row = arguments[0].row;
const rowIndex = arguments[0].rowIndex;

(async () => {
  try {
    const tempDataStr = row.temp_data || "[]";
    if (!tempDataStr || tempDataStr === "[]") return;

    // ============================================================
    // Locked row → source HU already exists as a real handling_unit.
    // No workflow / inventory movement; normalize state only.
    // ============================================================
    if (row.hu_row_type === "locked") {
      this.showLoading("Completing HU...");
      try {
        const lockedHuId = row.handling_unit_id;
        const lockedPackingId = this.getValue("id");

        await db
          .collection("handling_unit")
          .doc(lockedHuId)
          .update({ hu_status: "Packed" });

        await this.setData({
          [`table_hu.${rowIndex}.hu_status`]: "Completed",
        });

        if (row.source_hu_id) {
          const huSource = this.getValue("table_hu_source") || [];
          const huSourceUpdates = {};
          huSource.forEach((r, i) => {
            if (r.handling_unit_id === row.source_hu_id) {
              huSourceUpdates[`table_hu_source.${i}.hu_status`] = "Completed";
            }
          });
          if (Object.keys(huSourceUpdates).length) {
            await this.setData(huSourceUpdates);
          }
        }

        const packingResp = await db
          .collection("packing")
          .where({ id: lockedPackingId })
          .get();
        const packingDoc =
          (packingResp && packingResp.data && packingResp.data[0]) || {};
        const recordedTableHu = Array.isArray(packingDoc.table_hu)
          ? packingDoc.table_hu
          : [];

        const completedRow = { ...row, hu_status: "Completed" };
        recordedTableHu.push(completedRow);

        await db
          .collection("packing")
          .doc(lockedPackingId)
          .update({
            table_hu: recordedTableHu,
            table_hu_source: this.getValue("table_hu_source") || [],
            table_item_source: this.getValue("table_item_source") || [],
          });

        this.hideLoading();
        this.$message.success("HU completed");
      } catch (e) {
        this.hideLoading();
        throw e;
      }
      return;
    }

    this.showLoading("Completing HU...");

    const packingId = this.getValue("id");
    const packingNo = this.getValue("packing_no");
    const plantId = this.getValue("plant_id") || row.plant_id;
    const orgId = this.getValue("organization_id") || row.organization_id;

    let tempData;
    try {
      tempData = JSON.parse(tempDataStr);
    } catch (_) {
      tempData = [];
    }

    // Split nested HUs from direct items. Nested children don't move inventory —
    // they stay under their own handling_unit_id; we only relink them to the
    // new parent via parent_hu_id after the parent is created.
    const directItems = tempData.filter((it) => it.type !== "nested_hu");
    const nestedHus = tempData.filter((it) => it.type === "nested_hu");

    const items = [];
    for (const it of directItems) {
      // Packing temp_data stores bin_location (not location_id) and batch_no
      // (not batch_id) — field names come from the form's relation selectors,
      // but their stored values are the bin id / batch id.
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

    const targetHu = {
      id: row.handling_unit_id || "",
      handling_no: row.handling_no || "Auto-generated number",
      hu_material_id: row.hu_material_id,
      hu_type: row.hu_type,
      hu_quantity: row.hu_quantity || 1,
      hu_uom: row.hu_uom,
      storage_location_id: row.storage_location_id,
      location_id: row.location_id,
      parent_hu_id: row.parent_hu_id || "",
      hu_status: "Packed",
    };

    const parentTrxNo = (tempData[0] && tempData[0].gd_no) || "";

    const params = {
      plant_id: plantId,
      organization_id: orgId,
      process_type: "Load",
      trx_no: packingNo,
      parent_trx_no: parentTrxNo,
      items: items,
      source_hu: null,
      target_hu: targetHu,
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
      }
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
          "Failed to complete HU"
      );
      return;
    }

    const huId = workflowResult.data.huId;
    const huNo = workflowResult.data.huNo;

    // Relink nested child HUs to the new parent.
    for (const nested of nestedHus) {
      if (!nested.nested_hu_id) continue;
      await db
        .collection("handling_unit")
        .doc(nested.nested_hu_id)
        .update({ parent_hu_id: huId });
    }

    await this.setData({
      [`table_hu.${rowIndex}.handling_unit_id`]: huId,
      [`table_hu.${rowIndex}.handling_no`]: huNo,
      [`table_hu.${rowIndex}.hu_status`]: "Completed",
    });

    // Lock source HU so pick-selection won't offer it again.
    // (Individual items from table_item_source are already gated by
    // remaining_qty === 0 / line_status === "Fully Picked".)
    if (row.hu_row_type === "locked" && row.source_hu_id) {
      const huSource = this.getValue("table_hu_source") || [];
      const huSourceUpdates = {};
      huSource.forEach((r, i) => {
        if (r.handling_unit_id === row.source_hu_id) {
          huSourceUpdates[`table_hu_source.${i}.hu_status`] = "Completed";
        }
      });
      if (Object.keys(huSourceUpdates).length) {
        await this.setData(huSourceUpdates);
      }
    }

    // Packing DB doc: append completed row to table_hu, and persist
    // updated source tables so locks survive reload.
    const packingResp = await db
      .collection("packing")
      .where({ id: packingId })
      .get();
    const packingDoc =
      (packingResp && packingResp.data && packingResp.data[0]) || {};
    const recordedTableHu = Array.isArray(packingDoc.table_hu)
      ? packingDoc.table_hu
      : [];

    const completedRow = {
      ...row,
      handling_unit_id: huId,
      handling_no: huNo,
      hu_status: "Completed",
    };
    recordedTableHu.push(completedRow);

    await db
      .collection("packing")
      .doc(packingId)
      .update({
        table_hu: recordedTableHu,
        table_hu_source: this.getValue("table_hu_source") || [],
        table_item_source: this.getValue("table_item_source") || [],
      });

    this.hideLoading();
    this.$message.success("HU completed");
  } catch (error) {
    console.error("TableHUCompleted error:", error);
    this.hideLoading();
    this.$message.error(
      "Failed to complete HU: " + (error.message || error)
    );
  }
})();
