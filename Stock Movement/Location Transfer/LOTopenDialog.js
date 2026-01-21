const allData = this.getValues();
const lineItemData = arguments[0]?.row;
const rowIndex = arguments[0]?.rowIndex;
const plant_id = allData.issuing_operation_faci;
const materialId = lineItemData.item_selection;
const tempQtyData = lineItemData.temp_qty_data;
const quantityUOM = lineItemData.quantity_uom;

const fetchUomData = async (uomIds) => {
  if (!uomIds || uomIds.length === 0) return [];

  try {
    const resUOM = await Promise.all(
      uomIds.map((id) =>
        db.collection("unit_of_measurement").where({ id }).get()
      )
    );
    return resUOM.map((response) => response.data[0]).filter(Boolean);
  } catch (error) {
    console.error("Error fetching UOM data:", error);
    return [];
  }
};

// Hide category columns for Location Transfer
this.hide([
  "sm_item_balance.table_item_balance.category_from",
  "sm_item_balance.table_item_balance.category_to",
  "sm_item_balance.table_item_balance.serial_number",
]);

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
    tempDataArray.map((tempItem) => [generateKey(tempItem, itemData), tempItem])
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
      (dbItem) => generateKey(dbItem, itemData) === key
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

const processBalanceData = (itemBalanceData, itemData) => {
  const mappedData = mapBalanceData(itemBalanceData);
  let finalData = mappedData;

  if (tempQtyData) {
    try {
      const tempQtyDataArray = JSON.parse(tempQtyData);
      finalData = mergeWithTempData(mappedData, tempQtyDataArray, itemData);
    } catch (error) {
      console.error("Error parsing temp_qty_data:", error);
    }
  }

  return filterZeroQuantityRecords(finalData, itemData);
};

if (materialId) {
  db.collection("Item")
    .where({ id: materialId })
    .get()
    .then(async (response) => {
      const itemData = response.data[0];

      const altUoms = itemData.table_uom_conversion?.map(
        (data) => data.alt_uom_id
      );
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

      if (itemData.serial_number_management === 1) {
        this.display([
          "sm_item_balance.table_item_balance.serial_number",
          "sm_item_balance.search_serial_number",
          "sm_item_balance.confirm_search",
          "sm_item_balance.reset_search",
        ]);

        if (itemData.item_batch_management === 1) {
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

        db.collection("item_serial_balance")
          .where({ material_id: materialId, plant_id: plant_id })
          .get()
          .then((response) => {
            const filteredData = processBalanceData(
              response.data || [],
              itemData
            );

            this.setData({
              [`sm_item_balance.table_item_balance`]: filteredData,
              [`sm_item_balance.table_item_balance_raw`]:
                JSON.stringify(filteredData),
            });
          })
          .catch((error) => {
            console.error("Error fetching item serial balance data:", error);
          });
      } else if (itemData.item_batch_management === 1) {
        this.display([
          "sm_item_balance.table_item_balance.batch_id",
          "sm_item_balance.table_item_balance.dialog_expired_date",
          "sm_item_balance.table_item_balance.dialog_manufacturing_date",
        ]);
        this.hide("sm_item_balance.table_item_balance.serial_number");

        db.collection("item_batch_balance")
          .where({ material_id: materialId, plant_id: plant_id })
          .get()
          .then((response) => {
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
                    dialog_manufacturing_date:
                      itemBalanceData.manufacturing_date,
                  };
                })();

            const filteredData = processBalanceData(mappedData, itemData);
            this.setData({
              [`sm_item_balance.table_item_balance`]: filteredData,
            });
          })
          .catch((error) => {
            console.error("Error fetching item batch balance data:", error);
          });
      } else {
        this.hide([
          "sm_item_balance.table_item_balance.batch_id",
          "sm_item_balance.table_item_balance.dialog_expired_date",
          "sm_item_balance.table_item_balance.dialog_manufacturing_date",
          "sm_item_balance.table_item_balance.serial_number",
        ]);

        db.collection("item_balance")
          .where({ material_id: materialId, plant_id: plant_id })
          .get()
          .then((response) => {
            const filteredData = processBalanceData(
              response.data || [],
              itemData
            );

            this.setData({
              [`sm_item_balance.table_item_balance`]: filteredData,
              [`sm_item_balance.table_item_balance.unit_price`]:
                itemData.purchase_unit_price,
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
}

this.setData({
  [`sm_item_balance.table_item_balance.category`]: undefined,
});
