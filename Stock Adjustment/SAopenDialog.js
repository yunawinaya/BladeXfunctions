(async () => {
  this.showLoading("Loading inventory data...");
  try {
    const allData = this.getValues();
    const lineItemData = arguments[0]?.row;
    const rowIndex = arguments[0]?.rowIndex;
    const adjustment_type = allData.adjustment_type;
    const materialId = lineItemData.material_id;
    const plantId = allData.plant_id;
    const uomId = lineItemData.uom_id;

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

    // Merge fresh DB data with previously-saved balance_index. Only carries over
    // user-editable fields (sa_quantity, category, movement_type, remarks, fm_key)
    // from saved data — balance qty fields always come from fresh DB so the dialog
    // never shows or validates against stale stock.
    const mergeWithSavedData = (freshDbData, savedDataArray, itemData) => {
      if (!savedDataArray || savedDataArray.length === 0) {
        return freshDbData;
      }

      const savedDataMap = new Map(
        savedDataArray.map((savedItem) => [
          generateKey(savedItem, itemData),
          savedItem,
        ]),
      );

      const mergedData = freshDbData.map((dbItem) => {
        const key = generateKey(dbItem, itemData);
        const savedItem = savedDataMap.get(key);

        if (savedItem) {
          return {
            ...dbItem,
            balance_id: dbItem.id,
            fm_key: savedItem.fm_key,
            category: savedItem.category,
            sa_quantity: savedItem.sa_quantity,
            movement_type: savedItem.movement_type,
            remarks: savedItem.remarks || dbItem.remarks,
          };
        }

        return {
          ...dbItem,
          balance_id: dbItem.id,
        };
      });

      savedDataArray.forEach((savedItem) => {
        const key = generateKey(savedItem, itemData);
        const existsInDb = freshDbData.some(
          (dbItem) => generateKey(dbItem, itemData) === key,
        );

        if (!existsInDb) {
          mergedData.push({
            ...savedItem,
            balance_id: savedItem.balance_id || savedItem.id,
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

    const applyAdjustmentTypeBehavior = (filteredData, isSerial) => {
      filteredData.forEach((item) => {
        if (!item.category) item.category = "Unrestricted";
      });

      if (adjustment_type === "Stock Count") {
        filteredData.forEach((item) => {
          if (item.movement_type === "OUT" && item.sa_quantity > 0) {
            item.sa_quantity = -item.sa_quantity;
          }
        });
      } else if (isSerial) {
        filteredData.forEach((item) => {
          item.movement_type = "Out";
        });
      }
    };

    const applyMovementTypeUI = (isSerial) => {
      if (adjustment_type === "Write Off") {
        this.setData({
          [`sa_item_balance.table_item_balance.movement_type`]: "Out",
        });
        this.hide("sa_item_balance.table_item_balance.movement_type");
      } else if (adjustment_type === "Stock Count") {
        this.disabled(
          [`sa_item_balance.table_item_balance.movement_type`],
          true,
        );
        this.display([`sa_item_balance.table_item_balance.movement_type`]);
      } else if (isSerial) {
        this.setData({
          [`sa_item_balance.table_item_balance.movement_type`]: "Out",
        });
        this.disabled(
          [`sa_item_balance.table_item_balance.movement_type`],
          true,
        );
        this.display([`sa_item_balance.table_item_balance.movement_type`]);
      } else {
        this.display([`sa_item_balance.table_item_balance.movement_type`]);
      }
    };

    // ============= MAIN =============

    this.hide("sa_item_balance.table_item_balance.serial_number");

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

    const altUoms = itemData.table_uom_conversion?.map(
      (data) => data.alt_uom_id,
    );
    const uomOptions = await fetchUomData(altUoms);
    await this.setOptionData([`sa_item_balance.material_uom`], uomOptions);

    this.setData({
      [`sa_item_balance.material_id`]: itemData.material_code,
      [`sa_item_balance.material_name`]: itemData.material_name,
      [`sa_item_balance.row_index`]: rowIndex,
      [`sa_item_balance.material_uom`]: uomId,
    });

    const previousBalanceData = parseJSON(lineItemData.balance_index);
    const isSerial = itemData.serial_number_management === 1;
    const isBatch = itemData.item_batch_management === 1;

    if (isSerial) {
      this.display([
        "sa_item_balance.table_item_balance.serial_number",
        "sa_item_balance.search_serial_number",
        "sa_item_balance.confirm_search",
        "sa_item_balance.reset_search",
      ]);
      this.setData({ [`sa_item_balance.is_serialized`]: 1 });

      if (isBatch) {
        this.display([
          "sa_item_balance.table_item_balance.batch_id",
          "sa_item_balance.table_item_balance.expired_date",
          "sa_item_balance.table_item_balance.manufacturing_date",
        ]);
      } else {
        this.hide([
          "sa_item_balance.table_item_balance.batch_id",
          "sa_item_balance.table_item_balance.expired_date",
          "sa_item_balance.table_item_balance.manufacturing_date",
        ]);
      }

      try {
        const response = await db
          .collection("item_serial_balance")
          .where({ material_id: materialId, plant_id: plantId })
          .get();
        const mappedData = mapBalanceData(response.data || []);
        const finalData = mergeWithSavedData(
          mappedData,
          previousBalanceData,
          itemData,
        );
        const filteredData = filterZeroQuantityRecords(finalData, itemData);
        applyAdjustmentTypeBehavior(filteredData, true);

        this.setData({
          [`sa_item_balance.table_item_balance`]: filteredData,
        });
        this.setData({
          [`sa_item_balance.table_item_balance_raw`]:
            JSON.stringify(filteredData),
        });

        applyMovementTypeUI(true);
      } catch (error) {
        console.error("Error fetching item serial balance data:", error);
      }
    } else if (isBatch) {
      this.display([
        "sa_item_balance.table_item_balance.batch_id",
        "sa_item_balance.table_item_balance.expired_date",
        "sa_item_balance.table_item_balance.manufacturing_date",
      ]);
      this.hide([
        "sa_item_balance.table_item_balance.serial_number",
        "sa_item_balance.search_serial_number",
        "sa_item_balance.confirm_search",
        "sa_item_balance.reset_search",
      ]);
      this.setData({ [`sa_item_balance.is_serialized`]: 0 });

      try {
        const response = await db
          .collection("item_batch_balance")
          .where({ material_id: materialId, plant_id: plantId })
          .get();
        const mappedData = mapBalanceData(response.data || []);
        const finalData = mergeWithSavedData(
          mappedData,
          previousBalanceData,
          itemData,
        );
        const filteredData = filterZeroQuantityRecords(finalData, itemData);
        applyAdjustmentTypeBehavior(filteredData, false);

        this.setData({
          [`sa_item_balance.table_item_balance`]: filteredData,
        });

        applyMovementTypeUI(false);
      } catch (error) {
        console.error("Error fetching item batch balance data:", error);
      }
    } else {
      this.hide([
        "sa_item_balance.table_item_balance.batch_id",
        "sa_item_balance.table_item_balance.expired_date",
        "sa_item_balance.table_item_balance.manufacturing_date",
        "sa_item_balance.table_item_balance.serial_number",
        "sa_item_balance.search_serial_number",
        "sa_item_balance.confirm_search",
        "sa_item_balance.reset_search",
      ]);
      this.setData({ [`sa_item_balance.is_serialized`]: 0 });

      try {
        const response = await db
          .collection("item_balance")
          .where({ material_id: materialId, plant_id: plantId })
          .get();
        const mappedData = mapBalanceData(response.data || []);
        const finalData = mergeWithSavedData(
          mappedData,
          previousBalanceData,
          itemData,
        );
        const filteredData = filterZeroQuantityRecords(finalData, itemData);
        applyAdjustmentTypeBehavior(filteredData, false);

        this.setData({
          [`sa_item_balance.table_item_balance`]: filteredData,
        });

        applyMovementTypeUI(false);
      } catch (error) {
        console.error("Error fetching item balance data:", error);
      }
    }
  } catch (error) {
    console.error("Error in stock adjustment dialog:", error);
  } finally {
    this.hideLoading();
  }
})();
