const data = this.getValues();
const lineItemData = arguments[0]?.row;
const rowIndex = arguments[0]?.rowIndex;

console.log("lineItemData", lineItemData);

const materialId = lineItemData.material_id;
const altUOM = lineItemData.gd_order_uom_id;

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
    });

    this.setData({
      [`gd_item_balance.table_item_balance`]: [],
    });

    // Function to convert base quantity back to alternative quantity
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

    if (itemData.item_batch_management === 1) {
      this.display("gd_item_balance.table_item_balance.batch_id");

      db.collection("item_batch_balance")
        .where({
          material_id: materialId,
        })
        .get()
        .then((response) => {
          console.log("response item_batch_balance", response);
          let itemBalanceData = response.data;

          if (tempQtyData) {
            const tempQtyDataArray = JSON.parse(tempQtyData);
            this.setData({
              [`gd_item_balance.table_item_balance`]: tempQtyDataArray,
            });
          } else {
            const processedData = processItemBalanceData(itemBalanceData);
            this.setData({
              [`gd_item_balance.table_item_balance`]: processedData,
            });
          }
        })
        .catch((error) => {
          console.error("Error fetching item balance data:", error);
        });
    } else {
      this.hide("gd_item_balance.table_item_balance.batch_id");

      db.collection("item_balance")
        .where({
          material_id: materialId,
        })
        .get()
        .then((response) => {
          console.log("response item_balance", response);
          let itemBalanceData = response.data;

          if (tempQtyData) {
            const tempQtyDataArray = JSON.parse(tempQtyData);
            this.setData({
              [`gd_item_balance.table_item_balance`]: tempQtyDataArray,
            });
          } else {
            const processedData = processItemBalanceData(itemBalanceData);
            this.setData({
              [`gd_item_balance.table_item_balance`]: processedData,
            });
          }
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
const rowCount = data.gd_item_balance.table_item_balance.length;
for (let i = 0; i < rowCount; i++) {
  window.validationState[i] = true;
}
