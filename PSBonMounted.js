console.log("Starting unified plant stock balance synchronization...");

// Use Promise.all to fetch all necessary data in a single call
Promise.all([
  db.collection("Item").get(),
  db.collection("plant_stock_balance").get(),
  db.collection("item_batch_balance").get(),
  db.collection("item_balance").get(),
])
  .then(
    ([
      itemResponse,
      plantStockBalanceResponse,
      itemBatchBalanceResponse,
      itemBalanceResponse,
    ]) => {
      const items = itemResponse.data || [];
      const existingPlantStockBalances = plantStockBalanceResponse.data || [];
      const itemBatchBalances = itemBatchBalanceResponse.data || [];
      const itemBalances = itemBalanceResponse.data || [];

      console.log(
        `Found ${items.length} items, ${existingPlantStockBalances.length} plant stock balances, ` +
          `${itemBatchBalances.length} batch balances, ${itemBalances.length} item balances`
      );

      // Create a map to track existing plant stock balances by material_id
      const existingBalancesByMaterial = {};

      // First index existing balances by material_id only (ignoring plant_id for this step)
      existingPlantStockBalances.forEach((balance) => {
        const materialId = balance.material_id || balance.item_id;
        if (materialId) {
          if (!existingBalancesByMaterial[materialId]) {
            existingBalancesByMaterial[materialId] = [];
          }
          existingBalancesByMaterial[materialId].push(balance);
        }
      });

      // Identify items that need new plant_stock_balance records
      const itemsNeedingBalances = items.filter(
        (item) =>
          item.stock_control === 1 && !existingBalancesByMaterial[item.id]
      );

      console.log(
        `Found ${itemsNeedingBalances.length} items needing new plant_stock_balance records`
      );

      // Create basic balance records for items that need them
      const createBasicBalancesPromises = itemsNeedingBalances.map((item) => {
        return db.collection("plant_stock_balance").add({
          material_id: item.id,
          balance_quantity: 0,
          block_qty: 0,
          reserved_qty: 0,
          unrestricted_qty: 0,
          qualityinsp_qty: 0,
          intransit_qty: 0,
          created_at: new Date(),
        });
      });

      // Create an aggregation map for batch balances by material_id and plant_id
      const aggregatedQuantities = {};

      // Process all item_batch_balance records (aggregating by material_id and plant_id)
      itemBatchBalances.forEach((batchBalance) => {
        if (!batchBalance.material_id) {
          console.warn(
            "Skipping invalid batch balance record (missing material_id):",
            batchBalance
          );
          return;
        }

        // Use plant_id if available, otherwise use a default key
        const plantId = batchBalance.plant_id || "default_plant";
        const key = `${batchBalance.material_id}_${plantId}`;

        // Initialize if first time seeing this combination
        if (!aggregatedQuantities[key]) {
          aggregatedQuantities[key] = {
            material_id: batchBalance.material_id,
            plant_id: plantId,
            block_qty: 0,
            reserved_qty: 0,
            unrestricted_qty: 0,
            qualityinsp_qty: 0,
            intransit_qty: 0,
            balance_quantity: 0,
            organization_id: batchBalance.organization_id || "",
          };
        }

        // Add quantities
        const aggregate = aggregatedQuantities[key];
        aggregate.block_qty += parseFloat(batchBalance.block_qty || 0);
        aggregate.reserved_qty += parseFloat(batchBalance.reserved_qty || 0);
        aggregate.unrestricted_qty += parseFloat(
          batchBalance.unrestricted_qty || 0
        );
        aggregate.qualityinsp_qty += parseFloat(
          batchBalance.qualityinsp_qty || 0
        );
        aggregate.intransit_qty += parseFloat(batchBalance.intransit_qty || 0);
        // Update total balance
        aggregate.balance_quantity =
          aggregate.block_qty +
          aggregate.reserved_qty +
          aggregate.unrestricted_qty +
          aggregate.qualityinsp_qty +
          aggregate.intransit_qty;
      });

      // Process non-batch item_balance records
      itemBalances.forEach((itemBalance) => {
        if (!itemBalance.material_id) {
          console.warn(
            "Skipping invalid item balance record (missing material_id):",
            itemBalance
          );
          return;
        }

        // Use plant_id if available, otherwise use a default key
        const plantId = itemBalance.plant_id || "default_plant";
        const key = `${itemBalance.material_id}_${plantId}`;

        // Only add if not already present from batch records
        if (!aggregatedQuantities[key]) {
          aggregatedQuantities[key] = {
            material_id: itemBalance.material_id,
            plant_id: plantId,
            block_qty: parseFloat(itemBalance.block_qty || 0),
            reserved_qty: parseFloat(itemBalance.reserved_qty || 0),
            unrestricted_qty: parseFloat(itemBalance.unrestricted_qty || 0),
            qualityinsp_qty: parseFloat(itemBalance.qualityinsp_qty || 0),
            intransit_qty: parseFloat(itemBalance.intransit_qty || 0),
            balance_quantity: parseFloat(itemBalance.balance_quantity || 0),
            organization_id: itemBalance.organization_id || "",
          };
        }
      });

      // Convert aggregated quantities to array
      const aggregatedBalancesArray = Object.values(aggregatedQuantities);

      console.log(
        `Created ${aggregatedBalancesArray.length} aggregated balance records`
      );

      // Create a second pass to update materials with quantities, respecting the plant_id when present
      const updateQuantitiesPromises = aggregatedBalancesArray.map(
        (aggregatedBalance) => {
          // Try to find an exact match first (material_id + plant_id)
          let matchingPlantBalance = existingPlantStockBalances.find(
            (psb) =>
              psb.material_id === aggregatedBalance.material_id &&
              (psb.plant_id === aggregatedBalance.plant_id ||
                (!psb.plant_id &&
                  aggregatedBalance.plant_id === "default_plant"))
          );

          // If no exact match found and this is for the default plant, try to find any record with matching material_id
          if (
            !matchingPlantBalance &&
            aggregatedBalance.plant_id === "default_plant"
          ) {
            matchingPlantBalance = existingPlantStockBalances.find(
              (psb) => psb.material_id === aggregatedBalance.material_id
            );
          }

          if (matchingPlantBalance) {
            // Update existing record
            return db
              .collection("plant_stock_balance")
              .doc(matchingPlantBalance.id)
              .update({
                block_qty: aggregatedBalance.block_qty,
                reserved_qty: aggregatedBalance.reserved_qty,
                unrestricted_qty: aggregatedBalance.unrestricted_qty,
                qualityinsp_qty: aggregatedBalance.qualityinsp_qty,
                intransit_qty: aggregatedBalance.intransit_qty,
                balance_quantity: aggregatedBalance.balance_quantity,
                // Only add plant_id if it's a real value (not our default placeholder)
                ...(aggregatedBalance.plant_id !== "default_plant"
                  ? { plant_id: aggregatedBalance.plant_id }
                  : {}),
                updated_at: new Date(),
              });
          } else {
            // Create new record (this should be rare since we created basic records in step 1)
            return db.collection("plant_stock_balance").add({
              material_id: aggregatedBalance.material_id,
              // Only add plant_id if it's a real value (not our default placeholder)
              ...(aggregatedBalance.plant_id !== "default_plant"
                ? { plant_id: aggregatedBalance.plant_id }
                : {}),
              block_qty: aggregatedBalance.block_qty,
              reserved_qty: aggregatedBalance.reserved_qty,
              unrestricted_qty: aggregatedBalance.unrestricted_qty,
              qualityinsp_qty: aggregatedBalance.qualityinsp_qty,
              intransit_qty: aggregatedBalance.intransit_qty,
              balance_quantity: aggregatedBalance.balance_quantity,
              organization_id: aggregatedBalance.organization_id,
              created_at: new Date(),
            });
          }
        }
      );

      // Execute all promises (first create basic records, then update with quantities)
      return Promise.all(createBasicBalancesPromises)
        .then(() => {
          console.log(
            `Created ${createBasicBalancesPromises.length} basic balance records`
          );
          return Promise.all(updateQuantitiesPromises);
        })
        .then(() => {
          console.log(
            "Successfully updated all plant stock balance records with quantities"
          );
          this.refresh();
        })
        .catch((error) => {
          console.error("Error updating plant stock balance records:", error);
          this.refresh();
        });
    }
  )
  .catch((error) => {
    console.error("Error in plant stock balance synchronization:", error);
    this.refresh();
  });
