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

