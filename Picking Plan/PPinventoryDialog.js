(async () => {
  try {
    const data = this.getValues();
    const lineItemData = arguments[0]?.row;
    const rowIndex = arguments[0]?.rowIndex;

    if (!lineItemData) {
      console.error("Missing line item data");
      return;
    }

    const materialId = lineItemData.material_id;
    const altUOM = lineItemData.to_order_uom_id;
    const plantId = data.plant_id;
    const tempQtyData = lineItemData.temp_qty_data;

    console.log("lineItemData", lineItemData);

    if (!materialId || !plantId) {
      console.error("Missing required material_id or plant_id");
      return;
    }

    this.hide("to_item_balance.table_item_balance.serial_number");

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
        return freshDbData.map((item) => ({ ...item, to_quantity: 0 }));
      }

      console.log("Merging fresh DB data with existing temp data");

      const tempDataMap = new Map();
      tempDataArray.forEach((tempItem) => {
        const key = generateRecordKey(tempItem, itemData);
        tempDataMap.set(key, tempItem);
      });

      if (itemData.serial_number_management === 1) {
        this.display("to_item_balance.table_item_balance.serial_number");
      }

      const mergedData = freshDbData.map((dbItem) => {
        const key = generateRecordKey(dbItem, itemData);
        const tempItem = tempDataMap.get(key);

        if (tempItem) {
          console.log(
            `Merging data for ${key}: DB unrestricted=${dbItem.unrestricted_qty}, temp to_quantity=${tempItem.to_quantity}`,
          );
          return {
            ...dbItem,
            to_quantity: tempItem.to_quantity,
            remarks: tempItem.remarks || dbItem.remarks,
          };
        } else {
          return {
            ...dbItem,
            to_quantity: 0,
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
          const hasAllocation = (data.to_quantity || 0) > 0;
          const inStorageLocation = binLocationList.includes(data.location_id);

          return hasAllocation || inStorageLocation;
        });

        console.log("matchedBalanceData", matchedBalanceData);

        if (matchedBalanceData.length > 0) {
          finalData = matchedBalanceData;
        }
      }

      await this.setData({
        [`to_item_balance.table_item_balance`]: finalData,
      });

      if (includeRawData) {
        this.setData({
          [`to_item_balance.table_item_balance_raw`]:
            JSON.stringify(filteredData),
        });
      }
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
        const finalData = mergeWithTempData(
          processedFreshData,
          tempDataArray,
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

    const defaultStorageLocation = await fetchDefaultStorageLocation(itemData);

    if (defaultStorageLocation) {
      this.models["default_storage_location"] = defaultStorageLocation;
      this.models["previous_storage_location_id"] = defaultStorageLocation.id;

      const currentStorageLocationId = data.to_item_balance?.storage_location;

      if (currentStorageLocationId !== defaultStorageLocation.id) {
        await this.setData({
          [`to_item_balance.storage_location`]: defaultStorageLocation.id,
        });
      }
    }

    const altUoms =
      itemData.table_uom_conversion?.map((data) => data.alt_uom_id) || [];
    const uomOptions = await fetchUomData(altUoms);
    await this.setOptionData([`to_item_balance.material_uom`], uomOptions);

    this.setData({
      [`to_item_balance.material_code`]: itemData.material_code,
      [`to_item_balance.material_name`]: itemData.material_name,
      [`to_item_balance.row_index`]: rowIndex,
      [`to_item_balance.material_uom`]: altUOM,
    });

    this.setData({
      [`to_item_balance.table_item_balance`]: [],
    });

    if (itemData.serial_number_management === 1) {
      console.log(
        "Processing serialized item (may also have batch management)",
      );

      this.display("to_item_balance.table_item_balance.serial_number");
      this.display("to_item_balance.search_serial_number");
      this.display("to_item_balance.confirm_search");
      this.display("to_item_balance.reset_search");

      if (itemData.item_batch_management === 1) {
        this.display("to_item_balance.table_item_balance.batch_id");
        console.log(
          "Serialized item with batch management - showing both serial and batch columns",
        );
      } else {
        this.hide("to_item_balance.table_item_balance.batch_id");
        console.log(
          "Serialized item without batch management - hiding batch column",
        );
      }

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
    } else if (itemData.item_batch_management === 1) {
      console.log("Processing batch item (non-serialized)");

      this.display("to_item_balance.table_item_balance.batch_id");
      this.hide("to_item_balance.table_item_balance.serial_number");

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
    } else {
      console.log("Processing regular item (no batch, no serial)");

      this.hide("to_item_balance.table_item_balance.batch_id");
      this.hide("to_item_balance.table_item_balance.serial_number");

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

    window.validationState = window.validationState || {};

    setTimeout(() => {
      const currentData = this.getValues();
      const rowCount =
        currentData.to_item_balance?.table_item_balance?.length || 0;

      for (let i = 0; i < rowCount; i++) {
        window.validationState[i] = true;
      }

      console.log(`Initialized validation state for ${rowCount} rows`);
    }, 100);
  } catch (error) {
    console.error("Error in PP inventory dialog:", error);
  }
})();
