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
    const rowIndex = arguments[0].rowIndex;
    const plantId = this.getValue("plant_id");
    const organizationId = this.getValue("organization_id");
    const materialId = this.getValue(
      `table_stock_count.${rowIndex}.material_id`
    );
    const locationId = this.getValue(
      `table_stock_count.${rowIndex}.location_id`
    );
    const batchId = this.getValue(`table_stock_count.${rowIndex}.batch_id`);

    if (!materialId || !locationId) {
      this.$message.error("Material and location are required");
      return;
    }

    let balanceData;

    if (batchId && batchId !== null && batchId !== "") {
      // Fetch from item_batch_balance
      const batchBalanceQuery = await db
        .collection("item_batch_balance")
        .where({
          material_id: materialId,
          location_id: locationId,
          batch_id: batchId,
          plant_id: plantId,
          organization_id: organizationId,
        })
        .get();
      balanceData = batchBalanceQuery.data?.[0];
    } else {
      // Fetch from item_balance
      const balanceQuery = await db
        .collection("item_balance")
        .where({
          material_id: materialId,
          location_id: locationId,
          plant_id: plantId,
          organization_id: organizationId,
        })
        .get();
      balanceData = balanceQuery.data?.[0];
    }

    if (balanceData) {
      const systemQty = balanceData.balance_quantity || 0;
      const countQty =
        this.getValue(`table_stock_count.${rowIndex}.count_qty`) || 0;
      const varianceQty = countQty - systemQty;
      const adjustedQty =
        this.getValue(`table_stock_count.${rowIndex}.adjusted_qty`) || 0;
      const updatedVariance =
        varianceQty !== adjustedQty ? adjustedQty : varianceQty;
      const balanceDistribution = createBalanceDistribution(
        balanceData,
        updatedVariance
      );

      let variancePercentage;
      if (systemQty === 0) {
        variancePercentage = updatedVariance !== 0 ? "100.00%" : "0.00%";
      } else {
        variancePercentage =
          (Math.abs(updatedVariance / systemQty) * 100).toFixed(2) + "%";
      }

      await this.setData({
        [`table_stock_count.${rowIndex}.system_qty`]: systemQty,
        [`table_stock_count.${rowIndex}.balance_distribution`]:
          balanceDistribution,
        [`table_stock_count.${rowIndex}.variance_qty`]: varianceQty,
        [`table_stock_count.${rowIndex}.variance_percentage`]:
          variancePercentage,
      });

      console.log(
        `Synced item ${materialId}: system_qty=${systemQty}, variance=${varianceQty}`
      );
    } else {
      this.$message.error(
        `No balance data found for material ${materialId} at location ${locationId}${
          batchId ? `, batch ${batchId}` : ""
        }`
      );
    }
  } catch (error) {
    this.$message.error(`Error syncing balance: ${error.message}`);
    console.error(error);
  }
})();
