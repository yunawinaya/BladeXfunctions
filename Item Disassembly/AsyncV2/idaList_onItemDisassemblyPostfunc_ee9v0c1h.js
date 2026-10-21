// Chunked id reads with an explicit limit (the API clamps a read at IDA_READ_MAX rows, as GDonMounted.js); a short answer is read
// again for the ids it left out; a failed read rejects
const IDA_READ_CHUNK = 500;
const IDA_READ_MAX = 5000;
const idaChunks = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const idaUniq = (list) => [...new Set((list || []).filter((v) => v !== undefined && v !== null && v !== "").map(String))];
// rows of `collection` whose id is in `ids` (is_deleted 0), `fields` projected
const idaReadIds = async (collection, ids, fields) => {
  const rows = [];
  await Promise.all(
    idaChunks(idaUniq(ids), Math.min(IDA_READ_CHUNK, IDA_READ_MAX)).map(async (chunk) => {
      let left = chunk;
      while (left.length) {
        let query = db.collection(collection).filter([
          {
            type: "branch",
            operator: "all",
            children: [
              { prop: "id", operator: "in", value: left },
              { prop: "is_deleted", operator: "equal", value: 0 },
            ],
          },
        ]);
        if (fields) query = query.field(fields);
        const res = await query.limit(left.length).get();
        const got = (res && res.data) || [];
        rows.push(...got);
        const seen = new Set(got.map((row) => String(row.id)));
        const missing = left.filter((id) => !seen.has(id));
        if (!got.length || missing.length === left.length) return;
        left = missing;
      }
    }),
  );
  return { data: rows };
};

const callPostItemDisassemblyWorkflow = async (selectedRecords, aiData) => {
  switch (aiData.acc_integration_type) {
    case "SQL Accounting V2":
    case "AutoCount Accounting V2":
      await Promise.all(
        selectedRecords.map(async (item) => {
          await db
            .collection("sm_item_disassembly")
            .doc(item.id)
            .update({ posted_status: "Pending Post" });
        }),
      );

      this.$message.success("Item Disassembly sent for posting.");
      this.refresh();
      this.hideLoading();
      await this.runWorkflow(
        "2013511169625042946",
        {
          agent_id: aiData.agent_id,
          task_type: "post_item_disassembly",
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
    this.showLoading("Posting Item Disassembly...");

    let selectedRecords;

    selectedRecords = this.getComponent(allListID)?.$refs.crud.tableSelect || [];

    console.log("selectedRecords", selectedRecords);

    // List rows carry dictionary fields as { dict_key }, not plain strings.
    const dictValue = (value) => value?.dict_key ?? value;
    const getPostedStatus = (item) => dictValue(item.posted_status);

    selectedRecords = selectedRecords.filter((item) => {
      if (dictValue(item.item_disassembly_status) !== "Completed") {
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
      idaReadIds(
        "sm_item_disassembly",
        selectedRecords.map((item) => item.id),
        "item_disassembly_status,posted_status",
      ),
    ]);
    const storedKey = (value) => String(dictValue(value) ?? "").trim();
    const stored = new Map((storedRes.data || []).map((row) => [String(row.id), row]));
    const postable = (item) => {
      const row = stored.get(String(item.id));
      return !!row && storedKey(row.item_disassembly_status) === "Completed" &&
        ["Unposted", "Failed Post", ""].indexOf(storedKey(row.posted_status)) >= 0;
    };
    const changed = selectedRecords.filter((item) => !postable(item));
    selectedRecords = selectedRecords.filter(postable);
    if (changed.length > 0) {
      const why = (item) => {
        const row = stored.get(String(item.id));
        return row ? [storedKey(row.item_disassembly_status) || "no status", storedKey(row.posted_status)].filter((x) => x).join(", ") : "no longer available";
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
      await callPostItemDisassemblyWorkflow(selectedRecords, aiData);
    }

    await this.getComponent(allListID)?.$refs.crud.clearSelection();
    this.refresh();
    this.hideLoading();
  } catch (error) {
    this.hideLoading();
    console.error(error);
    this.$message.error(error?.message || "Failed to post the Item Disassembly");
  }
})();
