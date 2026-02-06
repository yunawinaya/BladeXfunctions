(async () => {
  try {
    const data = this.getValues();
    const lineItemData = arguments[0]?.row;
    const rowIndex = arguments[0]?.rowIndex;

    if (!lineItemData) {
      console.error("Missing line item data");
      return;
    }

    const isSelectPicking = data.is_select_picking === 1;
    const materialId = lineItemData.material_id;
    const altUOM = lineItemData.gd_order_uom_id;
    const plantId = data.plant_id;
    const tempQtyData = lineItemData.temp_qty_data;

    console.log("lineItemData", lineItemData);

    if (!materialId || !plantId) {
      console.error("Missing required material_id or plant_id");
      return;
    }

    this.hide("gd_item_balance.table_item_balance.serial_number");

    if (isSelectPicking) {
      console.log("GDPP mode: Showing to_quantity, hiding balance columns");
      this.display("gd_item_balance.table_item_balance.to_quantity");
    } else {
      console.log(
        "Regular GD mode: Hiding to_quantity, showing balance columns",
      );
      this.hide("gd_item_balance.table_item_balance.to_quantity");
    }

    const fetchDefaultStorageLocation = async (itemData) => {
      const defaultBin = itemData?.table_default_bin?.find(
        (bin) => bin.plant_id === plantId,
      );

      const defaultStorageLocationId = defaultBin?.storage_location_id;

      let defaultStorageLocation = null;

      if (!defaultStorageLocationId || defaultStorageLocationId === "") {
        defaultStorageLocation = await db
          .collection("storage_location")
          .where({
            plant_id: plantId,
            storage_status: 1,
            location_type: "Common",
            is_deleted: 0,
            is_default: 1,
          })
          .get()
          .then((res) => res.data[0]);
      } else {
        defaultStorageLocation = await db
          .collection("storage_location")
          .where({ id: defaultStorageLocationId })
          .get()
          .then((res) => res.data[0]);
      }

      if (!defaultStorageLocation) {
        console.error("Default storage location not found");
        return null;
      }

      return defaultStorageLocation;
    };

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

    const applyAutoAllocation = async (
      balanceData,
      itemData,
      plantId,
      organizationId,
      requestedQty,
      batchDataArray = [],
      soLineItemId = null
    ) => {
      console.log("Starting auto allocation for inventory dialog");

      // Fetch picking setup
      const pickingSetupRes = await db
        .collection("picking_setup")
        .where({
          organization_id: organizationId,
          picking_after: "Goods Delivery",
          is_deleted: 0,
        })
        .get();

      if (!pickingSetupRes.data || pickingSetupRes.data.length === 0) {
        console.log("No picking setup found, skipping auto allocation");
        return balanceData;
      }

      const pickingSetup = pickingSetupRes.data[0];

      if (pickingSetup.picking_mode !== "Auto") {
        console.log("Manual picking mode, skipping auto allocation");
        return balanceData;
      }

      const defaultStrategy = pickingSetup.default_strategy_id;
      const fallbackStrategy = pickingSetup.fallback_strategy_id;

      // Get default bin for this item
      const getDefaultBin = () => {
        if (!itemData.table_default_bin?.length) return null;
        const entry = itemData.table_default_bin.find(
          (bin) => bin.plant_id === plantId
        );
        return entry?.bin_location || null;
      };

      const defaultBin = getDefaultBin();
      const isBatchManaged = itemData.item_batch_management === 1;

      // Sort by FIFO (batch items only)
      const sortByFIFO = (balanceArray) => {
        if (!isBatchManaged || !batchDataArray.length) return balanceArray;

        return balanceArray.sort((a, b) => {
          const batchA = batchDataArray.find((batch) => batch.id === a.batch_id);
          const batchB = batchDataArray.find((batch) => batch.id === b.batch_id);

          if (batchA?.expiry_date && batchB?.expiry_date) {
            return (
              new Date(batchA.expiry_date) - new Date(batchB.expiry_date)
            );
          }

          return (batchA?.batch_number || "").localeCompare(
            batchB?.batch_number || ""
          );
        });
      };

      // Allocate from balance list
      const allocateFromBalances = (balanceList, remainingQty) => {
        const allocated = [];

        for (const balance of balanceList) {
          if (remainingQty <= 0) break;

          const availableQty = balance.unrestricted_qty || 0;
          if (availableQty <= 0) continue;

          const allocatedQty = Math.min(remainingQty, availableQty);

          allocated.push({
            ...balance,
            gd_quantity: allocatedQty,
          });

          remainingQty -= allocatedQty;
        }

        return { allocated, remainingQty };
      };

      let allAllocations = [];
      let remainingQty = requestedQty;

      // ========================================================================
      // STEP 0: Prioritize pending reserved data first
      // ========================================================================
      if (soLineItemId) {
        const pendingReservedRes = await db
          .collection("on_reserved_gd")
          .where({
            plant_id: plantId,
            material_id: itemData.id,
            parent_line_id: soLineItemId,
            status: "Pending",
          })
          .get();

        const pendingReservedData = pendingReservedRes?.data || [];

        if (pendingReservedData.length > 0) {
          console.log(`Found ${pendingReservedData.length} pending reservations, prioritizing...`);

          // Sort to prioritize Production over Sales Order
          const sortedReservedData = [...pendingReservedData].sort((a, b) => {
            if (a.doc_type === "Production" && b.doc_type !== "Production") return -1;
            if (a.doc_type !== "Production" && b.doc_type === "Production") return 1;
            return 0;
          });

          for (const reservation of sortedReservedData) {
            if (remainingQty <= 0) break;

            const reservedQty = parseFloat(reservation.open_qty || 0);
            if (reservedQty <= 0) continue;

            // Find matching balance by bin_location and batch_id (if batch-managed)
            const matchingBalance = balanceData.find((b) => {
              const binMatch = b.location_id === reservation.bin_location;
              if (isBatchManaged) {
                return binMatch && b.batch_id === reservation.batch_id;
              }
              return binMatch;
            });

            if (matchingBalance) {
              const availableQty = matchingBalance.unrestricted_qty || 0;
              // Allocate min of: remaining qty, reserved qty, available balance
              const allocatedQty = Math.min(remainingQty, reservedQty, availableQty);

              if (allocatedQty > 0) {
                // Check if already allocated to this location
                const existingAlloc = allAllocations.find((a) => {
                  const locMatch = a.location_id === matchingBalance.location_id;
                  if (isBatchManaged) {
                    return locMatch && a.batch_id === matchingBalance.batch_id;
                  }
                  return locMatch;
                });

                if (existingAlloc) {
                  existingAlloc.gd_quantity += allocatedQty;
                } else {
                  allAllocations.push({
                    ...matchingBalance,
                    gd_quantity: allocatedQty,
                  });
                }

                remainingQty -= allocatedQty;
                console.log(`Reserved allocation (${reservation.doc_type}): ${allocatedQty} from bin ${reservation.bin_location}`);
              }
            }
          }

          console.log(`After reserved allocation: ${remainingQty} remaining`);
        }
      }

      // ========================================================================
      // STEP 1: Apply strategy for remaining qty (FIXED BIN / RANDOM)
      // ========================================================================
      if (remainingQty > 0) {
        // Get already allocated location keys to exclude
        const allocatedKeys = new Set(
          allAllocations.map((a) =>
            isBatchManaged
              ? `${a.location_id}-${a.batch_id || "no_batch"}`
              : `${a.location_id}`
          )
        );

        // Filter out already allocated balances
        const remainingBalances = balanceData.filter((b) => {
          const key = isBatchManaged
            ? `${b.location_id}-${b.batch_id || "no_batch"}`
            : `${b.location_id}`;
          return !allocatedKeys.has(key) && (b.unrestricted_qty || 0) > 0;
        });

        // STRATEGY: FIXED BIN
        if (defaultStrategy === "FIXED BIN") {
          // Step 1: Try default bin first (only if configured)
          if (defaultBin) {
            console.log(`Applying FIXED BIN strategy (bin: ${defaultBin})`);

            const defaultBinBalances = remainingBalances.filter(
              (b) => b.location_id === defaultBin
            );

            const sortedDefaultBalances = sortByFIFO(defaultBinBalances);
            const result1 = allocateFromBalances(
              sortedDefaultBalances,
              remainingQty
            );
            allAllocations.push(...result1.allocated);
            remainingQty = result1.remainingQty;
          }

          // Step 2: Fallback to RANDOM for remainder (or if no default bin configured)
          if (remainingQty > 0 && fallbackStrategy === "RANDOM") {
            console.log(`Falling back to RANDOM strategy for remainder`);
            const otherBalances = remainingBalances.filter(
              (b) => !defaultBin || b.location_id !== defaultBin
            );

            const sortedOtherBalances = sortByFIFO(otherBalances);
            const result2 = allocateFromBalances(
              sortedOtherBalances,
              remainingQty
            );
            allAllocations.push(...result2.allocated);
            remainingQty = result2.remainingQty;
          }
        }
        // STRATEGY: RANDOM
        else if (defaultStrategy === "RANDOM") {
          console.log("Applying RANDOM strategy");
          const sortedBalances = sortByFIFO(remainingBalances);
          const result = allocateFromBalances(sortedBalances, remainingQty);
          allAllocations.push(...result.allocated);
          remainingQty = result.remainingQty;
        }
      }

      // Merge allocations back into original balance data
      const finalData = balanceData.map((balance) => {
        const key = isBatchManaged
          ? `${balance.location_id}-${balance.batch_id || "no_batch"}`
          : `${balance.location_id}`;

        const allocation = allAllocations.find((alloc) => {
          const allocKey = isBatchManaged
            ? `${alloc.location_id}-${alloc.batch_id || "no_batch"}`
            : `${alloc.location_id}`;
          return allocKey === key;
        });

        return {
          ...balance,
          gd_quantity: allocation ? allocation.gd_quantity : 0,
        };
      });

      console.log(
        `Auto allocation completed: ${requestedQty - remainingQty} allocated`
      );
      return finalData;
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

    const setTableBalanceData = async (
      filteredData,
      includeRawData = false,
    ) => {
      this.models["full_balance_data"] = filteredData;

      const defaultStorageLocation = this.models["default_storage_location"];

      let finalData = filteredData;

      if (defaultStorageLocation) {
        const binLocationList =
          defaultStorageLocation.table_bin_location?.map(
            (bin) => bin.bin_location_id,
          ) || [];

        console.log("binLocationList", binLocationList);

        const matchedBalanceData = filteredData.filter((data) => {
          const hasAllocation = (data.gd_quantity || 0) > 0;
          const inStorageLocation = binLocationList.includes(data.location_id);

          return hasAllocation || inStorageLocation;
        });

        console.log("matchedBalanceData", matchedBalanceData);

        if (matchedBalanceData.length > 0) {
          finalData = matchedBalanceData;
        }
      }

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
      const filteredData = filterZeroQuantityRecords(finalData, itemData);

      console.log("Final filtered data (GDPP):", filteredData);
      setTableBalanceData(filteredData, includeRawData);
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
      organizationId = null,
      requestedQty = 0,
      batchDataArray = [],
      soLineItemId = null
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
        let finalData = mergeWithTempData(
          processedFreshData,
          tempDataArray,
          itemData,
        );

        // Apply auto allocation if no existing temp_qty_data
        const hasExistingAllocation = tempDataArray && tempDataArray.length > 0;

        if (!hasExistingAllocation && requestedQty > 0 && organizationId) {
          console.log(`Applying auto allocation for qty: ${requestedQty}`);
          finalData = await applyAutoAllocation(
            finalData,
            itemData,
            plantId,
            organizationId,
            requestedQty,
            batchDataArray,
            soLineItemId
          );
        }

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

    // Fetch batch data if batch-managed (for FIFO sorting in auto allocation)
    let batchDataArray = [];
    if (itemData.item_batch_management === 1) {
      const batchRes = await db
        .collection("batch")
        .where({
          material_id: materialId,
          plant_id: plantId,
          organization_id: organizationId,
          is_deleted: 0,
        })
        .get();
      batchDataArray = batchRes.data || [];
    }

    const defaultStorageLocation = await fetchDefaultStorageLocation(itemData);

    if (defaultStorageLocation) {
      this.models["default_storage_location"] = defaultStorageLocation;
      this.models["previous_storage_location_id"] = defaultStorageLocation.id;

      const currentStorageLocationId = data.gd_item_balance?.storage_location;

      if (currentStorageLocationId !== defaultStorageLocation.id) {
        await this.setData({
          [`gd_item_balance.storage_location`]: defaultStorageLocation.id,
        });
      }
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
          organizationId,
          requestedQty,
          batchDataArray,
          lineItemData.so_line_item_id
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
          organizationId,
          requestedQty,
          batchDataArray,
          lineItemData.so_line_item_id
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
          organizationId,
          requestedQty,
          batchDataArray,
          lineItemData.so_line_item_id
        );
      }
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
  } catch (error) {
    console.error("Error in GD inventory dialog:", error);
  }
})();
