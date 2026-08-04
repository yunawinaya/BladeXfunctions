console.log("arguments[0]", arguments[0]);

if (arguments[0].$eventArgs[1].columnKey === "material_code") {
  this.openDialog("balance_dialog");
  this.setData({
    material_id: arguments[0].$eventArgs[0].material_id,
    "balance_dialog.balance_uom": "",
    "balance_dialog.batch_balance_uom": "",
  });

  setTimeout(async () => {
    const maxRetries = 10;
    const interval = 500;
    let component = null;

    // 1. Wait for component to be available
    for (let i = 0; i < maxRetries; i++) {
      component = await this.getComponent("balance_dialog.custom_9xise27n");
      if (component != null) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    if (!component) {
      console.warn("Component not ready after retries");
      return;
    }

    // 2. Wait for the component to be rendered in DOM
    let elementReady = false;
    for (let i = 0; i < maxRetries; i++) {
      const element = document.querySelector('[model-name="custom_9xise27n"]');
      if (element) {
        elementReady = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    if (!elementReady) {
      console.warn("Component element not found in DOM");
      return;
    }

    // 3. Wait for table to be rendered (either with data or empty state)
    let tableReady = false;
    for (let i = 0; i < maxRetries; i++) {
      const table = document.querySelector(
        '[model-name="custom_9xise27n"] .el-table__body-wrapper',
      );
      if (table) {
        // Check if table has rows or empty text
        const hasRows = table.querySelector(".el-table__row");
        const isEmpty = table.querySelector(".el-table__empty-text");
        if (hasRows || isEmpty) {
          tableReady = true;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    if (!tableReady) {
      console.warn("Table not ready after retries");
      // Still try to refresh even if table isn't fully ready
    }

    // 4. Additional wait for data to be loaded (optional)
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 5. Now call refreshChange
    try {
      component.refreshChange();
      console.log("Component refreshed successfully");
    } catch (error) {
      console.error("Error refreshing component:", error);
    }
  }, 200);
}
