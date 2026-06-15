(async () => {
  await this.openDialog("confirm_inventory");
  this.showLoading("Loading inventory data...");
  try {
    const allData = this.getValues();
    const lineItemData = arguments[0]?.row;
    const rowIndex = arguments[0]?.rowIndex;
    const plant_id = allData.plant_id || allData.plant;
    const materialId = lineItemData?.material_id;
    const tempQtyData = lineItemData?.temp_qty_data;
    const tempHuData = lineItemData?.temp_hu_data;
    const organizationId = allData.organization_id;
    // Quantities are displayed/entered in the line's return UOM. PRTsaveAsCompleted
    // interprets temp.return_quantity as return_uom_id and converts to base via
    // table_uom_conversion, and the dialog's received_qty is also in the return
    // UOM, so the displayed balances must be converted base -> return_uom_id.
    const altUOM = lineItemData?.return_uom_id;

    if (!lineItemData || !materialId) {
      console.error("Invalid line item data or missing material ID");
      return;
    }

    // ============= HELPERS =============

    const convertBaseToAlt = (baseQty, itemData, alt) => {
      if (
        !baseQty ||
        !Array.isArray(itemData.table_uom_conversion) ||
        itemData.table_uom_conversion.length === 0 ||
        !alt
      ) {
        return baseQty || 0;
      }
      const uomConversion = itemData.table_uom_conversion.find(
        (c) => c.alt_uom_id === alt,
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

    // Keep any-category-with-qty behavior (PRT lets user pick the category to
    // return from), with the serial-number existence guard for serialized items.
    const filterZeroQuantityRecords = (data, itemData) => {
      return data.filter((record) => {
        if (itemData.serial_number_management === 1) {
          const hasValidSerial =
            record.serial_number && record.serial_number.trim() !== "";
          if (!hasValidSerial) return false;
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
      return `${item.location_id || "no_location"}`;
    };

    // Restore the user's prior loose picks (return_quantity / inventory_category /
    // remarks) onto fresh DB rows, and re-append any temp-only rows.
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

      const freshKeys = freshDbData.map((d) => generateKey(d, itemData));
      const freshKeySet = new Set(freshKeys);

      const mergedData = freshDbData.map((dbItem, i) => {
        const tempItem = tempDataMap.get(freshKeys[i]);
        if (tempItem) {
          return {
            ...dbItem,
            return_quantity:
              tempItem.return_quantity || tempItem.prt_quantity || 0,
            inventory_category:
              tempItem.inventory_category ||
              tempItem.category ||
              dbItem.inventory_category ||
              "Unrestricted",
            remarks: tempItem.remarks || dbItem.remarks,
          };
        }
        return { ...dbItem, return_quantity: 0 };
      });

      tempDataArray.forEach((tempItem) => {
        const key = generateKey(tempItem, itemData);
        if (!freshKeySet.has(key)) {
          mergedData.push({
            ...tempItem,
            balance_id: tempItem.balance_id || tempItem.id,
            inventory_category:
              tempItem.inventory_category ||
              tempItem.category ||
              "Unrestricted",
          });
        }
      });

      return mergedData;
    };

    // Map a balance record to a display row: add balance_id, convert the shown
    // quantity fields base -> return UOM, alias block_qty -> blocked_qty for the
    // column, and default the category to Unrestricted.
    const mapBalanceData = (itemBalanceData) => {
      const arr = Array.isArray(itemBalanceData)
        ? itemBalanceData
        : [itemBalanceData];
      return arr.map((item) => {
        const blockAlt = convertBaseToAlt(
          parseFloat(item.block_qty) || 0,
          itemData,
          altUOM,
        );
        return {
          ...item,
          balance_id: item.id,
          unrestricted_qty: convertBaseToAlt(
            parseFloat(item.unrestricted_qty) || 0,
            itemData,
            altUOM,
          ),
          block_qty: blockAlt,
          blocked_qty: blockAlt,
          balance_quantity: convertBaseToAlt(
            parseFloat(item.balance_quantity) || 0,
            itemData,
            altUOM,
          ),
          inventory_category: item.inventory_category || "Unrestricted",
        };
      });
    };

    // Sum HU-bound qty by location/batch for current material — used to subtract
    // from loose item_balance display so the same physical stock isn't pickable
    // both ways. Reserved portion (via on_reserved_gd overlay) is excluded.
    const buildHuQtyMap = (allHUs, matId, isBatchManaged, huReservedMap) => {
      const huQtyMap = new Map();
      for (const hu of allHUs) {
        const items = (hu.table_hu_items || []).filter(
          (item) => item.is_deleted !== 1 && item.material_id === matId,
        );
        for (const item of items) {
          const locationId = item.location_id || hu.location_id;
          const key = isBatchManaged
            ? `${locationId}-${item.batch_id || "no_batch"}`
            : `${locationId}`;
          const reservedKey = `${hu.id}|${item.batch_id || ""}`;
          const reservedQty =
            (huReservedMap && huReservedMap.get(reservedKey)) || 0;
          const qty = Math.max(
            0,
            (parseFloat(item.quantity) || 0) - reservedQty,
          );
          if (qty <= 0) continue;
          huQtyMap.set(key, (huQtyMap.get(key) || 0) + qty);
        }
      }
      return huQtyMap;
    };

    // Build HU table from pre-fetched HU data. ALLOW_SPLIT: include HUs that
    // contain the current material; filter table_hu_items down to the matching
    // items. Emits PRT's `return_quantity` column (not MSI's sm_quantity) and a
    // `hu_material_id` flag that drives the column's disable binding.
    const buildHandlingUnits = (
      allHUs,
      matId,
      tempHuStr,
      itemData,
      alt,
      otherLinesHuAllocations,
      huReservedMap,
    ) => {
      const huAllocMap = new Map();
      for (const a of otherLinesHuAllocations) {
        const k = `${a.handling_unit_id}|${a.material_id}|${a.batch_id || ""}`;
        if (!huAllocMap.has(k)) huAllocMap.set(k, a);
      }

      const huTableData = [];

      for (const hu of allHUs) {
        const allActiveItems = (hu.table_hu_items || []).filter(
          (item) => item.is_deleted !== 1 && item.material_id === matId,
        );
        if (allActiveItems.length === 0) continue;

        const headerRow = {
          row_type: "header",
          handling_unit_id: hu.id,
          handling_no: hu.handling_no,
          material_id: "",
          material_name: "",
          hu_material_id: "",
          storage_location_id: hu.storage_location_id,
          location_id: hu.location_id,
          batch_id: null,
          item_quantity: 0,
          return_quantity: 0,
          remark: hu.remark || "",
          balance_id: "",
        };
        huTableData.push(headerRow);

        let headerItemTotal = 0;
        for (const huItem of allActiveItems) {
          const rawBaseQty = parseFloat(huItem.quantity) || 0;
          const reservedKey = `${hu.id}|${huItem.batch_id || ""}`;
          const reservedBase = huReservedMap?.get(reservedKey) || 0;
          const baseQty = Math.max(0, rawBaseQty - reservedBase);
          let displayQty = convertBaseToAlt(baseQty, itemData, alt);

          const k = `${hu.id}|${huItem.material_id}|${huItem.batch_id || ""}`;
          const otherLineAlloc = huAllocMap.get(k);
          if (otherLineAlloc) {
            displayQty = Math.max(
              0,
              displayQty - (otherLineAlloc.return_quantity || 0),
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
            hu_material_id: huItem.material_id,
            storage_location_id: hu.storage_location_id,
            location_id: huItem.location_id || hu.location_id,
            batch_id: huItem.batch_id || null,
            item_quantity: displayQty,
            item_quantity_base: baseQty,
            return_quantity: 0,
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
        (r) => r.row_type === "item" || huIdsWithItems.has(r.handling_unit_id),
      );

      // Restore return_quantity from existing temp_hu_data on re-open
      const parsedTempHu = parseJSON(tempHuStr);
      if (parsedTempHu.length > 0) {
        const filteredItemMap = new Map();
        for (const row of filtered) {
          if (row.row_type !== "item") continue;
          const k = `${row.handling_unit_id}|${row.material_id}|${
            row.batch_id || ""
          }`;
          if (!filteredItemMap.has(k)) filteredItemMap.set(k, row);
        }
        for (const tempItem of parsedTempHu) {
          if (tempItem.row_type !== "item") continue;
          const k = `${tempItem.handling_unit_id}|${tempItem.material_id}|${
            tempItem.batch_id || ""
          }`;
          const match = filteredItemMap.get(k);
          if (match) match.return_quantity = tempItem.return_quantity || 0;
        }
      }

      return filtered;
    };

    // Dialog-scoped selectors so we don't collide with same-id tabs on the parent
    // page. PRT's confirm_inventory renders as an el-dialog (not a drawer).
    const TAB_SCOPE = `.el-dialog .el-tabs__item`;

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

    // Hide serial column initially + the hu_select switch (ALLOW_SPLIT: user
    // types a per-item return_quantity rather than toggling whole HUs).
    this.hide([
      "confirm_inventory.table_item_balance.serial_number",
      "confirm_inventory.table_hu.hu_select",
    ]);

    // Reset both tables
    this.setData({
      "confirm_inventory.table_item_balance": [],
      "confirm_inventory.table_hu": [],
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
    if (!itemData) {
      console.error("Item not found for material ID:", materialId);
      return;
    }

    const isBatchManaged = itemData.item_batch_management === 1;
    const isSerial = itemData.serial_number_management === 1;

    const balanceCollection = isSerial
      ? "item_serial_balance"
      : isBatchManaged
        ? "item_batch_balance"
        : "item_balance";

    // Parallelize independent fetches: GD reservations, all HUs, balance.
    const [reservationRes, huRes, balanceRes] = await Promise.all([
      db
        .collection("on_reserved_gd")
        .where({
          plant_id: plant_id,
          organization_id: organizationId,
          material_id: materialId,
          is_deleted: 0,
        })
        .get()
        .catch((error) => {
          console.error("Error fetching on_reserved_gd:", error);
          return { data: [] };
        }),
      (async () => {
        // Find HU IDs containing this material via the flat sub-collection to
        // avoid the 5000-row default cap on `handling_unit`.
        try {
          const subRes = await db
            .collection("handling_unit_atu7sreg_sub")
            .where({ material_id: materialId, is_deleted: 0 })
            .get();
          const candidateHuIds = [
            ...new Set(
              (subRes.data || [])
                .map((r) => r.handling_unit_id)
                .filter(Boolean),
            ),
          ];
          if (candidateHuIds.length === 0) return { data: [] };
          return await db
            .collection("handling_unit")
            .filter([
              {
                type: "branch",
                operator: "all",
                children: [
                  { prop: "id", operator: "in", value: candidateHuIds },
                  { prop: "plant_id", operator: "equal", value: plant_id },
                  {
                    prop: "organization_id",
                    operator: "equal",
                    value: organizationId,
                  },
                  { prop: "is_deleted", operator: "equal", value: 0 },
                ],
              },
            ])
            .get();
        } catch (error) {
          console.error("Error fetching handling units:", error);
          return { data: [] };
        }
      })(),
      db
        .collection(balanceCollection)
        .where({ material_id: materialId, plant_id: plant_id })
        .get()
        .catch((error) => {
          console.error(`Error fetching ${balanceCollection} data:`, error);
          return { data: [] };
        }),
    ]);

    this.setData({
      [`confirm_inventory.material_id`]: materialId,
      [`confirm_inventory.material_name`]: itemData.material_name,
      [`confirm_inventory.received_qty`]:
        lineItemData.received_qty - lineItemData.returned_quantity,
      [`confirm_inventory.row_index`]: rowIndex,
    });

    // Only Allocated overlays matter. Loose Allocated reservations are already
    // netted into item_balance.unrestricted_qty at SO save, so we only build the
    // HU partial-reservation map (for buildHuQtyMap / buildHandlingUnits).
    const activeReservations = (reservationRes.data || []).filter(
      (r) => parseFloat(r.open_qty || 0) > 0 && r.status === "Allocated",
    );

    const convertReservedToBase = (qty, item_uom) => {
      if (!item_uom || item_uom === itemData.based_uom) return qty;
      const conv = itemData.table_uom_conversion?.find(
        (c) => c.alt_uom_id === item_uom,
      );
      if (conv && conv.base_qty) return qty * conv.base_qty;
      return qty;
    };

    const huReservedMap = new Map();
    for (const r of activeReservations) {
      if (!r.handling_unit_id) continue;
      const qtyBase = convertReservedToBase(
        parseFloat(r.open_qty || 0),
        r.item_uom,
      );
      const key = `${r.handling_unit_id}|${r.batch_id || ""}`;
      huReservedMap.set(key, (huReservedMap.get(key) || 0) + qtyBase);
    }

    const allHUs = huRes.data || [];

    // item_balance.unrestricted_qty is already net of all Allocated loose
    // reservations, so only the unreserved HU portion is deducted here to isolate
    // truly-loose stock. Skip serialized: HU items don't carry serial_number.
    const applyLooseDeduction = (freshDbData) => {
      if (isSerial) return freshDbData;
      const huQtyMap = buildHuQtyMap(
        allHUs,
        materialId,
        isBatchManaged,
        huReservedMap,
      );
      for (const row of freshDbData) {
        const key = isBatchManaged
          ? `${row.location_id}-${row.batch_id || "no_batch"}`
          : `${row.location_id}`;
        const huQty = huQtyMap.get(key) || 0;
        if (huQty > 0) {
          row.unrestricted_qty = Math.max(
            0,
            (row.unrestricted_qty || 0) - huQty,
          );
          row.balance_quantity = Math.max(
            0,
            (row.balance_quantity || 0) - huQty,
          );
        }
      }
      return freshDbData;
    };

    // Build loose-tab data: deduct HU-bound qty (in base units) -> map+convert to
    // return UOM -> merge prior loose picks (loose-only) -> filter to rows w/ qty.
    const buildLoose = (rawData, itemDataLocal, deduct) => {
      let rows = rawData.map((r) => ({ ...r }));
      if (deduct) rows = applyLooseDeduction(rows);
      const mapped = mapBalanceData(rows);
      let finalData = mapped;
      if (tempQtyData) {
        try {
          const tempArr = JSON.parse(tempQtyData).filter(
            (it) => !it.handling_unit_id,
          );
          finalData = mergeWithTempData(mapped, tempArr, itemDataLocal);
        } catch (error) {
          console.error("Error parsing temp_qty_data:", error);
        }
      }
      return filterZeroQuantityRecords(finalData, itemDataLocal);
    };

    let looseRowCount = 0;

    if (isSerial) {
      this.display("confirm_inventory.table_item_balance.serial_number");
      if (isBatchManaged) {
        this.display([
          "confirm_inventory.table_item_balance.batch_id",
          "confirm_inventory.table_item_balance.expired_date",
          "confirm_inventory.table_item_balance.manufacturing_date",
        ]);
      } else {
        this.hide([
          "confirm_inventory.table_item_balance.batch_id",
          "confirm_inventory.table_item_balance.expired_date",
          "confirm_inventory.table_item_balance.manufacturing_date",
        ]);
      }

      const filteredData = buildLoose(balanceRes.data || [], itemData, false);
      looseRowCount = filteredData.length;
      this.setData({
        [`confirm_inventory.table_item_balance`]: filteredData,
      });
    } else if (isBatchManaged) {
      this.display([
        "confirm_inventory.table_item_balance.batch_id",
        "confirm_inventory.table_item_balance.expired_date",
        "confirm_inventory.table_item_balance.manufacturing_date",
      ]);
      this.hide("confirm_inventory.table_item_balance.serial_number");

      const filteredData = buildLoose(balanceRes.data || [], itemData, true);
      looseRowCount = filteredData.length;
      this.setData({
        [`confirm_inventory.table_item_balance`]: filteredData,
      });
    } else {
      this.hide([
        "confirm_inventory.table_item_balance.batch_id",
        "confirm_inventory.table_item_balance.expired_date",
        "confirm_inventory.table_item_balance.manufacturing_date",
        "confirm_inventory.table_item_balance.serial_number",
      ]);

      const filteredData = buildLoose(balanceRes.data || [], itemData, true);
      looseRowCount = filteredData.length;
      this.setData({
        [`confirm_inventory.table_item_balance`]: filteredData,
      });
    }

    // ============= HU TABLE =============

    // Other purchase-return lines' HU allocations for same material — to deduct
    const otherLinesHuAllocations = [];
    if (Array.isArray(allData.table_prt)) {
      allData.table_prt.forEach((line, idx) => {
        if (idx === rowIndex) return;
        if (line.material_id !== materialId) return;
        const huStr = line.temp_hu_data;
        if (!huStr || huStr === "[]") return;
        try {
          const parsed = JSON.parse(huStr);
          if (Array.isArray(parsed)) {
            parsed.forEach((alloc) => {
              if (
                alloc.row_type === "item" &&
                parseFloat(alloc.return_quantity) > 0
              ) {
                otherLinesHuAllocations.push(alloc);
              }
            });
          }
        } catch (e) {
          console.warn(`Failed to parse temp_hu_data for table_prt row ${idx}`);
        }
      });
    }

    const huTableData = buildHandlingUnits(
      allHUs,
      materialId,
      tempHuData,
      itemData,
      altUOM,
      otherLinesHuAllocations,
      huReservedMap,
    );

    // Reset both tabs to visible — clears any stale hide from a previous open
    showTab("handling_unit");
    showTab("loose");

    const hasHu = huTableData.length > 0;
    const hasLoose = looseRowCount > 0;

    if (hasHu) {
      await this.setData({ "confirm_inventory.table_hu": huTableData });

      // Disable header-row return_quantity (header rows are summaries). The JSON
      // disable binding (hu_material_id === '') also handles this; we disable
      // explicitly for safety.
      const disabledPaths = [];
      for (let idx = 0; idx < huTableData.length; idx++) {
        if (huTableData[idx].row_type === "header") {
          disabledPaths.push(`confirm_inventory.table_hu.${idx}.return_quantity`);
        }
      }
      if (disabledPaths.length > 0) {
        this.disabled(disabledPaths, true);
      }
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

    // Re-init per-row loose validation state (used by the loose return_quantity
    // validator + the Confirm handler).
    window.validationState = {};
    setTimeout(() => {
      const currentData = this.getValues();
      const rowCount =
        currentData.confirm_inventory?.table_item_balance?.length || 0;
      for (let i = 0; i < rowCount; i++) {
        window.validationState[i] = true;
      }
    }, 100);
  } catch (error) {
    console.error("Error in PRT inventory dialog:", error);
  } finally {
    this.hideLoading();
  }
})();
