const data = this.getValues();
const lineItemData = arguments[0]?.row;
const categoryValue = arguments[0]?.value;
const rowIndex = arguments[0]?.rowIndex;

console.log("lineItemData", lineItemData);

const materialId = data.confirm_inventory.material_id;

// Helper function to get organization and plant info
const getPlantAndOrgInfo = () => {
  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }
  
  const plantId = data.plant_id || data.plant; // Support both field names
  
  return { organizationId, plantId };
};

const { organizationId, plantId } = getPlantAndOrgInfo();

// First, check if this is a serialized item by checking if serial_number exists
if (lineItemData.serial_number && lineItemData.serial_number.trim() !== "") {
  console.log("Processing serialized item with serial number:", lineItemData.serial_number);
  
  // For serialized items, query item_serial_balance
  const serialBalanceParams = {
    material_id: materialId,
    serial_number: lineItemData.serial_number,
    plant_id: plantId,
    organization_id: organizationId,
  };

  // Add location_id if available
  if (lineItemData.location_id) {
    serialBalanceParams.location_id = lineItemData.location_id;
  }

  // Add batch_id if available and applicable
  if (lineItemData.batch_id) {
    serialBalanceParams.batch_id = lineItemData.batch_id;
  }

  db.collection("item_serial_balance")
    .where(serialBalanceParams)
    .get()
    .then((response) => {
      console.log("response item_serial_balance", response);

      // Check if response.data exists and is an array with items
      if (
        response &&
        response.data &&
        Array.isArray(response.data) &&
        response.data.length > 0
      ) {
        const serialBalanceData = response.data[0];
        console.log("Serial balance data:", serialBalanceData);
        console.log("categoryValue", categoryValue);

        // Now set the data based on category for serialized item
        switch (categoryValue) {
          case "Quality Inspection":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                serialBalanceData.qualityinsp_qty,
            });
            break;
          case "Unrestricted":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                serialBalanceData.unrestricted_qty,
            });
            break;
          case "Reserved":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                serialBalanceData.reserved_qty,
            });
            break;
          case "Blocked":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                serialBalanceData.block_qty,
            });
            break;
          case "In Transit":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                serialBalanceData.intransit_qty,
            });
            break;
        }
      } else {
        console.log("No serial balance data found");
        // Set to 0 if no balance found
        this.setData({
          [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]: 0,
        });
      }
    })
    .catch((error) => {
      console.error("Error fetching serial balance:", error);
      // Set to 0 on error
      this.setData({
        [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]: 0,
      });
    });
} else if (lineItemData.batch_id) {
  db.collection("item_batch_balance")
    .where({
      material_id: materialId,
      batch_id: lineItemData.batch_id,
      location_id: lineItemData.location_id,
      plant_id: plantId,
      organization_id: organizationId,
    })
    .get()
    .then((response) => {
      console.log("response item_batch_balance", response);

      // Check if response.data exists and is an array with items
      if (
        response &&
        response.data &&
        Array.isArray(response.data) &&
        response.data.length > 0
      ) {
        const itemBalanceData = response.data[0];
        console.log("Item batch balance data:", itemBalanceData);
        console.log("categoryValue", categoryValue);

        // Now set the data based on category
        switch (categoryValue) {
          case "Quality Inspection":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                itemBalanceData.qualityinsp_qty,
            });
            break;
          case "Unrestricted":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                itemBalanceData.unrestricted_qty,
            });
            break;
          case "Reserved":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                itemBalanceData.reserved_qty,
            });
            break;
          case "Blocked":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                itemBalanceData.block_qty,
            });
            break;
          case "In Transit":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                itemBalanceData.intransit_qty,
            });
            break;
        }
      } else {
        console.log("No item batch balance data found");
        // Set to 0 if no balance found
        this.setData({
          [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]: 0,
        });
      }
    })
    .catch((error) => {
      console.error("Error fetching item batch balance:", error);
      // Set to 0 on error
      this.setData({
        [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]: 0,
      });
    });
} else {
  db.collection("item_balance")
    .where({ 
      material_id: materialId, 
      location_id: lineItemData.location_id,
      plant_id: plantId,
      organization_id: organizationId,
    })
    .get()
    .then((response) => {
      console.log("response item_balance", response);

      // Check if response.data exists and is an array with items
      if (
        response &&
        response.data &&
        Array.isArray(response.data) &&
        response.data.length > 0
      ) {
        const itemBalanceData = response.data[0];
        console.log("Item balance data:", itemBalanceData);

        // Now set the data based on category
        switch (categoryValue) {
          case "Quality Inspection":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                itemBalanceData.qualityinsp_qty,
            });
            break;
          case "Unrestricted":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                itemBalanceData.unrestricted_qty,
            });
            break;
          case "Reserved":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                itemBalanceData.reserved_qty,
            });
            break;
          case "Blocked":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                itemBalanceData.block_qty,
            });
            break;
          case "In Transit":
            this.setData({
              [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]:
                itemBalanceData.intransit_qty,
            });
            break;
        }
      } else {
        console.log("No item balance data found");
        // Set to 0 if no balance found
        this.setData({
          [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]: 0,
        });
      }
    })
    .catch((error) => {
      console.error("Error fetching item balance:", error);
      // Set to 0 on error
      this.setData({
        [`confirm_inventory.table_item_balance.${rowIndex}.category_balance`]: 0,
      });
    });
}
