const url = new URL(window.location.href);
const type = url.searchParams.get("type");
const id = url.searchParams.get("id");

if (type && id) {
  this.toView({
    title: type.charAt(0).toUpperCase() + type.slice(1),
    target: "1935556443668959233", //table id for picking
    targetType: "Table",
    mode: "drawer",
    ...(type === "view" ? { viewMode: "disabled" } : {}),
    type: type,
    data: {
      id: id,
    },
  });
}

(async () => {
  try {
    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    const pickingSetupResponse = await db
      .collection("picking_setup")
      .where({
        organization_id: organizationId,
        picking_required: 1,
      })
      .get();

    if (pickingSetupResponse.data.length > 0) {
      if (pickingSetupResponse.data[0].picking_after === "Goods Delivery") {
        this.display("custom_41s73hyl");
        this.hide("tabs_picking");
      } else if (pickingSetupResponse.data[0].picking_after === "Sales Order") {
        this.display("tabs_picking");
        this.hide("custom_41s73hyl");
      } else {
        this.display("tabs_picking");
        this.hide("custom_41s73hyl");
      }
    } else {
      this.hide("tabs_picking");
      this.display("custom_41s73hyl");
    }
  } catch (error) {
    console.error("Error in PPonMountedListPage:", error);
  }
})();
