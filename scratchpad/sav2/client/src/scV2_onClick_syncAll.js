// onClick_syncAll - Stock Count form, Sync: re-read every line's balance and recompute its variance.
// 2,000-line counts: balances are read per 100 materials with an explicit limit (a read without .limit() may be capped by the
// server; a capped answer is re-read per material), matched by key, and written back as ONE table instead of ~10,000 row paths
// (each adjusted_qty path fired onAdjustedQtyChange). The values are the old per-row writes' after that handler ran.
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

// onAdjustedQtyChange's rewrite of balance_distribution (verbatim), which the old per-row adjusted_qty writes triggered
const updateBalanceDistribution = (currentDistribution, variance) => {
  if (!currentDistribution) {
    const varianceStr = variance >= 0 ? `(+${variance})` : `(${variance})`;
    return `TOTAL: ${variance}\n\nBreakdown:\n  • Unrestricted: ${varianceStr}`;
  }

  // Extract system values from the distribution string (original values without variance)
  const totalMatch = currentDistribution.match(/TOTAL:\s*([\d.]+)/);
  const unrestrictedMatch = currentDistribution.match(/Unrestricted:\s*([\d.]+)/);
  const reservedMatch = currentDistribution.match(/Reserved:\s*([\d.]+)/);
  const blockedMatch = currentDistribution.match(/Blocked:\s*([\d.]+)/);
  const qualityMatch = currentDistribution.match(/Quality Inspection:\s*([\d.]+)/);
  const transitMatch = currentDistribution.match(/In Transit:\s*([\d.]+)/);

  const systemTotal = totalMatch ? parseFloat(totalMatch[1]) : 0;
  const systemUnrestricted = unrestrictedMatch ? parseFloat(unrestrictedMatch[1]) : 0;
  const systemReserved = reservedMatch ? parseFloat(reservedMatch[1]) : 0;
  const systemBlocked = blockedMatch ? parseFloat(blockedMatch[1]) : 0;
  const systemQuality = qualityMatch ? parseFloat(qualityMatch[1]) : 0;
  const systemTransit = transitMatch ? parseFloat(transitMatch[1]) : 0;

  // Build distribution string with variance shown in parentheses
  const details = [];
  const varianceStr = variance >= 0 ? `(+${variance})` : `(${variance})`;

  if (systemUnrestricted > 0 || variance !== 0) {
    details.push(`  • Unrestricted: ${systemUnrestricted} ${varianceStr}`);
  }
  if (systemReserved > 0) {
    details.push(`  • Reserved: ${systemReserved}`);
  }
  if (systemBlocked > 0) {
    details.push(`  • Blocked: ${systemBlocked}`);
  }
  if (systemQuality > 0) {
    details.push(`  • Quality Inspection: ${systemQuality}`);
  }
  if (systemTransit > 0) {
    details.push(`  • In Transit: ${systemTransit}`);
  }

  return details.length > 0
    ? `TOTAL: ${systemTotal} ${varianceStr}\n\nBreakdown:\n${details.join('\n')}`
    : `TOTAL: ${systemTotal} ${varianceStr}`;
};

const SC_READ_CHUNK = 100;
const SC_READ_MAX = 5000;
const SC_BALANCE_FIELDS =
  "material_id,location_id,batch_id,plant_id,balance_quantity,unrestricted_qty,reserved_qty,block_qty,qualityinsp_qty,intransit_qty";

(async () => {
  try {
    this.showLoading("Syncing balance data...");
    const tableStockCount = this.getValue("table_stock_count");
    const plantId = this.getValue("plant_id");
    const organizationId = this.getValue("organization_id");

    if (!tableStockCount || tableStockCount.length === 0) {
      this.hideLoading();
      this.$message.warning("No items in stock count table to refresh");
      return;
    }

    const isBatched = (item) => item.batch_id && item.batch_id !== null && item.batch_id !== "";
    const keyOf = (row, batched) =>
      String(row.material_id) + "|" + String(row.location_id) + (batched ? "|" + String(row.batch_id) : "");

    // every balance row of the lines' materials at this plant, first row per key (the old .find kept the first match)
    const readBalances = async (collection, items, batched) => {
      const byKey = new Map();
      const ids = [...new Set(items.map((item) => String(item.material_id)))];
      const read = async (chunk) => {
        const res = await db
          .collection(collection)
          .filter([
            {
              type: "branch",
              operator: "all",
              children: [
                { prop: "material_id", operator: "in", value: chunk },
                { prop: "plant_id", operator: "equal", value: plantId },
                { prop: "organization_id", operator: "equal", value: organizationId },
                { prop: "is_deleted", operator: "equal", value: 0 },
              ],
            },
          ])
          .field(SC_BALANCE_FIELDS)
          .limit(SC_READ_MAX)
          .get();
        return (res && res.data) || [];
      };
      const chunks = [];
      for (let i = 0; i < ids.length; i += SC_READ_CHUNK) chunks.push(ids.slice(i, i + SC_READ_CHUNK));
      const found = await Promise.all(
        chunks.map(async (chunk) => {
          const rows = await read(chunk);
          return rows.length >= SC_READ_MAX ? (await Promise.all(chunk.map((id) => read([id])))).flat() : rows;
        }),
      );
      for (const rows of found) {
        for (const row of rows) {
          if (String(row.plant_id) !== String(plantId)) continue;
          const key = keyOf(row, batched);
          if (!byKey.has(key)) byKey.set(key, row);
        }
      }
      return byKey;
    };

    const batchedItems = tableStockCount.filter((item) => isBatched(item));
    const nonBatchedItems = tableStockCount.filter((item) => !isBatched(item));
    const [nonBatchedResults, batchedResults] = await Promise.all([
      nonBatchedItems.length > 0 ? readBalances("item_balance", nonBatchedItems, false) : new Map(),
      batchedItems.length > 0 ? readBalances("item_batch_balance", batchedItems, true) : new Map(),
    ]);

    let successCount = 0;
    let missingCount = 0;
    const rows = tableStockCount.map((item) => {
      const batched = isBatched(item);
      const balanceData = (batched ? batchedResults : nonBatchedResults).get(keyOf(item, batched));
      if (!balanceData) {
        missingCount++;
        return item;
      }
      const systemQty = balanceData.balance_quantity || 0;
      const countQty = item.count_qty || 0;
      const varianceQty = countQty - systemQty;
      const adjustedQty = item.adjusted_qty || 0;
      const updatedVariance =
        varianceQty !== adjustedQty ? adjustedQty : varianceQty;

      let variancePercentage;
      if (systemQty === 0) {
        variancePercentage = updatedVariance !== 0 ? "100.00%" : "0.00%";
      } else {
        variancePercentage =
          (Math.abs(updatedVariance / systemQty) * 100) + "%";
      }

      successCount++;
      return {
        ...item,
        system_qty: systemQty,
        balance_distribution: updateBalanceDistribution(
          createBalanceDistribution(balanceData, updatedVariance),
          updatedVariance || 0
        ),
        variance_qty: varianceQty,
        adjusted_qty: updatedVariance,
        variance_percentage: variancePercentage,
      };
    });

    // Apply all updates at once
    if (successCount > 0) {
      await this.setData({ table_stock_count: rows });
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
    this.hideLoading();
    this.$message.error(`Error refreshing balance: ${error.message}`);
    console.error(error);
  }
})();
