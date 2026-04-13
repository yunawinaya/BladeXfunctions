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
        console.log(`Tab ${tabName} not found`);
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
      tab.setAttribute("aria-disabled", "false");
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
    this.showLoading("Loading target handling units...");

    const rowIndex = arguments[0].rowIndex;
    const plantId = this.getValue("plant_id");
    const organizationId = this.getValue("organization_id");
    const repackType = this.getValue("repack_type");

    if (repackType === "Unload") {
      this.hideLoading();
      this.$message.error("Target Handling Unit is not applicable for Unload type");
      return;
    }

    if (!plantId || !organizationId) {
      this.hideLoading();
      this.$message.error("Please set plant and organization first");
      return;
    }

    const tableRepack = this.getValue("table_repack") || [];
    const currentRow = tableRepack[rowIndex] || {};

    let sourceHuId = null;
    if (currentRow.source_temp_data) {
      try {
        const parsed = JSON.parse(currentRow.source_temp_data);
        sourceHuId = parsed?.id || null;
      } catch (e) {
        console.error("Error parsing source_temp_data:", e);
      }
    }

    const responseHU = await db
      .collection("handling_unit")
      .where({
        plant_id: plantId,
        organization_id: organizationId,
        is_deleted: 0,
      })
      .get();

    const allHUs = (responseHU && responseHU.data) || [];
    const availableTargetHUs = allHUs.filter((hu) => hu.id !== sourceHuId);

    let previouslySelectedId = null;
    if (currentRow.target_temp_data) {
      try {
        const parsed = JSON.parse(currentRow.target_temp_data);
        previouslySelectedId = parsed?.id || null;
      } catch (e) {
        console.error("Error parsing target_temp_data:", e);
      }
    }

    const tableTargetHU = availableTargetHUs.map((hu, index) => ({
      ...hu,
      handling_unit_id: hu.id,
      line_index: index,
      select_hu: previouslySelectedId && hu.id === previouslySelectedId ? 1 : 0,
    }));

    selectTab("tab_target_hu");
    if (repackType === "Load") {
      hideTab("tab_source_hu");
    }

    await this.openDialog("dialog_repack");

    await this.setData({
      dialog_repack: {
        row_index: rowIndex,
        table_source_hu: [],
        table_items: [],
        table_target_hu: tableTargetHU,
      },
    });

    this.hideLoading();
  } catch (error) {
    this.hideLoading();
    this.$message.error("Error in ROopenTargetHUDialog: " + error.message);
    console.error("Error in ROopenTargetHUDialog:", error);
  }
})();
