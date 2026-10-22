// RES-01 (scratchpad/iasc/res01/RES01_PLAN.md): a Draft that reserves materials (its stored hold status, whatever the switch: review I4)
// gives them back (IA_HOLD RELEASE_ALL) before it is deleted
const RES_HOLD = "__IA_HOLD__"; // IA_HOLD
const resOn = /^[1-9][0-9]{0,19}$/.test(RES_HOLD);
(async () => {
  try {
    const row = arguments[0]?.row;
    if (!row || !row.id) {
      this.$message.error("No Item Assembly selected.");
      return;
    }

    const label = row.stock_movement_no || row.id;
    const status = row.item_assembly_status;

    // Once an assembly is completed the components have left stock and the
    // assembled item has been received; deleting the document would strand both.
    // A Processing one is being completed or reverted in the background.
    // RES-01 Cancel (user 10-22): Delete is for Draft and Cancelled IAs; a Created IA is cancelled first (Cancel releases its reservation)
    const UNDELETABLE = ["Completed", "Fully Posted", "Processing", "Created"];
    const whyNot = (st) => (st === "Created" ? `Item Assembly ${label} is Created: cancel it first (Cancel releases its reserved materials).`
      : `Item Assembly ${label} is ${st} and cannot be deleted.`);
    if (UNDELETABLE.includes(status)) {
      this.$message.error(whyNot(status));
      return;
    }

    // stock_movement_no is free text under the Manual Input serial rule, so it
    // cannot go into an HTML confirm unescaped.
    const escapeHtml = (value) =>
      String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    await this.$confirm(
      `Delete Item Assembly <strong>${escapeHtml(
        label
      )}</strong>?<br>This cannot be undone.`,
      "Item Assembly Deletion",
      {
        confirmButtonText: "Delete",
        cancelButtonText: "Cancel",
        type: "warning",
        dangerouslyUseHTMLString: true,
      }
    ).catch(() => {
      throw new Error("cancelled");
    });

    // The grid can be stale (a background job may hold it now): the stored status decides.
    const storedRes = await db
      .collection("sm_item_assembly")
      .where({ id: row.id, is_deleted: 0 })
      .field("item_assembly_status,material_hold_status,organization_id")
      .get();
    const stored = (storedRes && storedRes.data && storedRes.data[0]) || null;
    if (!stored || UNDELETABLE.includes(stored.item_assembly_status)) {
      this.$message.error(
        stored
          ? whyNot(stored.item_assembly_status)
          : `Item Assembly ${label} is no longer available.`
      );
      this.refresh();
      return;
    }

    await db
      .collection("sm_item_assembly")
      .doc(row.id)
      .update({ is_deleted: 1 });

    // held stock is never left behind: the header went first (IA_HOLD refuses a deleted IA, so no reservation can start for it any
    // more; review M4), then its holds are released - one still being made is waited for; refused -> the IA restored, nothing else deleted
    if (resOn && String(stored.material_hold_status || "") !== "") {
      const release = async () => {
        try {
          const res = await new Promise((resolve, reject) => {
            const p = this.runWorkflow(
              RES_HOLD,
              { ia_id: String(row.id), organization_id: String(stored.organization_id || ""), operation: "RELEASE_ALL", source: "LIST" },
              (r) => resolve(r),
              (e) => reject(e)
            );
            if (p && typeof p.then === "function") p.then(resolve, reject);
          });
          return (res && res.data) || null;
        } catch (e) {
          console.error("RES-01: releasing the reserved materials failed", e);
          return null;
        }
      };
      let answer = await release();
      for (let i = 0; i < 3 && answer && String(answer.code) === "409"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        answer = await release();
      }
      let held = "";
      try {
        held = String(JSON.parse(answer.result_json).status || "");
      } catch (e) {
        held = "";
      }
      if (!answer || String(answer.code) !== "200" || held !== "NONE") {
        await db.collection("sm_item_assembly").doc(row.id).update({ is_deleted: 0 });
        this.$message.error(
          `The materials reserved for Item Assembly ${label} could not be released, so it was not deleted.` + (answer && answer.message ? ` ${answer.message}` : "")
        );
        this.refresh();
        return;
      }
    }

    // Both subforms are real child tables; leaving them behind orphans them.
    const CHILD_TABLES = [
      "sm_item_assembly_tlm8ve69_sub",
      "sm_item_assembly_mw10kf66_sub",
    ];

    await Promise.all(
      CHILD_TABLES.map(async (table) => {
        const children = await db
          .collection(table)
          .where({ sm_item_assembly_id: row.id, is_deleted: 0 })
          .get()
          .catch(() => ({ data: [] }));

        await Promise.all(
          (children.data || []).map((child) =>
            db
              .collection(table)
              .doc(child.id)
              .update({ is_deleted: 1 })
              .catch((error) =>
                console.error(`Error deleting ${table} row:`, error)
              )
          )
        );
      })
    );

    this.refresh();
    this.$message.success(`Item Assembly ${label} deleted.`);
  } catch (error) {
    if (error?.message === "cancelled") return;
    console.error(error);
    this.$message.error(error?.message || "Failed to delete the Item Assembly");
  }
})();
