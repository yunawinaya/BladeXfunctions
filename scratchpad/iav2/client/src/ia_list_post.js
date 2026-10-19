/*@@IA_READS@@*/

const callPostItemAssemblyWorkflow = async (selectedRecords, aiData) => {
  switch (aiData.acc_integration_type) {
    case "SQL Accounting V2":
    case "AutoCount Accounting V2":
      await Promise.all(
        selectedRecords.map(async (item) => {
          await db
            .collection("sm_item_assembly")
            .doc(item.id)
            .update({ posted_status: "Pending Post" });
        }),
      );

      this.$message.success("Item assembly completed successfully.");
      this.refresh();
      this.hideLoading();
      await this.runWorkflow(
        "2013511169625042946",
        {
          agent_id: aiData.agent_id,
          task_type: "post_item_assembly",
          payload: selectedRecords.map((item) => item.id),
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
      console.log(
        "No post handler for accounting integration type:",
        aiData.acc_integration_type,
      );
      break;
  }
};

(async () => {
  try {
    const allListID = "custom_7rq6zmn4";
    const organizationID = this.getVarGlobal("firstLvDeptId");
    this.showLoading("Posting Item Assembly...");

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect;

    console.log("selectedRecords", selectedRecords);

    const getPostedStatus = (item) =>
      item.posted_status?.dict_key ?? item.posted_status;

    selectedRecords = selectedRecords.filter((item) => {
      if (item.item_assembly_status !== "Completed") {
        return false;
      }

      const postedStatus = getPostedStatus(item);
      return (
        postedStatus === "Unposted" ||
        postedStatus === "Failed Post" ||
        postedStatus === "" ||
        postedStatus === null ||
        postedStatus === undefined
      );
    });

    if (selectedRecords.length === 0) {
      this.hideLoading();
      await this.$alert(
        "No selected records are available for posting. Please select records with status 'Completed' and not yet posted.",
        "No Records to Post",
        {
          confirmButtonText: "OK",
          dangerouslyUseHTMLString: true,
          type: "warning",
        },
      );
      return;
    }

    // The grid can be stale (a background job may hold a row now, or it was posted since): the stored status decides.
    const [resAI, storedRes] = await Promise.all([
      db
        .collection("accounting_integration")
        .where({ organization_id: organizationID })
        .get(),
      iaReadIds(
        "sm_item_assembly",
        selectedRecords.map((item) => item.id),
        "item_assembly_status,posted_status",
      ),
    ]);
    const dictKey = (v) => String((v && typeof v === "object" ? v.dict_key : v) || "").trim();
    const stored = new Map((storedRes.data || []).map((row) => [String(row.id), row]));
    const postable = (item) => {
      const row = stored.get(String(item.id));
      return !!row && dictKey(row.item_assembly_status) === "Completed" && ["Unposted", "Failed Post", ""].indexOf(dictKey(row.posted_status)) >= 0;
    };
    const changed = selectedRecords.filter((item) => !postable(item));
    selectedRecords = selectedRecords.filter(postable);
    if (changed.length > 0) {
      const why = (item) => {
        const row = stored.get(String(item.id));
        return row ? [dictKey(row.item_assembly_status) || "no status", dictKey(row.posted_status)].filter((x) => x).join(", ") : "no longer available";
      };
      this.$message.warning(`Not posted, changed since the list loaded: ${changed.map((item) => `${item.stock_movement_no || item.id} (${why(item)})`).join("; ")}`);
    }
    if (selectedRecords.length === 0) {
      this.refresh();
      this.hideLoading();
      return;
    }

    if (resAI && resAI.data && resAI.data.length > 0) {
      const aiData = resAI.data[0];
      await callPostItemAssemblyWorkflow(selectedRecords, aiData);
    }

    await this.getComponent(allListID)?.$refs.crud.clearSelection();
    this.refresh();
    this.hideLoading();
  } catch (error) {
    console.error(error);
  }
})();
