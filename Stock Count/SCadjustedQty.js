(async () => {
  try {
    // adjusted_qty is the user-modified variance (can be different from variance_qty)
    const adjustedQty = arguments[0].value || 0;
    const rowIndex = arguments[0].rowIndex;
    const systemQty =
      this.getValue(`table_stock_count.${rowIndex}.system_qty`) || 0;

    // Calculate variance percentage based on the adjusted value
    // Note: variance_qty remains unchanged to show original variance
    let variancePercentage;
    if (systemQty === 0) {
      variancePercentage = adjustedQty !== 0 ? "100.00%" : "0.00%";
    } else {
      variancePercentage =
        (Math.abs(adjustedQty / systemQty) * 100).toFixed(2) + "%";
    }

    // Get current balance distribution data
    const balanceDistributionStr = this.getValue(
      `table_stock_count.${rowIndex}.balance_distribution`
    ) || "";

    // Calculate new balance distribution with adjusted variance
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

    const newBalanceDistribution = updateBalanceDistribution(
      balanceDistributionStr,
      adjustedQty
    );

    // Update variance_percentage and balance_distribution, keep variance_qty as original
    await this.setData({
      [`table_stock_count.${rowIndex}.variance_percentage`]: variancePercentage,
      [`table_stock_count.${rowIndex}.balance_distribution`]: newBalanceDistribution,
    });
  } catch (error) {
    console.error(error);
  }
})();
