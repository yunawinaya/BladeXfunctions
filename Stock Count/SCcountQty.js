(async () => {
  try {
    const countQty = arguments[0].value;
    const rowIndex = arguments[0].rowIndex;
    const systemQty =
      this.getValue(`table_stock_count.${rowIndex}.system_qty`) || 0;

    let varianceQty = 0;
    if (
      countQty &&
      countQty !== null &&
      countQty !== undefined &&
      countQty !== ""
    ) {
      varianceQty = countQty - systemQty;
    }

    let variancePercentage;
    if (systemQty === 0) {
      variancePercentage = countQty > 0 ? "100.00%" : "0.00%";
    } else {
      variancePercentage =
        (Math.abs(varianceQty / systemQty) * 100).toFixed(2) + "%";
    }

    // Auto-lock: if count_qty is not empty/null, set is_counted = 1 (locked)
    // Otherwise, set is_counted = 0 (unlocked)
    const isCounted =
      countQty !== null && countQty !== undefined && countQty !== "" ? 1 : 0;

    // Get current statuses to determine line_status
    const reviewStatus = this.getValue(
      `table_stock_count.${rowIndex}.review_status`
    );
    const lineStatus = this.getValue(
      `table_stock_count.${rowIndex}.line_status`
    );

    // Determine new line_status based on is_counted value
    let newLineStatus = lineStatus;
    if (isCounted === 1) {
      // Locked (counted)
      if (reviewStatus !== "Stock Adjust" && lineStatus !== "Recount") {
        newLineStatus = "Counted";
      } else if (lineStatus === "Recount") {
        newLineStatus = "Recounted";
      }
    } else {
      // Unlocked (not counted)
      if (
        reviewStatus !== "Stock Adjust" &&
        lineStatus !== "Recount" &&
        lineStatus !== "Recounted"
      ) {
        newLineStatus = "Pending";
      } else if (lineStatus === "Recounted") {
        newLineStatus = "Recount";
      }
    }

    // Get current balance distribution data from balance_distribution field
    // Parse it to extract current quantities
    const balanceDistributionStr =
      this.getValue(`table_stock_count.${rowIndex}.balance_distribution`) || "";

    // Calculate new balance distribution with variance applied to Unrestricted
    const updateBalanceDistribution = (currentDistribution, variance) => {
      if (!currentDistribution) {
        const varianceStr = variance >= 0 ? `(+${variance})` : `(${variance})`;
        return `TOTAL: ${variance}\n\nBreakdown:\n  • Unrestricted: ${varianceStr}`;
      }

      // Extract system values from the distribution string (original values without variance)
      const totalMatch = currentDistribution.match(/TOTAL:\s*([\d.]+)/);
      const unrestrictedMatch = currentDistribution.match(
        /Unrestricted:\s*([\d.]+)/
      );
      const reservedMatch = currentDistribution.match(/Reserved:\s*([\d.]+)/);
      const blockedMatch = currentDistribution.match(/Blocked:\s*([\d.]+)/);
      const qualityMatch = currentDistribution.match(
        /Quality Inspection:\s*([\d.]+)/
      );
      const transitMatch = currentDistribution.match(/In Transit:\s*([\d.]+)/);

      const systemTotal = totalMatch ? parseFloat(totalMatch[1]) : 0;
      const systemUnrestricted = unrestrictedMatch
        ? parseFloat(unrestrictedMatch[1])
        : 0;
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
        ? `TOTAL: ${systemTotal} ${varianceStr}\n\nBreakdown:\n${details.join(
            "\n"
          )}`
        : `TOTAL: ${systemTotal} ${varianceStr}`;
    };

    const newBalanceDistribution = updateBalanceDistribution(
      balanceDistributionStr,
      varianceQty
    );

    await this.setData({
      [`table_stock_count.${rowIndex}.variance_qty`]: varianceQty,
      [`table_stock_count.${rowIndex}.variance_percentage`]: variancePercentage,
      [`table_stock_count.${rowIndex}.is_counted`]: isCounted,
      [`table_stock_count.${rowIndex}.adjusted_qty`]: varianceQty,
      [`table_stock_count.${rowIndex}.line_status`]: newLineStatus,
      [`table_stock_count.${rowIndex}.balance_distribution`]:
        newBalanceDistribution,
    });
  } catch (error) {
    console.error(error);
  }
})();
