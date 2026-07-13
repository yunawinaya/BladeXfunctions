(async () => {
  try {
    const pickingAfter = await this.getValue("picking_after");

    if (pickingAfter === "Goods Delivery") {
      await this.display([
        "auto_trigger_to",
        "auto_completed_gd",
        "allow_full_picking",
      ]);
      this.disabled(["picking_required"], false);
    } else if (pickingAfter === "Sales Order") {
      await this.hide([
        "auto_trigger_to",
        "auto_completed_gd",
        "allow_full_picking",
      ]);
      await this.setData({
        auto_trigger_to: 0,
        auto_completed_gd: 0,
        picking_required: 1,
        allow_full_picking: 0,
      });
      this.disabled(["picking_required"], true);
    } else {
      await this.hide(["auto_trigger_to", "auto_completed_gd"]);
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
