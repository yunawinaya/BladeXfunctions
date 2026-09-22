// ITEM_ASSEMBLY_SAVE — the server-side save; see ItemAssemblySaveWorkflow.json.
const IA_SAVE_WORKFLOW_ID = "2098335576774463489";

const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const findFieldMessage = (obj) => {
  if (obj && typeof obj === "object") {
    if (obj.field && obj.message) {
      return obj.message;
    }

    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findFieldMessage(item);
        if (found) return found;
      }
    }

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const found = findFieldMessage(obj[key]);
        if (found) return found;
      }
    }

    return obj.toString();
  }
  return null;
};

// The BOM seeds the component table but does not bind it, so the two can legitimately
// differ by completion. This reports the difference once and never blocks the save.
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
    const label = line.item_name || line.item_selection;
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
        `Removed: ${sub.sub_material_name || sub.bom_material_code}`,
      );
    }
  });

  if (differences.length === 0) return true;

  return this.$confirm(
    `These components differ from BOM ${bom.parent_mat_bom_version}:<br><br>` +
      differences.map((line) => `\u2022 ${line}`).join("<br>") +
      "<br><br>Complete the assembly with these components?",
    "Components Differ From The BOM",
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
    await this.validate();

    const rawData = this.getValues();
    // sm_item_balance is the stock dialog's model, not a column on the table.
    const { sm_item_balance, ...data } = rawData;
    const pageStatus = data.page_status;

    if (!(await confirmBomVariance(data))) return;

    this.showLoading("Completing Item Assembly...");

    let workflowResult;

    await this.runWorkflow(
      IA_SAVE_WORKFLOW_ID,
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
          "Failed to save the Item Assembly",
      );
      return;
    }

    this.$message.success("Item Assembly completed");
    this.hideLoading();
    closeDialog();
  } catch (error) {
    this.hideLoading();
    console.error(error);

    let errorMessage = "";
    if (error && typeof error === "object") {
      errorMessage = findFieldMessage(error) || "An error occurred";
      // findFieldMessage bottoms out at obj.toString(), which is the useless
      // "[object Object]" for a rejected response or a thrown validator.
      if (errorMessage === "[object Object]") {
        errorMessage =
          error.message ||
          error.msg ||
          JSON.stringify(error) ||
          "An error occurred";
      }
    } else {
      errorMessage = error;
    }

    this.$message.error(errorMessage);
  }
})();
