const hideTab = (tabName) => {
  setTimeout(() => {
    const tabSelector = `.el-drawer[role="dialog"] .el-tabs__item.is-top#tab-${tabName}[tabindex="-1"][aria-selected="false"]`;
    const tab = document.querySelector(tabSelector);

    if (tab) {
      tab.style.display = "none";
    } else {
      const fallbackTab = document.querySelector(
        `.el-drawer[role="dialog"] .el-tabs__item#tab-${tabName}`
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

      // Trigger click to properly activate the tab in Element UI
      tab.click();
    } else {
      console.log(`Tab ${tabName} not found`);
    }
  }, 100); // Increased timeout to allow dialog to render
};

const fetchAllLocations = async () => {
  const plantId = this.getValue("plant_id");
  const locations = await db
    .collection("item_balance")
    .where({ plant_id: plantId })
    .get();
  // passed unique location ids only
  const locationIds = [
    ...new Set(locations.data.map((location) => location.location_id)),
  ];

  let locationList = [];

  for (const locationId of locationIds) {
    const location = await db
      .collection("bin_location")
      .where({ id: locationId })
      .get();
    console.log("location", location.data[0]);
    locationList.push({
      id: location.data[0].id,
      name: location.data[0].bin_location_combine,
    });
  }

  return locationList;
};

(async () => {
  try {
    console.log("Opening stock count dialog");
    const data = this.getValues();

    if (data.count_type === "Location") {
      hideTab("item_selection");
      hideTab("batch_selection");
    } else {
      const locationList = await fetchAllLocations();
      console.log("locationList", locationList);
      this.models["locationList"] = locationList;
      selectTab("item_selection");
      hideTab("location_selection");
      hideTab("batch_selection");
      this.hide("dialog_select_stock.batch_balance");
    }

    await this.openDialog("dialog_select_stock");
  } catch (error) {
    console.error("Error opening stock count dialog:", error);
  }
})();
