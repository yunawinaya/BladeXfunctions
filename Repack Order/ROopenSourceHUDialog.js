const hideTab = (tabName) => {
  setTimeout(() => {
    const tabSelector = `.el-drawer[role="dialog"] .el-tabs__item.is-top#tab-${tabName}[tabindex="-1"][aria-selected="false"]`;
    const tab = document.querySelector(tabSelector);

    if (tab) {
      tab.style.display = "none";
    } else {
      const fallbackTab = document.querySelector(
        `.el-drawer[role="dialog"] .el-tabs__item#tab-${tabName}`,
      );
      if (fallbackTab) {
        fallbackTab.style.display = "none";
      } else {
        console.log("Completion tab not found");
      }
    }

    const inactiveTabSelector = `.el-drawer[role="dialog"] .el-tabs__item.is-top[tabindex="-1"]:not(#tab-${tabName})`;
    const inactiveTab = document.querySelector(inactiveTabSelector);
    if (inactiveTab) {
      inactiveTab.setAttribute("aria-disabled", "true");
      inactiveTab.classList.add("is-disabled");
    }
  }, 10);
};

const selectTab = (tabName) => {
  setTimeout(() => {
    const tabSelector = `.el-drawer[role="dialog"] .el-tabs__item.is-top#tab-${tabName}`;
    const tab = document.querySelector(tabSelector);

    if (tab) {
      tab.style.display = "flex";
      tab.setAttribute("aria-selected", "true");
      tab.setAttribute("tabindex", "0");
      tab.classList.remove("is-disabled");
      tab.classList.add("is-active");
      tab.click();
    } else {
      console.log(`Tab ${tabName} not found`);
    }
  }, 100);
};

(async () => {
  try {
    this.showLoading("Loading handling units...");

    const rowIndex = arguments[0].rowIndex;
    const plantId = this.getValue("plant_id");
    const organizationId = this.getValue("organization_id");
    const repackType = this.getValue("repack_type");

    if (repackType === "Load") {
      this.hideLoading();
      this.$message.error("Source Handling Unit is not applicable for Load type");
      return;
    }

    if (!plantId || !organizationId) {
      this.hideLoading();
      this.$message.error("Please set plant and organization first");
      return;
    }

    const tableRepack = this.getValue("table_repack") || [];
    const currentRow = tableRepack[rowIndex] || {};

    const responseHU = await db
      .collection("handling_unit")
      .where({
        plant_id: plantId,
        organization_id: organizationId,
        is_deleted: 0,
      })
      .get();

    const allHUs = (responseHU && responseHU.data) || [];

    const availableHUs = allHUs.filter(
      (hu) =>
        (parseFloat(hu.item_count) || 0) > 0 &&
        (parseFloat(hu.total_quantity) || 0) > 0,
    );

    let previouslySelectedId = null;
    if (currentRow.source_temp_data) {
      try {
        const parsed = JSON.parse(currentRow.source_temp_data);
        previouslySelectedId = parsed?.id || null;
      } catch (e) {
        console.error("Error parsing source_temp_data:", e);
      }
    }

    const tableSourceHU = availableHUs.map((hu, index) => ({
      ...hu,
      handling_unit_id: hu.id,
      line_index: index,
      select_hu: previouslySelectedId && hu.id === previouslySelectedId ? 1 : 0,
    }));

    selectTab("tab_source_hu");
    hideTab("tab_items");
    hideTab("tab_target_hu");

    await this.openDialog("dialog_repack");

    await this.setData({
      dialog_repack: {
        row_index: rowIndex,
        table_source_hu: tableSourceHU,
        table_items: [],
        table_target_hu: [],
      },
    });

    this.hideLoading();
  } catch (error) {
    this.hideLoading();
    this.$message.error("Error in ROopenSourceHUDialog: " + error.message);
    console.error("Error in ROopenSourceHUDialog:", error);
  }
})();
