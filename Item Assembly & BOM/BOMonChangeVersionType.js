const { value } = arguments[0];
const pageStatus = this.getValue("page_status");

// On Edit the version is already loaded; only a new record starts blank.
if (pageStatus === "Add" || pageStatus === "Clone") {
  this.setData({ parent_mat_bom_version: "" });
}

this.disabled("parent_mat_bom_version", value !== -9999);
