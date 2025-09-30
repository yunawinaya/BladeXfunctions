class StockAdjuster {
  constructor(db) {
    this.db = db;
    this.categoryMap = {
      Unrestricted: "unrestricted_qty",
      "Quality Inspection": "qualityinsp_qty",
      Blocked: "block_qty",
      Reserved: "reserved_qty",
    };
  }

  // Helper functions for consistent decimal formatting
  roundQty(value) {
    return parseFloat(parseFloat(value || 0).toFixed(3));
  }

  roundPrice(value) {
    return parseFloat(parseFloat(value || 0).toFixed(4));
  }

  validateRequiredFields(data, requiredFields, context = "") {
    const missingFields = requiredFields.filter(
      (field) => !data[field] && data[field] !== 0
    );
    if (missingFields.length > 0) {
      throw new Error(
        `Please fill in all required fields marked with (*) ${context}: ${missingFields.join(
          ", "
        )}`
      );
    }
  }

  // Add this missing method to the StockAdjuster class

  async transferSerialBalanceCategory(
    materialId,
    serialNumber,
    batchId,
    locationId,
    categoryFrom,
    categoryTo,
    qtyChange,
    plantId,
    organizationId
  ) {
    try {
      console.log(
        `Transferring serial balance category for ${serialNumber}: ${categoryFrom} → ${categoryTo}, Qty: ${qtyChange}`
      );

      const serialBalanceParams = {
        material_id: materialId,
        serial_number: serialNumber,
        plant_id: plantId,
        organization_id: organizationId,
      };

      if (batchId) {
        serialBalanceParams.batch_id = batchId;
      }

      if (locationId) {
        serialBalanceParams.location_id = locationId;
      }

      const serialBalanceQuery = await this.db
        .collection("item_serial_balance")
        .where(serialBalanceParams)
        .get();

      if (!serialBalanceQuery.data || serialBalanceQuery.data.length === 0) {
        throw new Error(
          `No serial balance found for serial number: ${serialNumber}`
        );
      }

      const existingBalance = serialBalanceQuery.data[0];

      // Get category field mappings
      const fromCategoryField =
        this.categoryMap[categoryFrom] || "unrestricted_qty";
      const toCategoryField =
        this.categoryMap[categoryTo] || "unrestricted_qty";

      const currentFromQty = this.roundQty(
        parseFloat(existingBalance[fromCategoryField] || 0)
      );
      const currentToQty = this.roundQty(
        parseFloat(existingBalance[toCategoryField] || 0)
      );

      // Validate sufficient quantity in source category
      if (currentFromQty < qtyChange) {
        throw new Error(
          `Insufficient ${categoryFrom} quantity for serial ${serialNumber}. Available: ${currentFromQty}, Requested: ${qtyChange}`
        );
      }

      // Calculate new quantities
      const newFromQty = this.roundQty(currentFromQty - qtyChange);
      const newToQty = this.roundQty(currentToQty + qtyChange);

      // Update the serial balance record
      const updateData = {
        [fromCategoryField]: newFromQty,
        [toCategoryField]: newToQty,
        update_time: new Date().toISOString(),
      };

      await this.db
        .collection("item_serial_balance")
        .doc(existingBalance.id)
        .update(updateData);

      console.log(
        `Updated serial balance category transfer for ${serialNumber}: ${categoryFrom}=${newFromQty}, ${categoryTo}=${newToQty}`
      );

      // ✅ CRITICAL FIX: For serialized items, also update item_balance (aggregated across all serial numbers)
      try {
        const generalItemBalanceParams = {
          material_id: materialId,
          location_id: locationId,
          plant_id: plantId,
          organization_id: organizationId,
        };

        // Don't include serial_number in item_balance query (aggregated balance across all serial numbers)
        const generalBalanceQuery = await this.db
          .collection("item_balance")
          .where(generalItemBalanceParams)
          .get();

        if (generalBalanceQuery.data && generalBalanceQuery.data.length > 0) {
          // Update existing item_balance record for category transfer
          const generalBalance = generalBalanceQuery.data[0];

          const currentGeneralFromQty = parseFloat(
            generalBalance[fromCategoryField] || 0
          );
          const currentGeneralToQty = parseFloat(
            generalBalance[toCategoryField] || 0
          );

          const generalUpdateData = {
            [fromCategoryField]: this.roundQty(
              currentGeneralFromQty - qtyChange
            ),
            [toCategoryField]: this.roundQty(currentGeneralToQty + qtyChange),
            update_time: new Date().toISOString(),
          };

          await this.db
            .collection("item_balance")
            .doc(generalBalance.id)
            .update(generalUpdateData);

          console.log(
            `✓ Updated aggregated item_balance for serialized category transfer ${materialId}, serial ${serialNumber}: ${categoryFrom}=${generalUpdateData[fromCategoryField]}, ${categoryTo}=${generalUpdateData[toCategoryField]}`
          );
        } else {
          console.warn(
            `No item_balance record found for serialized category transfer ${materialId} at location ${locationId}`
          );
        }
      } catch (itemBalanceError) {
        console.error(
          `Error updating aggregated item_balance for serialized category transfer ${materialId}, serial ${serialNumber}:`,
          itemBalanceError
        );
        // Don't throw - let the main process continue
      }

      return true;
    } catch (error) {
      console.error(
        `Error transferring serial balance category for ${serialNumber}:`,
        error
      );
      throw error;
    }
  }

  async addSerialNumberInventoryForSMDeduction(
    data,
    item,
    inventoryMovementId,
    organizationId,
    plantId,
    singleBalance,
    movementType
  ) {
    try {
      console.log(
        `Processing serial number deduction for SM item ${item.item_selection}, movement: ${movementType}`
      );

      const balancesToProcess = singleBalance ? [singleBalance] : [];

      if (balancesToProcess.length === 0) {
        console.log(`No balance to process for item ${item.item_selection}`);
        return;
      }

      const itemRes = await this.db
        .collection("Item")
        .where({ id: item.item_selection })
        .get();
      if (!itemRes.data || !itemRes.data.length) {
        console.error(`Item not found: ${item.item_selection}`);
        return;
      }
      const itemData = itemRes.data[0];
      const isSerializedItem = itemData.serial_number_management === 1;

      if (!isSerializedItem) {
        console.log(
          `Item ${item.item_selection} is not serialized, skipping serial processing`
        );
        return;
      }

      let baseUOM = itemData.based_uom;

      for (const balance of balancesToProcess) {
        let baseQtyPerBalance = this.roundQty(
          parseFloat(balance.quantity_converted || balance.sm_quantity || 0)
        );

        if (movementType === "Location Transfer") {
          await this.createSerialMovementRecord(
            inventoryMovementId,
            balance.serial_number,
            balance.batch_id,
            baseQtyPerBalance,
            baseUOM,
            plantId,
            organizationId
          );

          await this.updateSerialBalance(
            item.item_selection,
            balance.serial_number,
            balance.batch_id,
            balance.location_id,
            balance.category || "Unrestricted",
            -baseQtyPerBalance,
            plantId,
            organizationId
          );
        } else {
          await this.createSerialMovementRecord(
            inventoryMovementId,
            balance.serial_number,
            balance.batch_id,
            baseQtyPerBalance,
            baseUOM,
            plantId,
            organizationId
          );

          await this.updateSerialBalance(
            item.item_selection,
            balance.serial_number,
            balance.batch_id,
            balance.location_id,
            balance.category || "Unrestricted",
            -baseQtyPerBalance,
            plantId,
            organizationId
          );
        }
      }

      console.log(
        `Successfully processed serial number deduction for SM item ${item.item_selection}`
      );
    } catch (error) {
      console.error(
        `Error processing serial number deduction for SM item ${item.item_selection}:`,
        error
      );
      throw new Error(
        `Failed to process serial number deduction for SM item ${item.item_selection}: ${error.message}`
      );
    }
  }

  async createSerialMovementRecord(
    inventoryMovementId,
    serialNumber,
    batchId,
    baseQty,
    baseUOM,
    plantId,
    organizationId
  ) {
    const invSerialMovementRecord = {
      inventory_movement_id: inventoryMovementId,
      serial_number: serialNumber,
      batch_id: batchId || null,
      base_qty: this.roundQty(baseQty),
      base_uom: baseUOM,
      plant_id: plantId,
      organization_id: organizationId,
    };

    await this.db
      .collection("inv_serial_movement")
      .add(invSerialMovementRecord);
    console.log(`Created inv_serial_movement for serial: ${serialNumber}`);
  }

  async updateSerialBalance(
    materialId,
    serialNumber,
    batchId,
    locationId,
    category,
    qtyChange,
    plantId,
    organizationId
  ) {
    const serialBalanceParams = {
      material_id: materialId,
      serial_number: serialNumber,
      plant_id: plantId,
      organization_id: organizationId,
    };

    if (batchId) {
      serialBalanceParams.batch_id = batchId;
    }

    if (locationId) {
      serialBalanceParams.location_id = locationId;
    }

    const serialBalanceQuery = await this.db
      .collection("item_serial_balance")
      .where(serialBalanceParams)
      .get();

    if (!serialBalanceQuery.data || serialBalanceQuery.data.length === 0) {
      throw new Error(
        `No serial balance found for serial number: ${serialNumber}`
      );
    }

    const existingBalance = serialBalanceQuery.data[0];
    const categoryField = this.categoryMap[category] || "unrestricted_qty";

    const currentCategoryQty = this.roundQty(
      parseFloat(existingBalance[categoryField] || 0)
    );
    const currentBalanceQty = this.roundQty(
      parseFloat(existingBalance.balance_quantity || 0)
    );

    const newCategoryQty = this.roundQty(currentCategoryQty + qtyChange);
    const newBalanceQty = this.roundQty(currentBalanceQty + qtyChange);

    if (newCategoryQty < 0) {
      throw new Error(
        `Insufficient ${category} quantity for serial ${serialNumber}. Available: ${currentCategoryQty}, Requested: ${Math.abs(
          qtyChange
        )}`
      );
    }

    if (newBalanceQty < 0) {
      throw new Error(
        `Insufficient total quantity for serial ${serialNumber}. Available: ${currentBalanceQty}, Requested: ${Math.abs(
          qtyChange
        )}`
      );
    }

    const updateData = {
      [categoryField]: newCategoryQty,
      balance_quantity: newBalanceQty,
    };

    await this.db
      .collection("item_serial_balance")
      .doc(existingBalance.id)
      .update(updateData);

    console.log(
      `Updated serial balance for ${serialNumber}: ${category}=${newCategoryQty}, Balance=${newBalanceQty}`
    );

    // ✅ CRITICAL FIX: For serialized items, also update item_balance (aggregated across all serial numbers)
    try {
      const generalItemBalanceParams = {
        material_id: materialId,
        location_id: locationId,
        plant_id: plantId,
        organization_id: organizationId,
      };

      // Don't include serial_number in item_balance query (aggregated balance across all serial numbers)
      const generalBalanceQuery = await this.db
        .collection("item_balance")
        .where(generalItemBalanceParams)
        .get();

      if (generalBalanceQuery.data && generalBalanceQuery.data.length > 0) {
        // Update existing item_balance record
        const generalBalance = generalBalanceQuery.data[0];

        const currentGeneralBalanceQty = parseFloat(
          generalBalance.balance_quantity || 0
        );
        const currentGeneralCategoryQty = parseFloat(
          generalBalance[categoryField] || 0
        );

        const generalUpdateData = {
          balance_quantity: this.roundQty(currentGeneralBalanceQty + qtyChange),
          [categoryField]: this.roundQty(currentGeneralCategoryQty + qtyChange),
          update_time: new Date().toISOString(),
        };

        await this.db
          .collection("item_balance")
          .doc(generalBalance.id)
          .update(generalUpdateData);

        console.log(
          `✓ Updated aggregated item_balance for serialized item ${materialId}, serial ${serialNumber}: ${category}=${generalUpdateData[categoryField]}, Balance=${generalUpdateData.balance_quantity}`
        );
      } else {
        // Create new item_balance record if it doesn't exist
        const generalUpdateData = {
          material_id: materialId,
          location_id: locationId,
          plant_id: plantId,
          organization_id: organizationId,
          balance_quantity: this.roundQty(qtyChange),
          unrestricted_qty:
            category === "Unrestricted" ? this.roundQty(qtyChange) : 0,
          qualityinsp_qty:
            category === "Quality Inspection" ? this.roundQty(qtyChange) : 0,
          block_qty: category === "Blocked" ? this.roundQty(qtyChange) : 0,
          reserved_qty: category === "Reserved" ? this.roundQty(qtyChange) : 0,
          intransit_qty:
            category === "In Transit" ? this.roundQty(qtyChange) : 0,
          create_time: new Date().toISOString(),
          update_time: new Date().toISOString(),
          is_deleted: 0,
        };

        await this.db.collection("item_balance").add(generalUpdateData);

        console.log(
          `✓ Created new aggregated item_balance for serialized item ${materialId}, serial ${serialNumber}: ${category}=${generalUpdateData[categoryField]}`
        );
      }
    } catch (itemBalanceError) {
      console.error(
        `Error updating aggregated item_balance for serialized item ${materialId}, serial ${serialNumber}:`,
        itemBalanceError
      );
      // Don't throw - let the main process continue
    }
  }

  async addSerialNumberInventoryForSMReceipt(
    data,
    item,
    inventoryMovementId,
    organizationId,
    plantId,
    singleBalance,
    receivingLocationId
  ) {
    try {
      console.log(
        `Processing serial number receipt for Location Transfer at receiving location ${receivingLocationId}`
      );

      const balancesToProcess = singleBalance ? [singleBalance] : [];

      if (balancesToProcess.length === 0) {
        console.log(`No balance to process for item ${item.item_selection}`);
        return;
      }

      const itemRes = await this.db
        .collection("Item")
        .where({ id: item.item_selection })
        .get();
      if (!itemRes.data || !itemRes.data.length) {
        console.error(`Item not found: ${item.item_selection}`);
        return;
      }
      const itemData = itemRes.data[0];
      let baseUOM = itemData.based_uom;

      for (const balance of balancesToProcess) {
        let baseQtyPerBalance = this.roundQty(
          parseFloat(balance.quantity_converted || balance.sm_quantity || 0)
        );

        await this.createSerialMovementRecord(
          inventoryMovementId,
          balance.serial_number,
          balance.batch_id,
          baseQtyPerBalance,
          baseUOM,
          plantId,
          organizationId
        );

        // For production orders, items should go to Reserved category at destination
        const destinationCategory =
          data.is_production_order === 1
            ? "Reserved"
            : balance.category || "Unrestricted";

        await this.createOrUpdateReceivingSerialBalance(
          item.item_selection,
          balance.serial_number,
          balance.batch_id,
          receivingLocationId,
          destinationCategory,
          baseQtyPerBalance,
          plantId,
          organizationId,
          baseUOM
        );
      }

      console.log(
        `Successfully processed serial number receipt for Location Transfer`
      );
    } catch (error) {
      console.error(
        `Error processing serial number receipt for Location Transfer:`,
        error
      );
      throw error;
    }
  }

  async createOrUpdateReceivingSerialBalance(
    materialId,
    serialNumber,
    batchId,
    locationId,
    category,
    qtyChange,
    plantId,
    organizationId,
    materialUom
  ) {
    const serialBalanceParams = {
      material_id: materialId,
      serial_number: serialNumber,
      location_id: locationId,
      plant_id: plantId,
      organization_id: organizationId,
    };

    if (batchId) {
      serialBalanceParams.batch_id = batchId;
    }

    const serialBalanceQuery = await this.db
      .collection("item_serial_balance")
      .where(serialBalanceParams)
      .get();

    const categoryField = this.categoryMap[category] || "unrestricted_qty";

    if (serialBalanceQuery.data && serialBalanceQuery.data.length > 0) {
      const existingBalance = serialBalanceQuery.data[0];
      const currentCategoryQty = this.roundQty(
        parseFloat(existingBalance[categoryField] || 0)
      );
      const currentBalanceQty = this.roundQty(
        parseFloat(existingBalance.balance_quantity || 0)
      );

      const newCategoryQty = this.roundQty(currentCategoryQty + qtyChange);
      const newBalanceQty = this.roundQty(currentBalanceQty + qtyChange);

      const updateData = {
        [categoryField]: newCategoryQty,
        balance_quantity: newBalanceQty,
      };

      await this.db
        .collection("item_serial_balance")
        .doc(existingBalance.id)
        .update(updateData);

      console.log(
        `Updated existing serial balance for ${serialNumber} at location ${locationId}`
      );
    } else {
      const serialBalanceRecord = {
        material_id: materialId,
        material_uom: materialUom,
        serial_number: serialNumber,
        batch_id: batchId || null,
        plant_id: plantId,
        location_id: locationId,
        unrestricted_qty:
          category === "Unrestricted" ? this.roundQty(qtyChange) : 0,
        block_qty: category === "Blocked" ? this.roundQty(qtyChange) : 0,
        reserved_qty: category === "Reserved" ? this.roundQty(qtyChange) : 0,
        qualityinsp_qty:
          category === "Quality Inspection" ? this.roundQty(qtyChange) : 0,
        intransit_qty: category === "In Transit" ? this.roundQty(qtyChange) : 0,
        balance_quantity: this.roundQty(qtyChange),
        organization_id: organizationId,
      };

      await this.db.collection("item_serial_balance").add(serialBalanceRecord);

      console.log(
        `Created new serial balance for ${serialNumber} at location ${locationId}`
      );
    }

    // ✅ CRITICAL FIX: For serialized items, also update item_balance (aggregated across all serial numbers)
    try {
      const generalItemBalanceParams = {
        material_id: materialId,
        location_id: locationId,
        plant_id: plantId,
        organization_id: organizationId,
      };

      // Don't include serial_number in item_balance query (aggregated balance across all serial numbers)
      const generalBalanceQuery = await this.db
        .collection("item_balance")
        .where(generalItemBalanceParams)
        .get();

      if (generalBalanceQuery.data && generalBalanceQuery.data.length > 0) {
        // Update existing item_balance record
        const generalBalance = generalBalanceQuery.data[0];

        const currentGeneralBalanceQty = parseFloat(
          generalBalance.balance_quantity || 0
        );
        const currentGeneralCategoryQty = parseFloat(
          generalBalance[categoryField] || 0
        );

        const generalUpdateData = {
          balance_quantity: this.roundQty(currentGeneralBalanceQty + qtyChange),
          [categoryField]: this.roundQty(currentGeneralCategoryQty + qtyChange),
          update_time: new Date().toISOString(),
        };

        await this.db
          .collection("item_balance")
          .doc(generalBalance.id)
          .update(generalUpdateData);

        console.log(
          `✓ Updated aggregated item_balance for receiving serialized item ${materialId}, serial ${serialNumber}: ${category}=${generalUpdateData[categoryField]}, Balance=${generalUpdateData.balance_quantity}`
        );
      } else {
        // Create new item_balance record if it doesn't exist
        const generalUpdateData = {
          material_id: materialId,
          location_id: locationId,
          plant_id: plantId,
          organization_id: organizationId,
          balance_quantity: this.roundQty(qtyChange),
          unrestricted_qty:
            category === "Unrestricted" ? this.roundQty(qtyChange) : 0,
          qualityinsp_qty:
            category === "Quality Inspection" ? this.roundQty(qtyChange) : 0,
          block_qty: category === "Blocked" ? this.roundQty(qtyChange) : 0,
          reserved_qty: category === "Reserved" ? this.roundQty(qtyChange) : 0,
          intransit_qty:
            category === "In Transit" ? this.roundQty(qtyChange) : 0,
          create_time: new Date().toISOString(),
          update_time: new Date().toISOString(),
          is_deleted: 0,
        };

        await this.db.collection("item_balance").add(generalUpdateData);

        console.log(
          `✓ Created new aggregated item_balance for receiving serialized item ${materialId}, serial ${serialNumber}: ${category}=${generalUpdateData[categoryField]}`
        );
      }
    } catch (itemBalanceError) {
      console.error(
        `Error updating aggregated item_balance for receiving serialized item ${materialId}, serial ${serialNumber}:`,
        itemBalanceError
      );
      // Don't throw - let the main process continue
    }
  }

  async addSerialNumberInventoryForCategoryTransfer(
    data,
    item,
    inventoryMovementId,
    organizationId,
    plantId,
    balance
  ) {
    try {
      console.log(
        `Processing serial number category transfer for SM item ${item.item_selection}`
      );
      console.log(
        `Category transfer: ${balance.category_from} → ${balance.category_to}`
      );

      if (!balance.serial_number) {
        throw new Error("Serial number is required for category transfer");
      }

      if (!balance.category_from || !balance.category_to) {
        throw new Error("Both category_from and category_to are required");
      }

      const itemRes = await this.db
        .collection("Item")
        .where({ id: item.item_selection })
        .get();
      if (!itemRes.data || !itemRes.data.length) {
        console.error(`Item not found: ${item.item_selection}`);
        return;
      }
      const itemData = itemRes.data[0];
      let baseUOM = itemData.based_uom;

      let baseQty = this.roundQty(parseFloat(balance.original_quantity || 1));

      // Create serial movement record for the OUT movement
      await this.createSerialMovementRecord(
        inventoryMovementId,
        balance.serial_number,
        balance.batch_id,
        baseQty,
        baseUOM,
        plantId,
        organizationId
      );

      // Update the serial balance (transfer from one category to another)
      await this.transferSerialBalanceCategory(
        item.item_selection,
        balance.serial_number,
        balance.batch_id,
        balance.location_id,
        balance.category_from,
        balance.category_to,
        baseQty,
        plantId,
        organizationId,
        baseUOM
      );

      console.log(
        `Successfully processed serial number category transfer for ${balance.serial_number}`
      );
    } catch (error) {
      console.error(
        `Error processing serial number category transfer for SM item ${item.item_selection}:`,
        error
      );
      throw new Error(
        `Failed to process serial number category transfer for SM item ${item.item_selection}: ${error.message}`
      );
    }
  }

  async addSerialNumberInventoryForInterFacilityTransfer(
    data,
    item,
    inventoryMovementId,
    organizationId,
    plantId
  ) {
    try {
      console.log(
        `Processing serial number for Inter Operation Facility Transfer - item ${item.item_selection}`
      );

      const balancesToProcess =
        data.balance_index?.filter(
          (balance) =>
            balance.sm_quantity &&
            balance.sm_quantity > 0 &&
            balance.material_id === item.item_selection
        ) || [];

      if (balancesToProcess.length === 0) {
        console.log(`No balances to process for item ${item.item_selection}`);
        return;
      }

      const itemRes = await this.db
        .collection("Item")
        .where({ id: item.item_selection })
        .get();
      if (!itemRes.data || !itemRes.data.length) {
        console.error(`Item not found: ${item.item_selection}`);
        return;
      }
      const itemData = itemRes.data[0];
      let baseUOM = itemData.based_uom;

      for (const balance of balancesToProcess) {
        let baseQtyPerBalance = this.roundQty(
          parseFloat(balance.quantity_converted || balance.sm_quantity || 0)
        );

        await this.createSerialMovementRecord(
          inventoryMovementId,
          balance.serial_number,
          balance.batch_id,
          baseQtyPerBalance,
          baseUOM,
          plantId,
          organizationId
        );

        await this.createOrUpdateReceivingSerialBalance(
          item.item_selection,
          balance.serial_number,
          balance.batch_id,
          item.location_id || balance.location_id,
          balance.category || "Unrestricted",
          baseQtyPerBalance,
          plantId,
          organizationId,
          baseUOM
        );
      }

      console.log(
        `Successfully processed serial number for Inter Operation Facility Transfer`
      );
    } catch (error) {
      console.error(
        `Error processing serial number for Inter Operation Facility Transfer:`,
        error
      );
      throw error;
    }
  }

  async addSerialNumberInventoryForSM(
    data,
    item,
    inventoryMovementId,
    organizationId,
    plantId,
    batchId = null
  ) {
    try {
      console.log(
        `Processing serial number inventory for SM item ${item.item_selection}`
      );

      if (!item.serial_number_data) {
        console.log(
          `No serial number data found for item ${item.item_selection}`
        );
        return;
      }

      let serialNumberData;
      try {
        serialNumberData = JSON.parse(item.serial_number_data);
      } catch (parseError) {
        console.error(
          `Error parsing serial number data for item ${item.item_selection}:`,
          parseError
        );
        return;
      }

      const tableSerialNumber = serialNumberData.table_serial_number || [];
      const serialQuantity = serialNumberData.serial_number_qty || 0;
      const isAuto = serialNumberData.is_auto;

      // Get item data for UOM
      const itemRes = await this.db
        .collection("Item")
        .where({ id: item.item_selection })
        .get();
      if (!itemRes.data || !itemRes.data.length) {
        console.error(`Item not found: ${item.item_selection}`);
        return;
      }
      const itemData = itemRes.data[0];

      // For SM, we work with base quantity directly
      let baseQty = this.roundQty(
        parseFloat(item.quantity_converted || item.received_quantity || 0)
      );
      let baseUOM = itemData.based_uom;

      // Calculate base quantity per serial number
      const baseQtyPerSerial =
        serialQuantity > 0 ? baseQty / serialQuantity : 0;

      // Use the passed batchId if available
      let finalBatchId = batchId;

      // Setup inventory category quantities for serial balance
      let block_qty = 0,
        reserved_qty = 0,
        unrestricted_qty = 0,
        qualityinsp_qty = 0,
        intransit_qty = 0;

      const category = item.category || "Unrestricted";
      if (category === "Blocked") {
        block_qty = baseQtyPerSerial;
      } else if (category === "Reserved") {
        reserved_qty = baseQtyPerSerial;
      } else if (category === "Unrestricted") {
        unrestricted_qty = baseQtyPerSerial;
      } else if (category === "Quality Inspection") {
        qualityinsp_qty = baseQtyPerSerial;
      } else if (category === "In Transit") {
        intransit_qty = baseQtyPerSerial;
      } else {
        unrestricted_qty = baseQtyPerSerial;
      }

      const balance_quantity =
        block_qty +
        reserved_qty +
        unrestricted_qty +
        qualityinsp_qty +
        intransit_qty;

      // Process serial number generation if needed
      const updatedTableSerialNumber = [];
      let generatedCount = 0;
      let currentRunningNumber = null;
      let serialPrefix = "";

      if (isAuto === 1) {
        const needsGeneration = tableSerialNumber.some(
          (serial) =>
            serial.system_serial_number === "Auto generated serial number"
        );

        if (needsGeneration) {
          const resSerialConfig = await this.db
            .collection("serial_level_config")
            .where({ organization_id: organizationId })
            .get();

          if (
            !resSerialConfig ||
            !resSerialConfig.data ||
            resSerialConfig.data.length === 0
          ) {
            throw new Error(
              `Serial number configuration not found for organization ${organizationId}`
            );
          }

          const serialConfigData = resSerialConfig.data[0];
          currentRunningNumber = serialConfigData.serial_running_number;
          serialPrefix = serialConfigData.serial_prefix
            ? `${serialConfigData.serial_prefix}-`
            : "";
        }
      }

      // Process all serial numbers sequentially
      for (
        let serialIndex = 0;
        serialIndex < tableSerialNumber.length;
        serialIndex++
      ) {
        const serialItem = tableSerialNumber[serialIndex];
        let finalSystemSerialNumber = serialItem.system_serial_number;

        // Generate new serial number if needed
        if (finalSystemSerialNumber === "Auto generated serial number") {
          finalSystemSerialNumber =
            serialPrefix +
            String(currentRunningNumber + generatedCount).padStart(10, "0");
          generatedCount++;
        }

        updatedTableSerialNumber.push({
          ...serialItem,
          system_serial_number: finalSystemSerialNumber,
        });

        if (
          finalSystemSerialNumber &&
          finalSystemSerialNumber !== "" &&
          finalSystemSerialNumber !== "Auto generated serial number"
        ) {
          // 1. Insert serial_number record
          const serialNumberRecord = {
            system_serial_number: finalSystemSerialNumber,
            supplier_serial_number: serialItem.supplier_serial_number || "",
            material_id: item.item_selection,
            batch_id: finalBatchId,
            bin_location: item.location_id,
            plant_id: plantId,
            organization_id: organizationId,
            transaction_no: data.stock_movement_no,
            parent_trx_no: "",
          };

          await this.db.collection("serial_number").add(serialNumberRecord);

          // 2. Insert inv_serial_movement record
          const invSerialMovementRecord = {
            inventory_movement_id: inventoryMovementId,
            serial_number: finalSystemSerialNumber,
            batch_id: finalBatchId,
            base_qty: this.roundQty(baseQtyPerSerial),
            base_uom: baseUOM,
            plant_id: plantId,
            organization_id: organizationId,
          };

          await this.db
            .collection("inv_serial_movement")
            .add(invSerialMovementRecord);

          // 3. Insert item_serial_balance record
          const serialBalanceRecord = {
            material_id: item.item_selection,
            material_uom: baseUOM,
            serial_number: finalSystemSerialNumber,
            batch_id: finalBatchId,
            plant_id: plantId,
            location_id: item.location_id,
            unrestricted_qty: this.roundQty(unrestricted_qty),
            block_qty: this.roundQty(block_qty),
            reserved_qty: this.roundQty(reserved_qty),
            qualityinsp_qty: this.roundQty(qualityinsp_qty),
            intransit_qty: this.roundQty(intransit_qty),
            balance_quantity: this.roundQty(balance_quantity),
            organization_id: organizationId,
          };

          await this.db
            .collection("item_serial_balance")
            .add(serialBalanceRecord);
        }
      }

      // Update serial configuration if we generated new numbers
      if (generatedCount > 0 && currentRunningNumber !== null) {
        await this.db
          .collection("serial_level_config")
          .where({ organization_id: organizationId })
          .update({
            serial_running_number: currentRunningNumber + generatedCount,
          });
      }

      // Update the item's serial number data in the main data structure and store generated serial numbers
      const updatedSerialNumberData = {
        ...serialNumberData,
        table_serial_number: updatedTableSerialNumber,
      };

      // Update the item in data.stock_movement
      const itemIndex = data.stock_movement.findIndex(
        (smItem) => smItem === item
      );
      if (itemIndex !== -1) {
        data.stock_movement[itemIndex].serial_number_data = JSON.stringify(
          updatedSerialNumberData
        );

        // Store the generated serial numbers for record creation use
        const generatedSerialNumbers = updatedTableSerialNumber
          .map((serial) => serial.system_serial_number)
          .filter(
            (serial) =>
              serial &&
              serial !== "" &&
              serial !== "Auto generated serial number"
          );
        data.stock_movement[itemIndex].generated_serial_numbers =
          generatedSerialNumbers;
        console.log(
          `Stored ${
            generatedSerialNumbers.length
          } generated serial numbers for record creation: [${generatedSerialNumbers.join(
            ", "
          )}]`
        );
      }

      // ✅ CRITICAL FIX: For serialized items processed in SM, also update item_balance (aggregated across all serial numbers)
      try {
        const generalItemBalanceParams = {
          material_id: item.item_selection,
          location_id: item.location_id,
          plant_id: plantId,
          organization_id: organizationId,
        };

        // Don't include serial_number in item_balance query (aggregated balance across all serial numbers)
        const generalBalanceQuery = await this.db
          .collection("item_balance")
          .where(generalItemBalanceParams)
          .get();

        // Calculate total quantities from all serial numbers processed
        const totalUnrestrictedQty = this.roundQty(baseQty);
        const totalBalanceQty = this.roundQty(baseQty);

        if (generalBalanceQuery.data && generalBalanceQuery.data.length > 0) {
          // Update existing item_balance record
          const generalBalance = generalBalanceQuery.data[0];

          const currentGeneralBalanceQty = parseFloat(
            generalBalance.balance_quantity || 0
          );
          const currentGeneralUnrestrictedQty = parseFloat(
            generalBalance.unrestricted_qty || 0
          );

          const generalUpdateData = {
            balance_quantity: this.roundQty(
              currentGeneralBalanceQty + totalBalanceQty
            ),
            unrestricted_qty: this.roundQty(
              currentGeneralUnrestrictedQty + totalUnrestrictedQty
            ),
            update_time: new Date().toISOString(),
          };

          await this.db
            .collection("item_balance")
            .doc(generalBalance.id)
            .update(generalUpdateData);

          console.log(
            `✓ Updated aggregated item_balance for SM serialized item ${item.item_selection}: Unrestricted=${generalUpdateData.unrestricted_qty}, Balance=${generalUpdateData.balance_quantity}`
          );
        } else {
          // Create new item_balance record
          const generalUpdateData = {
            material_id: item.item_selection,
            location_id: item.location_id,
            plant_id: plantId,
            organization_id: organizationId,
            balance_quantity: totalBalanceQty,
            unrestricted_qty: totalUnrestrictedQty,
            qualityinsp_qty: 0,
            block_qty: 0,
            reserved_qty: 0,
            intransit_qty: 0,
            create_time: new Date().toISOString(),
            update_time: new Date().toISOString(),
            is_deleted: 0,
          };

          await this.db.collection("item_balance").add(generalUpdateData);

          console.log(
            `✓ Created new aggregated item_balance for SM serialized item ${item.item_selection}: Unrestricted=${totalUnrestrictedQty}, Balance=${totalBalanceQty}`
          );
        }
      } catch (itemBalanceError) {
        console.error(
          `Error updating aggregated item_balance for SM serialized item ${item.item_selection}:`,
          itemBalanceError
        );
        // Don't throw - let the main process continue
      }

      console.log(
        `Successfully processed serial number inventory for SM item ${item.item_selection}`
      );
    } catch (error) {
      console.error(
        `Error processing serial number inventory for SM item ${item.item_selection}:`,
        error
      );
      throw new Error(
        `Failed to process serial number inventory for SM item ${item.item_selection}: ${error.message}`
      );
    }
  }

  async updateProductionOrder(
    allData,
    subformData,
    balanceIndex,
    productionOrderData
  ) {
    if (allData.is_production_order !== 1 || !allData.production_order_id) {
      return; // Skip if not a production order or no production order ID
    }

    let tableMatConfirmation = [];

    const previousTableMatConfirmation =
      productionOrderData.table_mat_confirmation.map((item) => ({
        ...item,
      }));

    for (const [index, item] of previousTableMatConfirmation.entries()) {
      //get material data
      const resItem = await this.db
        .collection("Item")
        .doc(item.material_id)
        .get();

      if (!resItem || resItem.data.length === 0) return;

      const materialData = resItem.data[0];

      // Check if item is serialized
      const isSerializedItem = materialData.serial_number_management === 1;

      // if item no batch and not serialized, table mat confirmation remain the same
      if (
        (!materialData.item_batch_management ||
          materialData.item_batch_management === 0) &&
        !isSerializedItem
      ) {
        const matConfirmationData = {
          material_id: item.material_id,
          material_name: item.material_name,
          material_desc: item.material_desc,
          material_category: item.material_category,
          material_uom: item.material_uom,
          item_process_id: item.item_process_id,
          bin_location_id: item.bin_location_id,
          material_required_qty: item.material_required_qty,
          material_actual_qty: item.material_actual_qty,
          item_remarks: item.item_remarks,
        };

        tableMatConfirmation.push(matConfirmationData);
        continue;
      }
      // if item has batch or is serialized, process individual balances
      else {
        let tempDataParsed;
        const subFormItem = subformData[index];
        try {
          const tempData = subFormItem.temp_qty_data;
          if (!tempData) {
            console.warn(
              `No temp_qty_data found for item ${subFormItem.item_selection}`
            );
            tempDataParsed = [];
          } else {
            tempDataParsed = JSON.parse(tempData);
            tempDataParsed = tempDataParsed.filter(
              (tempData) => tempData.sm_quantity > 0
            );
          }
        } catch (parseError) {
          console.error(
            `Error parsing temp_qty_data for item ${item.item_selection}:`,
            parseError
          );
          tempDataParsed = [];
        }

        console.log("tempDataParsed", tempDataParsed);

        let balancesToProcess =
          allData.balance_index?.filter(
            (balance) =>
              balance.sm_quantity &&
              balance.sm_quantity > 0 &&
              tempDataParsed.some(
                (tempData) =>
                  tempData.material_id === balance.material_id &&
                  tempData.balance_id === balance.balance_id
              )
          ) || [];

        for (const balance of balancesToProcess) {
          // Handle serialized items - create one record per serial number
          if (isSerializedItem && balance.serial_number) {
            const matConfirmationData = {
              material_id: item.material_id,
              material_name: item.material_name,
              material_desc: item.material_desc,
              material_category: item.material_category,
              material_uom: item.material_uom,
              item_process_id: item.item_process_id,
              bin_location_id: item.bin_location_id,
              material_required_qty: 1, // Serialized items always have qty = 1
              material_actual_qty: 1, // Serialized items always have qty = 1
              item_remarks: item.item_remarks,
              batch_id: balance.batch_id,
              serial_number: balance.serial_number,
            };

            tableMatConfirmation.push(matConfirmationData);
          }
          // Handle regular batch items (non-serialized)
          else if (!isSerializedItem) {
            const matConfirmationData = {
              material_id: item.material_id,
              material_name: item.material_name,
              material_desc: item.material_desc,
              material_category: item.material_category,
              material_uom: item.material_uom,
              item_process_id: item.item_process_id,
              bin_location_id: item.bin_location_id,
              material_required_qty: balance.sm_quantity,
              material_actual_qty: balance.sm_quantity,
              item_remarks: item.item_remarks,
              batch_id: balance.batch_id,
            };

            tableMatConfirmation.push(matConfirmationData);
          }
          // Handle serialized items without serial numbers (shouldn't happen but safety check)
          else if (isSerializedItem && !balance.serial_number) {
            console.warn(
              `Serialized item ${item.material_id} has no serial number in balance record`
            );
            // Still create record but with quantity from balance
            const matConfirmationData = {
              material_id: item.material_id,
              material_name: item.material_name,
              material_desc: item.material_desc,
              material_category: item.material_category,
              material_uom: item.material_uom,
              item_process_id: item.item_process_id,
              bin_location_id: item.bin_location_id,
              material_required_qty: balance.sm_quantity,
              material_actual_qty: balance.sm_quantity,
              item_remarks: item.item_remarks,
              batch_id: balance.batch_id,
            };

            tableMatConfirmation.push(matConfirmationData);
          }
        }
      }
    }

    try {
      await this.db
        .collection("production_order")
        .doc(productionOrderData.id)
        .update({
          balance_index: balanceIndex || [],
          production_order_status: "In Progress",
          table_mat_confirmation: tableMatConfirmation,
          update_time: new Date().toISOString(),
        });

      console.log(
        `Production order ${allData.production_order_id} updated successfully`
      );
    } catch (error) {
      console.error("Error updating production order:", error);
      throw new Error(`Failed to update production order: ${error.message}`);
    }
  }

  async preValidateItems(subformData, movementType, allData) {
    for (const item of subformData) {
      this.validateRequiredFields(
        item,
        ["item_selection"],
        `for item ${item.item_name || "unknown"}`
      );

      if (movementType === "Miscellaneous Receipt") {
        this.validateRequiredFields(
          item,
          ["category"],
          `for item ${item.item_name || "unknown"}`
        );
      }

      const materialResponse = await this.db
        .collection("Item")
        .where({ id: item.item_selection })
        .get();
      const materialData = materialResponse.data[0];
      // UOM comparison and conversion logic
      let quantityConverted = item.received_quantity || 0;
      let selected_uom = materialData.based_uom; // Default to base UOM
      let unitPriceConverted = item.unit_price || 0;

      if (
        movementType === "Location Transfer" &&
        allData.is_production_order === 1
      ) {
        for (const sm of subformData) {
          if (sm.total_quantity !== sm.requested_qty) {
            throw new Error(
              "Total quantity is not equal to requested quantity."
            );
          }
        }
      }

      if (
        movementType === "Miscellaneous Receipt" &&
        item.received_quantity_uom
      ) {
        if (item.received_quantity_uom === materialData.based_uom) {
          selected_uom = materialData.based_uom;
        } else {
          const uomConversion = materialData.table_uom_conversion?.find(
            (conversion) => conversion.alt_uom_id === item.received_quantity_uom
          );
          if (uomConversion) {
            selected_uom = uomConversion.alt_uom_id;
            quantityConverted =
              Math.round(
                ((item.received_quantity || 0) / uomConversion.alt_qty) * 1000
              ) / 1000;
            unitPriceConverted =
              Math.round(((item.unit_price || 0) / quantityConverted) * 1000) /
              1000;
          } else {
            throw new Error(
              `Invalid UOM ${item.received_quantity_uom} for item ${item.item_selection}`
            );
          }
        }
      }

      // Always set effective_uom and quantity_converted for the item
      item.effective_uom = selected_uom;
      item.quantity_converted = quantityConverted;
      item.price_converted = unitPriceConverted;

      console.log(
        `preValidateItems: item ${item.item_selection}, effective_uom: ${item.effective_uom}, quantity_converted: ${quantityConverted}, price_converted: ${unitPriceConverted}`
      );

      if (
        movementType === "Inter Operation Facility Transfer" ||
        movementType === "Miscellaneous Receipt"
      ) {
        if (!item.received_quantity || item.received_quantity <= 0) {
          continue;
        }
      } else {
        if (!allData.balance_index || !Array.isArray(allData.balance_index)) {
          throw new Error(
            `Balance selection (balance_index) is required for item ${item.item_selection}`
          );
        }

        const balancesToProcess = allData.balance_index.filter(
          (balance) =>
            balance.sm_quantity &&
            balance.sm_quantity > 0 &&
            balance.material_id === item.item_selection
        );

        if (balancesToProcess.length === 0) {
          continue;
        }

        if (movementType === "Location Transfer") {
          balancesToProcess.forEach((balance) => {
            if (!balance.location_id && !item.location_id) {
              throw new Error(
                `Receiving bin ID (receiving_bin_id) is required for Location Transfer for item ${item.item_selection}`
              );
            }
          });
        }

        const isSerializedItem = materialData.serial_number_management === 1;

        for (const balance of balancesToProcess) {
          this.validateRequiredFields(
            balance,
            ["sm_quantity", "location_id"],
            `for balance in item ${item.item_selection}`
          );

          if (isSerializedItem) {
            // ✅ For serialized items, check item_serial_balance
            console.log(
              `Checking serialized item balance for ${item.item_selection}, serial: ${balance.serial_number}`
            );

            const serialBalanceParams = {
              material_id: materialData.id,
              serial_number: balance.serial_number,
              location_id: balance.location_id,
              plant_id: allData.issuing_operation_faci,
              organization_id: allData.organization_id,
            };

            if (materialData.item_batch_management == "1" && balance.batch_id) {
              serialBalanceParams.batch_id = balance.batch_id;
            }

            const serialBalanceResponse = await this.db
              .collection("item_serial_balance")
              .where(serialBalanceParams)
              .get();

            if (
              !serialBalanceResponse.data ||
              serialBalanceResponse.data.length === 0
            ) {
              throw new Error(
                `No existing serial balance found for item ${item.item_selection}, serial ${balance.serial_number} at location ${balance.location_id}`
              );
            }
          } else {
            // ✅ For non-serialized items, use existing logic
            const collectionName =
              materialData.item_batch_management == "1"
                ? "item_batch_balance"
                : "item_balance";

            const balanceResponse = await this.db
              .collection(collectionName)
              .where({
                material_id: materialData.id,
                location_id: balance.location_id,
                ...(materialData.item_batch_management == "1" &&
                balance.batch_id
                  ? { batch_id: balance.batch_id }
                  : {}),
              })
              .get();

            const balanceData = balanceResponse.data[0];

            console.log("balancesToProcess", balancesToProcess);
            console.log("current processing balance", balance);

            if (!balanceData) {
              throw new Error(
                `No existing balance found for item ${item.item_selection} at location ${balance.location_id}`
              );
            }
          }
        }
      }
    }
  }

  async processStockAdjustment(allData, organizationId) {
    console.log("This is all data", allData);
    const subformData = allData.stock_movement;
    const movementType = allData.movement_type;
    const balanceIndex = allData.balance_index;
    const requiredTopLevelFields = [
      "stock_movement_no",
      "movement_type",
      "issue_date",
    ];
    this.validateRequiredFields(allData, requiredTopLevelFields);

    await this.preValidateItems(subformData, movementType, allData);
    await this.updateStockMovementTable(
      allData,
      subformData,
      movementType,
      organizationId
    );

    // Update production order for Location Transfer if applicable
    if (
      movementType === "Location Transfer" &&
      allData.is_production_order === 1
    ) {
      const resProductionOrder = await this.db
        .collection("production_order")
        .doc(allData.production_order_id)
        .get();

      if (!resProductionOrder || resProductionOrder.data.length === 0) return;

      const productionOrderData = resProductionOrder.data[0];

      await this.updateProductionOrder(
        allData,
        subformData,
        balanceIndex,
        productionOrderData
      );
      await this.updateOnReservedTable(
        allData,
        subformData,
        productionOrderData
      );
    }

    const updates = [];
    for (const item of subformData) {
      try {
        const result = await this.processItem(
          item,
          movementType,
          allData,
          organizationId
        );
        updates.push(result);
      } catch (error) {
        console.error(`Error processing item ${item.item_selection}:`, error);
        updates.push({
          itemId: item.item_selection,
          status: "failed",
          error: error.message,
        });
      }
    }

    return updates;
  }

  async updateStockMovementTable(
    allData,
    subformData,
    movementType,
    organizationId
  ) {
    const table_item_balance = allData.sm_item_balance?.table_item_balance;

    let postedStatus = "";

    if (
      (movementType === "Miscellaneous Issue" ||
        movementType === "Miscellaneous Receipt" ||
        movementType === "Disposal/Scrap") &&
      allData.acc_integration_type !== "No Accounting Integration"
    ) {
      postedStatus = "Pending Post";
    } else {
      postedStatus = "";
    }

    const stockMovementData = {
      stock_movement_no: allData.stock_movement_no,
      movement_type: allData.movement_type,
      movement_type_id: allData.movement_type_id,
      movement_reason: allData.movement_reason || null,
      issued_by: allData.issued_by,
      issue_date: allData.issue_date,
      issuing_operation_faci: allData.issuing_operation_faci,
      stock_movement: subformData,
      sm_item_balance: allData.sm_item_balance,
      table_item_balance: table_item_balance,
      remarks: allData.remarks,
      delivery_method: allData.delivery_method,

      cp_driver_name: allData.cp_driver_name,
      cp_ic_no: allData.cp_ic_no,
      cp_driver_contact_no: allData.cp_driver_contact_no,
      cp_vehicle_number: allData.cp_vehicle_number,
      cp_pickup_date: allData.cp_pickup_date,
      cp_validity_collection: allData.cp_validity_collection,
      cs_courier_company: allData.cs_courier_company,
      cs_shipping_date: allData.cs_shipping_date,
      cs_tracking_number: allData.cs_tracking_number,
      cs_est_arrival_date: allData.cs_est_arrival_date,
      cs_freight_charges: allData.cs_freight_charges,
      ct_driver_name: allData.ct_driver_name,
      ct_driver_contact_no: allData.ct_driver_contact_no,
      ct_ic_no: allData.ct_ic_no,
      ct_vehicle_number: allData.ct_vehicle_number,
      ct_est_delivery_date: allData.ct_est_delivery_date,
      ct_delivery_cost: allData.ct_delivery_cost,
      ss_shipping_company: allData.ss_shipping_company,
      ss_shipping_date: allData.ss_shipping_date,
      ss_freight_charges: allData.ss_freight_charges,
      ss_shipping_method: allData.ss_shipping_method,
      ss_est_arrival_date: allData.ss_est_arrival_date,
      ss_tracking_number: allData.ss_tracking_number,
      tpt_vehicle_number: allData.tpt_vehicle_number,
      tpt_transport_name: allData.tpt_transport_name,
      tpt_ic_no: allData.tpt_ic_no,
      tpt_driver_contact_no: allData.tpt_driver_contact_no,

      balance_index: allData.balance_index,
      organization_id: organizationId,
      posted_status: postedStatus,
      reference_documents: allData.reference_documents,

      is_production_order: allData.is_production_order,
      production_order_id: allData.production_order_id,
    };

    const page_status = allData.page_status ? allData.page_status : null;
    const stockMovementNo = allData.id;

    const getPrefixData = async (organizationId, movementType) => {
      const prefixEntry = await db
        .collection("prefix_configuration")
        .where({
          document_types: "Stock Movement",
          is_deleted: 0,
          organization_id: organizationId,
          is_active: 1,
          movement_type: movementType,
        })
        .get();

      const prefixData = await prefixEntry.data[0];

      return prefixData;
    };

    const updatePrefix = async (
      organizationId,
      runningNumber,
      movementType
    ) => {
      try {
        await db
          .collection("prefix_configuration")
          .where({
            document_types: "Stock Movement",
            is_deleted: 0,
            organization_id: organizationId,
            movement_type: movementType,
          })
          .update({
            running_number: parseInt(runningNumber) + 1,
            has_record: 1,
          });
      } catch (error) {
        console.error(error);
      }
    };

    const generatePrefix = (runNumber, now, prefixData) => {
      let generated = prefixData.current_prefix_config;
      generated = generated.replace("prefix", prefixData.prefix_value);
      generated = generated.replace("suffix", prefixData.suffix_value);
      generated = generated.replace(
        "month",
        String(now.getMonth() + 1).padStart(2, "0")
      );
      generated = generated.replace(
        "day",
        String(now.getDate()).padStart(2, "0")
      );
      generated = generated.replace("year", now.getFullYear());
      generated = generated.replace(
        "running_number",
        String(runNumber).padStart(prefixData.padding_zeroes, "0")
      );
      return generated;
    };

    const checkUniqueness = async (generatedPrefix, organizationId) => {
      const existingDoc = await db
        .collection("stock_movement")
        .where({
          stock_movement_no: generatedPrefix,
          organization_id: organizationId,
        })
        .get();
      return existingDoc.data[0] ? false : true;
    };

    const findUniquePrefix = async (prefixData, organizationId) => {
      const now = new Date();
      let prefixToShow;
      let runningNumber = prefixData.running_number;
      let isUnique = false;
      let maxAttempts = 10;
      let attempts = 0;

      while (!isUnique && attempts < maxAttempts) {
        attempts++;
        prefixToShow = await generatePrefix(runningNumber, now, prefixData);
        isUnique = await checkUniqueness(prefixToShow, organizationId);
        if (!isUnique) {
          runningNumber++;
        }
      }

      if (!isUnique) {
        console.error(
          "Could not generate a unique Stock Movement number after maximum attempts"
        );
      }

      return { prefixToShow, runningNumber };
    };

    if (page_status === "Add") {
      const prefixData = await getPrefixData(organizationId, movementType);

      if (prefixData.length !== 0) {
        const { prefixToShow, runningNumber } = await findUniquePrefix(
          prefixData,
          organizationId
        );

        await updatePrefix(organizationId, runningNumber, movementType);

        stockMovementData.stock_movement_no = prefixToShow;
        allData.stock_movement_no = prefixToShow;
      }
      await this.db.collection("stock_movement").add({
        stock_movement_status: "Completed",
        ...stockMovementData,
      });

      this.runWorkflow(
        "1921755711809626113",
        { stock_movement_no: stockMovementData.stock_movement_no },
        (res) => {
          console.log("Workflow success:", res);
        },
        (err) => {
          console.error("Workflow error:", err);
        }
      );
    } else if (page_status === "Edit") {
      if (!stockMovementNo) {
        throw new Error("Stock movement number is required for editing");
      }

      const prefixData = await getPrefixData(organizationId, movementType);

      if (prefixData.length !== 0) {
        const { prefixToShow, runningNumber } = await findUniquePrefix(
          prefixData,
          organizationId
        );

        await updatePrefix(organizationId, runningNumber, movementType);

        stockMovementData.stock_movement_no = prefixToShow;
        allData.stock_movement_no = prefixToShow;
      }

      const result = await this.db
        .collection("stock_movement")
        .doc(stockMovementNo)
        .update({
          stock_movement_status: "Completed",
          ...stockMovementData,
        });

      await this.runWorkflow(
        "1921755711809626113",
        { stock_movement_no: stockMovementData.stock_movement_no },
        (res) => {
          console.log("Workflow success:", res);
        },
        (err) => {
          console.error("Workflow error:", err);
        }
      );
      console.log("Stock Movement Updated:", result);
    }
  }

  async processItem(item, movementType, allData, organizationId) {
    try {
      const materialResponse = await this.db
        .collection("Item")
        .where({ id: item.item_selection })
        .get();
      const materialData = materialResponse.data[0];

      if (!materialData) {
        throw new Error(`Material not found for item ${item.item_selection}`);
      }

      let tempDataParsed;
      try {
        const tempData = item.temp_qty_data;
        if (!tempData) {
          console.warn(
            `No temp_qty_data found for item ${item.item_selection}`
          );
          tempDataParsed = [];
        } else {
          tempDataParsed = JSON.parse(tempData);
          tempDataParsed = tempDataParsed.filter(
            (tempData) => tempData.sm_quantity > 0
          );
          if (!Array.isArray(tempDataParsed)) {
            console.warn(
              `temp_qty_data for item ${item.item_selection} is not an array:`,
              tempDataParsed
            );
            tempDataParsed = [];
          }
        }
      } catch (parseError) {
        console.error(
          `Error parsing temp_qty_data for item ${item.item_selection}:`,
          parseError
        );
        console.error("Raw temp_qty_data:", item.temp_qty_data);
        tempDataParsed = [];
      }

      console.log("tempDataParsed", tempDataParsed);

      let balancesToProcess =
        allData.balance_index?.filter(
          (balance) =>
            balance.sm_quantity &&
            balance.sm_quantity > 0 &&
            tempDataParsed.some(
              (tempData) =>
                tempData.material_id === balance.material_id &&
                tempData.balance_id === balance.balance_id
            )
        ) || [];

      console.log("balancesToProcess", balancesToProcess);

      if (
        movementType === "Miscellaneous Receipt" &&
        (!item.received_quantity || item.received_quantity <= 0)
      ) {
        return {
          itemId: item.item_selection,
          status: "skipped",
          reason: "No received quantity provided",
        };
      }

      const updates = [];
      if (movementType !== "Miscellaneous Receipt") {
        const groupedBalances = new Map();

        for (const balance of balancesToProcess) {
          const groupKey = `${balance.location_id || "null"}_${
            balance.batch_id || "null"
          }_${balance.category || "Unrestricted"}`;

          if (groupedBalances.has(groupKey)) {
            const existingGroup = groupedBalances.get(groupKey);
            existingGroup.balances.push(balance);
            existingGroup.totalQty +=
              balance.quantity_converted || balance.sm_quantity || 0;
          } else {
            groupedBalances.set(groupKey, {
              balances: [balance],
              totalQty: balance.quantity_converted || balance.sm_quantity || 0,
              combinedBalance: {
                ...balance,
                sm_quantity:
                  balance.quantity_converted || balance.sm_quantity || 0,
                quantity_converted:
                  balance.quantity_converted || balance.sm_quantity || 0,
                original_quantity:
                  balance.quantity_converted || balance.sm_quantity || 0,
                serial_balances: [balance],
              },
            });
          }
        }

        // Update the combined balance quantities and serial_balances array
        for (const group of groupedBalances.values()) {
          group.combinedBalance.sm_quantity = group.totalQty;
          group.combinedBalance.quantity_converted = group.totalQty;
          group.combinedBalance.serial_balances = group.balances;
        }

        console.log(
          `Grouped ${balancesToProcess.length} balances into ${groupedBalances.size} inventory movements`
        );

        // Process each group - update quantities for all balances, then create single inventory movement
        for (const [groupKey, group] of groupedBalances.entries()) {
          try {
            console.log(
              `Processing grouped balance for ${item.item_selection} - Key: ${groupKey}, Total Qty: ${group.totalQty}`
            );

            // Update quantities for all individual balances (for balance tables)
            let weightedAvgCost = null;
            for (const balance of group.balances) {
              const result = await this.updateQuantities(
                materialData,
                movementType,
                balance,
                allData,
                item,
                organizationId
              );

              if (
                result?.weightedAverageCost !== null &&
                materialData.material_costing_method === "First In First Out"
              ) {
                weightedAvgCost = result.weightedAverageCost;
              }
            }

            // Set the calculated cost in the combined balance
            if (weightedAvgCost !== null) {
              group.combinedBalance.calculated_fifo_cost = weightedAvgCost;
            }

            const movementResult = await this.recordInventoryMovement(
              materialData,
              movementType,
              group.combinedBalance,
              allData,
              item,
              organizationId,
              balancesToProcess
            );

            updates.push({
              group: groupKey,
              totalQty: group.totalQty,
              balanceCount: group.balances.length,
              status: "success",
              result: movementResult,
            });
          } catch (groupError) {
            console.error(
              `Error processing grouped balance for ${item.item_selection} - Key: ${groupKey}:`,
              groupError
            );

            updates.push({
              group: groupKey,
              status: "error",
              error: groupError.message,
            });

            return {
              itemId: item.item_selection,
              status: "error",
              error: groupError.message,
            };
          }
        }
      }

      if (
        movementType === "Miscellaneous Receipt" &&
        item.received_quantity > 0
      ) {
        try {
          const result = await this.updateQuantities(
            materialData,
            movementType,
            {},
            allData,
            item,
            organizationId
          );

          const batchId = result?.batchId || null;

          await this.recordInventoryMovement(
            materialData,
            movementType,
            { sm_quantity: item.received_quantity, batch_id: batchId },
            allData,
            item,
            organizationId,
            balancesToProcess
          );

          updates.push({
            type: "receipt",
            status: "success",
          });
        } catch (receiptError) {
          console.error(
            `Error processing receipt for ${item.item_selection}:`,
            receiptError
          );

          updates.push({
            type: "receipt",
            status: "error",
            error: receiptError.message,
          });
          return {
            itemId: item.item_selection,
            status: "error",
            error: receiptError.message,
          };
        }
      }

      const accIntegrationType = allData.acc_integration_type;

      if (
        accIntegrationType === "SQL Accounting" &&
        organizationId &&
        organizationId !== ""
      ) {
        console.log("Calling SQL Accounting workflow");

        await this.runWorkflow(
          "1958732352162164738",
          { key: "value" },
          async (res) => {
            console.log("成功结果：", res);
            if (res.data.status === "running") {
              await this.runWorkflow(
                "1910197713380311041",
                { key: "value" },
                (res) => {
                  console.log("Workflow success", res);
                },
                (err) => {
                  console.error("Workflow error", err);
                  throw new Error(
                    "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists."
                  );
                }
              );
            }
          },
          (err) => {
            console.log("失败结果：", err);

            this.hideLoading();
            throw new Error(
              "Your SQL accounting software isn't connected. Check your network or ensure you're logged into your PC after a restart. Contact SuDu AI support if the issue persists."
            );
          }
        );
      } else if (
        accIntegrationType === "AutoCount Accounting" &&
        organizationId &&
        organizationId !== ""
      ) {
        console.log("Calling AutoCount workflow");
      } else if (
        accIntegrationType === "No Accounting Integration" &&
        organizationId &&
        organizationId !== ""
      ) {
        console.log("Not calling workflow");
      } else {
        throw new Error();
      }

      return {
        itemId: item.item_selection,
        status: updates.some((u) => u.status === "error")
          ? "partial"
          : "success",
        details: updates,
      };
    } catch (error) {
      console.error(`Error in processItem for ${item.item_selection}:`, error);
      return {
        itemId: item.item_selection,
        status: "failed",
        error: error.message,
      };
    }
  }

  async updateQuantities(
    materialData,
    movementType,
    balance,
    allData,
    subformData,
    organizationId
  ) {
    // For batched items, we'll handle both item_batch_balance AND item_balance
    // For non-batched items, we'll only handle item_balance
    const isBatchedItem = materialData.item_batch_management == "1";
    const primaryCollectionName = isBatchedItem
      ? "item_batch_balance"
      : "item_balance";

    let qtyChangeValue =
      movementType === "Miscellaneous Receipt"
        ? subformData.quantity_converted || subformData.received_quantity || 0
        : balance.quantity_converted || balance.sm_quantity || 0;

    const locationId = balance.location_id || subformData.location_id;
    const effectiveUom =
      balance.effective_uom ||
      subformData.effective_uom ||
      materialData.based_uom;

    let weightedAverageCost = null;

    console.log(
      `updateQuantities: item ${materialData.id}, movement ${movementType}, effectiveUom: ${effectiveUom}, qtyChangeValue: ${qtyChangeValue}`
    );

    if (qtyChangeValue === 0) return null;

    if (!locationId && movementType !== "Miscellaneous Receipt") {
      throw new Error("Location ID is required");
    }

    if (!effectiveUom) {
      throw new Error(`Effective UOM is undefined for item ${materialData.id}`);
    }

    const isSerializedItem = materialData.serial_number_management === 1;
    const isSerialAllocated =
      movementType === "Miscellaneous Receipt"
        ? subformData.is_serialized_item === 1 &&
          subformData.is_serial_allocated === 1
        : true;

    if (isSerializedItem && isSerialAllocated) {
      console.log(
        `Skipping regular balance update for serialized item ${materialData.id} - handled by serial balance processing`
      );

      let batchId = null;

      if (
        movementType === "Miscellaneous Receipt" &&
        materialData.item_batch_management == "1"
      ) {
        console.log("Processing batch for Miscellaneous Receipt");
        batchId = await this.createBatch(
          materialData,
          qtyChangeValue,
          allData,
          subformData,
          organizationId
        );
        console.log("Obtained batchId:", batchId);
      } else if (
        materialData.item_batch_management == "1" &&
        balance.batch_id
      ) {
        batchId = balance.batch_id;
      }

      // Handle costing for serialized items
      if (
        [
          "Miscellaneous Issue",
          "Disposal/Scrap",
          "Miscellaneous Receipt",
        ].includes(movementType)
      ) {
        const qtyChange =
          movementType === "Miscellaneous Receipt"
            ? qtyChangeValue
            : -qtyChangeValue;

        // Create a dummy updateData for costing method
        const updateData = {
          batch_id: batchId,
          unit_price:
            subformData.unit_price ||
            balance.unit_price ||
            materialData.purchase_unit_price ||
            0,
        };

        weightedAverageCost = await this.updateCostingMethod(
          materialData,
          qtyChange,
          allData.issuing_operation_faci,
          subformData,
          updateData,
          organizationId
        );
      }

      return { weightedAverageCost, batchId };
    }

    const categoryKey =
      movementType === "Location Transfer"
        ? balance.category || "Unrestricted"
        : movementType === "Miscellaneous Receipt"
        ? subformData.category || "Unrestricted"
        : balance.category || "Unrestricted";

    const categoryField = this.categoryMap[categoryKey];

    let batchId = null;

    if (
      movementType === "Miscellaneous Receipt" &&
      materialData.item_batch_management == "1"
    ) {
      console.log("Processing batch for Miscellaneous Receipt");
      batchId = await this.createBatch(
        materialData,
        qtyChangeValue,
        allData,
        subformData,
        organizationId
      );
      console.log("Obtained batchId:", batchId);
      if (
        subformData.is_serialized_item === 1 &&
        subformData.is_serial_allocated === 1
      ) {
        console.log(
          "Processing serial numbers for batch item in Miscellaneous Receipt"
        );
      }
    } else if (materialData.item_batch_management == "1" && balance.batch_id) {
      batchId = balance.batch_id;
    }

    const queryConditions = {
      material_id: materialData.id,
      location_id: locationId,
    };

    if (materialData.item_batch_management == "1" && batchId) {
      queryConditions.batch_id = batchId;
      console.log(`Including batch_id ${batchId} in query conditions`);
    }

    console.log(
      "Querying for existing balance with conditions:",
      queryConditions
    );
    const balanceResponse = await this.db
      .collection(primaryCollectionName)
      .where(queryConditions)
      .get();

    let balanceData =
      balanceResponse.data && balanceResponse.data.length > 0
        ? balanceResponse.data[0]
        : null;

    console.log("Found existing balance:", balanceData ? "Yes" : "No");

    let updateData = balanceData
      ? { ...balanceData }
      : {
          material_id: materialData.id,
          location_id: locationId,
          balance_quantity: 0,
          unrestricted_qty: 0,
          qualityinsp_qty: 0,
          block_qty: 0,
          reserved_qty: 0,
          batch_id: batchId,
          plant_id: allData.issuing_operation_faci,
          create_user: allData.user_id || "system",
          issue_date: allData.issue_date,
          update_user: allData.user_id || "system",
          is_deleted: 0,
          tenant_id: allData.tenant_id || "000000",
          organization_id: organizationId,
          doc_date: allData.issue_date,
          manufacturing_date:
            (subformData && subformData.manufacturing_date) ||
            (balance && balance.manufacturing_date) ||
            null,
          expired_date:
            (subformData && subformData.expired_date) ||
            (balance && balance.expired_date) ||
            null,
        };

    switch (movementType) {
      case "Inter Operation Facility Transfer":
        updateData.balance_quantity =
          (updateData.balance_quantity || 0) + qtyChangeValue;
        updateData[categoryField] =
          (updateData[categoryField] || 0) + qtyChangeValue;
        break;

      case "Location Transfer":
        updateData.balance_quantity =
          (updateData.balance_quantity || 0) - qtyChangeValue;
        updateData[categoryField] =
          (updateData[categoryField] || 0) - qtyChangeValue;
        break;

      case "Miscellaneous Issue":
      case "Disposal/Scrap":
        updateData.balance_quantity =
          (updateData.balance_quantity || 0) - qtyChangeValue;
        updateData[categoryField] =
          (updateData[categoryField] || 0) - qtyChangeValue;
        break;

      case "Miscellaneous Receipt":
        updateData.balance_quantity =
          (updateData.balance_quantity || 0) + qtyChangeValue;
        updateData[categoryField] =
          (updateData[categoryField] || 0) + qtyChangeValue;
        break;

      case "Inventory Category Transfer Posting":
        if (!balance.category_from || !balance.category_to) {
          throw new Error("Both category_from and category_to are required");
        }
        const fromCategoryField = this.categoryMap[balance.category_from];
        const toCategoryField = this.categoryMap[balance.category_to];
        updateData[fromCategoryField] =
          (updateData[fromCategoryField] || 0) - qtyChangeValue;
        updateData[toCategoryField] =
          (updateData[toCategoryField] || 0) + qtyChangeValue;
        break;

      default:
        throw new Error(`Unsupported movement type: ${movementType}`);
    }

    updateData.update_time = new Date().toISOString();
    updateData.update_user = allData.user_id || "system";

    if (!balanceData) {
      console.log("Creating new balance record");

      const isSerializedItem =
        subformData.is_serialized_item === 1 &&
        subformData.is_serial_allocated === 1;

      if (!isSerializedItem) {
        await this.db.collection(primaryCollectionName).add(updateData);
      } else {
        console.log(
          "Skipped balance creation for serialized item - handled by serial balance"
        );
      }
    } else {
      console.log("Updating existing balance record");

      const isSerializedItem =
        subformData.is_serialized_item === 1 &&
        subformData.is_serial_allocated === 1;

      if (!isSerializedItem) {
        const updateFields = {
          balance_quantity: parseFloat(updateData.balance_quantity.toFixed(3)),
          unrestricted_qty: parseFloat(updateData.unrestricted_qty.toFixed(3)),
          qualityinsp_qty: parseFloat(updateData.qualityinsp_qty.toFixed(3)),
          block_qty: parseFloat(updateData.block_qty.toFixed(3)),
          reserved_qty: parseFloat(updateData.reserved_qty.toFixed(3)),
          update_time: updateData.update_time,
          update_user: updateData.update_user,
          plant_id: updateData.plant_id,
        };

        if (materialData.item_batch_management == "1") {
          updateFields.batch_id = updateData.batch_id;
        }

        await this.db
          .collection(primaryCollectionName)
          .doc(balanceData.id)
          .update(updateFields);
      } else {
        console.log(
          "Skipped balance update for serialized item - handled by serial balance"
        );
      }
    }

    // ✅ CRITICAL FIX: For batched items processed through regular balance updates,
    // also update item_balance (aggregated across all batches)
    if (isBatchedItem && primaryCollectionName === "item_batch_balance") {
      try {
        const generalItemBalanceParams = {
          material_id: materialData.id,
          location_id: locationId,
          plant_id: allData.issuing_operation_faci,
          organization_id: organizationId,
        };

        // Don't include batch_id in item_balance query (aggregated balance across all batches)
        const generalBalanceQuery = await this.db
          .collection("item_balance")
          .where(generalItemBalanceParams)
          .get();

        let generalUpdateData;

        if (generalBalanceQuery.data && generalBalanceQuery.data.length > 0) {
          // Update existing item_balance record
          const generalBalance = generalBalanceQuery.data[0];

          // Apply the same movement logic as the batch-specific update
          let generalBalanceQty = parseFloat(
            generalBalance.balance_quantity || 0
          );
          let generalUnrestrictedQty = parseFloat(
            generalBalance.unrestricted_qty || 0
          );
          let generalQualityInspQty = parseFloat(
            generalBalance.qualityinsp_qty || 0
          );
          let generalBlockQty = parseFloat(generalBalance.block_qty || 0);
          let generalReservedQty = parseFloat(generalBalance.reserved_qty || 0);
          let generalIntransitQty = parseFloat(
            generalBalance.intransit_qty || 0
          );

          // Apply movement type logic
          const categoryField =
            this.categoryMap[
              movementType === "Location Transfer"
                ? balance.category || "Unrestricted"
                : movementType === "Miscellaneous Receipt"
                ? subformData.category || "Unrestricted"
                : balance.category || "Unrestricted"
            ];

          switch (movementType) {
            case "Inter Operation Facility Transfer":
              generalBalanceQty += qtyChangeValue;
              if (categoryField === "unrestricted_qty") {
                generalUnrestrictedQty += qtyChangeValue;
              } else if (categoryField === "qualityinsp_qty") {
                generalQualityInspQty += qtyChangeValue;
              } else if (categoryField === "block_qty") {
                generalBlockQty += qtyChangeValue;
              } else if (categoryField === "reserved_qty") {
                generalReservedQty += qtyChangeValue;
              } else if (categoryField === "intransit_qty") {
                generalIntransitQty += qtyChangeValue;
              }
              break;

            case "Location Transfer":
            case "Miscellaneous Issue":
            case "Disposal/Scrap":
              generalBalanceQty -= qtyChangeValue;
              if (categoryField === "unrestricted_qty") {
                generalUnrestrictedQty -= qtyChangeValue;
              } else if (categoryField === "qualityinsp_qty") {
                generalQualityInspQty -= qtyChangeValue;
              } else if (categoryField === "block_qty") {
                generalBlockQty -= qtyChangeValue;
              } else if (categoryField === "reserved_qty") {
                generalReservedQty -= qtyChangeValue;
              } else if (categoryField === "intransit_qty") {
                generalIntransitQty -= qtyChangeValue;
              }
              break;

            case "Miscellaneous Receipt":
              generalBalanceQty += qtyChangeValue;
              if (categoryField === "unrestricted_qty") {
                generalUnrestrictedQty += qtyChangeValue;
              } else if (categoryField === "qualityinsp_qty") {
                generalQualityInspQty += qtyChangeValue;
              } else if (categoryField === "block_qty") {
                generalBlockQty += qtyChangeValue;
              } else if (categoryField === "reserved_qty") {
                generalReservedQty += qtyChangeValue;
              } else if (categoryField === "intransit_qty") {
                generalIntransitQty += qtyChangeValue;
              }
              break;

            case "Inventory Category Transfer Posting":
              if (balance.category_from && balance.category_to) {
                const fromCategoryField =
                  this.categoryMap[balance.category_from];
                const toCategoryField = this.categoryMap[balance.category_to];

                // Subtract from source category
                if (fromCategoryField === "unrestricted_qty") {
                  generalUnrestrictedQty -= qtyChangeValue;
                } else if (fromCategoryField === "qualityinsp_qty") {
                  generalQualityInspQty -= qtyChangeValue;
                } else if (fromCategoryField === "block_qty") {
                  generalBlockQty -= qtyChangeValue;
                } else if (fromCategoryField === "reserved_qty") {
                  generalReservedQty -= qtyChangeValue;
                } else if (fromCategoryField === "intransit_qty") {
                  generalIntransitQty -= qtyChangeValue;
                }

                // Add to destination category
                if (toCategoryField === "unrestricted_qty") {
                  generalUnrestrictedQty += qtyChangeValue;
                } else if (toCategoryField === "qualityinsp_qty") {
                  generalQualityInspQty += qtyChangeValue;
                } else if (toCategoryField === "block_qty") {
                  generalBlockQty += qtyChangeValue;
                } else if (toCategoryField === "reserved_qty") {
                  generalReservedQty += qtyChangeValue;
                } else if (toCategoryField === "intransit_qty") {
                  generalIntransitQty += qtyChangeValue;
                }
              }
              break;
          }

          generalUpdateData = {
            balance_quantity: parseFloat(generalBalanceQty.toFixed(3)),
            unrestricted_qty: parseFloat(generalUnrestrictedQty.toFixed(3)),
            qualityinsp_qty: parseFloat(generalQualityInspQty.toFixed(3)),
            block_qty: parseFloat(generalBlockQty.toFixed(3)),
            reserved_qty: parseFloat(generalReservedQty.toFixed(3)),
            intransit_qty: parseFloat(generalIntransitQty.toFixed(3)),
            update_time: new Date().toISOString(),
            update_user: allData.user_id || "system",
          };

          await this.db
            .collection("item_balance")
            .doc(generalBalance.id)
            .update(generalUpdateData);

          console.log(
            `Updated aggregated item_balance for batched item ${materialData.id} with movement type ${movementType}`
          );
        } else {
          // Create new item_balance record if it doesn't exist
          console.log(
            `No existing item_balance found for batched item ${materialData.id}, creating new record`
          );

          // This should rarely happen, but handle it for completeness
          generalUpdateData = {
            material_id: materialData.id,
            location_id: locationId,
            plant_id: allData.issuing_operation_faci,
            organization_id: organizationId,
            balance_quantity: 0,
            unrestricted_qty: 0,
            qualityinsp_qty: 0,
            block_qty: 0,
            reserved_qty: 0,
            intransit_qty: 0,
            create_user: allData.user_id || "system",
            update_user: allData.user_id || "system",
            create_time: new Date().toISOString(),
            update_time: new Date().toISOString(),
            is_deleted: 0,
          };

          // Apply the movement logic to the new record
          const categoryField =
            this.categoryMap[
              movementType === "Location Transfer"
                ? balance.category || "Unrestricted"
                : movementType === "Miscellaneous Receipt"
                ? subformData.category || "Unrestricted"
                : balance.category || "Unrestricted"
            ];

          switch (movementType) {
            case "Inter Operation Facility Transfer":
              generalUpdateData.balance_quantity = qtyChangeValue;
              if (categoryField === "unrestricted_qty") {
                generalUpdateData.unrestricted_qty = qtyChangeValue;
              } else if (categoryField === "qualityinsp_qty") {
                generalUpdateData.qualityinsp_qty = qtyChangeValue;
              } else if (categoryField === "block_qty") {
                generalUpdateData.block_qty = qtyChangeValue;
              } else if (categoryField === "reserved_qty") {
                generalUpdateData.reserved_qty = qtyChangeValue;
              } else if (categoryField === "intransit_qty") {
                generalUpdateData.intransit_qty = qtyChangeValue;
              }
              break;

            case "Location Transfer":
            case "Miscellaneous Issue":
            case "Disposal/Scrap":
              // For deduction movements, we start with negative quantities
              generalUpdateData.balance_quantity = -qtyChangeValue;
              if (categoryField === "unrestricted_qty") {
                generalUpdateData.unrestricted_qty = -qtyChangeValue;
              } else if (categoryField === "qualityinsp_qty") {
                generalUpdateData.qualityinsp_qty = -qtyChangeValue;
              } else if (categoryField === "block_qty") {
                generalUpdateData.block_qty = -qtyChangeValue;
              } else if (categoryField === "reserved_qty") {
                generalUpdateData.reserved_qty = -qtyChangeValue;
              } else if (categoryField === "intransit_qty") {
                generalUpdateData.intransit_qty = -qtyChangeValue;
              }
              break;

            case "Miscellaneous Receipt":
              generalUpdateData.balance_quantity = qtyChangeValue;
              if (categoryField === "unrestricted_qty") {
                generalUpdateData.unrestricted_qty = qtyChangeValue;
              } else if (categoryField === "qualityinsp_qty") {
                generalUpdateData.qualityinsp_qty = qtyChangeValue;
              } else if (categoryField === "block_qty") {
                generalUpdateData.block_qty = qtyChangeValue;
              } else if (categoryField === "reserved_qty") {
                generalUpdateData.reserved_qty = qtyChangeValue;
              } else if (categoryField === "intransit_qty") {
                generalUpdateData.intransit_qty = qtyChangeValue;
              }
              break;

            case "Inventory Category Transfer Posting":
              if (balance.category_from && balance.category_to) {
                const fromCategoryField =
                  this.categoryMap[balance.category_from];
                const toCategoryField = this.categoryMap[balance.category_to];

                // For new records with category transfers, we only set the destination category
                // (assuming the source category starts at 0)
                if (toCategoryField === "unrestricted_qty") {
                  generalUpdateData.unrestricted_qty = qtyChangeValue;
                } else if (toCategoryField === "qualityinsp_qty") {
                  generalUpdateData.qualityinsp_qty = qtyChangeValue;
                } else if (toCategoryField === "block_qty") {
                  generalUpdateData.block_qty = qtyChangeValue;
                } else if (toCategoryField === "reserved_qty") {
                  generalUpdateData.reserved_qty = qtyChangeValue;
                } else if (toCategoryField === "intransit_qty") {
                  generalUpdateData.intransit_qty = qtyChangeValue;
                }

                // Set the source category to negative (since we're transferring from it)
                if (fromCategoryField === "unrestricted_qty") {
                  generalUpdateData.unrestricted_qty = -qtyChangeValue;
                } else if (fromCategoryField === "qualityinsp_qty") {
                  generalUpdateData.qualityinsp_qty = -qtyChangeValue;
                } else if (fromCategoryField === "block_qty") {
                  generalUpdateData.block_qty = -qtyChangeValue;
                } else if (fromCategoryField === "reserved_qty") {
                  generalUpdateData.reserved_qty = -qtyChangeValue;
                } else if (fromCategoryField === "intransit_qty") {
                  generalUpdateData.intransit_qty = -qtyChangeValue;
                }

                // Balance quantity remains 0 for category transfers (no net change)
                generalUpdateData.balance_quantity = 0;
              }
              break;
          }

          // Round all quantities to 3 decimal places
          generalUpdateData.balance_quantity = parseFloat(
            generalUpdateData.balance_quantity.toFixed(3)
          );
          generalUpdateData.unrestricted_qty = parseFloat(
            generalUpdateData.unrestricted_qty.toFixed(3)
          );
          generalUpdateData.qualityinsp_qty = parseFloat(
            generalUpdateData.qualityinsp_qty.toFixed(3)
          );
          generalUpdateData.block_qty = parseFloat(
            generalUpdateData.block_qty.toFixed(3)
          );
          generalUpdateData.reserved_qty = parseFloat(
            generalUpdateData.reserved_qty.toFixed(3)
          );
          generalUpdateData.intransit_qty = parseFloat(
            generalUpdateData.intransit_qty.toFixed(3)
          );

          await this.db.collection("item_balance").add(generalUpdateData);
        }
      } catch (error) {
        console.error(
          `Error updating aggregated item_balance for batched item ${materialData.id}:`,
          error
        );
        // Don't throw - let the main process continue
      }
    }

    if (
      [
        "Miscellaneous Issue",
        "Disposal/Scrap",
        "Miscellaneous Receipt",
      ].includes(movementType)
    ) {
      const qtyChange =
        movementType === "Miscellaneous Receipt"
          ? qtyChangeValue
          : -qtyChangeValue;
      weightedAverageCost = await this.updateCostingMethod(
        materialData,
        qtyChange,
        allData.issuing_operation_faci,
        subformData,
        updateData,
        organizationId
      );
    }

    if (movementType === "Location Transfer") {
      await this.updateReceivingLocation(
        materialData,
        primaryCollectionName,
        subformData.location_id,
        qtyChangeValue,
        { ...balance, batch_id: batchId },
        allData,
        subformData,
        movementType,
        organizationId
      );

      // ✅ CRITICAL FIX: For Location Transfer with batched items and serialized items, also deduct from SOURCE location's item_balance
      const isSerializedItem = materialData.serial_number_management === 1;

      if (isBatchedItem || isSerializedItem) {
        try {
          const sourceItemBalanceParams = {
            material_id: materialData.id,
            location_id: locationId, // Source location
            plant_id: allData.issuing_operation_faci,
            organization_id: organizationId,
          };

          // Don't include batch_id/serial_number in item_balance query (aggregated balance across all batches/serials)
          const sourceBalanceQuery = await this.db
            .collection("item_balance")
            .where(sourceItemBalanceParams)
            .get();

          if (sourceBalanceQuery.data && sourceBalanceQuery.data.length > 0) {
            // Update existing item_balance record for SOURCE location (deduction)
            const sourceBalance = sourceBalanceQuery.data[0];
            const categoryField =
              this.categoryMap[balance.category || "Unrestricted"];

            const currentSourceBalanceQty = parseFloat(
              sourceBalance.balance_quantity || 0
            );
            const currentSourceCategoryQty = parseFloat(
              sourceBalance[categoryField] || 0
            );

            const sourceUpdateData = {
              balance_quantity: parseFloat(
                (currentSourceBalanceQty - qtyChangeValue).toFixed(3)
              ),
              [categoryField]: parseFloat(
                (currentSourceCategoryQty - qtyChangeValue).toFixed(3)
              ),
              update_time: new Date().toISOString(),
              update_user: allData.user_id || "system",
            };

            await this.db
              .collection("item_balance")
              .doc(sourceBalance.id)
              .update(sourceUpdateData);

            console.log(
              `Updated aggregated item_balance for SOURCE location ${locationId}, item ${
                materialData.id
              } (Location Transfer deduction - ${
                isBatchedItem ? "batched" : ""
              }${isSerializedItem ? "serialized" : ""})`
            );
          }
        } catch (error) {
          console.error(
            `Error updating source item_balance for Location Transfer, item ${materialData.id}:`,
            error
          );
          // Don't throw - let the main process continue
        }
      }
    }

    // ✅ NEW: For batched items, also update item_balance collection (both serialized and non-serialized)
    // ✅ EXTENDED: Also handle serialized items that need item_balance aggregation
    // ✅ CRITICAL FIX: Skip movements that are handled by the legacy processItemBalance logic below to prevent double updates
    const movementsHandledByLegacyLogic = [
      "Location Transfer",
      "Miscellaneous Issue",
      "Disposal/Scrap",
      "Inter Operation Facility Transfer",
      "Miscellaneous Receipt",
      "Inventory Category Transfer Posting",
    ];

    if (
      (isBatchedItem || (isSerializedItem && isSerialAllocated)) &&
      !movementsHandledByLegacyLogic.includes(movementType)
    ) {
      const isSerializedItem = materialData.serial_number_management === 1;
      const isSerialAllocated =
        movementType === "Miscellaneous Receipt"
          ? subformData.is_serialized_item === 1 &&
            subformData.is_serial_allocated === 1
          : true;

      if (isSerializedItem && isSerialAllocated) {
        // For serialized batched items: calculate aggregated quantities from serial data
        const serialItem = subformData || balance; // Get the item with serial data
        if (serialItem.serial_number_data) {
          const aggregatedQuantities = calculateAggregatedSerialQuantities(
            serialItem,
            qtyChangeValue,
            this.roundQty
          );

          if (aggregatedQuantities) {
            const itemBalanceParams = {
              material_id: materialData.id,
              location_id: locationId,
              plant_id: allData.issuing_operation_faci,
              organization_id: organizationId,
            };

            await processItemBalance(
              this.db,
              { material_id: materialData.id, location_id: locationId },
              itemBalanceParams,
              aggregatedQuantities.block_qty,
              aggregatedQuantities.reserved_qty,
              aggregatedQuantities.unrestricted_qty,
              aggregatedQuantities.qualityinsp_qty,
              aggregatedQuantities.intransit_qty,
              this.roundQty
            );

            console.log(
              `Updated item_balance for serialized batch item ${materialData.id} with ${aggregatedQuantities.serial_count} serial numbers`
            );
          }
        }
      } else {
        // For non-serialized batched items: use direct quantities from updateData
        const categoryField =
          this.categoryMap[balance.category || "Unrestricted"];
        let block_qty = 0,
          reserved_qty = 0,
          unrestricted_qty = 0,
          qualityinsp_qty = 0,
          intransit_qty = 0;

        // Calculate the quantity change based on movement type
        let qtyChange = qtyChangeValue;
        if (
          [
            "Miscellaneous Issue",
            "Disposal/Scrap",
            "Location Transfer",
          ].includes(movementType)
        ) {
          qtyChange = -qtyChangeValue;
        } else if (
          [
            "Inter Operation Facility Transfer",
            "Miscellaneous Receipt",
          ].includes(movementType)
        ) {
          qtyChange = qtyChangeValue; // Positive for additions
        }

        // Handle category transfer posting (special case)
        if (movementType === "Inventory Category Transfer Posting") {
          if (!balance.category_from || !balance.category_to) {
            throw new Error(
              "Both category_from and category_to are required for category transfer"
            );
          }

          // Subtract from source category
          const fromCategoryField = this.categoryMap[balance.category_from];
          if (fromCategoryField === "block_qty") {
            block_qty = -qtyChangeValue;
          } else if (fromCategoryField === "reserved_qty") {
            reserved_qty = -qtyChangeValue;
          } else if (fromCategoryField === "qualityinsp_qty") {
            qualityinsp_qty = -qtyChangeValue;
          } else if (fromCategoryField === "intransit_qty") {
            intransit_qty = -qtyChangeValue;
          } else {
            unrestricted_qty = -qtyChangeValue; // Default
          }

          // Add to destination category
          const toCategoryField = this.categoryMap[balance.category_to];
          if (toCategoryField === "block_qty") {
            block_qty += qtyChangeValue;
          } else if (toCategoryField === "reserved_qty") {
            reserved_qty += qtyChangeValue;
          } else if (toCategoryField === "qualityinsp_qty") {
            qualityinsp_qty += qtyChangeValue;
          } else if (toCategoryField === "intransit_qty") {
            intransit_qty += qtyChangeValue;
          } else {
            unrestricted_qty += qtyChangeValue; // Default
          }
        } else {
          // Assign to appropriate category for other movement types
          if (categoryField === "block_qty") {
            block_qty = qtyChange;
          } else if (categoryField === "reserved_qty") {
            reserved_qty = qtyChange;
          } else if (categoryField === "qualityinsp_qty") {
            qualityinsp_qty = qtyChange;
          } else if (categoryField === "intransit_qty") {
            intransit_qty = qtyChange;
          } else {
            unrestricted_qty = qtyChange; // Default
          }
        }

        const itemBalanceParams = {
          material_id: materialData.id,
          location_id: locationId,
          plant_id: allData.issuing_operation_faci,
          organization_id: organizationId,
        };

        await processItemBalance(
          this.db,
          { material_id: materialData.id, location_id: locationId },
          itemBalanceParams,
          block_qty,
          reserved_qty,
          unrestricted_qty,
          qualityinsp_qty,
          intransit_qty,
          this.roundQty
        );

        console.log(
          `Updated item_balance for ${
            isBatchedItem ? "batched" : "serialized"
          } item ${
            materialData.id
          } with movement type ${movementType} (legacy logic)`
        );
      }
    }

    return { weightedAverageCost, batchId };
  }

  async updateReceivingLocation(
    materialData,
    collectionName,
    receivingLocationId,
    qtyChangeValue,
    balance,
    allData,
    subformData,
    movementType,
    organizationId
  ) {
    if (!receivingLocationId) {
      throw new Error(
        "Receiving location ID is required for Location Transfer"
      );
    }

    const effectiveUom =
      balance.effective_uom ||
      subformData.effective_uom ||
      materialData.based_uom;
    qtyChangeValue = balance.quantity_converted || qtyChangeValue;

    console.log(
      `updateReceivingLocation: item ${materialData.id}, effectiveUom: ${effectiveUom}, qtyChangeValue: ${qtyChangeValue}`
    );

    if (!effectiveUom) {
      throw new Error(
        `Effective UOM is undefined for item ${materialData.id} in receiving location`
      );
    }

    // For batch-managed items, we need to check for the specific batch
    const queryConditions = {
      material_id: materialData.id,
      location_id: receivingLocationId,
    };

    // Add batch_id to query conditions for batch-managed items
    if (materialData.item_batch_management == "1" && balance.batch_id) {
      queryConditions.batch_id = balance.batch_id;
    }

    const balanceResponse = await this.db
      .collection(collectionName)
      .where(queryConditions)
      .get();

    let balanceData = balanceResponse.data[0];

    let updateData = balanceData
      ? { ...balanceData }
      : {
          material_id: materialData.id,
          location_id: receivingLocationId,
          balance_quantity: 0,
          unrestricted_qty: 0,
          qualityinsp_qty: 0,
          block_qty: 0,
          reserved_qty: 0,
          batch_id:
            materialData.item_batch_management == "1" ? balance.batch_id : null,
          plant_id: allData.issuing_operation_faci,
          create_user: allData.user_id || "system",
          issue_date: allData.issue_date,
          update_user: allData.user_id || "system",
          is_deleted: 0,
          tenant_id: allData.tenant_id || "000000",
          organization_id: organizationId,
        };

    let categoryField =
      movementType === "Location Transfer"
        ? this.categoryMap[balance.category || "Unrestricted"]
        : movementType === "Miscellaneous Receipt"
        ? this.categoryMap[subformData.category || "Unrestricted"]
        : this.categoryMap[balance.category || "Unrestricted"];

    if (
      movementType === "Location Transfer" &&
      allData.is_production_order === 1
    ) {
      categoryField = this.categoryMap["Reserved"];
    }

    updateData.balance_quantity =
      (updateData.balance_quantity || 0) + qtyChangeValue;
    updateData[categoryField] =
      (updateData[categoryField] || 0) + qtyChangeValue;

    updateData.update_time = new Date().toISOString();
    updateData.update_user = allData.user_id || "system";

    if (!balanceData) {
      // For new entries, ensure we're creating a properly-formatted record
      await this.db.collection(collectionName).add(updateData);
      console.log(
        `Created new ${collectionName} record for batch ${balance.batch_id} at location ${receivingLocationId}`
      );
    } else {
      const updateFields = {
        balance_quantity: parseFloat(updateData.balance_quantity.toFixed(3)),
        unrestricted_qty: parseFloat(updateData.unrestricted_qty.toFixed(3)),
        qualityinsp_qty: parseFloat(updateData.qualityinsp_qty.toFixed(3)),
        block_qty: parseFloat(updateData.block_qty.toFixed(3)),
        reserved_qty: parseFloat(updateData.reserved_qty.toFixed(3)),
        update_time: updateData.update_time,
        update_user: updateData.update_user,
        plant_id: updateData.plant_id,
      };

      // Only update batch_id if it's a batch-managed item and not already set
      if (materialData.item_batch_management == "1") {
        updateFields.batch_id = updateData.batch_id;
      }

      await this.db
        .collection(collectionName)
        .doc(balanceData.id)
        .update(updateFields);

      console.log(
        `Updated existing ${collectionName} record for batch ${balance.batch_id} at location ${receivingLocationId}`
      );
    }

    // ✅ CRITICAL FIX: For batched items, also update item_balance (aggregated across all batches)
    if (
      materialData.item_batch_management == "1" &&
      collectionName === "item_batch_balance"
    ) {
      try {
        const generalItemBalanceParams = {
          material_id: materialData.id,
          location_id: receivingLocationId,
          plant_id: allData.issuing_operation_faci,
          organization_id: organizationId,
        };

        // Don't include batch_id in item_balance query (aggregated balance across all batches)
        const generalBalanceQuery = await this.db
          .collection("item_balance")
          .where(generalItemBalanceParams)
          .get();

        if (generalBalanceQuery.data && generalBalanceQuery.data.length > 0) {
          // Update existing item_balance record
          const generalBalance = generalBalanceQuery.data[0];

          const currentGeneralBalanceQty = parseFloat(
            generalBalance.balance_quantity || 0
          );
          const currentGeneralCategoryQty = parseFloat(
            generalBalance[categoryField] || 0
          );

          const generalUpdateData = {
            balance_quantity: parseFloat(
              (currentGeneralBalanceQty + qtyChangeValue).toFixed(3)
            ),
            [categoryField]: parseFloat(
              (currentGeneralCategoryQty + qtyChangeValue).toFixed(3)
            ),
            update_time: new Date().toISOString(),
            update_user: allData.user_id || "system",
          };

          await this.db
            .collection("item_balance")
            .doc(generalBalance.id)
            .update(generalUpdateData);

          console.log(
            `Updated aggregated item_balance for receiving location ${receivingLocationId}, item ${materialData.id}`
          );
        } else {
          // Create new item_balance record if it doesn't exist
          const generalUpdateData = {
            material_id: materialData.id,
            location_id: receivingLocationId,
            plant_id: allData.issuing_operation_faci,
            organization_id: organizationId,
            balance_quantity: parseFloat(qtyChangeValue.toFixed(3)),
            unrestricted_qty:
              categoryField === "unrestricted_qty"
                ? parseFloat(qtyChangeValue.toFixed(3))
                : 0,
            qualityinsp_qty:
              categoryField === "qualityinsp_qty"
                ? parseFloat(qtyChangeValue.toFixed(3))
                : 0,
            block_qty:
              categoryField === "block_qty"
                ? parseFloat(qtyChangeValue.toFixed(3))
                : 0,
            reserved_qty:
              categoryField === "reserved_qty"
                ? parseFloat(qtyChangeValue.toFixed(3))
                : 0,
            intransit_qty:
              categoryField === "intransit_qty"
                ? parseFloat(qtyChangeValue.toFixed(3))
                : 0,
            create_user: allData.user_id || "system",
            update_user: allData.user_id || "system",
            create_time: new Date().toISOString(),
            update_time: new Date().toISOString(),
            is_deleted: 0,
          };

          await this.db.collection("item_balance").add(generalUpdateData);

          console.log(
            `Created new aggregated item_balance for receiving location ${receivingLocationId}, item ${materialData.id}`
          );
        }
      } catch (error) {
        console.error(
          `Error updating aggregated item_balance for receiving location ${receivingLocationId}, item ${materialData.id}:`,
          error
        );
        // Don't throw - let the main process continue
      }
    }

    // ✅ CRITICAL FIX: For serialized items, also update item_balance (aggregated across all serial numbers)
    if (materialData.serial_number_management === 1) {
      try {
        const generalItemBalanceParams = {
          material_id: materialData.id,
          location_id: receivingLocationId,
          plant_id: allData.issuing_operation_faci,
          organization_id: organizationId,
        };

        // Don't include serial_number in item_balance query (aggregated balance across all serial numbers)
        const generalBalanceQuery = await this.db
          .collection("item_balance")
          .where(generalItemBalanceParams)
          .get();

        if (generalBalanceQuery.data && generalBalanceQuery.data.length > 0) {
          // Update existing item_balance record
          const generalBalance = generalBalanceQuery.data[0];

          const currentGeneralBalanceQty = parseFloat(
            generalBalance.balance_quantity || 0
          );
          const currentGeneralCategoryQty = parseFloat(
            generalBalance[categoryField] || 0
          );

          const generalUpdateData = {
            balance_quantity: parseFloat(
              (currentGeneralBalanceQty + qtyChangeValue).toFixed(3)
            ),
            [categoryField]: parseFloat(
              (currentGeneralCategoryQty + qtyChangeValue).toFixed(3)
            ),
            update_time: new Date().toISOString(),
            update_user: allData.user_id || "system",
          };

          await this.db
            .collection("item_balance")
            .doc(generalBalance.id)
            .update(generalUpdateData);

          console.log(
            `Updated aggregated item_balance for receiving location ${receivingLocationId}, item ${materialData.id} (serialized)`
          );
        } else {
          // Create new item_balance record
          const generalUpdateData = {
            material_id: materialData.id,
            location_id: receivingLocationId,
            plant_id: allData.issuing_operation_faci,
            organization_id: organizationId,
            balance_quantity: parseFloat(qtyChangeValue.toFixed(3)),
            unrestricted_qty:
              categoryField === "unrestricted_qty"
                ? parseFloat(qtyChangeValue.toFixed(3))
                : 0,
            qualityinsp_qty:
              categoryField === "qualityinsp_qty"
                ? parseFloat(qtyChangeValue.toFixed(3))
                : 0,
            block_qty:
              categoryField === "block_qty"
                ? parseFloat(qtyChangeValue.toFixed(3))
                : 0,
            reserved_qty:
              categoryField === "reserved_qty"
                ? parseFloat(qtyChangeValue.toFixed(3))
                : 0,
            intransit_qty:
              categoryField === "intransit_qty"
                ? parseFloat(qtyChangeValue.toFixed(3))
                : 0,
            create_user: allData.user_id || "system",
            update_user: allData.user_id || "system",
            create_time: new Date().toISOString(),
            update_time: new Date().toISOString(),
            is_deleted: 0,
          };

          await this.db.collection("item_balance").add(generalUpdateData);

          console.log(
            `Created new aggregated item_balance for receiving location ${receivingLocationId}, item ${materialData.id} (serialized)`
          );
        }
      } catch (error) {
        console.error(
          `Error updating aggregated item_balance for serialized receiving location ${receivingLocationId}, item ${materialData.id}:`,
          error
        );
        // Don't throw - let the main process continue
      }
    }
  }

  async createBatch(
    materialData,
    quantity,
    allData,
    subformData,
    organizationId
  ) {
    const batchNumber = `BATCH-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 5)}`;
    const batchData = {
      batch_number: subformData.batch_id || batchNumber,
      material_id: materialData.id,
      initial_quantity: quantity,
      plant_id: allData.issuing_operation_faci,
      transaction_no: allData.stock_movement_no,
      organization_id: organizationId,
      created_at: new Date(),
      create_user: allData.user_id || "system",
    };

    try {
      await this.db.collection("batch").add(batchData);

      await new Promise((resolve) => setTimeout(resolve, 300));

      const batchQuery = await this.db
        .collection("batch")
        .where({
          batch_number: subformData.batch_id || batchNumber,
          material_id: materialData.id,
        })
        .get();

      if (!batchQuery.data || !batchQuery.data.length) {
        throw new Error("Batch was created but could not be retrieved");
      }

      return batchQuery.data[0].id;
    } catch (error) {
      console.error("Error creating or retrieving batch:", error);
      throw new Error(`Failed to create batch: ${error.message}`);
    }
  }

  async updateCostingMethod(
    materialData,
    quantityChange,
    plantId,
    subformData,
    balanceData,
    organizationId
  ) {
    try {
      console.log("updateCostingMethod inputs:", {
        materialData,
        quantityChange,
        plantId,
        subformData,
        balanceData,
      });

      if (!materialData?.id) {
        throw new Error("Invalid material data: material_id is missing");
      }

      if (!materialData.material_costing_method) {
        throw new Error("Material costing method is not defined");
      }

      if (!plantId) {
        throw new Error("Plant ID is required for costing update");
      }

      const costingMethod = materialData.material_costing_method;
      const qtyChangeValue =
        subformData.quantity_converted || quantityChange || 0;

      if (qtyChangeValue === 0) {
        console.log("No quantity change, skipping costing update");
        return null;
      }

      if (
        !["Weighted Average", "First In First Out", "Fixed Cost"].includes(
          costingMethod
        )
      ) {
        throw new Error(`Unsupported costing method: ${costingMethod}`);
      }

      const unitPrice =
        balanceData.unit_price && balanceData.unit_price !== 0
          ? balanceData.unit_price
          : subformData.price_converted && subformData.price_converted !== 0
          ? subformData.price_converted
          : subformData.unit_price && subformData.unit_price !== 0
          ? subformData.unit_price
          : materialData.purchase_unit_price || 0;

      if (unitPrice === 0) {
        console.warn("Unit price is zero, proceeding with costing update");
      }

      let weightedAverageCost = null;

      if (costingMethod === "Weighted Average") {
        const waQuery =
          materialData.item_batch_management == "1" && balanceData.batch_id
            ? this.db.collection("wa_costing_method").where({
                material_id: materialData.id,
                batch_id: balanceData.batch_id,
                plant_id: plantId,
              })
            : this.db.collection("wa_costing_method").where({
                material_id: materialData.id,
                plant_id: plantId,
              });

        const waResponse = await waQuery.get();
        if (!waResponse || !waResponse.data) {
          throw new Error("Failed to retrieve weighted average costing data");
        }

        const waData = waResponse.data;

        let newWaQuantity, newWaCostPrice;

        if (waData.length === 0 && qtyChangeValue > 0) {
          newWaQuantity = this.roundQty(qtyChangeValue);
          newWaCostPrice = this.roundPrice(unitPrice);

          await this.db.collection("wa_costing_method").add({
            material_id: materialData.id,
            batch_id:
              materialData.item_batch_management == "1"
                ? balanceData.batch_id
                : null,
            plant_id: plantId,
            organization_id: organizationId,
            wa_quantity: newWaQuantity,
            wa_cost_price: newWaCostPrice,
            created_at: new Date().toISOString(),
          });
        } else if (waData.length > 0) {
          console.log("WA Data found:", {
            count: waData.length,
            firstItem: waData[0],
            dataTypes: waData.map((item) => typeof item),
            hasCreatedAt: waData.map((item) => Boolean(item.created_at)),
            hasId: waData.map((item) => Boolean(item.id)),
          });

          let latestWa;
          try {
            latestWa = waData.sort(
              (a, b) =>
                new Date(b.created_at || 0) - new Date(a.created_at || 0)
            )[0];

            if (!latestWa) {
              throw new Error("No WA records found after sorting");
            }

            if (!latestWa.id) {
              throw new Error("Latest WA record has no ID");
            }

            console.log("Latest WA record:", {
              id: latestWa.id,
              wa_quantity: latestWa.wa_quantity,
              wa_cost_price: latestWa.wa_cost_price,
              created_at: latestWa.created_at,
            });
          } catch (sortError) {
            console.error("Error during WA record sorting:", sortError);
            throw new Error(
              `Error processing WA records: ${sortError.message}`
            );
          }

          const currentQty = this.roundQty(latestWa.wa_quantity || 0);
          const currentCostPrice = this.roundPrice(latestWa.wa_cost_price || 0);

          if (qtyChangeValue > 0) {
            newWaQuantity = this.roundQty(currentQty + qtyChangeValue);
            const currentTotalCost = this.roundPrice(
              currentCostPrice * currentQty
            );
            const newTotalCost = this.roundPrice(unitPrice * qtyChangeValue);
            newWaCostPrice =
              newWaQuantity > 0
                ? this.roundPrice(
                    (currentTotalCost + newTotalCost) / newWaQuantity
                  )
                : 0;
          } else {
            const deliveredQuantity = Math.abs(qtyChangeValue);
            newWaQuantity = this.roundQty(currentQty - deliveredQuantity);

            if (newWaQuantity < 0) {
              throw new Error(
                `Insufficient WA quantity: available ${currentQty}, requested ${deliveredQuantity}`
              );
            }

            newWaCostPrice = currentCostPrice;
          }

          await this.db
            .collection("wa_costing_method")
            .doc(latestWa.id)
            .update({
              wa_quantity: newWaQuantity,
              wa_cost_price: newWaCostPrice,
              updated_at: new Date().toISOString(),
            });
        } else {
          console.log("waQuery", waQuery);
          console.log("waResponse", waQuery);
          throw new Error(
            `No WA costing record found for deduction: material ${materialData.id}, plant ${plantId}`
          );
        }
      } else if (costingMethod === "First In First Out") {
        const fifoQuery =
          materialData.item_batch_management == "1" && balanceData.batch_id
            ? this.db.collection("fifo_costing_history").where({
                material_id: materialData.id,
                batch_id: balanceData.batch_id,
                plant_id: plantId,
              })
            : this.db.collection("fifo_costing_history").where({
                material_id: materialData.id,
                plant_id: plantId,
              });

        const fifoResponse = await fifoQuery.get();
        if (!fifoResponse || !fifoResponse.data) {
          throw new Error("Failed to retrieve FIFO costing data");
        }

        const fifoData = Array.isArray(fifoResponse.data)
          ? fifoResponse.data
          : [];

        if (qtyChangeValue > 0) {
          const latestSequence =
            fifoData.length > 0
              ? Math.max(...fifoData.map((record) => record.fifo_sequence || 0))
              : 0;

          await this.db.collection("fifo_costing_history").add({
            material_id: materialData.id,
            batch_id:
              materialData.item_batch_management == "1"
                ? balanceData.batch_id
                : null,
            plant_id: plantId,
            organization_id: organizationId,
            fifo_initial_quantity: this.roundQty(qtyChangeValue),
            fifo_available_quantity: this.roundQty(qtyChangeValue),
            fifo_cost_price: this.roundPrice(unitPrice),
            fifo_sequence: latestSequence + 1,
            created_at: new Date().toISOString(),
          });
        } else if (qtyChangeValue < 0) {
          let remainingDeduction = Math.abs(qtyChangeValue);
          const fifoDeductions = []; // Track deductions for weighted average

          const sortedFifoData = fifoData.sort(
            (a, b) => (a.fifo_sequence || 0) - (b.fifo_sequence || 0)
          );

          const totalAvailable = this.roundQty(
            sortedFifoData.reduce(
              (sum, record) => sum + (record.fifo_available_quantity || 0),
              0
            )
          );

          if (totalAvailable < remainingDeduction) {
            throw new Error(
              `Insufficient FIFO quantity: available ${totalAvailable}, requested ${remainingDeduction}`
            );
          }

          for (const record of sortedFifoData) {
            if (remainingDeduction <= 0) break;

            const available = this.roundQty(
              record.fifo_available_quantity || 0
            );
            if (available <= 0) continue;

            const deduction = Math.min(available, remainingDeduction);
            const newAvailable = this.roundQty(available - deduction);

            // Store the deduction details for weighted average calculation
            fifoDeductions.push({
              quantity: deduction,
              costPrice: this.roundPrice(record.fifo_cost_price || 0),
            });

            await this.db
              .collection("fifo_costing_history")
              .doc(record.id)
              .update({
                fifo_available_quantity: newAvailable,
                updated_at: new Date().toISOString(),
              });

            remainingDeduction -= deduction;
          }

          if (remainingDeduction > 0) {
            throw new Error(
              `Insufficient FIFO quantity: remaining ${remainingDeduction} after processing all layers`
            );
          }

          // Calculate weighted average cost for FIFO
          if (fifoDeductions.length > 0) {
            const totalCost = fifoDeductions.reduce(
              (sum, d) => sum + d.quantity * d.costPrice,
              0
            );
            const totalQty = fifoDeductions.reduce(
              (sum, d) => sum + d.quantity,
              0
            );
            weightedAverageCost = this.roundPrice(totalCost / totalQty);
            console.log(
              `FIFO weighted average cost calculated: ${weightedAverageCost}`
            );
          }
        }
      } else if (costingMethod === "Fixed Cost") {
        console.log("Fixed Cost method - no costing records to update");
        return null;
      }

      return weightedAverageCost;
    } catch (error) {
      console.error("Detailed error in updateCostingMethod:", {
        message: error.message || "Unknown error",
        stack: error.stack || "No stack trace",
        material_id: materialData.id,
        quantityChange,
        plantId,
        costing_method: materialData.material_costing_method,
        batch_id: balanceData.batch_id,
        subformData,
        balanceData,
      });
      throw new Error(
        `Failed to update costing method: ${error.message || "Unknown error"}`
      );
    }
  }

  // Function to get latest FIFO cost price with available quantity check
  async getLatestFIFOCostPrice(
    materialData,
    batchId,
    plantId,
    deductionQty = null
  ) {
    try {
      const query =
        materialData.item_batch_management == "1" && batchId
          ? this.db.collection("fifo_costing_history").where({
              material_id: materialData.id,
              batch_id: batchId,
              plant_id: plantId,
            })
          : this.db
              .collection("fifo_costing_history")
              .where({ material_id: materialData.id, plant_id: plantId });

      const response = await query.get();
      const result = response.data;

      if (!result || !Array.isArray(result) || result.length === 0) {
        console.warn(`No FIFO records found for material ${materialData.id}`);
        return 0;
      }

      const sortedRecords = result.sort(
        (a, b) => a.fifo_sequence - b.fifo_sequence
      );

      if (deductionQty && deductionQty > 0) {
        let remainingQtyToDeduct = this.roundQty(deductionQty);
        let totalCost = 0;
        let totalDeductedQty = 0;

        for (const record of sortedRecords) {
          if (remainingQtyToDeduct <= 0) break;

          const availableQty = this.roundQty(
            record.fifo_available_quantity || 0
          );
          if (availableQty <= 0) continue;

          const costPrice = this.roundPrice(record.fifo_cost_price || 0);
          const qtyToDeduct = Math.min(availableQty, remainingQtyToDeduct);

          totalCost += qtyToDeduct * costPrice;
          totalDeductedQty += qtyToDeduct;
          remainingQtyToDeduct -= qtyToDeduct;
        }

        return totalDeductedQty > 0
          ? this.roundPrice(totalCost / totalDeductedQty)
          : 0;
      }

      // First look for records with available quantity
      for (const record of sortedRecords) {
        const availableQty = this.roundQty(record.fifo_available_quantity || 0);
        if (availableQty > 0) {
          console.log(
            `Found FIFO record with available quantity: Sequence ${record.fifo_sequence}, Cost price ${record.fifo_cost_price}`
          );
          return this.roundPrice(record.fifo_cost_price || 0);
        }
      }

      // If no records with available quantity, use the most recent record
      console.warn(
        `No FIFO records with available quantity found for ${materialData.id}, using most recent cost price`
      );
      return this.roundPrice(
        sortedRecords[sortedRecords.length - 1].fifo_cost_price || 0
      );
    } catch (error) {
      console.error(
        `Error retrieving FIFO cost price for ${materialData.id}:`,
        error
      );
      return 0;
    }
  }

  // Function to get Weighted Average cost price
  async getWeightedAverageCostPrice(materialData, batchId, plantId) {
    try {
      const query =
        materialData.item_batch_management == "1" && batchId
          ? this.db.collection("wa_costing_method").where({
              material_id: materialData.id,
              batch_id: batchId,
              plant_id: plantId,
            })
          : this.db
              .collection("wa_costing_method")
              .where({ material_id: materialData.id, plant_id: plantId });

      const response = await query.get();
      const waData = response.data;

      if (waData && Array.isArray(waData) && waData.length > 0) {
        // Sort by date (newest first) to get the latest record
        waData.sort((a, b) => {
          if (a.created_at && b.created_at) {
            return new Date(b.created_at) - new Date(a.created_at);
          }
          return 0;
        });

        return this.roundPrice(waData[0].wa_cost_price || 0);
      }

      console.warn(
        `No weighted average records found for material ${materialData.id}`
      );
      return 0;
    } catch (error) {
      console.error(
        `Error retrieving WA cost price for ${materialData.id}:`,
        error
      );
      return 0;
    }
  }

  async getFixedCostPrice(materialId) {
    const query = this.db.collection("Item").where({ id: materialId });
    const response = await query.get();
    const result = response.data;
    return this.roundPrice(result[0].purchase_unit_price || 0);
  }

  async recordInventoryMovement(
    materialData,
    movementType,
    balance,
    allData,
    subformData,
    organizationId
  ) {
    console.log("recordInventoryMovement inputs:", {
      materialData,
      movementType,
      balance,
      subformData,
    });

    const originalQty =
      balance.sm_quantity || subformData.received_quantity || 0;
    const convertedQty =
      balance.quantity_converted ||
      subformData.quantity_converted ||
      originalQty;
    const effectiveUom =
      balance.effective_uom ||
      subformData.effective_uom ||
      materialData.based_uom;

    console.log(
      `recordInventoryMovement: item ${materialData.id}, effectiveUom: ${effectiveUom}, originalQty: ${originalQty}, convertedQty: ${convertedQty}`
    );

    if (!effectiveUom) {
      throw new Error(
        `Effective UOM is undefined for item ${materialData.id} in inventory movement`
      );
    }

    // Check if this is a serialized item
    const isSerializedItem = materialData.serial_number_management === 1;

    let unitPrice =
      balance.unit_price && balance.unit_price !== 0
        ? balance.unit_price
        : subformData.unit_price && subformData.unit_price !== 0
        ? subformData.unit_price
        : materialData.purchase_unit_price || 0;

    console.log("unitPrice JN", unitPrice);

    if (materialData.material_costing_method === "First In First Out") {
      if (
        balance.calculated_fifo_cost !== undefined &&
        balance.calculated_fifo_cost !== null
      ) {
        unitPrice = balance.calculated_fifo_cost;
        console.log(
          `Using calculated FIFO weighted average cost: ${unitPrice}`
        );
      } else {
        const isDeductionMovement = [
          "Miscellaneous Issue",
          "Disposal/Scrap",
          "Location Transfer",
        ].includes(movementType);
        const deductionQty = isDeductionMovement
          ? balance.quantity_converted || balance.sm_quantity
          : null;

        const fifoCostPrice = await this.getLatestFIFOCostPrice(
          materialData,
          balance.batch_id,
          allData.issuing_operation_faci,
          deductionQty
        );
        unitPrice = this.roundPrice(fifoCostPrice);
      }
    } else if (materialData.material_costing_method === "Weighted Average") {
      const waCostPrice = await this.getWeightedAverageCostPrice(
        materialData,
        balance.batch_id,
        allData.issuing_operation_faci
      );
      unitPrice = this.roundPrice(waCostPrice);
    } else if (materialData.material_costing_method === "Fixed Cost") {
      const fixedCostPrice = await this.getFixedCostPrice(materialData.id);
      unitPrice = this.roundPrice(fixedCostPrice);
    } else {
      return Promise.resolve();
    }

    let receiptUnitPrice = unitPrice;
    if (movementType === "Miscellaneous Receipt") {
      receiptUnitPrice =
        balance.unit_price && balance.unit_price !== 0
          ? balance.unit_price
          : subformData.unit_price && subformData.unit_price !== 0
          ? subformData.unit_price
          : materialData.purchase_unit_price || 0;
    }

    const formattedUnitPrice = this.roundPrice(
      movementType === "Miscellaneous Receipt" ? receiptUnitPrice : unitPrice
    );
    const formattedConvertedQty = this.roundQty(convertedQty);
    const formattedOriginalQty = this.roundQty(originalQty);

    console.log("formattedUnitPrice JN", formattedUnitPrice);

    const baseMovementData = {
      transaction_type: "SM",
      trx_no: allData.stock_movement_no,
      unit_price: formattedUnitPrice,
      total_price: this.roundPrice(formattedUnitPrice * formattedConvertedQty),
      quantity: formattedOriginalQty,
      item_id: materialData.id,
      inventory_category: balance.category || subformData.category,
      uom_id: effectiveUom,
      base_qty: formattedConvertedQty,
      base_uom_id: materialData.based_uom,
      batch_number_id:
        materialData.item_batch_management == "1" ? balance.batch_id : null,
      costing_method_id: materialData.material_costing_method,
      plant_id: allData.issuing_operation_faci,
      created_at: new Date(),
      organization_id: organizationId,
      doc_date: allData.issue_date,
      manufacturing_date:
        (subformData && subformData.manufacturing_date) ||
        (balance && balance.manufacturing_date) ||
        null,
      expired_date:
        (subformData && subformData.expired_date) ||
        (balance && balance.expired_date) ||
        null,
    };

    console.log("baseMovementData JN", baseMovementData);

    switch (movementType) {
      case "Location Transfer":
        let productionOrderNo = null;
        let category = null;
        if (allData.is_production_order === 1) {
          const productionOrder = await this.db
            .collection("production_order")
            .where({
              id: allData.production_order_id,
            })
            .get();
          productionOrderNo =
            productionOrder.data[0]?.production_order_no || null;
          category = "Reserved";
          console.log("Production Order No:", productionOrderNo);
        }
        const outMovement = {
          ...baseMovementData,
          movement: "OUT",
          parent_trx_no: productionOrderNo,
          bin_location_id: balance.location_id,
          inventory_category: balance.category || "Unrestricted",
        };
        const inMovement = {
          ...baseMovementData,
          movement: "IN",
          bin_location_id: subformData.location_id,
          parent_trx_no: productionOrderNo,
          inventory_category: category || balance.category,
        };

        // Create OUT movement first (deduction from source)
        const outResult = await this.db
          .collection("inventory_movement")
          .add(outMovement);

        // Then create IN movement (addition to destination)
        const inResult = await this.db
          .collection("inventory_movement")
          .add(inMovement);

        // Handle serialized items for Location Transfer
        if (isSerializedItem) {
          await new Promise((resolve) => setTimeout(resolve, 300));

          const outMovementQuery = await this.db
            .collection("inventory_movement")
            .where({
              trx_no: allData.stock_movement_no,
              item_id: materialData.id,
              movement: "OUT",
              bin_location_id: balance.location_id,
              base_qty: formattedConvertedQty,
              plant_id: allData.issuing_operation_faci,
            })
            .get();

          // Process OUT movement serials once
          if (outMovementQuery.data && outMovementQuery.data.length > 0) {
            const outMovementRecord = outMovementQuery.data.sort(
              (a, b) => new Date(b.create_time) - new Date(a.create_time)
            )[0];
            const outMovementId = outMovementRecord.id;

            if (
              balance.serial_balances &&
              Array.isArray(balance.serial_balances)
            ) {
              // Process each serial balance individually for OUT
              for (const serialBalance of balance.serial_balances) {
                await this.addSerialNumberInventoryForSMDeduction(
                  allData,
                  subformData,
                  outMovementId,
                  organizationId,
                  allData.issuing_operation_faci,
                  serialBalance,
                  movementType
                );
              }
            } else {
              // Single balance (fallback for non-grouped scenarios)
              await this.addSerialNumberInventoryForSMDeduction(
                allData,
                subformData,
                outMovementId,
                organizationId,
                allData.issuing_operation_faci,
                balance,
                movementType
              );
            }
          }

          const inMovementQuery = await this.db
            .collection("inventory_movement")
            .where({
              trx_no: allData.stock_movement_no,
              item_id: materialData.id,
              movement: "IN",
              bin_location_id: subformData.location_id,
              base_qty: formattedConvertedQty,
              plant_id: allData.issuing_operation_faci,
            })
            .get();

          // Process IN movement serials once
          if (inMovementQuery.data && inMovementQuery.data.length > 0) {
            const inMovementRecord = inMovementQuery.data.sort(
              (a, b) => new Date(b.create_time) - new Date(a.create_time)
            )[0];
            const inMovementId = inMovementRecord.id;

            if (
              balance.serial_balances &&
              Array.isArray(balance.serial_balances)
            ) {
              // Process each serial balance individually for IN
              for (const serialBalance of balance.serial_balances) {
                await this.addSerialNumberInventoryForSMReceipt(
                  allData,
                  subformData,
                  inMovementId,
                  organizationId,
                  allData.issuing_operation_faci,
                  serialBalance,
                  subformData.location_id
                );
              }
            } else {
              // Single balance (fallback for non-grouped scenarios)
              await this.addSerialNumberInventoryForSMReceipt(
                allData,
                subformData,
                inMovementId,
                organizationId,
                allData.issuing_operation_faci,
                balance,
                subformData.location_id
              );
            }
          }
        }

        return [outResult, inResult];

      case "Miscellaneous Issue":
      case "Disposal/Scrap":
        const outData = {
          ...baseMovementData,
          movement: "OUT",
          bin_location_id: balance.location_id,
        };
        console.log("outData JN", outData);

        const outResult_Issue = await this.db
          .collection("inventory_movement")
          .add(outData);

        // Handle serialized items for deduction movements
        if (isSerializedItem) {
          await new Promise((resolve) => setTimeout(resolve, 300));

          const movementQuery = await this.db
            .collection("inventory_movement")
            .where({
              trx_no: allData.stock_movement_no,
              item_id: materialData.id,
              movement: "OUT",
              bin_location_id: balance.location_id,
              base_qty: formattedConvertedQty,
              plant_id: allData.issuing_operation_faci,
            })
            .get();

          if (movementQuery.data && movementQuery.data.length > 0) {
            const movementId = movementQuery.data.sort(
              (a, b) => new Date(b.create_time) - new Date(a.create_time)
            )[0].id;

            if (
              balance.serial_balances &&
              Array.isArray(balance.serial_balances)
            ) {
              // Process each serial balance individually for inv_serial_movement
              for (const serialBalance of balance.serial_balances) {
                await this.addSerialNumberInventoryForSMDeduction(
                  allData,
                  subformData,
                  movementId,
                  organizationId,
                  allData.issuing_operation_faci,
                  serialBalance,
                  movementType
                );
              }
            } else {
              // Single balance (fallback for non-grouped scenarios)
              await this.addSerialNumberInventoryForSMDeduction(
                allData,
                subformData,
                movementId,
                organizationId,
                allData.issuing_operation_faci,
                balance,
                movementType
              );
            }
          }
        }

        return outResult_Issue;

      case "Miscellaneous Receipt":
        const inData = {
          ...baseMovementData,
          movement: "IN",
          bin_location_id: subformData.location_id || balance.location_id,
          batch_number_id:
            materialData.item_batch_management == "1"
              ? baseMovementData.batch_number_id
              : null,
        };

        await this.db.collection("inventory_movement").add(inData);

        if (
          subformData.is_serialized_item === 1 &&
          subformData.is_serial_allocated === 1
        ) {
          await new Promise((resolve) => setTimeout(resolve, 300));

          const inventoryMovementQuery = await this.db
            .collection("inventory_movement")
            .where({
              trx_no: allData.stock_movement_no,
              item_id: materialData.id,
              movement: "IN",
              transaction_type: "SM",
              ...(materialData.item_batch_management == "1" &&
              baseMovementData.batch_number_id
                ? { batch_number_id: baseMovementData.batch_number_id }
                : {}),
            })
            .get();

          if (
            !inventoryMovementQuery.data ||
            inventoryMovementQuery.data.length === 0
          ) {
            throw new Error(
              "Inventory movement record was created but could not be retrieved"
            );
          }

          const inventoryMovementRecord = inventoryMovementQuery.data.sort(
            (a, b) => new Date(b.create_time) - new Date(a.create_time)
          )[0];

          const inventoryMovementId = inventoryMovementRecord.id;

          await this.addSerialNumberInventoryForSM(
            allData,
            subformData,
            inventoryMovementId,
            organizationId,
            allData.issuing_operation_faci,
            baseMovementData.batch_number_id
          );
        }

        return { success: true, type: "miscellaneous_receipt" };

      case "Inventory Category Transfer Posting":
        if (!balance.category_from || !balance.category_to) {
          throw new Error("Both category_from and category_to are required");
        }

        const outMovementICT = {
          ...baseMovementData,
          movement: "OUT",
          inventory_category: balance.category_from,
          bin_location_id: balance.location_id,
        };
        const inMovementICT = {
          ...baseMovementData,
          movement: "IN",
          inventory_category: balance.category_to,
          bin_location_id: balance.location_id,
        };

        // Create OUT movement first (deduction from source category)
        const outResultICT = await this.db
          .collection("inventory_movement")
          .add(outMovementICT);

        // Then create IN movement (addition to target category)
        const inResultICT = await this.db
          .collection("inventory_movement")
          .add(inMovementICT);

        // Handle serialized items for Category Transfer
        if (isSerializedItem) {
          await new Promise((resolve) => setTimeout(resolve, 300));

          const outMovementQueryICT = await this.db
            .collection("inventory_movement")
            .where({
              trx_no: allData.stock_movement_no,
              item_id: materialData.id,
              movement: "OUT",
              inventory_category: balance.category_from,
              bin_location_id: balance.location_id,
              base_qty: formattedConvertedQty,
              plant_id: allData.issuing_operation_faci,
            })
            .get();

          const inMovementQueryICT = await this.db
            .collection("inventory_movement")
            .where({
              trx_no: allData.stock_movement_no,
              item_id: materialData.id,
              movement: "IN",
              inventory_category: balance.category_to,
              bin_location_id: balance.location_id,
              base_qty: formattedConvertedQty,
              plant_id: allData.issuing_operation_faci,
            })
            .get();

          // Process OUT movement - this will handle the serial balance update for each serial
          if (outMovementQueryICT.data && outMovementQueryICT.data.length > 0) {
            const outMovementIdICT = outMovementQueryICT.data.sort(
              (a, b) => new Date(b.create_time) - new Date(a.create_time)
            )[0].id;

            // Process each serial balance individually
            if (balance.serial_balances && balance.serial_balances.length > 0) {
              for (const serialBalance of balance.serial_balances) {
                await this.addSerialNumberInventoryForCategoryTransfer(
                  allData,
                  subformData,
                  outMovementIdICT,
                  organizationId,
                  allData.issuing_operation_faci,
                  serialBalance
                );
              }
            } else {
              // Fallback for single balance
              await this.addSerialNumberInventoryForCategoryTransfer(
                allData,
                subformData,
                outMovementIdICT,
                organizationId,
                allData.issuing_operation_faci,
                balance
              );
            }
          }

          // Process IN movement - create serial movement record for each serial
          if (inMovementQueryICT.data && inMovementQueryICT.data.length > 0) {
            const inMovementIdICT = inMovementQueryICT.data.sort(
              (a, b) => new Date(b.create_time) - new Date(a.create_time)
            )[0].id;

            // Create serial movement records for each serial
            if (balance.serial_balances && balance.serial_balances.length > 0) {
              for (const serialBalance of balance.serial_balances) {
                const serialQty = this.roundQty(
                  parseFloat(serialBalance.original_quantity || 1)
                );
                await this.createSerialMovementRecord(
                  inMovementIdICT,
                  serialBalance.serial_number,
                  serialBalance.batch_id,
                  serialQty,
                  effectiveUom,
                  allData.issuing_operation_faci,
                  organizationId
                );
              }
            } else {
              // Fallback for single balance
              await this.createSerialMovementRecord(
                inMovementIdICT,
                balance.serial_number,
                balance.batch_id,
                formattedConvertedQty,
                materialData.based_uom,
                allData.issuing_operation_faci,
                organizationId
              );
            }
          }
        }

        return [outResultICT, inResultICT];

      case "Inter Operation Facility Transfer":
        const movementData = {
          ...baseMovementData,
          movement: "IN",
          bin_location_id: subformData.location_id || balance.location_id,
        };

        const result = await this.db
          .collection("inventory_movement")
          .add(movementData);

        // Handle serialized items for Inter Operation Facility Transfer
        if (isSerializedItem) {
          await new Promise((resolve) => setTimeout(resolve, 300));

          const movementQuery = await this.db
            .collection("inventory_movement")
            .where({
              trx_no: allData.stock_movement_no,
              item_id: materialData.id,
              movement: "IN",
              bin_location_id: subformData.location_id || balance.location_id,
              base_qty: formattedConvertedQty,
              plant_id: allData.issuing_operation_faci,
            })
            .get();

          if (movementQuery.data && movementQuery.data.length > 0) {
            const movementId = movementQuery.data.sort(
              (a, b) => new Date(b.create_time) - new Date(a.create_time)
            )[0].id;

            await this.addSerialNumberInventoryForInterFacilityTransfer(
              allData,
              subformData,
              movementId,
              organizationId,
              allData.issuing_operation_faci
            );
          }
        }

        return result;

      default:
        console.warn(
          `Unknown movement type: ${movementType}, using basic movement logic`
        );

        const movement = "OUT";
        const binLocationId = balance.location_id || subformData.location_id;

        const defaultMovementData = {
          ...baseMovementData,
          movement,
          bin_location_id: binLocationId,
        };

        const defaultResult = await this.db
          .collection("inventory_movement")
          .add(defaultMovementData);

        if (isSerializedItem && movement === "OUT") {
          await new Promise((resolve) => setTimeout(resolve, 300));

          const movementQuery = await this.db
            .collection("inventory_movement")
            .where({
              trx_no: allData.stock_movement_no,
              item_id: materialData.id,
              movement: movement,
              bin_location_id: binLocationId,
              base_qty: formattedConvertedQty,
              plant_id: allData.issuing_operation_faci,
            })
            .get();

          if (movementQuery.data && movementQuery.data.length > 0) {
            const movementId = movementQuery.data.sort(
              (a, b) => new Date(b.create_time) - new Date(a.create_time)
            )[0].id;

            if (
              balance.serial_balances &&
              Array.isArray(balance.serial_balances)
            ) {
              // Process each serial balance individually for inv_serial_movement
              for (const serialBalance of balance.serial_balances) {
                await this.addSerialNumberInventoryForSMDeduction(
                  allData,
                  subformData,
                  movementId,
                  organizationId,
                  allData.issuing_operation_faci,
                  serialBalance,
                  movementType
                );
              }
            } else {
              // Single balance (fallback for non-grouped scenarios)
              await this.addSerialNumberInventoryForSMDeduction(
                allData,
                subformData,
                movementId,
                organizationId,
                allData.issuing_operation_faci,
                balance,
                movementType
              );
            }
          }
        }

        return defaultResult;
    }
  }

  async updateOnReservedTable(allData, subformData, productionOrderData) {
    try {
      for (const [index, item] of subformData.entries()) {
        if (!item.item_selection || item.item_selection === "") {
          console.log(
            `Skipping item ${item.item_selection} due to no item_selection`
          );
          return;
        }

        //get material data
        const resItem = await this.db
          .collection("Item")
          .doc(item.item_selection)
          .get();

        if (!resItem || resItem.data.length === 0) return;

        const materialData = resItem.data[0];

        // process item without batch
        if (
          !materialData.item_batch_management ||
          materialData.item_batch_management === 0
        ) {
          this.db.collection("on_reserved_gd").add({
            doc_type: "Location Transfer",
            parent_no: productionOrderData.production_order_no,
            doc_no: allData.stock_movement_no,
            material_id: item.item_selection,
            item_name: materialData.material_name,
            item_desc: materialData.material_desc || "",
            batch_id: null,
            bin_location: item.location_id,
            item_uom: item.quantity_uom,
            line_no: index + 1,
            reserved_qty: item.total_quantity,
            delivered_qty: 0,
            open_qty: item.total_quantity,
            reserved_date: new Date()
              .toISOString()
              .slice(0, 19)
              .replace("T", " "),
            plant_id: allData.issuing_operation_faci,
            organization_id: allData.organization_id,
            created_by: this.getVarGlobal("nickname"),
            created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
          });
        } else {
          let tempDataParsed;
          try {
            const tempData = item.temp_qty_data;
            if (!tempData) {
              console.warn(
                `No temp_qty_data found for item ${item.item_selection}`
              );
              tempDataParsed = [];
            } else {
              tempDataParsed = JSON.parse(tempData);
              tempDataParsed = tempDataParsed.filter(
                (tempData) => tempData.sm_quantity > 0
              );
            }
          } catch (parseError) {
            console.error(
              `Error parsing temp_qty_data for item ${item.item_selection}:`,
              parseError
            );
            tempDataParsed = [];
          }

          console.log("tempDataParsed", tempDataParsed);

          let balancesToProcess =
            allData.balance_index?.filter(
              (balance) =>
                balance.sm_quantity &&
                balance.sm_quantity > 0 &&
                tempDataParsed.some(
                  (tempData) =>
                    tempData.material_id === balance.material_id &&
                    tempData.balance_id === balance.balance_id
                )
            ) || [];
          for (const balance of balancesToProcess) {
            this.db.collection("on_reserved_gd").add({
              doc_type: "Location Transfer",
              parent_no: productionOrderData.production_order_no,
              doc_no: allData.stock_movement_no,
              material_id: balance.material_id,
              item_name: materialData.material_name,
              item_desc: materialData.material_desc || "",
              batch_id: balance.batch_id || null,
              bin_location: item.location_id,
              item_uom: item.quantity_uom,
              line_no: index + 1,
              reserved_qty: balance.sm_quantity,
              delivered_qty: 0,
              open_qty: balance.sm_quantity,
              reserved_date: new Date()
                .toISOString()
                .slice(0, 19)
                .replace("T", " "),
              plant_id: allData.issuing_operation_faci,
              organization_id: allData.organization_id,
              created_by: this.getVarGlobal("nickname"),
              created_at: new Date()
                .toISOString()
                .slice(0, 19)
                .replace("T", " "),
            });
          }
        }
      }
    } catch {
      throw error;
    }
  }

  // Updated preCheckQuantitiesAndCosting with integrated serial number quantity validation
  async preCheckQuantitiesAndCosting(allData, context) {
    try {
      console.log("Starting preCheckQuantitiesAndCosting with data:", allData);

      // Step 1: Validate top-level required fields
      try {
        const requiredTopLevelFields = [
          "stock_movement_no",
          "movement_type",
          "issue_date",
          "issuing_operation_faci",
        ];
        this.validateRequiredFields(allData, requiredTopLevelFields);
      } catch (error) {
        if (context && context.parentGenerateForm) {
          context.parentGenerateForm.$alert(
            error.message,
            "Missing Required Fields",
            {
              confirmButtonText: "OK",
              type: "warning",
            }
          );
        } else {
          alert(error.message);
        }
        throw error;
      }

      // Step 2: Get movement type details
      const movementType = allData.movement_type;

      // Step 3: Validate subform data
      const subformData = allData.stock_movement;
      if (!subformData || subformData.length === 0) {
        throw new Error("Stock movement items are required");
      }

      console.log("📋 Stock movement items:", subformData);
      console.log("📋 Stock movement items length:", subformData.length);

      // Log each item's material_id and location_id
      subformData.forEach((item, index) => {
        console.log(
          `📦 Item ${index + 1}: material_id=${
            item.item_selection
          }, location_id=${item.location_id}`
        );
      });

      if (
        movementType === "Miscellaneous Receipt" ||
        movementType === "Location Transfer"
      ) {
        for (let i = 0; i < subformData.length; i++) {
          const item = subformData[i];
          if (!item.location_id) {
            throw new Error(
              `Location ID is required for item ${i + 1} in stock movement`
            );
          }
        }
      }

      // Step 4: Perform item validations and quantity checks
      await this.preValidateItems(subformData, movementType, allData);

      // Step 4.5: Validate serial number uniqueness for all movement types with serialized items
      console.log(
        "🔍 Validating serial number uniqueness for serialized items..."
      );

      // Check if any item has serial number data
      const hasSerializedItems = subformData.some(
        (item) =>
          item.is_serialized_item === 1 ||
          (item.serial_number_data && item.serial_number_data.trim() !== "")
      );

      if (hasSerializedItems) {
        try {
          await this.validateSerialNumberUniqueness(subformData);
          console.log("✅ Serial number uniqueness validation passed");
        } catch (serialError) {
          console.error(
            "❌ Serial number uniqueness validation failed:",
            serialError.message
          );
          throw serialError;
        }
      }

      // Step 5: ENHANCED LOGIC - Aggregate quantities by location and material for deduction movements
      // + INTEGRATED Serial Number Quantity Validation for Deduction Movements
      if (
        [
          "Miscellaneous Issue",
          "Disposal/Scrap",
          "Location Transfer",
          "Inventory Category Transfer Posting",
        ].includes(movementType)
      ) {
        console.log("🔍 Starting quantity aggregation for deduction movements");

        // Get all balance indices to process
        console.log("🔍 Raw balance_index:", allData.balance_index);
        console.log(
          "🔍 Balance_index length:",
          allData.balance_index?.length || 0
        );

        const balancesToProcess =
          allData.balance_index?.filter(
            (balance) => balance.sm_quantity && balance.sm_quantity > 0
          ) || [];

        console.log("📊 Balances to process:", balancesToProcess);
        console.log("📊 Balances to process length:", balancesToProcess.length);

        if (balancesToProcess.length === 0) {
          console.log("⚠️ No balances to process - skipping aggregation");
          return true;
        }

        // INTEGRATED: Serial Number Quantity Validation for Deduction
        // Group requested quantities by serial number for validation
        const serialRequestMap = new Map();

        for (const balance of balancesToProcess) {
          // Track serial number usage for validation
          if (balance.serial_number) {
            // For category transfer, validate against the source category (category_from)
            let categoryToValidate;
            if (movementType === "Inventory Category Transfer Posting") {
              categoryToValidate = balance.category_from || "Unrestricted";
            } else {
              categoryToValidate = balance.category || "Unrestricted";
            }

            const serialKey = `${balance.material_id}|${
              balance.serial_number
            }|${balance.location_id}|${categoryToValidate}|${
              balance.batch_id || ""
            }`;
            const requestedQty =
              balance.quantity_converted || balance.sm_quantity || 0;

            console.log(
              `📝 Processing serial request - Material: ${
                balance.material_id
              }, Serial: ${balance.serial_number}, Location: ${
                balance.location_id
              }, Category: ${categoryToValidate}, Requested: ${requestedQty}${
                movementType === "Inventory Category Transfer Posting"
                  ? ` (Transfer: ${balance.category_from} → ${balance.category_to})`
                  : ""
              }`
            );

            if (serialRequestMap.has(serialKey)) {
              const existingRequest = serialRequestMap.get(serialKey);
              existingRequest.totalRequestedQty += requestedQty;
              existingRequest.occurrences.push({
                itemIndex: balance.item_index || "Unknown",
                requestedQty: requestedQty,
                balance_id: balance.balance_id || balance.id,
                ...(movementType === "Inventory Category Transfer Posting" && {
                  categoryFrom: balance.category_from,
                  categoryTo: balance.category_to,
                }),
              });
            } else {
              serialRequestMap.set(serialKey, {
                materialId: balance.material_id,
                serialNumber: balance.serial_number,
                locationId: balance.location_id,
                category: categoryToValidate,
                batchId: balance.batch_id || null,
                totalRequestedQty: requestedQty,
                movementType: movementType,
                occurrences: [
                  {
                    itemIndex: balance.item_index || "Unknown",
                    requestedQty: requestedQty,
                    balance_id: balance.balance_id || balance.id,
                    ...(movementType ===
                      "Inventory Category Transfer Posting" && {
                      categoryFrom: balance.category_from,
                      categoryTo: balance.category_to,
                    }),
                  },
                ],
              });
            }
          }
        }

        // Create a map to track total requested quantities per location/material/category combination
        const locationQuantityMap = new Map();

        // Process all balance indices to aggregate quantities
        for (const balance of balancesToProcess) {
          // Create a unique key for each combination
          const materialId = balance.material_id || "";
          const locationId = balance.location_id || "";
          const batchId = balance.batch_id || "";

          // For category transfer, use category_from for validation
          let category;
          if (movementType === "Inventory Category Transfer Posting") {
            category = balance.category_from || "Unrestricted";
          } else {
            category = balance.category || "Unrestricted";
          }

          // Use a more reliable key format
          const key = `${materialId}|${locationId}|${category}|${batchId}`;
          const requestedQty =
            balance.quantity_converted || balance.sm_quantity || 0;

          console.log(
            `📝 Processing balance - Material: ${materialId}, Location: ${locationId}, Category: ${category}, Qty: ${requestedQty}${
              movementType === "Inventory Category Transfer Posting"
                ? ` (Source category for transfer)`
                : ""
            }`
          );

          if (locationQuantityMap.has(key)) {
            const existingQty = locationQuantityMap.get(key);
            const newTotal = existingQty + requestedQty;
            locationQuantityMap.set(key, newTotal);
            console.log(
              `📈 Updated aggregated quantity for ${key}: ${existingQty} + ${requestedQty} = ${newTotal}`
            );
          } else {
            locationQuantityMap.set(key, requestedQty);
            console.log(`📌 New entry for ${key}: ${requestedQty}`);
          }
        }

        console.log(
          "🗺️ Final locationQuantityMap:",
          Array.from(locationQuantityMap.entries())
        );

        // Now check each aggregated quantity against available balance
        for (const [key, totalRequestedQty] of locationQuantityMap.entries()) {
          console.log(
            `🔍 Checking aggregated quantity for key: ${key}, total requested: ${totalRequestedQty}`
          );

          const [materialId, locationId, category, batchId] = key.split("|");

          // Get material data
          const materialResponse = await this.db
            .collection("Item")
            .where({ id: materialId })
            .get();
          const materialData = materialResponse.data[0];

          if (!materialData) {
            throw new Error(`Material not found: ${materialId}`);
          }

          if (!materialData.based_uom) {
            throw new Error(`Base UOM is missing for item ${materialId}`);
          }

          // ✅ NEW LOGIC: Check if item is serialized
          const isSerializedItem = materialData.serial_number_management === 1;

          let currentQty = 0;

          if (isSerializedItem) {
            // ✅ For serialized items, check item_serial_balance
            console.log(
              `Checking serialized item balance for material: ${materialId}`
            );

            // INTEGRATED: Validate serial number quantities during balance checking
            console.log(
              "🔍 Validating serial number quantities for deduction movements..."
            );

            const serialValidationErrors = [];

            // For serialized items, we need to check each serial number in the balance_index
            const serialBalancesToCheck =
              allData.balance_index?.filter(
                (balance) =>
                  balance.sm_quantity &&
                  balance.sm_quantity > 0 &&
                  balance.material_id === materialId &&
                  balance.location_id === locationId
              ) || [];

            for (const balance of serialBalancesToCheck) {
              const serialBalanceParams = {
                material_id: materialId,
                serial_number: balance.serial_number,
                plant_id: allData.issuing_operation_faci,
                organization_id: allData.organization_id,
              };

              if (balance.batch_id && balance.batch_id !== "undefined") {
                serialBalanceParams.batch_id = balance.batch_id;
              }

              if (locationId) {
                serialBalanceParams.location_id = locationId;
              }

              const serialBalanceQuery = await this.db
                .collection("item_serial_balance")
                .where(serialBalanceParams)
                .get();

              if (
                !serialBalanceQuery.data ||
                serialBalanceQuery.data.length === 0
              ) {
                throw new Error(
                  `No existing serial balance found for item ${materialId}, serial ${balance.serial_number} at location ${locationId}`
                );
              }

              const serialBalance = serialBalanceQuery.data[0];
              const categoryField = this.categoryMap[category];
              const serialCategoryQty = parseFloat(
                serialBalance[categoryField] || 0
              );

              // For serialized items, each serial should have exactly the requested quantity
              const requestedQtyForThisSerial = balance.sm_quantity || 0;

              if (serialCategoryQty < requestedQtyForThisSerial) {
                let errorMessage;
                if (movementType === "Inventory Category Transfer Posting") {
                  errorMessage = `Insufficient quantity in source category "${category}" for serial ${
                    balance.serial_number
                  } of item ${
                    materialData.material_name || materialId
                  }. Available: ${serialCategoryQty}, Requested: ${requestedQtyForThisSerial} (Transfer: ${
                    balance.category_from
                  } → ${balance.category_to})`;
                } else {
                  errorMessage = `Insufficient quantity in ${category} for serial ${
                    balance.serial_number
                  } of item ${
                    materialData.material_name || materialId
                  }. Available: ${serialCategoryQty}, Requested: ${requestedQtyForThisSerial}`;
                }
                throw new Error(errorMessage);
              }

              // INTEGRATED: Check if this serial number is being used multiple times
              let validationCategory = category;
              let serialKey;

              if (movementType === "Inventory Category Transfer Posting") {
                validationCategory = balance.category_from || "Unrestricted";
                serialKey = `${materialId}|${
                  balance.serial_number
                }|${locationId}|${validationCategory}|${
                  balance.batch_id || ""
                }`;
              } else {
                serialKey = `${materialId}|${
                  balance.serial_number
                }|${locationId}|${category}|${balance.batch_id || ""}`;
              }

              const serialRequest = serialRequestMap.get(serialKey);

              if (
                serialRequest &&
                serialRequest.totalRequestedQty > serialCategoryQty
              ) {
                let itemDetails;
                let errorMessage;

                if (movementType === "Inventory Category Transfer Posting") {
                  itemDetails = serialRequest.occurrences
                    .map(
                      (occ) =>
                        `Item ${occ.itemIndex} (Qty: ${occ.requestedQty}, ${occ.categoryFrom} → ${occ.categoryTo})`
                    )
                    .join(", ");

                  errorMessage =
                    `Insufficient quantity for category transfer of serial number "${
                      serialRequest.serialNumber
                    }" of item "${
                      materialData.material_name || materialId
                    }".\n` +
                    `Available in source category "${validationCategory}": ${serialCategoryQty}\n` +
                    `Total Requested: ${serialRequest.totalRequestedQty}\n` +
                    `Used in: ${itemDetails}\n` +
                    `Each serial number can only be transferred once per transaction or until its quantity is exhausted.`;
                } else {
                  itemDetails = serialRequest.occurrences
                    .map(
                      (occ) =>
                        `Item ${occ.itemIndex} (Qty: ${occ.requestedQty})`
                    )
                    .join(", ");

                  errorMessage =
                    `Insufficient quantity for serial number "${
                      serialRequest.serialNumber
                    }" of item "${
                      materialData.material_name || materialId
                    }".\n` +
                    `Available: ${serialCategoryQty} in ${category} category\n` +
                    `Total Requested: ${serialRequest.totalRequestedQty}\n` +
                    `Used in: ${itemDetails}\n` +
                    `Each serial number can only be used once per transaction or until its quantity is exhausted.`;
                }

                serialValidationErrors.push(errorMessage);
              }
            }

            // Throw consolidated serial validation errors if any
            if (serialValidationErrors.length > 0) {
              const consolidatedError =
                "Serial number quantity validation failed:\n\n" +
                serialValidationErrors
                  .map((error, index) => `${index + 1}. ${error}`)
                  .join("\n\n");

              throw new Error(consolidatedError);
            }

            console.log(
              `✅ Sufficient serial inventory available for ${materialId}`
            );
          } else {
            // ✅ For non-serialized items, use existing logic
            const collectionName =
              materialData.item_batch_management == "1"
                ? "item_batch_balance"
                : "item_balance";

            console.log(
              `🔍 Querying ${collectionName} for material: ${materialId}, location: ${locationId}`
            );

            const balanceResponse = await this.db
              .collection(collectionName)
              .where({
                material_id: materialId,
                location_id: locationId,
                ...(collectionName === "item_batch_balance"
                  ? { batch_id: batchId || null }
                  : {}),
              })
              .get();

            const balanceData = balanceResponse.data[0];

            if (!balanceData) {
              throw new Error(
                `No existing balance found for item ${materialId} at location ${locationId}`
              );
            }

            const categoryField = this.categoryMap[category];
            currentQty = balanceData[categoryField] || 0;

            console.log(
              `📊 Current quantity in ${category}: ${currentQty}, Total requested: ${totalRequestedQty}`
            );

            // Check if total requested quantity exceeds available quantity
            if (currentQty < totalRequestedQty) {
              let errorMessage;
              if (movementType === "Inventory Category Transfer Posting") {
                errorMessage = `Insufficient quantity in source category "${category}" for item ${materialData.material_name}. Available: ${currentQty}, Total Requested: ${totalRequestedQty}`;
              } else {
                errorMessage = `Insufficient quantity in ${category} for item ${materialData.material_name}. Available: ${currentQty}, Total Requested: ${totalRequestedQty}`;
              }
              console.error(`❌ ${errorMessage}`);
              throw new Error(errorMessage);
            }

            console.log(
              `✅ Sufficient quantity available for ${materialId} at ${locationId}`
            );
          }

          // Step 6: Check costing records for deduction movements
          // Note: Category Transfer doesn't need costing validation as it's just moving between categories
          if (
            ["Miscellaneous Issue", "Disposal/Scrap"].includes(movementType)
          ) {
            const costingMethod = materialData.material_costing_method;
            if (!costingMethod) {
              throw new Error(
                `Costing method not defined for item ${materialId}`
              );
            }

            if (costingMethod === "Weighted Average") {
              // Find any balance with this material and location to get batch_id if needed
              const sampleBalance = balancesToProcess.find(
                (b) =>
                  b.material_id === materialId && b.location_id === locationId
              );

              const waQuery =
                materialData.item_batch_management == "1" &&
                sampleBalance?.batch_id
                  ? this.db.collection("wa_costing_method").where({
                      material_id: materialId,
                      batch_id: sampleBalance.batch_id,
                      plant_id: allData.issuing_operation_faci,
                    })
                  : this.db.collection("wa_costing_method").where({
                      material_id: materialId,
                      plant_id: allData.issuing_operation_faci,
                    });

              const waResponse = await waQuery.get();
              if (!waResponse.data || waResponse.data.length === 0) {
                throw new Error(
                  `No costing record found for deduction for item ${materialId} (Weighted Average)`
                );
              }

              const waData = waResponse.data[0];
              if ((waData.wa_quantity || 0) < totalRequestedQty) {
                throw new Error(
                  `Insufficient WA quantity for item ${materialId}. Available: ${waData.wa_quantity}, Total Requested: ${totalRequestedQty}`
                );
              }
            } else if (costingMethod === "First In First Out") {
              // Find any balance with this material and location to get batch_id if needed
              const sampleBalance = balancesToProcess.find(
                (b) =>
                  b.material_id === materialId && b.location_id === locationId
              );

              const fifoQuery =
                materialData.item_batch_management == "1" &&
                sampleBalance?.batch_id
                  ? this.db.collection("fifo_costing_history").where({
                      material_id: materialId,
                      batch_id: sampleBalance.batch_id,
                      plant_id: allData.issuing_operation_faci,
                    })
                  : this.db.collection("fifo_costing_history").where({
                      material_id: materialId,
                      plant_id: allData.issuing_operation_faci,
                    });

              const fifoResponse = await fifoQuery.get();
              if (!fifoResponse.data || fifoResponse.data.length === 0) {
                throw new Error(
                  `No costing record found for deduction for item ${materialId} (FIFO)`
                );
              }

              const fifoData = fifoResponse.data;
              const totalAvailable = fifoData.reduce(
                (sum, record) => sum + (record.fifo_available_quantity || 0),
                0
              );
              if (totalAvailable < totalRequestedQty) {
                throw new Error(
                  `Insufficient FIFO quantity for item ${materialId}. Available: ${totalAvailable}, Total Requested: ${totalRequestedQty}`
                );
              }
            }
          }
        }
      }

      // Step 7: Validate serial number allocation for Miscellaneous Receipt
      if (allData.movement_type === "Miscellaneous Receipt") {
        console.log(
          "🔍 Validating serial number allocation for serialized items..."
        );
        await this.validateSerialNumberAllocation(allData.stock_movement);
      }

      console.log("⭐ Validation successful - all checks passed");
      return true;
    } catch (error) {
      console.error("❌ Error in preCheckQuantitiesAndCosting:", error.message);
      console.error("Full error object:", error);
      throw error;
    }
  }

  async validateSerialNumberUniqueness(subformData) {
    const serialNumbersInCurrentTransaction = new Set();
    const duplicateSerials = [];
    const existingSerials = [];

    for (const [index, item] of subformData.entries()) {
      if (!item.serial_number_data) continue;

      let serialNumberData;
      try {
        serialNumberData = JSON.parse(item.serial_number_data);
      } catch (parseError) {
        console.error(
          `Error parsing serial number data for item ${item.item_selection}:`,
          parseError
        );
        continue;
      }

      const tableSerialNumber = serialNumberData.table_serial_number || [];

      // Check each serial number in this item
      for (const serialItem of tableSerialNumber) {
        const serialNumber = serialItem.system_serial_number;

        // Skip auto-generated placeholders as they will be generated uniquely
        if (serialNumber === "Auto generated serial number") {
          continue;
        }

        if (!serialNumber || serialNumber.trim() === "") {
          continue;
        }

        const trimmedSerial = serialNumber.trim();

        // Check for duplicates within the current transaction
        if (serialNumbersInCurrentTransaction.has(trimmedSerial)) {
          duplicateSerials.push({
            serialNumber: trimmedSerial,
            itemIndex: index + 1,
            itemName:
              item.item_name || item.item_selection || `Item ${index + 1}`,
          });
        } else {
          serialNumbersInCurrentTransaction.add(trimmedSerial);
        }

        // Check if serial number already exists in the database
        try {
          const existingSerialQuery = await this.db
            .collection("serial_number")
            .where({ system_serial_number: trimmedSerial })
            .get();

          if (existingSerialQuery.data && existingSerialQuery.data.length > 0) {
            const existingRecord = existingSerialQuery.data[0];
            existingSerials.push({
              serialNumber: trimmedSerial,
              itemIndex: index + 1,
              itemName:
                item.item_name || item.item_selection || `Item ${index + 1}`,
              existingMaterialId: existingRecord.material_id,
              existingTransactionNo: existingRecord.transaction_no,
            });
          }
        } catch (dbError) {
          console.error(
            `Error checking existing serial number ${trimmedSerial}:`,
            dbError
          );
          // Continue validation even if DB check fails
        }
      }
    }

    // Report duplicate serial numbers within current transaction
    if (duplicateSerials.length > 0) {
      const duplicateList = duplicateSerials
        .map(
          (dup) => `• Serial Number "${dup.serialNumber}" in ${dup.itemName}`
        )
        .join("\n");

      throw new Error(
        `Duplicate serial numbers found within this transaction:\n\n${duplicateList}\n\nEach serial number must be unique across all items in the transaction.`
      );
    }

    // Report serial numbers that already exist in database
    if (existingSerials.length > 0) {
      const existingList = existingSerials
        .map(
          (existing) =>
            `• Serial Number "${existing.serialNumber}" in ${existing.itemName}\n  (Already exists for Material ID: ${existing.existingMaterialId}, Transaction: ${existing.existingTransactionNo})`
        )
        .join("\n");

      throw new Error(
        `Serial numbers already exist in the system:\n\n${existingList}\n\nPlease use different serial numbers as each serial number must be globally unique.`
      );
    }

    return true;
  }

  async validateSerialNumberAllocation(subformData) {
    const serializedItemsNotAllocated = [];

    // First, check for serial number allocation
    for (const [index, item] of subformData.entries()) {
      if (item.is_serialized_item === 1 && item.is_serial_allocated !== 1) {
        let itemIdentifier =
          item.item_name ||
          item.item_code ||
          item.item_selection ||
          `Item at row ${index + 1}`;
        serializedItemsNotAllocated.push({
          index: index + 1,
          identifier: itemIdentifier,
          item_id: item.item_selection,
        });
      }
    }

    if (serializedItemsNotAllocated.length > 0) {
      const itemsList = serializedItemsNotAllocated
        .map((item) => `• Row ${item.index}: ${item.identifier}`)
        .join("\n");

      throw new Error(
        `Serial number allocation is required for the following serialized items:\n\n${itemsList}\n\nPlease allocate serial numbers for all serialized items before saving.`
      );
    }

    // Then, check for serial number uniqueness
    await this.validateSerialNumberUniqueness(subformData);

    return true;
  }
}

// Modified processFormData to use preCheckQuantitiesAndCosting
async function processFormData(db, formData, context, organizationId) {
  const adjuster = new StockAdjuster(db);
  let results;

  if (context) {
    adjuster.getParamsVariables = context.getParamsVariables.bind(context);
    adjuster.getVarGlobal = context.getVarGlobal.bind(context);
    //adjuster.getParamsVariables = this.getParamsVariables('page_status');
    adjuster.parentGenerateForm = context.parentGenerateForm;
    adjuster.runWorkflow = context.runWorkflow.bind(context); // Bind the original context
  }

  try {
    console.log("🔍 About to run validation checks");
    const isValid = await adjuster.preCheckQuantitiesAndCosting(
      formData,
      context
    );
    console.log("✅ Validation result:", isValid);

    if (isValid) {
      console.log("📝 Starting stock adjustment processing");
      results = await adjuster.processStockAdjustment(formData, organizationId);
      console.log("✓ Stock adjustment completed");

      // Create serial number records for serialized items (only for Miscellaneous Receipt)
      if (formData.movement_type === "Miscellaneous Receipt") {
        console.log(
          "📋 Creating serial number records after inventory processing"
        );
        await createSerialNumberRecord(formData);

        // Update the stock movement record with serial number records
        const stockMovementRecord = await db
          .collection("stock_movement")
          .where({
            stock_movement_no: formData.stock_movement_no,
            organization_id: organizationId,
          })
          .get();

        if (stockMovementRecord.data && stockMovementRecord.data.length > 0) {
          await db
            .collection("stock_movement")
            .doc(stockMovementRecord.data[0].id)
            .update({
              table_sn_records: formData.table_sn_records,
            });
          console.log(
            "✓ Updated stock movement record with serial number records"
          );
        }
      }
    }
    return results;
  } catch (error) {
    console.error("❌ Error in processFormData:", error.message);
    throw error;
  }
}

const processRow = async (item, organizationId) => {
  if (item.batch_id === "Auto-generated batch number") {
    const resBatchConfig = await db
      .collection("batch_level_config")
      .where({ organization_id: organizationId })
      .get();

    if (resBatchConfig && resBatchConfig.data.length > 0) {
      const batchConfigData = resBatchConfig.data[0];
      let batchDate = "";
      let dd,
        mm,
        yy = "";

      // Checking for related field
      switch (batchConfigData.batch_format) {
        case "Document Date":
          let issueDate = this.getValue("issue_date");

          if (!issueDate)
            throw new Error(
              "Issue Date is required for generating batch number."
            );

          console.log("issueDate", new Date(issueDate));

          issueDate = new Date(issueDate);

          dd = String(issueDate.getDate()).padStart(2, "0");
          mm = String(issueDate.getMonth() + 1).padStart(2, "0");
          yy = String(issueDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;

          console.log("batchDate", batchDate);
          break;

        case "Document Created Date":
          let createdDate = new Date().toISOString().split("T")[0];

          console.log("createdDate", createdDate);

          createdDate = new Date(createdDate);

          dd = String(createdDate.getDate()).padStart(2, "0");
          mm = String(createdDate.getMonth() + 1).padStart(2, "0");
          yy = String(createdDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;

          console.log("batchDate", batchDate);
          break;

        case "Manufacturing Date":
          let manufacturingDate = item.manufacturing_date;

          console.log("manufacturingDate", manufacturingDate);

          if (!manufacturingDate)
            throw new Error(
              "Manufacturing Date is required for generating batch number."
            );

          manufacturingDate = new Date(manufacturingDate);

          dd = String(manufacturingDate.getDate()).padStart(2, "0");
          mm = String(manufacturingDate.getMonth() + 1).padStart(2, "0");
          yy = String(manufacturingDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;

          console.log("batchDate", batchDate);
          break;

        case "Expired Date":
          let expiredDate = item.expired_date;

          console.log("expiredDate", expiredDate);

          if (!expiredDate)
            throw new Error(
              "Expired Date is required for generating batch number."
            );

          expiredDate = new Date(expiredDate);

          dd = String(expiredDate.getDate()).padStart(2, "0");
          mm = String(expiredDate.getMonth() + 1).padStart(2, "0");
          yy = String(expiredDate.getFullYear()).slice(-2);

          batchDate = dd + mm + yy;

          console.log("batchDate", batchDate);
          break;
      }

      let batchPrefix = batchConfigData.batch_prefix || "";
      if (batchPrefix) batchPrefix += "-";

      const generatedBatchNo =
        batchPrefix +
        batchDate +
        String(batchConfigData.batch_running_number).padStart(
          batchConfigData.batch_padding_zeroes,
          "0"
        );

      item.batch_id = generatedBatchNo;
      await db
        .collection("batch_level_config")
        .where({ id: batchConfigData.id })
        .update({
          batch_running_number: batchConfigData.batch_running_number + 1,
        });

      return item;
    }
  } else {
    return item;
  }
};

const findFieldMessage = (obj) => {
  // Base case: if current object has the structure we want
  if (obj && typeof obj === "object") {
    if (obj.field && obj.message) {
      return obj.message;
    }

    // Check array elements
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findFieldMessage(item);
        if (found) return found;
      }
    }

    // Check all object properties
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const found = findFieldMessage(obj[key]);
        if (found) return found;
      }
    }
  }
  return null;
};

const updateItemTransactionDate = async (entry) => {
  try {
    const tableSM = entry.stock_movement;

    const uniqueItemIds = [
      ...new Set(
        tableSM
          .filter((item) => item.item_selection)
          .map((item) => item.item_selection)
      ),
    ];

    const date = new Date().toISOString();
    for (const [index, item] of uniqueItemIds.entries()) {
      try {
        await db
          .collection("Item")
          .doc(item)
          .update({ last_transaction_date: date });
      } catch (error) {
        throw new Error(
          `Cannot update last transaction date for item #${index + 1}.`,
          error
        );
      }
    }
  } catch (error) {
    throw new Error(error);
  }
};

const fillbackHeaderFields = async (allData) => {
  try {
    for (const [index, smLineItem] of allData.stock_movement.entries()) {
      smLineItem.organization_id = allData.organization_id;
      smLineItem.issuing_plant = allData.issuing_operation_faci || null;
      smLineItem.receiving_plant = allData.receiving_operation_faci || null;
      smLineItem.line_index = index + 1;
    }
    return allData.stock_movement;
  } catch {
    throw new Error("Error processing Stock Movement.");
  }
};

const createSerialNumberRecord = async (entry) => {
  const serialNumberRecords = [];

  // Initialize table_sn_records if it doesn't exist
  if (!entry.table_sn_records) {
    entry.table_sn_records = [];
  }

  for (const [_index, item] of entry.stock_movement.entries()) {
    // Only process serialized items for Miscellaneous Receipt
    if (item.is_serialized_item !== 1) {
      console.log(
        `Skipping serial number record for non-serialized item ${item.item_selection}`
      );
      continue;
    }

    // Only process items with received quantity > 0
    if (parseFloat(item.received_quantity || 0) > 0) {
      const serialNumberRecord = {
        item_selection: item.item_selection,
        item_name: item.item_name,
        item_desc: item.item_desc,
        batch_id: item.batch_id,
        location_id: item.location_id,
        quantity_uom: item.quantity_uom,
        received_quantity: item.received_quantity,
        unit_price: item.unit_price,
        amount: item.amount,
        category: item.category,
      };

      // Add serial numbers for serialized items with line break formatting
      if (
        item.is_serialized_item === 1 &&
        item.generated_serial_numbers &&
        Array.isArray(item.generated_serial_numbers)
      ) {
        serialNumberRecord.serial_numbers =
          item.generated_serial_numbers.join("\n");
        console.log(
          `Using generated serial numbers for stock movement item ${item.item_selection}: ${serialNumberRecord.serial_numbers}`
        );
      }

      serialNumberRecords.push(serialNumberRecord);
    }
  }

  entry.table_sn_records = entry.table_sn_records.concat(serialNumberRecords);

  console.log(
    `Created ${serialNumberRecords.length} serial number records for stock movement`
  );
};

// Add this at the bottom of your Save as Completed button handler
const self = this;
const allData = self.getValues();
let organizationId = this.getVarGlobal("deptParentId");
if (organizationId === "0") {
  organizationId = this.getVarSystem("deptIds").split(",")[0];
}

const processStockMovements = async () => {
  try {
    const processedTableSM = [];
    for (const [index, item] of allData.stock_movement.entries()) {
      await self.validate(`stock_movement.${index}.batch_id`);

      const processedItem = await processRow(item, organizationId);
      processedTableSM.push(processedItem);
    }

    // Wait for all processRow calls to complete
    allData.stock_movement = processedTableSM;

    allData.stock_movement = await fillbackHeaderFields(allData);

    // Universal serial number validation for all movement types with serialized items
    const adjuster = new StockAdjuster(db);
    const hasSerializedItems = allData.stock_movement.some(
      (item) =>
        item.is_serialized_item === 1 ||
        (item.serial_number_data && item.serial_number_data.trim() !== "")
    );

    if (hasSerializedItems) {
      console.log(
        "Validating serial number uniqueness for serialized items..."
      );
      await adjuster.validateSerialNumberUniqueness(allData.stock_movement);
    }

    // Specific validation for Miscellaneous Receipt
    if (allData.movement_type === "Miscellaneous Receipt") {
      console.log(
        "Validating serial number allocation for Miscellaneous Receipt..."
      );
      await adjuster.validateSerialNumberAllocation(allData.stock_movement);
    }

    console.log("this.getVarGlobal", this.getVarGlobal("deptParentId"));
    self.showLoading();

    console.log("Starting processFormData with data:", JSON.stringify(allData));

    // Now processFormData will receive allData with resolved stock_movement array
    const results = await processFormData(db, allData, self, organizationId);
    console.log(
      "ProcessFormData completed successfully with results:",
      results
    );

    if (allData.page_status === "Add") {
      console.log("New stock movement created:", results);
      self.hideLoading();
      await updateItemTransactionDate(allData);
      self.$message.success("Stock movement created successfully");
      self.parentGenerateForm.$refs.SuPageDialogRef.hide();
      self.parentGenerateForm.refresh();
    } else if (allData.page_status === "Edit") {
      console.log("Stock movement updated:", results);
      self.hideLoading();
      await updateItemTransactionDate(allData);
      self.$message.success("Stock movement updated successfully");
      self.parentGenerateForm.$refs.SuPageDialogRef.hide();
      self.parentGenerateForm.refresh();
    }
  } catch (error) {
    self.hideLoading();

    let errorMessage = "";

    if (error && typeof error === "object") {
      if (error.message) {
        errorMessage = error.message;
      } else if (error.field) {
        errorMessage = error.field;
      } else {
        const foundMessage = findFieldMessage(error);
        errorMessage = foundMessage || "An error occurred";
      }
    } else if (typeof error === "string") {
      errorMessage = error;
    } else {
      errorMessage = "An unknown error occurred";
    }

    console.error("Full error object:", error);
    console.error("Extracted error message:", errorMessage);

    self.$message.error(errorMessage);
  }
};

// Function to process item_balance for both batched and non-batched items
const processItemBalance = async (
  db,
  item,
  itemBalanceParams,
  block_qty,
  reserved_qty,
  unrestricted_qty,
  qualityinsp_qty,
  intransit_qty,
  roundQty
) => {
  try {
    // Get current item balance records
    const balanceResponse = await db
      .collection("item_balance")
      .where(itemBalanceParams)
      .get();

    const hasExistingBalance =
      balanceResponse.data &&
      Array.isArray(balanceResponse.data) &&
      balanceResponse.data.length > 0;

    console.log(
      `Item ${
        item.material_id || item.item_id
      }: Found existing balance: ${hasExistingBalance}`
    );

    const existingDoc = hasExistingBalance ? balanceResponse.data[0] : null;

    let balance_quantity;

    if (existingDoc && existingDoc.id) {
      // Update existing balance
      console.log(
        `Updating existing balance for item ${
          item.material_id || item.item_id
        } at location ${item.location_id}`
      );

      const updatedBlockQty = roundQty(
        parseFloat(existingDoc.block_qty || 0) + block_qty
      );
      const updatedReservedQty = roundQty(
        parseFloat(existingDoc.reserved_qty || 0) + reserved_qty
      );
      const updatedUnrestrictedQty = roundQty(
        parseFloat(existingDoc.unrestricted_qty || 0) + unrestricted_qty
      );
      const updatedQualityInspQty = roundQty(
        parseFloat(existingDoc.qualityinsp_qty || 0) + qualityinsp_qty
      );
      const updatedIntransitQty = roundQty(
        parseFloat(existingDoc.intransit_qty || 0) + intransit_qty
      );

      balance_quantity =
        updatedBlockQty +
        updatedReservedQty +
        updatedUnrestrictedQty +
        updatedQualityInspQty +
        updatedIntransitQty;

      await db.collection("item_balance").doc(existingDoc.id).update({
        block_qty: updatedBlockQty,
        reserved_qty: updatedReservedQty,
        unrestricted_qty: updatedUnrestrictedQty,
        qualityinsp_qty: updatedQualityInspQty,
        intransit_qty: updatedIntransitQty,
        balance_quantity: balance_quantity,
      });

      console.log(
        `Updated balance for item ${
          item.material_id || item.item_id
        }: ${balance_quantity}`
      );
    } else {
      // Create new balance record
      console.log(
        `Creating new balance for item ${
          item.material_id || item.item_id
        } at location ${item.location_id}`
      );

      balance_quantity =
        block_qty +
        reserved_qty +
        unrestricted_qty +
        qualityinsp_qty +
        intransit_qty;

      const newBalanceData = {
        material_id: item.material_id || item.item_id,
        location_id: item.location_id,
        block_qty: block_qty,
        reserved_qty: reserved_qty,
        unrestricted_qty: unrestricted_qty,
        qualityinsp_qty: qualityinsp_qty,
        intransit_qty: intransit_qty,
        balance_quantity: balance_quantity,
        plant_id: itemBalanceParams.plant_id,
        organization_id: itemBalanceParams.organization_id,
      };

      await db.collection("item_balance").add(newBalanceData);
      console.log(
        `Created new balance for item ${
          item.material_id || item.item_id
        }: ${balance_quantity}`
      );
    }
  } catch (error) {
    console.error(
      `Error processing item_balance for item ${
        item.material_id || item.item_id
      }:`,
      error
    );
    throw error;
  }
};

// Function to calculate aggregated quantities for serialized items
const calculateAggregatedSerialQuantities = (item, baseQty, roundQty) => {
  try {
    // Parse serial number data if available
    if (!item.serial_number_data) {
      console.log(
        `No serial number data found for item ${
          item.material_id || item.item_id
        }`
      );
      return null;
    }

    let serialNumberData;
    try {
      serialNumberData = JSON.parse(item.serial_number_data);
    } catch (parseError) {
      console.error(
        `Error parsing serial number data for item ${
          item.material_id || item.item_id
        }:`,
        parseError
      );
      return null;
    }

    const tableSerialNumber = serialNumberData.table_serial_number || [];
    const serialQuantity = serialNumberData.serial_number_qty || 0;

    if (serialQuantity === 0 || tableSerialNumber.length === 0) {
      console.log(
        `No serial numbers to process for item ${
          item.material_id || item.item_id
        }`
      );
      return null;
    }

    // Calculate base quantity per serial number
    const baseQtyPerSerial = serialQuantity > 0 ? baseQty / serialQuantity : 0;

    // Initialize aggregated quantities
    let aggregated_block_qty = 0;
    let aggregated_reserved_qty = 0;
    let aggregated_unrestricted_qty = 0;
    let aggregated_qualityinsp_qty = 0;
    let aggregated_intransit_qty = 0;

    // Aggregate quantities based on inventory category
    // Since all serial numbers for an item typically have the same inventory category,
    // we can multiply the per-serial quantity by the total number of serial numbers
    if (item.inv_category === "Blocked") {
      aggregated_block_qty = baseQtyPerSerial * serialQuantity;
    } else if (item.inv_category === "Reserved") {
      aggregated_reserved_qty = baseQtyPerSerial * serialQuantity;
    } else if (item.inv_category === "Unrestricted") {
      aggregated_unrestricted_qty = baseQtyPerSerial * serialQuantity;
    } else if (item.inv_category === "Quality Inspection") {
      aggregated_qualityinsp_qty = baseQtyPerSerial * serialQuantity;
    } else if (item.inv_category === "In Transit") {
      aggregated_intransit_qty = baseQtyPerSerial * serialQuantity;
    } else {
      // Default to unrestricted if category not specified
      aggregated_unrestricted_qty = baseQtyPerSerial * serialQuantity;
    }

    console.log(
      `Aggregated serial quantities for item ${
        item.material_id || item.item_id
      }: ` +
        `Total serial count: ${serialQuantity}, ` +
        `Category: ${item.inv_category}, ` +
        `Per-serial qty: ${baseQtyPerSerial}, ` +
        `Total aggregated: ${
          aggregated_block_qty +
          aggregated_reserved_qty +
          aggregated_unrestricted_qty +
          aggregated_qualityinsp_qty +
          aggregated_intransit_qty
        }`
    );

    return {
      block_qty: roundQty(aggregated_block_qty),
      reserved_qty: roundQty(aggregated_reserved_qty),
      unrestricted_qty: roundQty(aggregated_unrestricted_qty),
      qualityinsp_qty: roundQty(aggregated_qualityinsp_qty),
      intransit_qty: roundQty(aggregated_intransit_qty),
      serial_count: serialQuantity,
    };
  } catch (error) {
    console.error(
      `Error calculating aggregated serial quantities for item ${
        item.material_id || item.item_id
      }:`,
      error
    );
    return null;
  }
};

// Call the async function
processStockMovements();
