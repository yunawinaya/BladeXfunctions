const createBalanceDistribution = (balanceData, variance = 0) => {
  const details = [];
  const totalQty = balanceData.balance_quantity || 0;

  // Build variance string if variance exists
  const varianceStr =
    variance !== 0
      ? variance >= 0
        ? ` (+${variance})`
        : ` (${variance})`
      : "";

  // Add each non-zero category with bullet points
  // Variance always affects Unrestricted
  if (balanceData.unrestricted_qty > 0 || variance !== 0) {
    details.push(
      `  • Unrestricted: ${balanceData.unrestricted_qty}${varianceStr}`
    );
  }
  if (balanceData.reserved_qty > 0) {
    details.push(`  • Reserved: ${balanceData.reserved_qty}`);
  }
  if (balanceData.block_qty > 0) {
    details.push(`  • Blocked: ${balanceData.block_qty}`);
  }
  if (balanceData.qualityinsp_qty > 0) {
    details.push(`  • Quality Inspection: ${balanceData.qualityinsp_qty}`);
  }
  if (balanceData.intransit_qty > 0) {
    details.push(`  • In Transit: ${balanceData.intransit_qty}`);
  }

  // Format with clear header and breakdown section
  return details.length > 0
    ? `TOTAL: ${totalQty}${varianceStr}\n\nBreakdown:\n${details.join("\n")}`
    : `TOTAL: ${totalQty}${varianceStr}`;
};

(async () => {
  try {
    this.showLoading("Syncing balance data...");
    const tableStockCount = this.getValue("table_stock_count");
    const plantId = this.getValue("plant_id");
    const organizationId = this.getValue("organization_id");

    if (!tableStockCount || tableStockCount.length === 0) {
      this.$message.warning("No items in stock count table to refresh");
      return;
    }

    // Separate items into batched and non-batched
    const batchedItems = [];
    const nonBatchedItems = [];

    tableStockCount.forEach((item, index) => {
      if (item.batch_id && item.batch_id !== null && item.batch_id !== "") {
        batchedItems.push({ ...item, index });
      } else {
        nonBatchedItems.push({ ...item, index });
      }
    });

    // Build filter for non-batched items (item_balance)
    let nonBatchedResults = [];
    if (nonBatchedItems.length > 0) {
      const nonBatchedFilters = nonBatchedItems.map((item) => ({
        type: "branch",
        operator: "all",
        children: [
          { prop: "material_id", operator: "equal", value: item.material_id },
          { prop: "location_id", operator: "equal", value: item.location_id },
          { prop: "plant_id", operator: "equal", value: plantId },
          { prop: "organization_id", operator: "equal", value: organizationId },
        ],
      }));

      const balanceQuery = await db
        .collection("item_balance")
        .filter([
          {
            type: "branch",
            operator: "any",
            children: nonBatchedFilters,
          },
        ])
        .get();

      nonBatchedResults = balanceQuery.data || [];
    }

    // Build filter for batched items (item_batch_balance)
    let batchedResults = [];
    if (batchedItems.length > 0) {
      const batchedFilters = batchedItems.map((item) => ({
        type: "branch",
        operator: "all",
        children: [
          { prop: "material_id", operator: "equal", value: item.material_id },
          { prop: "location_id", operator: "equal", value: item.location_id },
          { prop: "batch_id", operator: "equal", value: item.batch_id },
          { prop: "plant_id", operator: "equal", value: plantId },
          { prop: "organization_id", operator: "equal", value: organizationId },
        ],
      }));

      const batchBalanceQuery = await db
        .collection("item_batch_balance")
        .filter([
          {
            type: "branch",
            operator: "any",
            children: batchedFilters,
          },
        ])
        .get();

      batchedResults = batchBalanceQuery.data || [];
    }

    // Process results and build updates object
    const updates = {};
    let successCount = 0;
    let missingCount = 0;

    // Process non-batched items
    nonBatchedItems.forEach((item) => {
      const balanceData = nonBatchedResults.find(
        (b) =>
          b.material_id === item.material_id &&
          b.location_id === item.location_id &&
          b.plant_id === plantId
      );

      if (balanceData) {
        const systemQty = balanceData.balance_quantity || 0;
        const countQty = item.count_qty || 0;
        const varianceQty = countQty - systemQty;
        const adjustedQty = item.adjusted_qty || 0;
        const updatedVariance =
          varianceQty !== adjustedQty ? adjustedQty : varianceQty;
        const balanceDistribution = createBalanceDistribution(
          balanceData,
          updatedVariance
        );

        updates[`table_stock_count.${item.index}.system_qty`] = systemQty;
        updates[`table_stock_count.${item.index}.balance_distribution`] =
          balanceDistribution;
        updates[`table_stock_count.${item.index}.variance_qty`] = varianceQty;
        updates[`table_stock_count.${item.index}.adjusted_qty`] =
          updatedVariance;

        let variancePercentage;
        if (systemQty === 0) {
          variancePercentage = updatedVariance !== 0 ? "100.00%" : "0.00%";
        } else {
          variancePercentage =
            (Math.abs(updatedVariance / systemQty) * 100).toFixed(2) + "%";
        }
        updates[`table_stock_count.${item.index}.variance_percentage`] =
          variancePercentage;

        successCount++;
        console.log(
          `Updated item ${item.material_id}: system_qty=${systemQty}, variance=${varianceQty}`
        );
      } else {
        missingCount++;
        console.warn(
          `No balance data found for item ${item.material_id} at location ${item.location_id}`
        );
      }
    });

    // Process batched items
    batchedItems.forEach((item) => {
      const balanceData = batchedResults.find(
        (b) =>
          b.material_id === item.material_id &&
          b.location_id === item.location_id &&
          b.batch_id === item.batch_id &&
          b.plant_id === plantId
      );

      if (balanceData) {
        const systemQty = balanceData.balance_quantity || 0;
        const countQty = item.count_qty || 0;
        const varianceQty = countQty - systemQty;
        const adjustedQty = item.adjusted_qty || 0;
        const updatedVariance =
          varianceQty !== adjustedQty ? adjustedQty : varianceQty;
        const balanceDistribution = createBalanceDistribution(
          balanceData,
          updatedVariance
        );

        updates[`table_stock_count.${item.index}.system_qty`] = systemQty;
        updates[`table_stock_count.${item.index}.balance_distribution`] =
          balanceDistribution;
        updates[`table_stock_count.${item.index}.variance_qty`] = varianceQty;
        updates[`table_stock_count.${item.index}.adjusted_qty`] =
          updatedVariance;

        let variancePercentage;
        if (systemQty === 0) {
          variancePercentage = updatedVariance !== 0 ? "100.00%" : "0.00%";
        } else {
          variancePercentage =
            (Math.abs(updatedVariance / systemQty) * 100).toFixed(2) + "%";
        }
        updates[`table_stock_count.${item.index}.variance_percentage`] =
          variancePercentage;

        successCount++;
        console.log(
          `Updated batched item ${item.material_id}: system_qty=${systemQty}, variance=${varianceQty}`
        );
      } else {
        missingCount++;
        console.warn(
          `No balance data found for batched item ${item.material_id}, batch ${item.batch_id}`
        );
      }
    });

    // Apply all updates at once
    if (Object.keys(updates).length > 0) {
      await this.setData(updates);
    }

    this.hideLoading();
    // Show detailed success message
    const totalItems = tableStockCount.length;
    if (missingCount > 0) {
      this.$message.warning(
        `Synced ${successCount}/${totalItems} items (${missingCount} items not found in balance)`
      );
    } else {
      this.$message.success(`Synced balance data for ${successCount} items`);
    }
  } catch (error) {
    this.$message.error(`Error refreshing balance: ${error.message}`);
    console.error(error);
  }
})();
