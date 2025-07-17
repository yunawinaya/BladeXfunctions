const data = this.getValues();
const lineItemData = arguments[0]?.row;
const rowIndex = arguments[0]?.rowIndex;

console.log("lineItemData", lineItemData);

const materialId = lineItemData.material_id;
const altUOM = lineItemData.gd_order_uom_id;
const plantId = data.plant_id;

const tempQtyData = lineItemData.temp_qty_data;

db.collection("Item")
  .where({
    id: materialId,
  })
  .get()
  .then((response) => {
    console.log("response item", response);
    const itemData = response.data[0];
    const baseUOM = itemData.based_uom;

    this.setData({
      [`gd_item_balance.material_code`]: itemData.material_code,
      [`gd_item_balance.material_name`]: itemData.material_name,
      [`gd_item_balance.row_index`]: rowIndex,
      [`gd_item_balance.material_uom`]: altUOM,
    });

    this.setData({
      [`gd_item_balance.table_item_balance`]: [],
    });

    const convertBaseToAlt = (baseQty, itemData, altUOM) => {
      if (
        !Array.isArray(itemData.table_uom_conversion) ||
        itemData.table_uom_conversion.length === 0 ||
        !altUOM
      ) {
        return baseQty;
      }

      const uomConversion = itemData.table_uom_conversion.find(
        (conv) => conv.alt_uom_id === altUOM
      );

      if (!uomConversion || !uomConversion.base_qty) {
        return baseQty;
      }

      return Math.round((baseQty / uomConversion.base_qty) * 1000) / 1000;
    };

    const processItemBalanceData = (itemBalanceData) => {
      return itemBalanceData.map((record) => {
        const processedRecord = { ...record };

        if (altUOM !== baseUOM) {
          if (processedRecord.block_qty) {
            processedRecord.block_qty = convertBaseToAlt(
              processedRecord.block_qty,
              itemData,
              altUOM
            );
          }

          if (processedRecord.reserved_qty) {
            processedRecord.reserved_qty = convertBaseToAlt(
              processedRecord.reserved_qty,
              itemData,
              altUOM
            );
          }

          if (processedRecord.unrestricted_qty) {
            processedRecord.unrestricted_qty = convertBaseToAlt(
              processedRecord.unrestricted_qty,
              itemData,
              altUOM
            );
          }

          if (processedRecord.qualityinsp_qty) {
            processedRecord.qualityinsp_qty = convertBaseToAlt(
              processedRecord.qualityinsp_qty,
              itemData,
              altUOM
            );
          }

          if (processedRecord.intransit_qty) {
            processedRecord.intransit_qty = convertBaseToAlt(
              processedRecord.intransit_qty,
              itemData,
              altUOM
            );
          }

          if (processedRecord.balance_quantity) {
            processedRecord.balance_quantity = convertBaseToAlt(
              processedRecord.balance_quantity,
              itemData,
              altUOM
            );
          }
        }

        return processedRecord;
      });
    };

    const mergeWithTempData = (freshDbData, tempDataArray) => {
      if (!tempDataArray || tempDataArray.length === 0) {
        console.log("No temp data to merge, using fresh DB data");
        return freshDbData;
      }

      console.log("Merging fresh DB data with existing temp data");

      const tempDataMap = new Map();
      tempDataArray.forEach((tempItem) => {
        const key =
          itemData.item_batch_management === 1
            ? `${tempItem.location_id}-${tempItem.batch_id || "no_batch"}`
            : `${tempItem.location_id}`;
        tempDataMap.set(key, tempItem);
      });

      const mergedData = freshDbData.map((dbItem) => {
        const key =
          itemData.item_batch_management === 1
            ? `${dbItem.location_id}-${dbItem.batch_id || "no_batch"}`
            : `${dbItem.location_id}`;

        const tempItem = tempDataMap.get(key);

        if (tempItem) {
          console.log(
            `Merging data for ${key}: DB unrestricted=${dbItem.unrestricted_qty}, temp gd_quantity=${tempItem.gd_quantity}`
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
        const key =
          itemData.item_batch_management === 1
            ? `${tempItem.location_id}-${tempItem.batch_id || "no_batch"}`
            : `${tempItem.location_id}`;

        const existsInDb = freshDbData.some((dbItem) => {
          const dbKey =
            itemData.item_batch_management === 1
              ? `${dbItem.location_id}-${dbItem.batch_id || "no_batch"}`
              : `${dbItem.location_id}`;
          return dbKey === key;
        });

        if (!existsInDb) {
          console.log(`Adding temp-only data for ${key}`);
          mergedData.push(tempItem);
        }
      });

      return mergedData;
    };

    const filterZeroQuantityRecords = (data) => {
      return data.filter((record) => {
        // Check if any of the quantity fields have a value greater than 0
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

    if (itemData.item_batch_management === 1) {
      this.display("gd_item_balance.table_item_balance.batch_id");

      db.collection("item_batch_balance")
        .where({
          material_id: materialId,
          plant_id: plantId,
        })
        .get()
        .then((response) => {
          console.log("response item_batch_balance", response);
          let freshDbData = response.data || [];

          const processedFreshData = processItemBalanceData(freshDbData);

          let tempDataArray = [];
          if (tempQtyData) {
            try {
              tempDataArray = JSON.parse(tempQtyData);
              console.log("Parsed temp data:", tempDataArray);
            } catch (error) {
              console.error("Error parsing temp_qty_data:", error);
              tempDataArray = [];
            }
          }

          const finalData = mergeWithTempData(
            processedFreshData,
            tempDataArray
          );

          // Filter out records with all zero quantities
          const filteredData = filterZeroQuantityRecords(finalData);

          console.log("Final filtered data:", filteredData);

          this.setData({
            [`gd_item_balance.table_item_balance`]: filteredData,
          });
        })
        .catch((error) => {
          console.error("Error fetching item batch balance data:", error);
        });
    } else {
      this.hide("gd_item_balance.table_item_balance.batch_id");

      db.collection("item_balance")
        .where({
          material_id: materialId,
          plant_id: plantId,
        })
        .get()
        .then((response) => {
          console.log("response item_balance", response);
          let freshDbData = response.data || [];

          const processedFreshData = processItemBalanceData(freshDbData);

          let tempDataArray = [];
          if (tempQtyData) {
            try {
              tempDataArray = JSON.parse(tempQtyData);
              console.log("Parsed temp data:", tempDataArray);
            } catch (error) {
              console.error("Error parsing temp_qty_data:", error);
              tempDataArray = [];
            }
          }

          const finalData = mergeWithTempData(
            processedFreshData,
            tempDataArray
          );

          // Filter out records with all zero quantities
          const filteredData = filterZeroQuantityRecords(finalData);

          console.log("Final filtered data:", filteredData);

          this.setData({
            [`gd_item_balance.table_item_balance`]: filteredData,
          });
        })
        .catch((error) => {
          console.error("Error fetching item balance data:", error);
        });
    }
  })
  .catch((error) => {
    console.error("Error fetching item data:", error);
  });

window.validationState = {};

setTimeout(() => {
  const currentData = this.getValues();
  const rowCount = currentData.gd_item_balance?.table_item_balance?.length || 0;
  for (let i = 0; i < rowCount; i++) {
    window.validationState[i] = true;
  }
  console.log(`Initialized validation state for ${rowCount} rows`);
}, 100);
