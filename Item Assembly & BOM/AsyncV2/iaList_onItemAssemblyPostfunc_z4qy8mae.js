// Chunked reads with an explicit limit (the API clamps at IA_READ_MAX rows, as GDonMounted.js); a clamped read is read again
const IA_READ_CHUNK = 500;
const IA_READ_MAX = 5000;
const iaChunks = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
const iaUniq = (list) => [...new Set((list || []).filter((v) => v !== undefined && v !== null && v !== "").map(String))];

// rows of `collection` whose id is in `ids` (is_deleted 0), `fields` projected
const iaReadIds = async (collection, ids, fields) => {
  const rows = [];
  await Promise.all(
    iaChunks(iaUniq(ids), Math.min(IA_READ_CHUNK, IA_READ_MAX)).map(async (chunk) => {
      let left = chunk;
      while (left.length) {
        let got = [];
        try {
          let query = db.collection(collection);
          if (fields) query = query.field(fields);
          const res = await query
            .filter([
              {
                type: "branch",
                operator: "all",
                children: [
                  { prop: "id", operator: "in", value: left },
                  { prop: "is_deleted", operator: "equal", value: 0 },
                ],
              },
            ])
            .limit(left.length)
            .get();
          got = (res && res.data) || [];
        } catch (error) {
          console.error(`Error fetching ${collection}:`, error);
          return;
        }
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

// rows of `collection` whose `prop` is in `values`, with the other conditions
const iaReadMany = async (collection, prop, values, conditions) => {
  const rows = [];
  const read = async (chunk) => {
    let got = [];
    try {
      const res = await db
        .collection(collection)
        .filter([
          {
            type: "branch",
            operator: "all",
            children: [{ prop: prop, operator: "in", value: chunk }, ...conditions],
          },
        ])
        .limit(IA_READ_MAX)
        .get();
      got = (res && res.data) || [];
    } catch (error) {
      console.error(`Error fetching ${collection}:`, error);
      return;
    }
    if (got.length >= IA_READ_MAX && chunk.length > 1) {
      const half = Math.ceil(chunk.length / 2);
      await Promise.all([read(chunk.slice(0, half)), read(chunk.slice(half))]);
      return;
    }
    if (got.length >= IA_READ_MAX) console.error(`${collection}: more than ${IA_READ_MAX} rows for ${chunk[0]}; ${got.length} read`);
    rows.push(...got);
  };
  await Promise.all(iaChunks(iaUniq(values), IA_READ_CHUNK).map(read));
  return { data: rows };
};

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
