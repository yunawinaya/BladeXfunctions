    // The grid can be stale (a background job may hold it now): the stored status decides.
    const storedRes = await db
      .collection("sm_item_disassembly")
      .where({ id: row.id, is_deleted: 0 })
      .field("item_disassembly_status")
      .get();
    const stored = (storedRes && storedRes.data && storedRes.data[0]) || null;
    const storedStatus = stored ? statusOf(stored.item_disassembly_status) : "";
    if (!stored || UNDELETABLE.includes(storedStatus)) {
      this.$message.error(
        stored
          ? `Item Disassembly ${label} is ${storedStatus} and cannot be deleted.`
          : `Item Disassembly ${label} is no longer available.`
      );
      this.refresh();
      return;
    }

