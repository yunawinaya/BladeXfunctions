// Project — onMounted
//
// Master-data form setup. Follows the house pattern (see Bin Location/BLonMounted.js):
// resolve the page state, stamp organization_id on new records, and lock the form in
// View mode.
//
// Deliberately does NOT refetch the record on Edit/View/Clone. The platform already
// populates the form, so a db round trip here would be redundant — SQTonMounted.js
// reads existing values with this.getValue() for the same reason.

// Only the six visible fields. organization_id is hidden, so it needs no disabling.
const ALL_FIELDS = [
  "is_active",
  "project_code",
  "project_name",
  "project_cost",
  "project_value",
  "parent_project_id",
];

// Every module in this repo resolves the tenant the same way: the global dept
// parent, falling back to the first system dept when it is the root ("0").
const resolveOrganizationId = () => {
  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }
  return organizationId;
};

// A project cannot be its own parent. The Parent Project dropdown is unfiltered, so
// on Edit the record lists itself — if a self-reference was ever saved, drop it here
// rather than let the cycle persist.
const clearSelfParent = () => {
  const projectId = this.getValue("id");
  const parentId = this.getValue("parent_project_id");

  if (projectId && parentId && String(parentId) === String(projectId)) {
    this.setData({ parent_project_id: "" });
    this.$message.warning(
      "A project cannot be its own parent — Parent Project has been cleared."
    );
  }
};

(async () => {
  try {
    let pageStatus = "";

    if (this.isAdd) pageStatus = "Add";
    else if (this.isEdit) pageStatus = "Edit";
    else if (this.isView) pageStatus = "View";
    else if (this.isCopy) pageStatus = "Clone";
    else throw new Error("Invalid page state");

    switch (pageStatus) {
      case "Add":
        // is_active already defaults to 1 in the form definition, so it is not set
        // here. The two amount fields have no default — seed them so the decimal
        // columns receive 0 rather than null.
        this.setData({
          organization_id: resolveOrganizationId(),
          project_cost: 0,
          project_value: 0,
        });
        break;

      case "Clone":
        // project_code identifies the project — the Parent Project dropdown labels
        // its options by it — so a clone must not carry the source code over.
        this.setData({
          organization_id: resolveOrganizationId(),
          project_code: "",
        });
        break;

      case "Edit":
        // organization_id is deliberately left untouched. Restamping it here would
        // silently move an existing project to whichever tenant the current user
        // happens to be in.
        clearSelfParent();
        break;

      case "View":
        this.disabled(ALL_FIELDS, true);
        break;

      default:
        break;
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
