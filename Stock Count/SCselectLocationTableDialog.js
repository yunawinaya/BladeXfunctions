const displayTab = (tabName) => {
  setTimeout(() => {
    // Try multiple selectors to find the tab
    let tab = document.querySelector(
      `.el-drawer[role="dialog"] .el-tabs__item.is-top#tab-${tabName}`
    );

    // If not found, try without the dialog context
    if (!tab) {
      tab = document.querySelector(`.el-tabs__item#tab-${tabName}`);
    }

    if (tab) {
      console.log(`Found tab: ${tabName}`, tab);

      // First, make the tab visible and enabled
      tab.style.display = "flex";
      tab.setAttribute("aria-disabled", "false");
      tab.setAttribute("tabindex", "0");
      tab.classList.remove("is-disabled");

      // Then trigger click to properly activate the tab
      setTimeout(() => {
        tab.click();
      }, 50);
    } else {
      console.error(
        `Tab ${tabName} not found. Available tabs:`,
        Array.from(document.querySelectorAll(".el-tabs__item")).map((t) => t.id)
      );
    }
  }, 50);
};

(async () => {
  const selectItems = this.getComponent("dialog_select_stock.location")?.$refs
    .crud.tableSelect;

  this.models["locationList"] = [];
  this.models["itemList"] = [];

  if (selectItems && selectItems.length > 0) {
    this.models["locationList"] = selectItems.map((item) => {
      return { id: item.id, name: item.location_code };
    });

    console.log("locationList", this.models["locationList"]);

    displayTab("item_selection");

    setTimeout(async () => {
      await this.hide([
        "dialog_select_stock.item_balance",
        "dialog_select_stock.batch_balance",
      ]);
      await this.display("dialog_select_stock.item_balance");
      setTimeout(() => {
        this.getComponent(
          "dialog_select_stock.item_balance"
        )?.$refs.crud.toggleAllSelection();
      }, 100);
    }, 100);
  }
})();
