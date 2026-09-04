// Full Picking splits one delivery line across several Pickings: any picked
// quantity closes the line, and the leftover waits for a manual Convert to
// Picking on the desktop GD list page.
//
// Auto Trigger To does not change that, despite the name: GDheadWorkflow's
// "IF Auto Create Picking" (if_9xhwui06) requires isPicking to be null, and the
// confirm's GD re-save (PickingProcessWorkflow workflow_node_4c98bf8x) passes
// isPicking = "Yes", so a pick confirm never mints the follow-up.
//
// Warned rather than forced: running the split by hand is a legitimate choice
// (it is where the assignee and grouping get decided), unlike the Loading Bay
// interlock, which prevents a state that strands stock.
(async () => {
  try {
    const allowFullPicking = arguments[0].value;

    if (allowFullPicking !== 1) return;

    this.$message.warning(
      "Full Picking is on. A partly picked line closes immediately, and the remaining quantity only becomes a new Picking when someone runs Convert to Picking on the Goods Delivery list — it is never created automatically.",
    );
  } catch (error) {
    console.error(error);
    this.$message.error(error.message || "An error occurred");
  }
})();
