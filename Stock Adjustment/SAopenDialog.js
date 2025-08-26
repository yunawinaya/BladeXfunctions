const allData = this.getValues();
const lineItemData = arguments[0]?.row;
const rowIndex = arguments[0]?.rowIndex;
const adjustment_type = allData.adjustment_type;
const materialId = lineItemData.material_id;
const isSingleSerial = lineItemData.is_single_serial;
const plantId = allData.plant_id;

console.log("materialId", materialId);

// Initially hide serial number column
this.hide("sa_item_balance.table_item_balance.serial_number");

const filterZeroQuantityRecords = (data, itemData) => {
  return data.filter((record) => {
    // For serialized items, check both serial number existence AND quantity > 0
    if (itemData && itemData.serial_number_management === 1) {
      // First check if serial number exists and is not empty
      const hasValidSerial =
        record.serial_number && record.serial_number.trim() !== "";

      if (!hasValidSerial) {
        return false; // Exclude if no valid serial number
      }

      // Then check if any quantity fields have value > 0
      const hasQuantity =
        (record.block_qty && record.block_qty > 0) ||
        (record.reserved_qty && record.reserved_qty > 0) ||
        (record.unrestricted_qty && record.unrestricted_qty > 0) ||
        (record.qualityinsp_qty && record.qualityinsp_qty > 0) ||
        (record.intransit_qty && record.intransit_qty > 0) ||
        (record.balance_quantity && record.balance_quantity > 0);

      console.log(
        `Serial ${record.serial_number}: hasQuantity=${hasQuantity}, unrestricted=${record.unrestricted_qty}, reserved=${record.reserved_qty}, balance=${record.balance_quantity}`
      );

      return hasQuantity; // Only include if both serial exists AND has quantity > 0
    }

    // For batch and regular items, check if any quantity fields have value > 0
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

// Proceed with original queries if no tempQtyData
if (materialId) {
  db.collection("Item")
    .where({
      id: materialId,
    })
    .get()
    .then((response) => {
      console.log("response item", response);
      const itemData = response.data[0];
      console.log("itemData", itemData);
      this.setData({
        [`sa_item_balance.material_id`]: itemData.material_code,
        [`sa_item_balance.material_name`]: itemData.material_name,
        [`sa_item_balance.row_index`]: rowIndex,
        [`sa_item_balance.material_uom`]: itemData.based_uom,
      });

      const previousBalanceData =
        lineItemData.balance_index === "" ||
        lineItemData.balance_index === undefined
          ? []
          : JSON.parse(lineItemData.balance_index);

      console.log("previousBalanceData", previousBalanceData);

      // Handle Serialized Items (takes priority over batch management)
      if (itemData.serial_number_management === 1) {
        console.log(
          "Processing serialized item (may also have batch management)"
        );

        // Show serial number column
        this.display("sa_item_balance.table_item_balance.serial_number");

        // Show or hide batch column based on whether item also has batch management
        if (itemData.item_batch_management === 1) {
          this.display("sa_item_balance.table_item_balance.batch_id");
          console.log(
            "Serialized item with batch management - showing both serial and batch columns"
          );
        } else {
          this.hide("sa_item_balance.table_item_balance.batch_id");
          console.log(
            "Serialized item without batch management - hiding batch column"
          );
        }

        db.collection("item_serial_balance")
          .where({
            material_id: materialId,
            plant_id: plantId,
          })
          .get()
          .then((response) => {
            console.log("response item_serial_balance", response.data);
            let itemBalanceData = response.data || [];

            // Map the data and remove the original id to prevent duplicate key errors
            const mappedData = Array.isArray(itemBalanceData)
              ? itemBalanceData.map((item) => {
                  const { id, ...itemWithoutId } = item; // Remove original id
                  return {
                    ...itemWithoutId,
                    balance_id: id, // Keep balance_id for reference
                  };
                })
              : (() => {
                  const { id, ...itemWithoutId } = itemBalanceData;
                  return { ...itemWithoutId, balance_id: id };
                })();

            let finalData = mappedData;

            if (previousBalanceData && previousBalanceData.length > 0) {
              finalData = previousBalanceData;
            }

            const filteredData = filterZeroQuantityRecords(finalData, itemData);
            console.log("Final filtered serialized data:", filteredData);

            this.setData({
              [`sa_item_balance.table_item_balance`]: filteredData,
            });

            if (isSingleSerial === 1) {
              this.setData({
                [`sa_item_balance.table_item_balance.movement_type`]: "Out",
              });
              this.hide("sa_item_balance.table_item_balance.movement_type");
            } else {
              this.display([
                `sa_item_balance.table_item_balance.movement_type`,
              ]);
            }
          })
          .catch((error) => {
            console.error("Error fetching item serial balance data:", error);
          });

        // Handle Batch Items (only if not serialized)
      } else if (itemData.item_batch_management === 1) {
        console.log("Processing batch item (non-serialized)");

        // Show batch column and hide serial number column
        this.display("sa_item_balance.table_item_balance.batch_id");
        this.hide("sa_item_balance.table_item_balance.serial_number");

        db.collection("item_batch_balance")
          .where({
            material_id: materialId,
            plant_id: plantId,
          })
          .get()
          .then((response) => {
            console.log("response item_batch_balance", response.data);
            let itemBalanceData = response.data || [];

            // Map the data and remove the original id to prevent duplicate key errors
            const mappedData = Array.isArray(itemBalanceData)
              ? itemBalanceData.map((item) => {
                  const { id, ...itemWithoutId } = item; // Remove original id
                  return {
                    ...itemWithoutId,
                    balance_id: id, // Keep balance_id for reference
                  };
                })
              : (() => {
                  const { id, ...itemWithoutId } = itemBalanceData;
                  return { ...itemWithoutId, balance_id: id };
                })();

            let finalData = mappedData;

            if (previousBalanceData && previousBalanceData.length > 0) {
              finalData = previousBalanceData;
            }

            const filteredData = filterZeroQuantityRecords(finalData, itemData);
            console.log("Final filtered batch data:", filteredData);

            this.setData({
              [`sa_item_balance.table_item_balance`]: filteredData,
            });

            if (adjustment_type === "Write Off") {
              this.setData({
                [`sa_item_balance.table_item_balance.movement_type`]: "Out",
              });
              this.hide("sa_item_balance.table_item_balance.movement_type");
            } else {
              this.display([
                `sa_item_balance.table_item_balance.movement_type`,
              ]);
            }
          })
          .catch((error) => {
            console.error("Error fetching item batch balance data:", error);
          });

        // Handle Regular Items (no batch, no serial)
      } else {
        console.log("Processing regular item (no batch, no serial)");

        // Hide both batch and serial columns
        this.hide("sa_item_balance.table_item_balance.batch_id");
        this.hide("sa_item_balance.table_item_balance.serial_number");

        db.collection("item_balance")
          .where({
            material_id: materialId,
            plant_id: plantId,
          })
          .get()
          .then((response) => {
            console.log("response item_balance", response.data);
            let itemBalanceData = response.data || [];

            // Map the data and remove the original id to prevent duplicate key errors
            const mappedData = Array.isArray(itemBalanceData)
              ? itemBalanceData.map((item) => {
                  const { id, ...itemWithoutId } = item; // Remove original id
                  return {
                    ...itemWithoutId,
                    balance_id: id, // Keep balance_id for reference
                  };
                })
              : (() => {
                  const { id, ...itemWithoutId } = itemBalanceData;
                  return { ...itemWithoutId, balance_id: id };
                })();

            let finalData = mappedData;

            if (previousBalanceData && previousBalanceData.length > 0) {
              finalData = previousBalanceData;
            }

            const filteredData = filterZeroQuantityRecords(finalData, itemData);
            console.log("Final filtered regular data:", filteredData);

            this.setData({
              [`sa_item_balance.table_item_balance`]: filteredData,
            });

            if (adjustment_type === "Write Off") {
              this.setData({
                [`sa_item_balance.table_item_balance.movement_type`]: "Out",
              });
              this.hide("sa_item_balance.table_item_balance.movement_type");
            } else {
              this.display([
                `sa_item_balance.table_item_balance.movement_type`,
              ]);
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
}
