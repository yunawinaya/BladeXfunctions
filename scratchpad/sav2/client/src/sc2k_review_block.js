  // 2,000-line counts: one write of the table and one disabled call per state, never one awaited call per line; Adjusted lines'
  // adjusted_qty is locked last, as the second per-line loop did
  setTimeout(async () => {
    const tableStockCount = (await this.getValue("table_stock_count")) || [];

    if (tableStockCount.some((item) => item.line_status === "Recounted")) {
      await this.setData({
        table_stock_count: tableStockCount.map((item) =>
          item.line_status === "Recounted" ? { ...item, review_status: "" } : item,
        ),
      });
    }

    if (scStatus === "In Progress") {
      const locked = [];
      const open = [];
      tableStockCount.forEach((item, index) => {
        const paths = item.line_status === "Pending" ? locked : open;
        paths.push(
          `table_stock_count.${index}.review_status`,
          `table_stock_count.${index}.adjusted_qty`,
          `table_stock_count.${index}.review_sub_button`,
        );
      });
      if (locked.length > 0) await this.disabled(locked, true);
      if (open.length > 0) await this.disabled(open, false);
    }

    const adjusted = [];
    tableStockCount.forEach((item, index) => {
      if (item.line_status === "Adjusted") {
        adjusted.push(`table_stock_count.${index}.adjusted_qty`);
      }
    });
    if (adjusted.length > 0) await this.disabled(adjusted, true);
  }, 100);
