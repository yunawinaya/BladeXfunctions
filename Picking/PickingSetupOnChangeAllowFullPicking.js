// Full Picking splits one delivery line across several Pickings: any picked
// quantity closes the line, and the leftover only becomes a new Picking because
// the confirm re-saves the GD and GDheadWorkflow's "IF Auto Create Picking"
// (if_9xhwui06) mints one. That gate also requires auto_trigger_to = 1, so with
// Full Picking on and Auto Trigger off the leftover is not picked up by anything
// and waits for a manual Convert to Picking on the desktop GD list page.
//
// Warned rather than forced: running the split by hand is a legitimate choice
// (it is where the assignee and grouping get decided), unlike the Loading Bay
// interlock, which prevents a state that strands stock.
(async () => {
  try {
    const allowFullPicking = arguments[0].value;

    if (allowFullPicking !== 1) return;

    const autoTriggerTo = await this.getValue("auto_trigger_to");

    if (autoTriggerTo !== 1) {
      this.$message.warning(
        "Full Picking is on but Auto Trigger To is off. A partly picked line closes immediately, and the remaining quantity will not become a new Picking until someone runs Convert to Picking on the Goods Delivery list. Turn on Auto Trigger To to have it created automatically.",
      );
    }
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
