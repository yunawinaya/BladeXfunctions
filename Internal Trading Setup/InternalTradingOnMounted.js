const showStatusHTML = async (status) => {
  switch (status) {
    case 1:
      this.display(["active_status"]);
      break;
    case 0:
      this.display(["inactive_status"]);
      break;
    default:
      break;
  }
};

(async () => {
  try {
    const activeStatus = await this.getValue("is_active");

    let pageStatus = "";

    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else throw new Error("Invalid page state");

    this.setData({ page_status: pageStatus });

    switch (pageStatus) {
      case "Add":
        this.display(["active_status"]);
        break;

      case "Edit":
        showStatusHTML(activeStatus);
        break;

      case "View":
        showStatusHTML(activeStatus);
        this.hide(["button_cancel", "button_save"]);
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
