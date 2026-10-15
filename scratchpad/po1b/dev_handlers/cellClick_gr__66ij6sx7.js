// function to view gr in list page
(async () => {
  if (arguments[0].$eventArgs[1].columnKey === "gr_no") {
    this.toView({
      target: "1901845517592285186",
      type: "view",
      mode: "dialog",
      viewMode: "disabled",
      title: "View",
      position: "rtl",
      data: { id: arguments[0].$eventArgs[0].id },
    });
  } else if (
    arguments[0].$eventArgs[1].columnKey === "supplier_name.supplier_code"
  ) {
    const roleID = this.getVarSystem("roleIds");
    const menuID = "1906702869311533057";
    const access = await db
      .collection("blade_role_menu")
      .where({
        role_id: roleID,
        menu_id: menuID,
      })
      .get();

    if (access.data.length > 0) {
      this.toView({
        target: "1901541078662762497",
        type: "view",
        mode: "dialog",
        viewMode: "disabled",
        title: "View",
        position: "rtl",
        data: { id: arguments[0].$eventArgs[0].supplier_name.id },
      });
    }
  }
})();