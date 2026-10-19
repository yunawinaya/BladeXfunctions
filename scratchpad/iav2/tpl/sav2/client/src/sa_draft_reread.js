        // only a stored Draft is saved as Draft again (a Processing, Completed or Fully Posted one is not reopened)
        const storedRes = await db
          .collection("stock_adjustment")
          .where({ id: stockAdjustmentId })
          .field("stock_adjustment_status")
          .get();
        const stored = (storedRes && storedRes.data && storedRes.data[0]) || null;
        const storedStatus = (stored && stored.stock_adjustment_status) || "";
        if (storedStatus !== "Draft") {
          this.hideLoading();
          this.$message.error(
            `This Stock Adjustment is ${storedStatus || "no longer available"} and can't be saved as Draft.`,
          );
          return;
        }
