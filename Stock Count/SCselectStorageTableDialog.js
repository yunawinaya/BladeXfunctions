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
  const selectItems = this.getComponent("dialog_select_stock.storage_location")
    ?.$refs.crud.tableSelect;

  if (selectItems && selectItems.length > 0) {
    this.setData({
      "dialog_select_stock.storage_location_id": selectItems.map(
        (item) => item.id
      ),
    });

    console.log(this.getValue("dialog_select_stock.storage_location_id"));

    displayTab("location_selection");

    setTimeout(async () => {
      await this.hide(["dialog_select_stock.location"]);
      await this.display("dialog_select_stock.location");
    }, 100);

    setTimeout(() => {
      this.getComponent(
        "dialog_select_stock.location"
      )?.$refs.crud.toggleAllSelection();
    }, 1000);
  }
})();
