// The accounting agent task queue shared by all V2 post functions.
const AGENT_TASK_WORKFLOW_ID = "2013511169625042946";

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

(async () => {
  try {
    const data = this.getValues();
    const stockMovementId = data.id;

    this.showLoading("Posting Item Assembly...");

    let organizationId = this.getVarGlobal("deptParentId");
    if (organizationId === "0") {
      organizationId = this.getVarSystem("deptIds").split(",")[0];
    }

    // The form can be stale (a background job may hold it now, or it was posted since): the stored status decides.
    const [resAI, storedRes] = await Promise.all([
      db
        .collection("accounting_integration")
        .where({ organization_id: organizationId })
        .get(),
      db
        .collection("sm_item_assembly")
        .where({ id: stockMovementId, is_deleted: 0 })
        .field("item_assembly_status,posted_status")
        .get(),
    ]);
    const dictKey = (v) => String((v && typeof v === "object" ? v.dict_key : v) || "").trim();
    const stored = (storedRes && storedRes.data && storedRes.data[0]) || null;
    const status = stored ? dictKey(stored.item_assembly_status) : "";
    const posted = stored ? dictKey(stored.posted_status) : "";
    if (status !== "Completed" || ["Unposted", "Failed Post", ""].indexOf(posted) < 0) {
      this.hideLoading();
      this.$message.error(
        stored
          ? `This Item Assembly cannot be posted (${[status || "no status", posted].filter((x) => x).join(", ")}).`
          : "This Item Assembly is no longer available."
      );
      return;
    }
    const aiData = resAI.data[0];

    switch (aiData.acc_integration_type) {
      case "SQL Accounting V2":
      case "AutoCount Accounting V2":
        await db
          .collection("sm_item_assembly")
          .doc(stockMovementId)
          .update({ posted_status: "Pending Post" });

        this.$message.success("Item Assembly sent for posting.");
        closeDialog();
        await this.runWorkflow(
          AGENT_TASK_WORKFLOW_ID,
          {
            agent_id: aiData.agent_id,
            task_type: "post_item_assembly",
            payload: [stockMovementId],
            priority: "0",
          },
          async (res) => {
            console.log("成功结果：", res);
          },
          (err) => {
            console.log("失败结果：", err);
          },
        );
        break;

      default:
        // No post handler for this integration type, so posted_status is left
        // alone rather than stranded at Pending Post.
        console.log(
          "No post handler for accounting integration type:",
          aiData.acc_integration_type,
        );
        closeDialog();
        break;
    }
  } catch (error) {
    closeDialog();
    this.$message.error(error);
  }
})();
