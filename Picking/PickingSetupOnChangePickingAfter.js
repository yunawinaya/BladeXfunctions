(async () => {
  try {
    const pickingAfter = await this.getValue("picking_after");

    if (pickingAfter === "Goods Delivery") {
      await this.display([
        "auto_trigger_to",
        "auto_completed_gd",
        "allow_full_picking",
        "convert_gd_created",
      ]);
      this.disabled(["picking_required"], false);

      // display() above re-enables auto_completed_gd — re-apply the Loading Bay
      // lock so switching picking_after can't resurrect the invalid combination
      // (see PickingSetupOnChangeLoadingBay.js).
      if ((await this.getValue("is_loading_bay")) === 1) {
        await this.setData({ auto_completed_gd: 0 });
        this.disabled(["auto_completed_gd"], true);
      }
    } else if (pickingAfter === "Sales Order") {
      await this.hide([
        "auto_trigger_to",
        "auto_completed_gd",
        "allow_full_picking",
        "convert_gd_created",
      ]);
      await this.setData({
        auto_trigger_to: 0,
        auto_completed_gd: 0,
        picking_required: 1,
        allow_full_picking: 0,
        convert_gd_created: 0,
      });
      this.disabled(["picking_required"], true);
    } else {
      await this.hide(["auto_trigger_to", "auto_completed_gd"]);
      await this.display(["convert_gd_created"]);
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
