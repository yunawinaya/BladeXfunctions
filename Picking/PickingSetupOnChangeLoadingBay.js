// Loading Bay staging and Auto Complete GD are mutually exclusive.
//
// With is_loading_bay = 1 the picker moves stock into a staging bin, and the
// Reserved allocation has to follow it. That shuttle (detectBinHuMigrations in
// GDProcessTable_batchProcess) only runs on a "Created" save, so the GD MUST
// pass through Created. auto_completed_gd = 1 sends picking straight to a
// "Completed" GD save, the shuttle never fires, and the delivery then tries to
// take unrestricted stock from a bay bin that was never stocked.
(async () => {
  try {
    const isLoadingBay = arguments[0].value;

    if (isLoadingBay === 1) {
      await this.setData({ auto_completed_gd: 0 });
      this.disabled(["auto_completed_gd"], true);
      return;
    }

    // Only re-enable where the field is meaningful — picking_after
    // "Sales Order" keeps it hidden and forced to 0 on its own.
    const pickingAfter = await this.getValue("picking_after");
    if (pickingAfter === "Goods Delivery") {
      this.disabled(["auto_completed_gd"], false);
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
