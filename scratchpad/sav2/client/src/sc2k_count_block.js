  // 2,000-line counts: one write of the table and one disabled call, never one awaited call per line
  setTimeout(async () => {
    let rows = null;
    if (scStatus === "In Progress") {
      const tableStockCount = (await this.getValue("table_stock_count")) || [];

      this.models["approvedItems"] = tableStockCount.filter(
        (item) =>
          item.line_status === "Approved" || item.line_status === "Adjusted",
      );

      rows = tableStockCount.filter(
        (item) =>
          item.line_status !== "Approved" && item.line_status !== "Adjusted",
      );
    }

    if (reviewStatus === "Recount") {
      this.display(["recount_status"]);
      this.hide(["processing_status"]);

      // unlock Recount
      const source = rows || (await this.getValue("table_stock_count")) || [];
      if (rows || source.some((item) => item.line_status === "Recount")) {
        rows = source.map((item) =>
          item.line_status === "Recount" ? { ...item, is_counted: 0 } : item,
        );
      }
    }

    if (rows) {
      await this.setData({
        table_stock_count: rows,
      });
      if (scStatus === "In Progress" && rows.length > 0) {
        await this.disabled(
          rows.map((item, index) => `table_stock_count.${index}.count_qty`),
          false,
        );
      }
    }
  }, 100);
