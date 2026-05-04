(async () => {
  this.showLoading("Loading inventory data...");
  try {
    const allData = this.getValues();
    const lineItemData = arguments[0]?.row;
    const rowIndex = arguments[0]?.rowIndex;
    const plant_id = allData.issuing_operation_faci;
    const materialId = lineItemData.item_selection;
    const tempQtyData = lineItemData.temp_qty_data;
    const tempHuData = lineItemData.temp_hu_data;
    const quantityUOM = lineItemData.quantity_uom;
    const organizationId = allData.organization_id;

    if (!materialId) return;

    // ============= HELPERS =============

    const fetchUomData = async (uomIds) => {
      if (!uomIds || uomIds.length === 0) return [];
      try {
        const resUOM = await Promise.all(
          uomIds.map((id) =>
            db.collection("unit_of_measurement").where({ id }).get(),
          ),
        );
        return resUOM.map((response) => response.data[0]).filter(Boolean);
      } catch (error) {
        console.error("Error fetching UOM data:", error);
        return [];
      }
    };

    const convertBaseToAlt = (baseQty, itemData, altUOM) => {
      if (
        !baseQty ||
        !Array.isArray(itemData.table_uom_conversion) ||
        itemData.table_uom_conversion.length === 0 ||
        !altUOM
      ) {
        return baseQty || 0;
      }
      const uomConversion = itemData.table_uom_conversion.find(
        (c) => c.alt_uom_id === altUOM,
      );
      if (!uomConversion || !uomConversion.base_qty) return baseQty;
      return Math.round((baseQty / uomConversion.base_qty) * 1000) / 1000;
    };

    const parseJSON = (str) => {
      if (
        !str ||
        str === "[]" ||
        (typeof str === "string" && str.trim() === "")
      )
        return [];
      try {
        const parsed = JSON.parse(str);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };

    const filterZeroQuantityRecords = (data, itemData) => {
      return data.filter((record) => {
        if (itemData.serial_number_management === 1) {
          const hasValidSerial =
            record.serial_number && record.serial_number.trim() !== "";
          if (!hasValidSerial) return false;
          return (
            (record.block_qty && record.block_qty > 0) ||
            (record.reserved_qty && record.reserved_qty > 0) ||
            (record.unrestricted_qty && record.unrestricted_qty > 0) ||
            (record.qualityinsp_qty && record.qualityinsp_qty > 0) ||
            (record.intransit_qty && record.intransit_qty > 0) ||
            (record.balance_quantity && record.balance_quantity > 0)
          );
        }
        return (
          (record.block_qty && record.block_qty > 0) ||
          (record.reserved_qty && record.reserved_qty > 0) ||
          (record.unrestricted_qty && record.unrestricted_qty > 0) ||
          (record.qualityinsp_qty && record.qualityinsp_qty > 0) ||
          (record.intransit_qty && record.intransit_qty > 0) ||
          (record.balance_quantity && record.balance_quantity > 0)
        );
      });
    };

    const generateKey = (item, itemData) => {
      if (itemData.serial_number_management === 1) {
        if (itemData.item_batch_management === 1) {
          return `${item.location_id || "no_location"}-${
            item.serial_number || "no_serial"
          }-${item.batch_id || "no_batch"}`;
        }
        return `${item.location_id || "no_location"}-${
          item.serial_number || "no_serial"
        }`;
      }
      if (itemData.item_batch_management === 1) {
        return `${item.location_id || "no_location"}-${
          item.batch_id || "no_batch"
        }`;
      }
      return `${item.location_id || item.balance_id || "no_key"}`;
    };

    const mergeWithTempData = (freshDbData, tempDataArray, itemData) => {
      if (!tempDataArray || tempDataArray.length === 0) {
        return freshDbData;
      }

      const tempDataMap = new Map(
        tempDataArray.map((tempItem) => [
          generateKey(tempItem, itemData),
          tempItem,
        ]),
      );

      const mergedData = freshDbData.map((dbItem) => {
        const key = generateKey(dbItem, itemData);
        const tempItem = tempDataMap.get(key);

        if (tempItem) {
          return {
            ...dbItem,
            ...tempItem,
            id: dbItem.id,
            balance_id: dbItem.id,
            fm_key: tempItem.fm_key,
            category: tempItem.category,
            sm_quantity: tempItem.sm_quantity,
            remarks: tempItem.remarks || dbItem.remarks,
          };
        }

        return {
          ...dbItem,
          balance_id: dbItem.id,
        };
      });

      tempDataArray.forEach((tempItem) => {
        const key = generateKey(tempItem, itemData);
        const existsInDb = freshDbData.some(
          (dbItem) => generateKey(dbItem, itemData) === key,
        );

        if (!existsInDb) {
          mergedData.push({
            ...tempItem,
            balance_id: tempItem.balance_id || tempItem.id,
          });
        }
      });

      return mergedData;
    };

    const mapBalanceData = (itemBalanceData) => {
      return Array.isArray(itemBalanceData)
        ? itemBalanceData.map((item) => {
            const { id, ...itemWithoutId } = item;
            return {
              ...itemWithoutId,
              balance_id: id,
            };
          })
        : (() => {
            const { id, ...itemWithoutId } = itemBalanceData;
            return { ...itemWithoutId, balance_id: id };
          })();
    };

    // Sum HU-bound qty by location/batch for current material — used to subtract
    // from loose item_balance display so the same physical stock isn't pickable both ways
    const fetchHuQtyByLocation = async (
      matId,
      plantId,
      orgId,
      isBatchManaged,
    ) => {
      try {
        const huRes = await db
          .collection("handling_unit")
          .where({
            plant_id: plantId,
            organization_id: orgId,
            is_deleted: 0,
          })
          .get();

        const huQtyMap = new Map();
        for (const hu of huRes.data || []) {
          const items = (hu.table_hu_items || []).filter(
            (item) => item.is_deleted !== 1 && item.material_id === matId,
          );
          for (const item of items) {
            const locationId = item.location_id || hu.location_id;
            const key = isBatchManaged
              ? `${locationId}-${item.batch_id || "no_batch"}`
              : `${locationId}`;
            const qty = parseFloat(item.quantity) || 0;
            huQtyMap.set(key, (huQtyMap.get(key) || 0) + qty);
          }
        }
        return huQtyMap;
      } catch (error) {
        console.error("Error fetching HU quantities:", error);
        return new Map();
      }
    };

    // Fetch HUs for the material. "No mixed item HU" rule: only show HUs whose every
    // active item matches the current row's material (foreign-item HUs are skipped).
    const fetchHandlingUnits = async (
      plantId,
      orgId,
      matId,
      tempHuStr,
      itemData,
      altUOM,
      otherLinesHuAllocations,
      reservedHuIdSet,
    ) => {
      try {
        const responseHU = await db
          .collection("handling_unit")
          .where({
            plant_id: plantId,
            organization_id: orgId,
            is_deleted: 0,
          })
          .get();

        const allHUs = responseHU.data || [];
        const huTableData = [];

        for (const hu of allHUs) {
          // Full HU exclusion: skip any HU with an active reservation in on_reserved_gd
          if (reservedHuIdSet && reservedHuIdSet.has(hu.id)) continue;

          const allActiveItems = (hu.table_hu_items || []).filter(
            (item) => item.is_deleted !== 1,
          );
          if (allActiveItems.length === 0) continue;

          // No mixed-item HUs: skip if any active item is a different material
          const allMatch = allActiveItems.every(
            (item) => item.material_id === matId,
          );
          if (!allMatch) continue;

          // Header row placeholder — item_quantity updated after items are added
          const headerRow = {
            row_type: "header",
            handling_unit_id: hu.id,
            handling_no: hu.handling_no,
            material_id: "",
            material_name: "",
            storage_location_id: hu.storage_location_id,
            location_id: hu.location_id,
            batch_id: null,
            item_quantity: 0,
            sm_quantity: 0,
            remark: hu.remark || "",
            balance_id: "",
          };
          huTableData.push(headerRow);

          let headerItemTotal = 0;
          for (const huItem of allActiveItems) {
            const baseQty = parseFloat(huItem.quantity) || 0;
            let displayQty = convertBaseToAlt(baseQty, itemData, altUOM);

            // Deduct other stock_movement lines' HU allocations for same HU+material+batch
            const otherLineAlloc = otherLinesHuAllocations.find(
              (a) =>
                a.handling_unit_id === hu.id &&
                a.material_id === huItem.material_id &&
                (a.batch_id || "") === (huItem.batch_id || ""),
            );
            if (otherLineAlloc) {
              displayQty = Math.max(
                0,
                displayQty - (otherLineAlloc.sm_quantity || 0),
              );
            }

            if (displayQty <= 0) continue;

            headerItemTotal += displayQty;
            huTableData.push({
              row_type: "item",
              handling_unit_id: hu.id,
              handling_no: "",
              material_id: huItem.material_id,
              material_name: huItem.material_name,
              storage_location_id: hu.storage_location_id,
              location_id: huItem.location_id || hu.location_id,
              batch_id: huItem.batch_id || null,
              item_quantity: displayQty,
              item_quantity_base: baseQty,
              sm_quantity: 0,
              remark: "",
              balance_id: huItem.balance_id || "",
              expired_date: huItem.expired_date || null,
              manufacturing_date: huItem.manufacturing_date || null,
              create_time: huItem.create_time || hu.create_time,
            });
          }

          headerRow.item_quantity = Math.round(headerItemTotal * 1000) / 1000;
        }

        // Drop header rows whose items were all fully allocated by other lines
        const huIdsWithItems = new Set(
          huTableData
            .filter((r) => r.row_type === "item")
            .map((r) => r.handling_unit_id),
        );
        const filtered = huTableData.filter(
          (r) =>
            r.row_type === "item" || huIdsWithItems.has(r.handling_unit_id),
        );

        // Restore sm_quantity from existing temp_hu_data on re-open, and re-check
        // hu_select on the matching header rows so the UI reflects prior selection.
        const parsedTempHu = parseJSON(tempHuStr);
        const huIdsWithAllocation = new Set();
        for (const tempItem of parsedTempHu) {
          if (tempItem.row_type !== "item") continue;
          const match = filtered.find(
            (row) =>
              row.row_type === "item" &&
              row.handling_unit_id === tempItem.handling_unit_id &&
              row.material_id === tempItem.material_id &&
              (row.batch_id || "") === (tempItem.batch_id || ""),
          );
          if (match) {
            match.sm_quantity = tempItem.sm_quantity || 0;
            if (match.sm_quantity > 0) {
              huIdsWithAllocation.add(tempItem.handling_unit_id);
            }
          }
        }

        // LOT enforces NO_SPLIT: set hu_select = 1 on headers whose HU has any
        // restored allocation, so the checkbox state matches the item rows.
        if (huIdsWithAllocation.size > 0) {
          for (const row of filtered) {
            if (
              row.row_type === "header" &&
              huIdsWithAllocation.has(row.handling_unit_id)
            ) {
              row.hu_select = 1;
            }
          }
        }

        return filtered;
      } catch (error) {
        console.error("Error fetching handling units:", error);
        return [];
      }
    };

    // Drawer-scoped selectors so we don't collide with same-id tabs on the parent page
    const TAB_SCOPE = `.el-drawer[role="dialog"] .el-tabs__item`;

    const hideTab = (tabName) => {
      const tab = document.querySelector(`${TAB_SCOPE}#tab-${tabName}`);
      if (tab) tab.style.display = "none";
    };

    const showTab = (tabName) => {
      const tab = document.querySelector(`${TAB_SCOPE}#tab-${tabName}`);
      if (tab) {
        tab.style.display = "flex";
        tab.setAttribute("aria-disabled", "false");
        tab.classList.remove("is-disabled");
      }
    };

    const activateTab = (tabName) => {
      const tab = document.querySelector(`${TAB_SCOPE}#tab-${tabName}`);
      if (tab) tab.click();
    };

    // ============= MAIN =============

    // Hide category-from/to + serial column. hu_select stays visible — LOT enforces
    // NO_SPLIT (whole-HU pick) and the checkbox on header rows is the picker.
    this.hide([
      "sm_item_balance.table_item_balance.category_from",
      "sm_item_balance.table_item_balance.category_to",
      "sm_item_balance.table_item_balance.serial_number",
    ]);

    // Reset tables and clear category default
    this.setData({
      "sm_item_balance.table_item_balance": [],
      "sm_item_balance.table_hu": [],
      "sm_item_balance.table_item_balance.category": undefined,
    });

    let itemData;
    try {
      const itemResponse = await db
        .collection("Item")
        .where({ id: materialId })
        .get();
      itemData = itemResponse.data?.[0];
    } catch (error) {
      console.error("Error fetching item data:", error);
      return;
    }
    if (!itemData) return;

    const altUoms =
      itemData.table_uom_conversion?.map((data) => data.alt_uom_id) || [];
    const uomOptions = await fetchUomData(altUoms);

    this.setOptionData([`sm_item_balance.material_uom`], uomOptions);
    this.setData({
      sm_item_balance: {
        material_id: itemData.material_code,
        material_name: itemData.material_name,
        row_index: rowIndex,
        material_uom: quantityUOM,
      },
    });

    const isBatchManaged = itemData.item_batch_management === 1;
    const isSerial = itemData.serial_number_management === 1;

    // Active GD reservations for this material. Used to:
    //   (a) Hide whole HUs that have any item reserved (full HU exclusion).
    //   (b) Subtract loose-stock reservations (no handling_unit_id) from the
    //       item_balance display so LOT doesn't pick stock already committed to GD.
    let activeReservations = [];
    try {
      const reservationRes = await db
        .collection("on_reserved_gd")
        .where({
          plant_id: plant_id,
          organization_id: organizationId,
          material_id: materialId,
          is_deleted: 0,
        })
        .get();
      activeReservations = (reservationRes.data || []).filter(
        (r) => parseFloat(r.open_qty || 0) > 0 && r.status !== "Cancelled",
      );
    } catch (error) {
      console.error("Error fetching on_reserved_gd:", error);
    }

    const convertReservedToBase = (qty, item_uom) => {
      if (!item_uom || item_uom === itemData.based_uom) return qty;
      const conv = itemData.table_uom_conversion?.find(
        (c) => c.alt_uom_id === item_uom,
      );
      if (conv && conv.base_qty) return qty * conv.base_qty;
      return qty;
    };

    const reservedHuIds = new Set();
    const looseReservedMap = new Map();
    for (const r of activeReservations) {
      if (r.handling_unit_id) {
        reservedHuIds.add(r.handling_unit_id);
      } else {
        const locId = r.bin_location;
        if (!locId) continue;
        const key = isBatchManaged
          ? `${locId}-${r.batch_id || "no_batch"}`
          : `${locId}`;
        const qtyBase = convertReservedToBase(
          parseFloat(r.open_qty || 0),
          r.item_uom,
        );
        looseReservedMap.set(key, (looseReservedMap.get(key) || 0) + qtyBase);
      }
    }

    let looseRowCount = 0;

    // Filter out HU-bound records from temp_qty_data — those belong to table_hu.
    // Final filter drops rows with no transferable stock: only rows with
    // unrestricted_qty > 0 OR block_qty > 0 are kept (Reserved / QI / InTransit
    // categories aren't transferable via LOT).
    const processBalanceData = (itemBalanceData, itemDataLocal) => {
      const mappedData = mapBalanceData(itemBalanceData);
      let finalData = mappedData;

      if (tempQtyData) {
        try {
          const tempArr = JSON.parse(tempQtyData).filter(
            (it) => !it.handling_unit_id,
          );
          finalData = mergeWithTempData(mappedData, tempArr, itemDataLocal);
        } catch (error) {
          console.error("Error parsing temp_qty_data:", error);
        }
      }

      return filterZeroQuantityRecords(finalData, itemDataLocal).filter(
        (r) =>
          (parseFloat(r.unrestricted_qty) || 0) > 0 ||
          (parseFloat(r.block_qty) || 0) > 0,
      );
    };

    // item_balance includes stock physically inside HUs and stock reserved by other
    // GDs — deduct both so loose display reflects what's actually available to LOT.
    // Skip serialized items: HU items don't carry serial_number.
    const applyLooseDeduction = async (freshDbData) => {
      if (isSerial) return freshDbData;
      const huQtyMap = await fetchHuQtyByLocation(
        materialId,
        plant_id,
        organizationId,
        isBatchManaged,
      );
      for (const row of freshDbData) {
        const key = isBatchManaged
          ? `${row.location_id}-${row.batch_id || "no_batch"}`
          : `${row.location_id}`;
        const huQty = huQtyMap.get(key) || 0;
        const reservedQty = looseReservedMap.get(key) || 0;
        const totalDeduct = huQty + reservedQty;
        if (totalDeduct > 0) {
          row.unrestricted_qty = Math.max(
            0,
            (row.unrestricted_qty || 0) - totalDeduct,
          );
          row.balance_quantity = Math.max(
            0,
            (row.balance_quantity || 0) - totalDeduct,
          );
        }
      }
      return freshDbData;
    };

    if (isSerial) {
      this.display([
        "sm_item_balance.table_item_balance.serial_number",
        "sm_item_balance.search_serial_number",
        "sm_item_balance.confirm_search",
        "sm_item_balance.reset_search",
      ]);

      if (isBatchManaged) {
        this.display([
          "sm_item_balance.table_item_balance.batch_id",
          "sm_item_balance.table_item_balance.dialog_expired_date",
          "sm_item_balance.table_item_balance.dialog_manufacturing_date",
        ]);
      } else {
        this.hide([
          "sm_item_balance.table_item_balance.batch_id",
          "sm_item_balance.table_item_balance.dialog_expired_date",
          "sm_item_balance.table_item_balance.dialog_manufacturing_date",
        ]);
      }

      try {
        const response = await db
          .collection("item_serial_balance")
          .where({ material_id: materialId, plant_id: plant_id })
          .get();
        const filteredData = processBalanceData(response.data || [], itemData);
        looseRowCount = filteredData.length;

        this.setData({
          [`sm_item_balance.table_item_balance`]: filteredData,
          [`sm_item_balance.table_item_balance_raw`]:
            JSON.stringify(filteredData),
        });
      } catch (error) {
        console.error("Error fetching item serial balance data:", error);
      }
    } else if (isBatchManaged) {
      this.display([
        "sm_item_balance.table_item_balance.batch_id",
        "sm_item_balance.table_item_balance.dialog_expired_date",
        "sm_item_balance.table_item_balance.dialog_manufacturing_date",
      ]);
      this.hide("sm_item_balance.table_item_balance.serial_number");

      try {
        const response = await db
          .collection("item_batch_balance")
          .where({ material_id: materialId, plant_id: plant_id })
          .get();
        const itemBalanceData = response.data || [];
        const mappedData = Array.isArray(itemBalanceData)
          ? itemBalanceData.map((item) => {
              const { id, ...itemWithoutId } = item;
              return {
                ...itemWithoutId,
                balance_id: id,
                dialog_expired_date: item.expired_date,
                dialog_manufacturing_date: item.manufacturing_date,
              };
            })
          : (() => {
              const { id, ...itemWithoutId } = itemBalanceData;
              return {
                ...itemWithoutId,
                balance_id: id,
                dialog_expired_date: itemBalanceData.expired_date,
                dialog_manufacturing_date: itemBalanceData.manufacturing_date,
              };
            })();

        const deducted = await applyLooseDeduction(mappedData);
        const filteredData = processBalanceData(deducted, itemData);
        looseRowCount = filteredData.length;

        this.setData({
          [`sm_item_balance.table_item_balance`]: filteredData,
        });
      } catch (error) {
        console.error("Error fetching item batch balance data:", error);
      }
    } else {
      this.hide([
        "sm_item_balance.table_item_balance.batch_id",
        "sm_item_balance.table_item_balance.dialog_expired_date",
        "sm_item_balance.table_item_balance.dialog_manufacturing_date",
        "sm_item_balance.table_item_balance.serial_number",
      ]);

      try {
        const response = await db
          .collection("item_balance")
          .where({ material_id: materialId, plant_id: plant_id })
          .get();
        const dbData = response.data || [];
        const deducted = await applyLooseDeduction(dbData);
        const filteredData = processBalanceData(deducted, itemData);
        looseRowCount = filteredData.length;

        this.setData({
          [`sm_item_balance.table_item_balance`]: filteredData,
          [`sm_item_balance.table_item_balance.unit_price`]:
            itemData.purchase_unit_price,
        });
      } catch (error) {
        console.error("Error fetching item balance data:", error);
      }
    }

    // ============= HU TABLE =============

    // Other stock_movement lines' HU allocations for same material — to deduct
    const otherLinesHuAllocations = [];
    if (Array.isArray(allData.stock_movement)) {
      allData.stock_movement.forEach((line, idx) => {
        if (idx === rowIndex) return;
        if (line.item_selection !== materialId) return;
        const huStr = line.temp_hu_data;
        if (!huStr || huStr === "[]") return;
        try {
          const parsed = JSON.parse(huStr);
          if (Array.isArray(parsed)) {
            parsed.forEach((alloc) => {
              if (
                alloc.row_type === "item" &&
                parseFloat(alloc.sm_quantity) > 0
              ) {
                otherLinesHuAllocations.push(alloc);
              }
            });
          }
        } catch (e) {
          console.warn(
            `Failed to parse temp_hu_data for stock_movement row ${idx}`,
          );
        }
      });
    }

    const huTableData = await fetchHandlingUnits(
      plant_id,
      organizationId,
      materialId,
      tempHuData,
      itemData,
      quantityUOM,
      otherLinesHuAllocations,
      reservedHuIds,
    );

    // Reset both tabs to visible — clears any stale hide from a previous open
    showTab("handling_unit");
    showTab("loose");

    const hasHu = huTableData.length > 0;
    const hasLoose = looseRowCount > 0;

    if (hasHu) {
      await this.setData({ "sm_item_balance.table_hu": huTableData });

      // NO_SPLIT UI: sm_quantity is auto-driven by hu_select on the header,
      // never user-editable on any row. hu_select is only clickable on headers.
      huTableData.forEach((row, idx) => {
        this.disabled([`sm_item_balance.table_hu.${idx}.sm_quantity`], true);
        if (row.row_type === "item") {
          this.disabled([`sm_item_balance.table_hu.${idx}.hu_select`], true);
        }
      });
    }

    if (!hasHu) hideTab("handling_unit");
    if (!hasLoose) hideTab("loose");

    if (hasHu && hasLoose) {
      activateTab("loose");
    } else if (hasHu) {
      activateTab("handling_unit");
    } else if (hasLoose) {
      activateTab("loose");
    }
  } catch (error) {
    console.error("Error in LOT inventory dialog:", error);
  } finally {
    this.hideLoading();
  }
})();
