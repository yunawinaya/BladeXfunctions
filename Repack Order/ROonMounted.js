const showStatusHTML = (status) => {
  switch (status) {
    case "Draft":
      this.display([
        "draft_status",
        "button_draft",
        "button_created",
        "button_completed",
      ]);
      break;
    case "Created":
      this.display(["created_status", "button_created", "button_completed"]);
      break;
    case "Completed":
      this.display(["completed_status"]);
      break;
    default:
      break;
  }
};

const setPlant = async (organizationId) => {
  try {
    const deptId = await this.getVarSystem("deptIds").split(",")[0];
    let plantId = "";

    if (deptId === organizationId) {
      plantId = "";
    } else {
      plantId = deptId;
      await this.disabled("plant_id", true);
    }

    await this.setData({
      organization_id: organizationId,
      plant_id: plantId,
    });
  } catch (error) {
    console.error("Error setting plant:", error);
  }
};

(async () => {
  let pageStatus = "";

  if (this.isAdd) pageStatus = "Add";
  else if (this.isEdit) pageStatus = "Edit";
  else if (this.isView) pageStatus = "View";
  else throw new Error("Invalid page state");

  this.setData({ page_status: pageStatus });

  console.log("pageStatus", pageStatus);

  const roStatus = (await this.getValue("repack_status")) || "Draft";
  const roType = await this.getValue("repack_type");

  switch (pageStatus) {
    case "Add":
      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }
      setPlant(organizationId);
      showStatusHTML(roStatus);
      break;
    case "Edit":
      await this.display(["table_repack"]);
      showStatusHTML(roStatus);
      break;
    case "View":
      await this.display(["table_repack"]);
      showStatusHTML(roStatus);
      break;
  }
})();

setTimeout(async () => {
  if (!this.isAdd) return;
  const maxRetries = 10;
  const interval = 500;
  for (let i = 0; i < maxRetries; i++) {
    const op = await this.onDropdownVisible("repack_no_type", true);
    if (op != null) break;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  function getDefaultItem(arr) {
    return arr?.find((item) => item?.item?.is_default === 1);
  }

  const optionsData = this.getOptionData("repack_no_type") || [];
  const data = getDefaultItem(optionsData);
  if (data) {
    this.setData({ repack_no_type: data.value });
  }
}, 500);
