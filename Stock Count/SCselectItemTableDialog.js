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
  const selectItems = this.getComponent("dialog_select_stock.item_balance")
    ?.$refs.crud.tableSelect;

  console.log(
    "getComponent item",
    this.getComponent("dialog_select_stock.item_balance")?.$refs.crud
      .tableSelect
  );

  this.models["itemList"] = [];

  if (selectItems && selectItems.length > 0) {
    this.models["itemList"] = selectItems.map((item) => {
      return {
        item_id: item.material_id.id,
        item_code: item.material_id.material_code,
        material_desc: item.material_id.material_desc,
        item_category: item.material_id.item_category,
        balance_quantity: item.unrestricted_qty,
        location_id: item.location_id.id,
        uom_id: item.material_id.based_uom,
        table_uom_conversion: item.material_id.table_uom_conversion,
      };
    });

    await this.setData({ item_list: this.models["itemList"] });

    if (
      selectItems.some((item) => item.material_id?.item_batch_management == 1)
    ) {
      displayTab("batch_selection");

      setTimeout(() => {
        this.hide("dialog_select_stock.batch_balance");
        this.display("dialog_select_stock.batch_balance");
      }, 100);
    } else {
      this.triggerEvent("onClick_countStock");
    }
  }
})();
