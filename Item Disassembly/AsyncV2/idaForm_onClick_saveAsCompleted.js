// ITEM_DISASSEMBLY_SAVE — the server-side save; see ItemDisassemblySaveWorkflow.json.
const IDA_SAVE_WORKFLOW_ID = "2107305535347552257";

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

// this.validate() rejects with { "<field path>": { message } } (or arrays of
// { field, message }). Return the first message string found at any depth.
const findFieldMessage = (obj) => {
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.message === "string" && obj.message) return obj.message;

  const children = Array.isArray(obj) ? obj : Object.values(obj);
  for (const child of children) {
    const found = findFieldMessage(child);
    if (found) return found;
  }
  return null;
};

// sm_item_balance is the Select Stock dialog: it is not saved with the document
// and onConfirm_Stock already checked its quantities, so the row rules it leaves
// registered must not block the save. Batch No keeps "required" only for the
// asterisk: whether it is filled in is checked by the save workflow, which also
// knows which items number their batches manually. Every other validation error
// still blocks the save.
const validateForSave = async () => {
  try {
    await this.validate();
  } catch (error) {
    if (!error || typeof error !== "object") throw error;

    const entries = Object.entries(error);
    const remainingErrors = entries.filter(
      ([field]) =>
        !field.startsWith("sm_item_balance.") &&
        !(field.startsWith("stock_movement.") && field.endsWith(".batch_number")),
    );

    if (remainingErrors.length === entries.length) throw error;
    if (remainingErrors.length > 0) {
      throw Object.fromEntries(remainingErrors);
    }
  }
};

// The BOM seeds the component table but does not bind it, so the two can legitimately
// differ by completion. This reports the difference once and never blocks the save.
// the BOM-variance dialog renders HTML: names go in escaped
const idaEscHtml = (value) =>
  String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const confirmBomVariance = async (data) => {
  if (!data.item_id) return true;

  let organizationId = this.getVarGlobal("deptParentId");
  if (organizationId === "0") {
    organizationId = this.getVarSystem("deptIds").split(",")[0];
  }

  const bomRes = await db
    .collection("bill_of_materials")
    .where({
      parent_material_code: data.item_id,
      organization_id: organizationId,
      is_deleted: 0,
      is_active: 1,
    })
    .get()
    .catch(() => ({ data: [] }));

  const boms = bomRes.data || [];
  if (boms.length === 0) return true;

  // Same selection rule as the explosion: default wins, otherwise highest V-number.
  const versionOf = (bom) => {
    const match = /^V(\d+)$/.exec(
      String(bom.parent_mat_bom_version || "").trim(),
    );
    return match ? parseInt(match[1], 10) : 0;
  };
  boms.sort((a, b) => {
    const byDefault =
      (b.parent_mat_is_default === 1 ? 1 : 0) -
      (a.parent_mat_is_default === 1 ? 1 : 0);
    return byDefault !== 0 ? byDefault : versionOf(b) - versionOf(a);
  });
  const bom = boms[0];

  const bomSubs = (bom.subform_sub_material || []).filter(
    (sub) => sub.bom_material_code && sub.consume_type !== "REF",
  );
  const bomItems = new Set(bomSubs.map((sub) => String(sub.bom_material_code)));

  const lines = data.stock_movement || [];
  const lineItems = new Set(lines.map((line) => String(line.item_selection)));

  const differences = [];

  lines.forEach((line) => {
    const label = idaEscHtml(line.item_name || line.item_selection);
    const allocated = parseFloat(line.total_quantity) || 0;
    const required = parseFloat(line.requested_qty) || 0;

    if (!bomItems.has(String(line.item_selection))) {
      differences.push(`Added: ${label} (${allocated})`);
    } else if (Math.abs(allocated - required) > 0.0005) {
      differences.push(`Changed: ${label} ${required} \u2192 ${allocated}`);
    }
  });

  bomSubs.forEach((sub) => {
    if (!lineItems.has(String(sub.bom_material_code))) {
      differences.push(
        `Removed: ${idaEscHtml(sub.sub_material_name || sub.bom_material_code)}`,
      );
    }
  });

  if (differences.length === 0) return true;

  return this.$confirm(
    `These components differ from BOM ${idaEscHtml(bom.parent_mat_bom_version)}:<br><br>` +
      differences.map((line) => `\u2022 ${line}`).join("<br>") +
      "<br><br>Complete the disassembly with these recovery components?",
    "Recovery Components Differ From The BOM",
    {
      confirmButtonText: "Complete",
      cancelButtonText: "Cancel",
      dangerouslyUseHTMLString: true,
      type: "warning",
    },
  ).then(
    () => true,
    () => false,
  );
};

(async () => {
  try {
    await validateForSave();

    const rawData = this.getValues();
    // sm_item_balance is the stock dialog's model, not a column on the table.
    const { sm_item_balance, ...data } = rawData;
    const pageStatus = data.page_status;

    if (!(await confirmBomVariance(data))) return;

    this.showLoading("Completing Item Disassembly...");

    let workflowResult;

    await this.runWorkflow(
      IDA_SAVE_WORKFLOW_ID,
      { allData: data, saveAs: "Completed", pageStatus },
      (res) => {
        workflowResult = res;
      },
      (err) => {
        workflowResult = err;
      },
    );

    if (!workflowResult || !workflowResult.data) {
      this.hideLoading();
      this.$message.error("No response from workflow");
      return;
    }

    const code = workflowResult.data.code;
    if (code && String(code) !== "200") {
      this.hideLoading();
      this.$message.error(
        workflowResult.data.message ||
          workflowResult.data.msg ||
          "Failed to complete the Item Disassembly",
      );
      return;
    }

    this.$message.success("Item Disassembly completed");
    closeDialog();
  } catch (error) {
    this.hideLoading();
    console.error(error);

    const errorMessage =
      error && typeof error === "object"
        ? findFieldMessage(error) || error.msg || "An error occurred"
        : error || "An error occurred";

    this.$message.error(errorMessage);
  }
})();
