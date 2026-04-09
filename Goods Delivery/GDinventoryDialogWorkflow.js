(async () => {
  try {
    this.showLoading("Loading inventory data...");

    const data = this.getValues();
    const lineItemData = arguments[0]?.row;
    const rowIndex = arguments[0]?.rowIndex;

    if (!lineItemData) {
      console.error("Missing line item data");
      this.hideLoading();
      return;
    }

    const isSelectPicking = data.is_select_picking === 1;
    const splitPolicy = data.split_policy || "ALLOW_SPLIT";
    const materialId = lineItemData.material_id;
    const altUOM = lineItemData.gd_order_uom_id;
    const plantId = data.plant_id;
    const tempQtyData = lineItemData.temp_qty_data;
    const tempHuData = lineItemData.temp_hu_data;

    console.log("lineItemData", lineItemData);

    if (!materialId || !plantId) {
      console.error("Missing required material_id or plant_id");
      return;
    }

    this.hide("gd_item_balance.table_item_balance.serial_number");

    if (isSelectPicking) {
      console.log("GDPP mode: Showing to_quantity, hiding balance columns");
      this.display("gd_item_balance.table_item_balance.to_quantity");
      this.hide([
        "gd_item_balance.table_item_balance.unrestricted_qty",
        "gd_item_balance.table_item_balance.block_qty",
        "gd_item_balance.table_item_balance.reserved_qty",
        "gd_item_balance.table_item_balance.qualityinsp_qty",
        "gd_item_balance.table_item_balance.intransit_qty",
        "gd_item_balance.table_item_balance.balance_quantity",
      ]);
    } else {
      console.log(
        "Regular GD mode: Hiding to_quantity, showing balance columns",
      );
      this.hide("gd_item_balance.table_item_balance.to_quantity");
    }

    const fetchUomData = async (uomIds) => {
      if (!Array.isArray(uomIds) || uomIds.length === 0) {
        console.warn("No UOM IDs provided to fetchUomData");
        return [];
      }

      try {
        const resUOM = await Promise.all(
          uomIds.map((id) =>
            db.collection("unit_of_measurement").where({ id }).get(),
          ),
        );

        const uomData = resUOM
          .map((response) => response.data?.[0])
          .filter(Boolean);

        return uomData;
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
        (conv) => conv.alt_uom_id === altUOM,
      );

      if (!uomConversion || !uomConversion.base_qty) {
        return baseQty;
      }

      return Math.round((baseQty / uomConversion.base_qty) * 1000) / 1000;
    };

    const processItemBalanceData = (
      itemBalanceData,
      itemData,
      altUOM,
      baseUOM,
    ) => {
      if (!Array.isArray(itemBalanceData)) {
        return [];
      }

      return itemBalanceData.map((record) => {
        const processedRecord = { ...record };

        if (altUOM !== baseUOM) {
          const quantityFields = [
            "block_qty",
            "reserved_qty",
            "unrestricted_qty",
            "qualityinsp_qty",
            "intransit_qty",
            "balance_quantity",
          ];

          quantityFields.forEach((field) => {
            if (processedRecord[field]) {
              processedRecord[field] = convertBaseToAlt(
                processedRecord[field],
                itemData,
                altUOM,
              );
            }
          });
        }

        return processedRecord;
      });
    };

    const generateRecordKey = (item, itemData) => {
      if (itemData.serial_number_management === 1) {
        if (itemData.item_batch_management === 1) {
          return `${item.location_id}-${item.serial_number || "no_serial"}-${
            item.batch_id || "no_batch"
          }`;
        } else {
          return `${item.location_id}-${item.serial_number || "no_serial"}`;
        }
      } else if (itemData.item_batch_management === 1) {
        return `${item.location_id}-${item.batch_id || "no_batch"}`;
      } else {
        return `${item.location_id}`;
      }
    };

    const mergeWithTempData = (freshDbData, tempDataArray, itemData) => {
      if (!Array.isArray(tempDataArray) || tempDataArray.length === 0) {
        console.log("No temp data to merge, using fresh DB data");
        return freshDbData.map((item) => ({ ...item, gd_quantity: 0 }));
      }

      console.log("Merging fresh DB data with existing temp data");

      const tempDataMap = new Map();
      tempDataArray.forEach((tempItem) => {
        const key = generateRecordKey(tempItem, itemData);
        tempDataMap.set(key, tempItem);
      });

      if (itemData.serial_number_management === 1) {
        this.display("gd_item_balance.table_item_balance.serial_number");
      }

      const mergedData = freshDbData.map((dbItem) => {
        const key = generateRecordKey(dbItem, itemData);
        const tempItem = tempDataMap.get(key);

        if (tempItem) {
          console.log(
            `Merging data for ${key}: DB unrestricted=${dbItem.unrestricted_qty}, temp gd_quantity=${tempItem.gd_quantity}`,
          );
          return {
            ...dbItem,
            gd_quantity: tempItem.gd_quantity,
            remarks: tempItem.remarks || dbItem.remarks,
          };
        } else {
          return {
            ...dbItem,
            gd_quantity: 0,
          };
        }
      });

      tempDataArray.forEach((tempItem) => {
        const tempKey = generateRecordKey(tempItem, itemData);

        const existsInDb = freshDbData.some((dbItem) => {
          const dbKey = generateRecordKey(dbItem, itemData);
          return dbKey === tempKey;
        });

        if (!existsInDb) {
          console.log(`Adding temp-only data for ${tempKey}`);
          mergedData.push(tempItem);
        }
      });

      return mergedData;
    };

    const processTempQtyDataOnly = (
      tempDataArray,
      itemData,
      altUOM,
      baseUOM,
    ) => {
      console.log("GDPP mode: Using temp_qty_data directly without DB fetch");

      if (!Array.isArray(tempDataArray) || tempDataArray.length === 0) {
        console.log("No temp data available");
        return [];
      }

      return tempDataArray.map((record) => {
        const processedRecord = { ...record };

        if (altUOM !== baseUOM) {
          if (processedRecord.unrestricted_qty) {
            processedRecord.unrestricted_qty = convertBaseToAlt(
              processedRecord.unrestricted_qty,
              itemData,
              altUOM,
            );
          }
          if (processedRecord.balance_quantity) {
            processedRecord.balance_quantity = convertBaseToAlt(
              processedRecord.balance_quantity,
              itemData,
              altUOM,
            );
          }
        }

        return processedRecord;
      });
    };

    const filterZeroQuantityRecords = (data, itemData) => {
      if (!Array.isArray(data)) {
        return [];
      }

      return data.filter((record) => {
        if (itemData.serial_number_management === 1) {
          const hasValidSerial =
            record.serial_number && record.serial_number.trim() !== "";

          if (!hasValidSerial) {
            return false;
          }

          const hasQuantity =
            (record.block_qty && record.block_qty > 0) ||
            (record.reserved_qty && record.reserved_qty > 0) ||
            (record.unrestricted_qty && record.unrestricted_qty > 0) ||
            (record.qualityinsp_qty && record.qualityinsp_qty > 0) ||
            (record.intransit_qty && record.intransit_qty > 0) ||
            (record.balance_quantity && record.balance_quantity > 0);

          console.log(
            `Serial ${record.serial_number}: hasQuantity=${hasQuantity}, unrestricted=${record.unrestricted_qty}, reserved=${record.reserved_qty}, balance=${record.balance_quantity}`,
          );

          return hasQuantity;
        }

        const hasQuantity =
          (record.block_qty && record.block_qty > 0) ||
          (record.reserved_qty && record.reserved_qty > 0) ||
          (record.unrestricted_qty && record.unrestricted_qty > 0) ||
          (record.qualityinsp_qty && record.qualityinsp_qty > 0) ||
          (record.intransit_qty && record.intransit_qty > 0) ||
          (record.balance_quantity && record.balance_quantity > 0);

        return hasQuantity;
      });
    };

    // Auto allocation via global workflow (handles both HU + loose in one call)
    const applyAutoAllocation = async (
      huTableData,
      balanceData,
      itemData,
      plantId,
      organizationId,
      requestedQty,
      allocationStrategy,
      existingAllocations,
      soLineItemId,
      huPriority,
      splitPolicy,
      lineMaterials,
    ) => {
      const isBatchManaged = itemData.item_batch_management === 1;
      const isPending = soLineItemId ? 1 : 0;

      const workflowParams = {
        material_id: itemData.id,
        quantity: requestedQty,
        plant_id: plantId,
        organization_id: organizationId,
        allocationType: "GD",
        allocationStrategy: allocationStrategy,
        isPending: isPending,
        parent_line_id: soLineItemId || "",
        existingAllocationData: existingAllocations,
        // Pass base UOM quantities to workflow (un-deducted) — workflow deducts via huReservedMap
        huData: huTableData.map((row) =>
          row.row_type === "item" && row.item_quantity_base != null
            ? { ...row, item_quantity: row.item_quantity_base }
            : row,
        ),
        huPriority: huPriority,
        currentDocId: data.id || "",
        orderUomId: altUOM || "",
        splitPolicy: splitPolicy || "ALLOW_SPLIT",
        lineMaterials: lineMaterials || [],
      };

      console.log(
        "Calling auto allocation workflow with params:",
        workflowParams,
      );

      let workflowResult;
      try {
        workflowResult = await new Promise((resolve, reject) => {
          this.runWorkflow(
            "2032298961937842178",
            workflowParams,
            (res) => resolve(res),
            (err) => reject(err),
          );
        });
      } catch (err) {
        console.error("Auto allocation workflow failed:", err);
        return;
      }

      console.log("Workflow result:", workflowResult);

      const allocationResult = workflowResult?.data || workflowResult;

      if (
        !allocationResult ||
        !allocationResult.allocationData ||
        allocationResult.allocationData.length === 0
      ) {
        console.log(
          "Workflow returned no allocation:",
          allocationResult?.message,
        );
        balanceData.forEach((b) => (b.gd_quantity = 0));
        return;
      }

      const allocationData = allocationResult.allocationData;

      // Split results: HU allocations vs loose allocations
      const generateKey = (locationId, batchId) => {
        if (isBatchManaged) {
          return `${locationId}-${batchId || "no_batch"}`;
        }
        return `${locationId}`;
      };

      // Apply HU allocations back to huTableData
      for (const alloc of allocationData) {
        if (alloc.source === "hu" && alloc.handling_unit_id) {
          const huItem = huTableData.find(
            (row) =>
              row.row_type === "item" &&
              row.handling_unit_id === alloc.handling_unit_id &&
              row.material_id === (alloc.material_id || "") &&
              (row.batch_id || "") === (alloc.batch_id || ""),
          );
          if (huItem) {
            huItem.deliver_quantity = alloc.gd_quantity || 0;
          }
        }
      }

      // Apply loose allocations back to balanceData
      const looseAllocations = allocationData.filter((a) => a.source !== "hu");
      const allocationMap = new Map();
      for (const alloc of looseAllocations) {
        const key = generateKey(alloc.location_id, alloc.batch_id);
        const existing = allocationMap.get(key) || 0;
        allocationMap.set(key, existing + (alloc.gd_quantity || 0));
      }

      const remainingAllocation = new Map(allocationMap);
      for (const balance of balanceData) {
        const key = generateKey(balance.location_id, balance.batch_id);
        const remaining = remainingAllocation.get(key) || 0;

        if (remaining > 0) {
          // Trust the workflow's allocation amount — it already validated availability
          // including reserved qty and UOM conversions. Don't cap against dialog's
          // unrestricted_qty which may not include reserved stock.
          balance.gd_quantity = remaining;
          remainingAllocation.set(key, 0);
        } else {
          balance.gd_quantity = 0;
        }
      }

      const totalHu = huTableData
        .filter((r) => r.row_type === "item")
        .reduce((sum, r) => sum + (r.deliver_quantity || 0), 0);
      const totalLoose = balanceData.reduce(
        (sum, r) => sum + (r.gd_quantity || 0),
        0,
      );
      console.log(
        `Auto allocation complete (${allocationStrategy}): HU=${totalHu}, Loose=${totalLoose}`,
      );
    };

    const parseTempQtyData = (tempQtyData) => {
      if (!tempQtyData) {
        return [];
      }

      try {
        const parsed = JSON.parse(tempQtyData);
        console.log("Parsed temp data:", parsed);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        console.error("Error parsing temp_qty_data:", error);
        return [];
      }
    };

    const fetchHandlingUnits = async (
      plantId,
      organizationId,
      materialId,
      tempHuDataStr,
      itemData,
      altUOM,
      otherLinesHuAllocations,
      splitPolicy,
    ) => {
      try {
        // Single query: fetch all HUs for this plant/org, filter items by material in JS
        const responseHU = await db
          .collection("handling_unit")
          .where({
            plant_id: plantId,
            organization_id: organizationId,
            is_deleted: 0,
          })
          .get();

        const allHUs = responseHU.data || [];
        const huTableData = [];

        // Fetch cross-GD HU reservations for display deduction
        const huReservationRes = await db
          .collection("on_reserved_gd")
          .where({
            plant_id: plantId,
            organization_id: organizationId,
            material_id: materialId,
            status: "Allocated",
            is_deleted: 0,
          })
          .get();

        const currentDocId = data.id || "";
        const huReservations = (huReservationRes.data || []).filter(
          (r) =>
            r.handling_unit_id &&
            parseFloat(r.open_qty) > 0 &&
            (!currentDocId || r.doc_id !== currentDocId),
        );

        for (const hu of allHUs) {
          const allActiveItems = (hu.table_hu_items || []).filter(
            (item) => item.is_deleted !== 1,
          );
          const hasCurrentMaterial = allActiveItems.some(
            (item) => item.material_id === materialId,
          );
          if (!hasCurrentMaterial) continue;

          const itemsToShow =
            splitPolicy === "ALLOW_SPLIT"
              ? allActiveItems.filter((item) => item.material_id === materialId)
              : allActiveItems;

          // Header row placeholder — item_quantity updated after processing items
          const headerRow = {
            row_type: "header",
            hu_select: 0,
            handling_unit_id: hu.id,
            handling_no: hu.handling_no,
            material_id: "",
            material_name: "",
            storage_location_id: hu.storage_location_id,
            location_id: hu.location_id,
            batch_id: null,
            item_quantity: 0,
            deliver_quantity: 0,
            remark: hu.remark || "",
            balance_id: "",
          };
          huTableData.push(headerRow);

          // Item rows — convert quantity to alt UOM for display
          let headerItemTotal = 0;
          for (const huItem of itemsToShow) {
            const baseQty = parseFloat(huItem.quantity) || 0;
            const isForeignItem = huItem.material_id !== materialId;
            // For foreign items: show raw base qty (UOM conversion is for current material only)
            let displayQty = isForeignItem ? baseQty : convertBaseToAlt(baseQty, itemData, altUOM);

            // Deduct other lines' HU allocations for same HU item
            const otherLineAlloc = otherLinesHuAllocations.find(
              (a) =>
                a.handling_unit_id === hu.id &&
                a.material_id === huItem.material_id &&
                (a.batch_id || "") === (huItem.batch_id || ""),
            );
            if (otherLineAlloc) {
              displayQty = Math.max(
                0,
                displayQty - (otherLineAlloc.deliver_quantity || 0),
              );
            }

            // Deduct cross-GD HU reservations from on_reserved_gd
            const crossGdReserved = huReservations
              .filter(
                (r) =>
                  r.handling_unit_id === hu.id &&
                  String(r.material_id || "") ===
                    String(huItem.material_id || "") &&
                  (r.batch_id || "") === (huItem.batch_id || ""),
              )
              .reduce((sum, r) => sum + parseFloat(r.open_qty || 0), 0);
            if (crossGdReserved > 0) {
              displayQty = Math.max(0, displayQty - crossGdReserved);
            }

            // Skip items with zero available quantity (fully reserved elsewhere)
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
              deliver_quantity: 0,
              remark: "",
              balance_id: huItem.balance_id || "",
              expired_date: huItem.expired_date || null,
              manufacturing_date: huItem.manufacturing_date || null,
              create_time: huItem.create_time || hu.create_time,
            });
          }

          // Update header with sum of visible item quantities (after deductions)
          headerRow.item_quantity = Math.round(headerItemTotal * 1000) / 1000;
        }

        // Remove header rows that have no item rows (fully reserved HU)
        const huIdsWithItems = new Set(
          huTableData
            .filter((r) => r.row_type === "item")
            .map((r) => r.handling_unit_id),
        );
        const filteredHuTableData = huTableData.filter(
          (r) =>
            r.row_type === "item" || huIdsWithItems.has(r.handling_unit_id),
        );
        huTableData.length = 0;
        huTableData.push(...filteredHuTableData);

        // Merge with existing temp_hu_data (restore deliver_quantity on re-open)
        const parsedTempHu = parseTempQtyData(tempHuDataStr);
        const huIdsWithAllocation = new Set();
        for (const tempItem of parsedTempHu) {
          if (tempItem.row_type !== "item") continue;
          const match = huTableData.find(
            (row) =>
              row.row_type === "item" &&
              row.handling_unit_id === tempItem.handling_unit_id &&
              row.material_id === tempItem.material_id &&
              (row.batch_id || "") === (tempItem.batch_id || ""),
          );
          if (match) {
            match.deliver_quantity = tempItem.deliver_quantity || 0;
            if (tempItem.deliver_quantity > 0) {
              huIdsWithAllocation.add(tempItem.handling_unit_id);
            }
          }
        }

        // For FULL_HU_PICK/NO_SPLIT: set hu_select = 1 on headers with existing allocations
        if (splitPolicy !== "ALLOW_SPLIT" && huIdsWithAllocation.size > 0) {
          for (const row of huTableData) {
            if (
              row.row_type === "header" &&
              huIdsWithAllocation.has(row.handling_unit_id)
            ) {
              row.hu_select = 1;
            }
          }
        }

        console.log(
          `Found ${huTableData.length} HU rows for material ${materialId}`,
        );
        return huTableData;
      } catch (error) {
        console.error("Error fetching handling units:", error);
        return [];
      }
    };

    const setTableBalanceData = async (
      filteredData,
      includeRawData = false,
    ) => {
      const finalData = filteredData;

      await this.setData({
        [`gd_item_balance.table_item_balance`]: finalData,
      });

      if (includeRawData) {
        this.setData({
          [`gd_item_balance.table_item_balance_raw`]:
            JSON.stringify(filteredData),
        });
      }
    };

    const processGDPPMode = (
      tempQtyData,
      itemData,
      altUOM,
      baseUOM,
      includeRawData = false,
    ) => {
      const tempDataArray = parseTempQtyData(tempQtyData);
      const finalData = processTempQtyDataOnly(
        tempDataArray,
        itemData,
        altUOM,
        baseUOM,
      );

      console.log("Final data (GDPP):", finalData);
      setTableBalanceData(finalData, includeRawData);
    };

    const processRegularMode = async (
      collectionName,
      materialId,
      plantId,
      tempQtyData,
      itemData,
      altUOM,
      baseUOM,
      includeRawData = false,
    ) => {
      try {
        const response = await db
          .collection(collectionName)
          .where({
            material_id: materialId,
            plant_id: plantId,
          })
          .get();

        console.log(`response ${collectionName}`, response);

        const freshDbData = response.data || [];
        const processedFreshData = processItemBalanceData(
          freshDbData,
          itemData,
          altUOM,
          baseUOM,
        );
        const tempDataArray = parseTempQtyData(tempQtyData);
        // Filter out HU records — they are handled separately via table_hu
        const balanceTempData = tempDataArray.filter(
          (item) => !item.handling_unit_id,
        );
        let finalData = mergeWithTempData(
          processedFreshData,
          balanceTempData,
          itemData,
        );

        const filteredData = filterZeroQuantityRecords(finalData, itemData);

        console.log("Final filtered data:", filteredData);
        setTableBalanceData(filteredData, includeRawData);
      } catch (error) {
        console.error(`Error fetching ${collectionName} data:`, error);
      }
    };

    const response = await db
      .collection("Item")
      .where({ id: materialId })
      .get();

    console.log("response item", response);

    if (!response.data || response.data.length === 0) {
      console.error("Item not found:", materialId);
      return;
    }

    const itemData = response.data[0];
    const baseUOM = itemData.based_uom;
    const organizationId = data.organization_id;
    const requestedQty = parseFloat(lineItemData.gd_qty) || 0;

    // Collect existing allocations from other line items with the same material
    // so the workflow can deduct them from available balances (prevent double-allocation)
    const existingAllocationData = [];
    if (data.table_gd) {
      data.table_gd.forEach((line, idx) => {
        if (idx === rowIndex) return;
        if (line.material_id !== materialId) return;

        const tempData = line.temp_qty_data;
        if (!tempData || tempData === "[]" || tempData.trim() === "") return;

        try {
          const parsed = JSON.parse(tempData);
          if (Array.isArray(parsed)) {
            parsed.forEach((alloc) => {
              if (alloc.gd_quantity > 0) {
                existingAllocationData.push({
                  location_id: alloc.location_id,
                  batch_id: alloc.batch_id || null,
                  handling_unit_id: alloc.handling_unit_id || null,
                  quantity: alloc.gd_quantity,
                });
              }
            });
          }
        } catch (e) {
          console.warn(`Failed to parse temp_qty_data for row ${idx}`);
        }
      });
    }

    if (existingAllocationData.length > 0) {
      console.log(
        `Found ${existingAllocationData.length} existing allocations from other line items`,
      );
    }

    const altUoms =
      itemData.table_uom_conversion?.map((data) => data.alt_uom_id) || [];
    const uomOptions = await fetchUomData(altUoms);
    await this.setOptionData([`gd_item_balance.material_uom`], uomOptions);

    this.setData({
      [`gd_item_balance.material_code`]: itemData.material_code,
      [`gd_item_balance.material_name`]: itemData.material_name,
      [`gd_item_balance.row_index`]: rowIndex,
      [`gd_item_balance.material_uom`]: altUOM,
    });

    this.setData({
      [`gd_item_balance.table_item_balance`]: [],
      [`gd_item_balance.table_hu`]: [],
    });

    if (itemData.serial_number_management === 1) {
      console.log(
        "Processing serialized item (may also have batch management)",
      );

      this.display("gd_item_balance.table_item_balance.serial_number");
      this.display("gd_item_balance.search_serial_number");
      this.display("gd_item_balance.confirm_search");
      this.display("gd_item_balance.reset_search");

      if (itemData.item_batch_management === 1) {
        this.display([
          "gd_item_balance.table_item_balance.batch_id",
          "gd_item_balance.table_item_balance.expired_date",
          "gd_item_balance.table_item_balance.manufacturing_date",
        ]);
        console.log(
          "Serialized item with batch management - showing both serial and batch columns",
        );
      } else {
        this.hide([
          "gd_item_balance.table_item_balance.batch_id",
          "gd_item_balance.table_item_balance.expired_date",
          "gd_item_balance.table_item_balance.manufacturing_date",
        ]);
        console.log(
          "Serialized item without batch management - hiding batch column",
        );
      }

      if (isSelectPicking) {
        console.log("GDPP mode: Skipping item_serial_balance fetch");
        processGDPPMode(tempQtyData, itemData, altUOM, baseUOM, true);
      } else {
        await processRegularMode(
          "item_serial_balance",
          materialId,
          plantId,
          tempQtyData,
          itemData,
          altUOM,
          baseUOM,
          true,
        );
      }
    } else if (itemData.item_batch_management === 1) {
      console.log("Processing batch item (non-serialized)");

      this.display([
        "gd_item_balance.table_item_balance.batch_id",
        "gd_item_balance.table_item_balance.expired_date",
        "gd_item_balance.table_item_balance.manufacturing_date",
      ]);
      this.hide("gd_item_balance.table_item_balance.serial_number");

      if (isSelectPicking) {
        console.log("GDPP mode: Skipping item_batch_balance fetch");
        processGDPPMode(tempQtyData, itemData, altUOM, baseUOM, false);
      } else {
        await processRegularMode(
          "item_batch_balance",
          materialId,
          plantId,
          tempQtyData,
          itemData,
          altUOM,
          baseUOM,
          false,
        );
      }
    } else {
      console.log("Processing regular item (no batch, no serial)");

      this.hide([
        "gd_item_balance.table_item_balance.batch_id",
        "gd_item_balance.table_item_balance.expired_date",
        "gd_item_balance.table_item_balance.manufacturing_date",
      ]);
      this.hide("gd_item_balance.table_item_balance.serial_number");

      if (isSelectPicking) {
        console.log("GDPP mode: Skipping item_balance fetch");
        processGDPPMode(tempQtyData, itemData, altUOM, baseUOM, false);
      } else {
        await processRegularMode(
          "item_balance",
          materialId,
          plantId,
          tempQtyData,
          itemData,
          altUOM,
          baseUOM,
          false,
        );
      }
    }

    // Tab helpers for hiding/showing HU tab
    const hideTab = (tabName) => {
      const tab = document.querySelector(`.el-tabs__item#tab-${tabName}`);
      if (tab) {
        tab.style.display = "none";
      }
    };

    const showTab = (tabName) => {
      const tab = document.querySelector(`.el-tabs__item#tab-${tabName}`);
      if (tab) {
        tab.style.display = "flex";
        tab.setAttribute("aria-disabled", "false");
        tab.classList.remove("is-disabled");
      }
    };

    const activateTab = (tabName) => {
      const tab = document.querySelector(`.el-tabs__item#tab-${tabName}`);
      if (tab) {
        tab.click();
      }
    };

    // Collect already-allocated HU IDs from other GD lines (for FULL_HU_PICK / NO_SPLIT)
    const allocatedHuIds = new Set();
    if (splitPolicy !== "ALLOW_SPLIT") {
      const tableGd = data.table_gd || [];
      tableGd.forEach((line, idx) => {
        if (idx === rowIndex) return;
        if (line.temp_hu_data && line.temp_hu_data !== "[]") {
          try {
            const lineHuData = JSON.parse(line.temp_hu_data);
            lineHuData.forEach((hu) => {
              if (hu.handling_unit_id) allocatedHuIds.add(hu.handling_unit_id);
            });
          } catch (e) {
            /* ignore */
          }
        }
      });
    }

    // Collect other lines' HU allocations for the same material (prevent double HU allocation)
    const otherLinesHuAllocations = [];
    if (data.table_gd) {
      data.table_gd.forEach((line, idx) => {
        if (idx === rowIndex) return;
        if (line.material_id !== materialId) return;

        const huStr = line.temp_hu_data;
        if (!huStr || huStr === "[]" || huStr.trim() === "") return;

        try {
          const parsed = JSON.parse(huStr);
          if (Array.isArray(parsed)) {
            parsed.forEach((alloc) => {
              if (
                alloc.row_type === "item" &&
                parseFloat(alloc.deliver_quantity) > 0
              ) {
                otherLinesHuAllocations.push(alloc);
              }
            });
          }
        } catch (e) {
          console.warn(`Failed to parse temp_hu_data for row ${idx}`);
        }
      });
    }

    // Fetch and populate HU table (skip in GDPP mode)
    if (!isSelectPicking) {
      // Fetch SO-line reserved data for accurate reserved_qty display
      const soLineItemId = lineItemData.so_line_item_id || "";
      const currentDocId = data.id || "";
      const gdStatus = data.gd_status;
      if (soLineItemId) {
        const reservedQuery = {
          plant_id: plantId,
          material_id: materialId,
          parent_line_id: soLineItemId,
        };
        const reservedRes = await db
          .collection("on_reserved_gd")
          .where(reservedQuery)
          .get();
        // Draft: only Pending (SO/Production reserved — user's own stock to use)
        // Created: Pending + this GD's own Allocated records (what system already reserved for this delivery)
        // Never include other GDs' Allocated records (those belong to other deliveries)
        const soLineReservedData = (reservedRes.data || []).filter((r) => {
          if (parseFloat(r.open_qty) <= 0) return false;
          if (r.status === "Cancelled") return false;
          if (r.status === "Pending") return true;
          if (r.status === "Allocated") {
            // Only include Allocated from THIS GD (current document)
            return (
              gdStatus === "Created" &&
              currentDocId &&
              r.doc_id === currentDocId
            );
          }
          return false;
        });

        // Update balance table: replace total reserved_qty with SO-line-specific qty
        if (soLineReservedData.length > 0) {
          const currentData = this.getValues();
          const balanceData =
            currentData.gd_item_balance?.table_item_balance || [];

          for (const balance of balanceData) {
            const matchingPending = soLineReservedData.filter((r) => {
              const locationMatch = r.bin_location === balance.location_id;
              if (itemData.item_batch_management === 1) {
                return (
                  locationMatch &&
                  (r.batch_id || "") === (balance.batch_id || "")
                );
              }
              return locationMatch;
            });

            if (matchingPending.length > 0) {
              // Sum and convert pending open_qty to dialog's display UOM
              let pendingQtyDisplay = 0;
              for (const pending of matchingPending) {
                const qty = parseFloat(pending.open_qty || 0);
                const pendingUom = pending.item_uom;
                if (pendingUom === altUOM) {
                  pendingQtyDisplay += qty;
                } else {
                  // Convert: pending UOM → base → alt UOM
                  const pendingConv = itemData.table_uom_conversion?.find(
                    (c) => c.alt_uom_id === pendingUom,
                  );
                  const altConv = itemData.table_uom_conversion?.find(
                    (c) => c.alt_uom_id === altUOM,
                  );
                  if (pendingConv && altConv) {
                    const baseQty = qty * pendingConv.base_qty;
                    pendingQtyDisplay += baseQty / altConv.base_qty;
                  } else {
                    pendingQtyDisplay += qty;
                  }
                }
              }
              balance.reserved_qty =
                Math.round(pendingQtyDisplay * 1000) / 1000;
            } else {
              balance.reserved_qty = 0;
            }
          }

          await this.setData({
            [`gd_item_balance.table_item_balance`]: balanceData,
          });
        }
      }

      const huTableData = await fetchHandlingUnits(
        plantId,
        organizationId,
        materialId,
        tempHuData,
        itemData,
        altUOM,
        otherLinesHuAllocations,
        splitPolicy,
      );

      // ================================================================
      // AUTO ALLOCATION (runs for both HU + loose, or loose-only)
      // ================================================================
      const tempDataArray = parseTempQtyData(tempQtyData);
      const balanceTempData = tempDataArray.filter(
        (item) => !item.handling_unit_id,
      );
      const huTempData = parseTempQtyData(tempHuData);
      const hasExistingAllocation =
        (balanceTempData && balanceTempData.length > 0) ||
        (huTempData && huTempData.length > 0);

      if (!hasExistingAllocation && requestedQty > 0 && organizationId) {
        const pickingSetupRes = await db
          .collection("picking_setup")
          .where({ organization_id: organizationId, is_deleted: 0 })
          .get();

        const pickingSetup = pickingSetupRes.data?.[0];

        if (pickingSetup && pickingSetup.picking_mode === "Auto") {
          const allocationStrategy =
            pickingSetup.default_strategy_id || "RANDOM";
          const huPriorityConfig = pickingSetup.hu_priority || "HU First";
          const splitPolicy = pickingSetup.split_policy || "ALLOW_SPLIT";

          const currentData = this.getValues();
          const balanceData =
            currentData.gd_item_balance?.table_item_balance || [];

          // Build GD line material IDs for NO_SPLIT filtering
          const lineMaterials = (currentData.table_gd || [])
            .map((line) => line.material_id)
            .filter(Boolean);

          await applyAutoAllocation(
            huTableData,
            balanceData,
            itemData,
            plantId,
            organizationId,
            requestedQty,
            allocationStrategy,
            existingAllocationData,
            lineItemData.so_line_item_id || "",
            huPriorityConfig,
            splitPolicy,
            lineMaterials,
          );

          // Update loose table with allocation results
          await this.setData({
            [`gd_item_balance.table_item_balance`]: balanceData.map((r) => ({
              ...r,
            })),
          });

          // For FULL_HU_PICK/NO_SPLIT: set hu_select = 1 on headers where auto-alloc assigned deliver_quantity
          if (splitPolicy !== "ALLOW_SPLIT") {
            const autoAllocatedHuIds = new Set();
            for (const row of huTableData) {
              if (row.row_type === "item" && row.deliver_quantity > 0) {
                autoAllocatedHuIds.add(row.handling_unit_id);
              }
            }
            for (const row of huTableData) {
              if (
                row.row_type === "header" &&
                autoAllocatedHuIds.has(row.handling_unit_id)
              ) {
                row.hu_select = 1;
              }
            }
          }
        }
      }

      // ================================================================
      // SPLIT POLICY: Mark disabled HUs (NO_SPLIT + already-allocated)
      // ================================================================
      if (splitPolicy === "NO_SPLIT") {
        const gdMaterialIds = new Set(
          (data.table_gd || []).map((line) => line.material_id).filter(Boolean),
        );

        const huItemsByHu = {};
        for (const row of huTableData) {
          if (row.row_type === "item") {
            if (!huItemsByHu[row.handling_unit_id])
              huItemsByHu[row.handling_unit_id] = [];
            huItemsByHu[row.handling_unit_id].push(row);
          }
        }

        const disabledHuIds = new Set();
        for (const [huId, items] of Object.entries(huItemsByHu)) {
          const hasForeignItem = items.some(
            (item) => !gdMaterialIds.has(item.material_id),
          );
          if (hasForeignItem) disabledHuIds.add(huId);
        }

        for (const row of huTableData) {
          if (disabledHuIds.has(row.handling_unit_id)) {
            row.hu_disabled = 1;
            row.hu_disabled_reason = "Contains items not in this delivery";
          }
        }
      }

      // Mark HUs already allocated by other GD lines as disabled (FULL_HU_PICK / NO_SPLIT)
      if (splitPolicy !== "ALLOW_SPLIT") {
        for (const row of huTableData) {
          if (allocatedHuIds.has(row.handling_unit_id)) {
            row.hu_disabled = 1;
            row.hu_disabled_reason = "Already allocated";
          }
        }
      }

      // ================================================================
      // SET HU TABLE DATA + TAB VISIBILITY
      // ================================================================
      if (huTableData.length > 0) {
        showTab("handling_unit");

        // Set HU table data once (with allocation results already applied)
        console.log("Final huTableData:", JSON.stringify(huTableData));
        await this.setData({ [`gd_item_balance.table_hu`]: huTableData });

        // Show/hide hu_select checkbox based on policy
        if (splitPolicy === "ALLOW_SPLIT") {
          this.hide("gd_item_balance.table_hu.hu_select");
        } else {
          this.display("gd_item_balance.table_hu.hu_select");
        }

        // Disable fields based on split policy
        huTableData.forEach((row, idx) => {
          if (splitPolicy === "ALLOW_SPLIT") {
            // Existing behavior: disable header deliver_quantity only
            if (row.row_type === "header") {
              this.disabled(
                [`gd_item_balance.table_hu.${idx}.deliver_quantity`],
                true,
              );
            }
          } else {
            // FULL_HU_PICK or NO_SPLIT: disable ALL deliver_quantity fields (qty is auto-set via checkbox)
            this.disabled(
              [`gd_item_balance.table_hu.${idx}.deliver_quantity`],
              true,
            );

            if (row.row_type === "item") {
              // Item rows: disable hu_select (only headers are clickable)
              this.disabled(
                [`gd_item_balance.table_hu.${idx}.hu_select`],
                true,
              );
            } else if (row.row_type === "header" && row.hu_disabled) {
              // Disabled HU headers: disable the checkbox
              this.disabled(
                [`gd_item_balance.table_hu.${idx}.hu_select`],
                true,
              );
            }
          }
        });

        // FULL_HU_PICK / NO_SPLIT checkbox behavior (requires platform-side event handler):
        // When hu_select checkbox is checked on a header row:
        //   - Set deliver_quantity = item_quantity for all item rows in this HU
        // When hu_select checkbox is unchecked:
        //   - Set deliver_quantity = 0 for all item rows in this HU
        // This is a preview only — cross-line distribution happens on Confirm (GDconfirmDialog.js)
      } else {
        hideTab("handling_unit");
        activateTab("loose");
      }
    } else {
      hideTab("handling_unit");
      activateTab("loose");
    }

    window.validationState = window.validationState || {};

    setTimeout(() => {
      const currentData = this.getValues();
      const rowCount =
        currentData.gd_item_balance?.table_item_balance?.length || 0;

      for (let i = 0; i < rowCount; i++) {
        window.validationState[i] = true;
      }

      console.log(`Initialized validation state for ${rowCount} rows`);
    }, 100);

    this.hideLoading();
  } catch (error) {
    console.error("Error in GD inventory dialog:", error);
    this.hideLoading();
  }
})();
