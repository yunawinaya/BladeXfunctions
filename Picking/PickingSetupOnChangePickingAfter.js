(async () => {
  try {
    const pickingAfter = await this.getValue("picking_after");

    if (pickingAfter === "Goods Delivery") {
      await this.display(["auto_trigger_to", "auto_completed_gd"]);
    } else if (pickingAfter === "Sales Order") {
      await this.hide(["auto_trigger_to", "auto_completed_gd"]);
      await this.setData({ auto_trigger_to: 0, auto_completed_gd: 0 });
    } else {
      await this.hide(["auto_trigger_to", "auto_completed_gd"]);
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
