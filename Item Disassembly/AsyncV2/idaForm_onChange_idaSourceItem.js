// Chunked id reads with an explicit limit (the API clamps a read at IDA_READ_MAX rows, as GDonMounted.js); a short answer is read
// again for the ids it left out; a failed read rejects
const IDA_READ_CHUNK = 500;
const IDA_READ_MAX = 5000;
const idaChunks = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const idaUniq = (list) => [...new Set((list || []).filter((v) => v !== undefined && v !== null && v !== "").map(String))];
// rows of `collection` whose id is in `ids` (is_deleted 0), `fields` projected
const idaReadIds = async (collection, ids, fields) => {
  const rows = [];
  await Promise.all(
    idaChunks(idaUniq(ids), Math.min(IDA_READ_CHUNK, IDA_READ_MAX)).map(async (chunk) => {
      let left = chunk;
      while (left.length) {
        let query = db.collection(collection).filter([
          {
            type: "branch",
            operator: "all",
            children: [
              { prop: "id", operator: "in", value: left },
              { prop: "is_deleted", operator: "equal", value: 0 },
            ],
          },
        ]);
        if (fields) query = query.field(fields);
        const res = await query.limit(left.length).get();
        const got = (res && res.data) || [];
        rows.push(...got);
        const seen = new Set(got.map((row) => String(row.id)));
        const missing = left.filter((id) => !seen.has(id));
        if (!got.length || missing.length === left.length) return;
        left = missing;
      }
    }),
  );
  return { data: rows };
};
// every Item column this handler reads (.field() also prunes the Item subform joins)
const IDA_ITEM_FIELDS = "material_code,material_name,material_desc,based_uom,serial_number_management,item_batch_management,batch_number_genaration,table_uom_conversion,table_default_bin";

(async () => {
  const idaHeaderSelectionVisibility = arguments[0]?.value || "";
  const detailAreas = ["item_disassembly", "recovered_tab"];
  if (idaHeaderSelectionVisibility) this.display(detailAreas);
  else this.hide(detailAreas);
  await (async function idaSourceItemHandler(payload) {
  try {
    const rowIndex = payload?.rowIndex ?? 0;
    const itemId = payload?.value || "";
    const rescale = payload?.rescale === true;
    const preserveAllocation = payload?.preserveAllocation === true;

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    const allData = this.getValues();
    const plantId = allData.issuing_operation_faci || "";
    // Quantity changes originate in the UI-only display table. Prefer the
    // explicit event value so BOM scaling never races the main-field setData.
    let disassemblyQty =
      parseFloat(payload?.quantity ?? allData.item_qty) || 0;


    const sourceState = {
      item_id: itemId,
      [`item_display_table.${rowIndex}.item_selection`]: itemId,
      item_qty: disassemblyQty,
      [`item_display_table.${rowIndex}.item_qty`]: disassemblyQty,
    };
    if (!preserveAllocation) {
      Object.assign(sourceState, {
          stock_summary: "",
        temp_qty_data: "",
        temp_hu_data: "",
        [`item_display_table.${rowIndex}.stock_summary`]: "",
      });
    }
    await this.setData(sourceState);

    if (!preserveAllocation) {
      this.models["ida_source_stock_mode"] = "none";
      this.disabled(
        [
          `item_display_table.${rowIndex}.item_qty`,
          `item_display_table.${rowIndex}.transfer_stock`,
        ],
        true,
      );
    }

    if (!itemId) {
      this.setData({
        item_code: "",
        item_name: "",
        item_desc: "",
        item_uom: "",
        stock_movement: [],
        [`item_display_table.${rowIndex}.item_code`]: "",
        [`item_display_table.${rowIndex}.item_name`]: "",
        [`item_display_table.${rowIndex}.item_desc`]: "",
        [`item_display_table.${rowIndex}.item_uom`]: "",
      });
      return;
    }

    const fetchByIds = (collection, ids, fields) => idaReadIds(collection, ids, fields);

    const [parentRes, bomRes] = await Promise.all([
      fetchByIds("item", [itemId], IDA_ITEM_FIELDS),
      db
        .collection("bill_of_materials")
        .where({
          parent_material_code: itemId,
          organization_id: organizationId,
          is_deleted: 0,
          is_active: 1,
        })
        .get(),
    ]);

    const parentItem = parentRes.data?.[0];
    if (!parentItem) throw new Error("The selected BOM item was not found.");

    this.setData({
      item_code: parentItem.material_code || "",
      item_name: parentItem.material_name || "",
      item_desc: parentItem.material_desc || "",
      item_uom: parentItem.based_uom || "",
      [`item_display_table.${rowIndex}.item_code`]:
        parentItem.material_code || "",
      [`item_display_table.${rowIndex}.item_name`]:
        parentItem.material_name || "",
      [`item_display_table.${rowIndex}.item_desc`]:
        parentItem.material_desc || "",
      [`item_display_table.${rowIndex}.item_uom`]: parentItem.based_uom || "",
    });

    const boms = bomRes.data || [];
    if (!boms.length) {
      if (!rescale) this.setData({ stock_movement: [] });
      this.$message.warning("No active BOM was found for the selected item.");
      return;
    }

    const versionNumber = (bom) => {
      const match = /^V(\d+)$/i.exec(
        String(bom.parent_mat_bom_version || "").trim(),
      );
      return match ? Number(match[1]) : 0;
    };
    boms.sort((left, right) => {
      const defaultOrder =
        Number(right.parent_mat_is_default === 1) -
        Number(left.parent_mat_is_default === 1);
      return defaultOrder || versionNumber(right) - versionNumber(left);
    });
    const bom = boms[0];
    const bomBaseQty = parseFloat(bom.parent_mat_base_quantity) || 0;
    if (bomBaseQty <= 0) {
      throw new Error("The selected BOM has no valid base quantity.");
    }

    const components = (bom.subform_sub_material || []).filter(
      (line) => line.bom_material_code && line.consume_type !== "REF",
    );
    if (!components.length) {
      if (!rescale) this.setData({ stock_movement: [] });
      this.$message.warning("The selected BOM has no recoverable components.");
      return;
    }

    const componentIds = [
      ...new Set(components.map((line) => line.bom_material_code)),
    ];
    const componentRes = await fetchByIds("item", componentIds, IDA_ITEM_FIELDS);
    const itemMap = new Map(
      (componentRes.data || []).map((item) => [String(item.id), item]),
    );

    const uomIds = [
      ...new Set(
        components
          .flatMap((line) => {
            const item = itemMap.get(String(line.bom_material_code));
            return [
              line.sub_material_qty_uom,
              item?.based_uom,
              ...(item?.table_uom_conversion || []).map(
                (conversion) => conversion.alt_uom_id,
              ),
            ];
          })
          .filter(Boolean),
      ),
    ];
    const uomRes = await fetchByIds("unit_of_measurement", uomIds);
    const uomMap = new Map(
      (uomRes.data || []).map((uom) => [String(uom.id), uom]),
    );

    let defaultStorage = "";
    let defaultBin = "";
    if (plantId) {
      const storageRes = await db
        .collection("storage_location")
        .where({
          plant_id: plantId,
          is_deleted: 0,
          is_default: 1,
          storage_status: 1,
          location_type: "Common",
        })
        .limit(1)
        .get()
        .catch(() => ({ data: [] }));
      defaultStorage = storageRes.data?.[0]?.id || "";
      if (defaultStorage) {
        const binRes = await db
          .collection("bin_location")
          .where({
            plant_id: plantId,
            storage_location_id: defaultStorage,
            is_deleted: 0,
            is_default: 1,
            bin_status: 1,
          })
          .limit(1)
          .get()
          .catch(() => ({ data: [] }));
        defaultBin = binRes.data?.[0]?.id || "";
      }
    }

    const previousRows = Array.isArray(allData.stock_movement)
      ? allData.stock_movement
      : [];
    const hasBomRatio = (line) =>
      line?.bom_ratio !== null &&
      line?.bom_ratio !== undefined &&
      line?.bom_ratio !== "";
    const isExistingBomRow = (line) =>
      hasBomRatio(line) || (parseFloat(line?.requested_qty) || 0) > 0;

    // Only BOM rows participate in ratio scaling. Manual Add / Batch Add rows
    // stay in the table unchanged when the header quantity changes.
    const previousBomRows = previousRows.filter(isExistingBomRow);
    const manualRows = rescale
      ? previousRows
          .filter((line) => !isExistingBomRow(line))
          .map((line) => ({ ...line, bom_ratio: null }))
      : [];

    const bomRows = components.map((component, index) => {
      const componentId = String(component.bom_material_code);
      const item = itemMap.get(componentId);
      const previous = rescale
        ? previousBomRows.find(
            (line) =>
              String(line.item_selection) === componentId &&
              Number(line.line_index) === index + 1,
          ) ||
          previousBomRows.find(
            (line) => String(line.item_selection) === componentId,
          ) ||
          {}
        : {};

      const originalRatio = Number(
        (
          (parseFloat(component.sub_material_qty) || 0) / bomBaseQty
        ).toFixed(8),
      );
      const bomRatio = hasBomRatio(previous)
        ? parseFloat(previous.bom_ratio)
        : originalRatio;
      const totalQuantity = Number(
        (disassemblyQty * bomRatio).toFixed(8),
      );

      const itemDefault = (item?.table_default_bin || []).find(
        (entry) => entry.plant_id === plantId && entry.bin_location,
      );
      const uomOptions = [
        component.sub_material_qty_uom,
        item?.based_uom,
        ...(item?.table_uom_conversion || []).map(
          (conversion) => conversion.alt_uom_id,
        ),
      ]
        .filter(Boolean)
        .filter((id, position, values) => values.indexOf(id) === position)
        .map((id) => uomMap.get(String(id)))
        .filter(Boolean);

      return {
        item_selection: component.bom_material_code,
        item_name:
          component.sub_material_name || item?.material_name || "",
        item_desc:
          component.sub_material_desc || item?.material_desc || "",
        requested_qty: totalQuantity,
        bom_ratio: bomRatio,
        total_quantity: totalQuantity,
        quantity_uom:
          component.sub_material_qty_uom || item?.based_uom || "",
        storage_location_id:
          previous.storage_location_id ||
          itemDefault?.storage_location ||
          defaultStorage,
        location_id:
          previous.location_id || itemDefault?.bin_location || defaultBin,
        batch_number:
          previous.batch_number ||
          (item?.item_batch_management !== 1
            ? "-"
            : item?.batch_number_genaration === "According To System Settings"
              ? "Auto-generated batch number"
              : ""),
        manufacturing_date: previous.manufacturing_date || "",
        expired_date: previous.expired_date || "",
        item_remark:
          previous.item_remark || component.sub_material_remark || "",
        item_remark_2: previous.item_remark_2 || "",
        item_remark_3: previous.item_remark_3 || "",
        project_id: previous.project_id || allData.project_id || "",
        organization_id: organizationId,
        issuing_plant: plantId,
        line_index: index + 1,
        uom_options: JSON.stringify(uomOptions),
      };
    });

    const rows = [
      ...bomRows,
      ...manualRows.map((line, index) => ({
        ...line,
        bom_ratio: null,
        line_index: bomRows.length + index + 1,
      })),
    ];

    await this.setData({ stock_movement: rows });

    const batchFields = [
      "stock_movement.batch_number",
      "stock_movement.manufacturing_date",
      "stock_movement.expired_date",
    ];
    const hasBatchItem = rows.some(
      (line) => line?.item_selection && line.batch_number !== "-",
    );
    if (hasBatchItem) this.display(batchFields);
    else this.hide(batchFields);

    rows.forEach((line, index) => {
      let options = [];
      try {
        options = JSON.parse(line.uom_options || "[]");
      } catch (error) {
        options = [];
      }
      this.setOptionData(`stock_movement.${index}.quantity_uom`, options);
      const isNoBatch = line.batch_number === "-";
      const isSystemGenerated =
        line.batch_number === "Auto-generated batch number";
      this.disabled(
        `stock_movement.${index}.batch_number`,
        isNoBatch || isSystemGenerated,
      );
      this.disabled(
        [
          `stock_movement.${index}.manufacturing_date`,
          `stock_movement.${index}.expired_date`,
        ],
        isNoBatch,
      );
    });

    // GD-style source allocation: only take the decision away from the user when
    // there is exactly one unambiguous loose-stock record. Any HU or multiple
    // balance/batch/serial candidates leave the Select Stock link available.
    const inspectSourceStock = async () => {
      if (!plantId || !itemId) return;
    
      const isSerial = parentItem.serial_number_management === 1;
      const isBatch = parentItem.item_batch_management === 1;
      const balanceCollection = isSerial
        ? "item_serial_balance"
        : isBatch
          ? "item_batch_balance"
          : "item_balance";
    
      const [balanceRes, huSubRes] = await Promise.all([
        db
          .collection(balanceCollection)
          .where({
            material_id: itemId,
            plant_id: plantId,
            organization_id: organizationId,
            is_deleted: 0,
          })
          .limit(IDA_READ_MAX)
          .get()
          .catch(() => ({ data: [] })),
        db
          .collection("handling_unit_atu7sreg_sub")
          .where({ material_id: itemId, is_deleted: 0 })
          .limit(IDA_READ_MAX)
          .get()
          .catch(() => ({ data: [] })),
      ]);
    
      const candidateHuIds = [
        ...new Set(
          (huSubRes.data || [])
            .map((entry) => entry.handling_unit_id)
            .filter(Boolean),
        ),
      ];
      const huRes = candidateHuIds.length
        ? await db
            .collection("handling_unit")
            .filter([
              {
                type: "branch",
                operator: "all",
                children: [
                  { prop: "id", operator: "in", value: candidateHuIds },
                  { prop: "plant_id", operator: "equal", value: plantId },
                  {
                    prop: "organization_id",
                    operator: "equal",
                    value: organizationId,
                  },
                  { prop: "is_deleted", operator: "equal", value: 0 },
                ],
              },
            ])
            .field("plant_id")
            .limit(IDA_READ_MAX)
            .get()
            .catch(() => ({ data: [] }))
        : { data: [] };
    
      const candidates = (balanceRes.data || []).filter(
        (balance) => (parseFloat(balance.unrestricted_qty) || 0) > 0,
      );
      const hasHuStock = (huRes.data || []).length > 0;
      const mode = hasHuStock || candidates.length > 1
        ? "multiple"
        : candidates.length === 1
          ? "single"
          : "none";
    
      this.models["ida_source_stock_mode"] = mode;
      this.disabled(
        `item_display_table.${rowIndex}.item_qty`,
        mode !== "single",
      );
      this.disabled(
        `item_display_table.${rowIndex}.transfer_stock`,
        mode !== "multiple",
      );
    
      if (mode === "none") {
        this.$message.warning("No available stock was found for this BOM item.");
        return;
      }
      if (mode === "multiple") {
        // Quantity comes from the sum confirmed in Select Stock.
        if (!preserveAllocation) {
          await this.setData({
            item_qty: 0,
                  [`item_display_table.${rowIndex}.item_qty`]: 0,
          });
        }
        return;
      }
      if (disassemblyQty <= 0) return;
    
      const balance = candidates[0];
      const availableQty = parseFloat(balance.unrestricted_qty) || 0;
      if (availableQty < disassemblyQty) {
        // Clamp to the single source's available qty and rescale BOM rows so
        // the quantity, recovered items and stock summary stay consistent.
        this.$message.warning(
          `Only ${availableQty} is available in the single stock source. Quantity adjusted to ${availableQty}.`,
        );
        disassemblyQty = availableQty;
        const clampedRows = rows.map((line) => {
          if (!hasBomRatio(line)) return line;
          const qty = Number(
            (disassemblyQty * parseFloat(line.bom_ratio)).toFixed(8),
          );
          return { ...line, requested_qty: qty, total_quantity: qty };
        });
        await this.setData({
          item_qty: disassemblyQty,
          [`item_display_table.${rowIndex}.item_qty`]: disassemblyQty,
          stock_movement: clampedRows,
        });
      }
    
      const [binRes, batchRes, uomRes] = await Promise.all([
        balance.location_id
          ? db
              .collection("bin_location")
              .where({ id: balance.location_id, is_deleted: 0 })
              .limit(1)
              .get()
              .catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
        balance.batch_id
          ? db
              .collection("batch")
              .where({ id: balance.batch_id, is_deleted: 0 })
              .limit(1)
              .get()
              .catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
        (allData.item_uom || parentItem.based_uom)
          ? db
              .collection("unit_of_measurement")
              .where({
                id: allData.item_uom || parentItem.based_uom,
                is_deleted: 0,
              })
              .limit(1)
              .get()
              .catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
      ]);
    
      const binName =
        binRes.data?.[0]?.bin_location_combine ||
        balance.location_id ||
        "Unknown Location";
      const batchName =
        batchRes.data?.[0]?.batch_number || balance.batch_id || "";
      const uomName = uomRes.data?.[0]?.uom_name || "";
      const pick = {
        material_id: itemId,
        location_id: balance.location_id || null,
        storage_location_id: balance.storage_location_id || null,
        batch_id: balance.batch_id || null,
        serial_number: balance.serial_number || "",
        balance_id: balance.id,
        sm_quantity: disassemblyQty,
        category: "Unrestricted",
        plant_id: plantId,
        organization_id: organizationId,
        is_deleted: 0,
        expired_date: balance.expired_date || null,
        manufacturing_date: balance.manufacturing_date || null,
        unrestricted_qty: availableQty,
        balance_quantity: parseFloat(balance.balance_quantity) || 0,
      };
    
      let details =
        "1. " + binName + ": " + disassemblyQty + " " + uomName + " (UNR)";
      if (batchName) details += "\n[Batch: " + batchName + "]";
      if (pick.serial_number) details += "\n[Serial: " + pick.serial_number + "]";
      const summary =
        "Total: " +
        disassemblyQty +
        " " +
        uomName +
        "\n\nDETAILS:\n" +
        details;
    
      await this.setData({
        temp_qty_data: JSON.stringify([pick]),
        temp_hu_data: "",
        stock_summary: summary,
        [`item_display_table.${rowIndex}.stock_summary`]: summary,
      });
    };

    if (!preserveAllocation) {
      await inspectSourceStock();
    }
  } catch (error) {
    console.error("Error generating recovery items:", error);
    this.$message.error(error.message || "Failed to generate recovery items");
  }
}).call(this, arguments[0]);
})();
