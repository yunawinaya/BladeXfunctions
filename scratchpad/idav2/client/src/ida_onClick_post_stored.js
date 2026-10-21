    // The form can be stale (a background job may hold it now, or it was posted since): the stored status decides.
    const [resAI, storedRes] = await Promise.all([
      db
        .collection("accounting_integration")
        .where({ organization_id: organizationId })
        .get(),
      db
        .collection("sm_item_disassembly")
        .where({ id: stockMovementId, is_deleted: 0 })
        .field("item_disassembly_status,posted_status")
        .get(),
    ]);
    const dictKey = (v) => String((v && typeof v === "object" ? v.dict_key : v) || "").trim();
    const stored = (storedRes && storedRes.data && storedRes.data[0]) || null;
    const status = stored ? dictKey(stored.item_disassembly_status) : "";
    const posted = stored ? dictKey(stored.posted_status) : "";
    if (status !== "Completed" || ["Unposted", "Failed Post", ""].indexOf(posted) < 0) {
      this.hideLoading();
      this.$message.error(
        stored
          ? `This Item Disassembly cannot be posted (${[status || "no status", posted].filter((x) => x).join(", ")}).`
          : "This Item Disassembly is no longer available."
      );
      return;
    }
    const aiData = resAI.data[0];
