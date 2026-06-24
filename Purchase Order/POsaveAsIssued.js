const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

// Escape dynamic text before injecting into dangerouslyUseHTMLString dialogs.
const escapeHtml = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );

const saveWorkflow = async (data) => {
  await this.runWorkflow(
    "2069257894280118274",
    { allData: data },
    (res) => {
      this.$message.success(`${this.isEdit ? "Update" : "Add"} successfully`);
      closeDialog();
    },
    async (error) => {
      this.hideLoading();
      console.error(error);
      if (error.data?.code === 402) {
        // 402 - Existing draft GR/PI: delete then retry
        const proceed = await this.$confirm(
          `${escapeHtml(error.data.msg)}<br><br><strong>Do you wish to continue?</strong>`,
          `Existing draft records detected`,
          {
            confirmButtonText: "Proceed",
            cancelButtonText: "Cancel",
            type: "error",
            dangerouslyUseHTMLString: true,
          },
        )
          .then(() => true)
          .catch(() => false);

        if (!proceed) {
          // User cancelled — close quietly, not an error.
          this.hideLoading();
          return;
        }

        this.showLoading("Saving Purchase Orders...");
        await this.runWorkflow(
          "1998576990124572673",
          { po_id: data.id },
          async (res) => {
            await saveWorkflow(data);
          },
          (error) => {
            this.hideLoading();
            this.$message.error(error || error.toString());
            console.error(error);
          },
        );
      } else if (error.data?.code === 406) {
        // 406 - Internal trading auto-create SO skipped (item not linked in
        // Item Alias, or currency mismatch). Issue the PO without a linked SO,
        // or cancel. The dialog must live here (workflows cannot prompt).
        const proceed = await this.$confirm(
          `${escapeHtml(error.data.msg)}<br><br><strong>If you proceed, the purchase order will be issued but no Sales Order will be created or linked. Continue?</strong>`,
          `Auto-create Sales Order skipped`,
          {
            confirmButtonText: "Proceed",
            cancelButtonText: "Cancel",
            type: "warning",
            dangerouslyUseHTMLString: true,
          },
        )
          .then(() => true)
          .catch(() => false);

        if (!proceed) {
          // User cancelled — close quietly, not an error.
          this.hideLoading();
          return;
        }

        this.showLoading("Saving Purchase Orders...");
        data.auto_so_skip = true;
        await saveWorkflow(data);
      } else if (error.data?.code === 408) {
        // 408 - PO is eligible for internal trading. Ask whether to auto-create
        // the linked Sales Order. Yes -> create & link; No -> issue without SO.
        const createSO = await this.$confirm(
          `${escapeHtml(error.data.msg)}<br><br><strong>Do you want to auto-create the linked Sales Order now?</strong>`,
          `Internal Trading – Auto-create Sales Order`,
          {
            confirmButtonText: "Yes, create SO",
            cancelButtonText: "No, issue without SO",
            type: "info",
            dangerouslyUseHTMLString: true,
          },
        )
          .then(() => true)
          .catch(() => false);

        this.showLoading("Saving Purchase Orders...");
        if (createSO) {
          data.auto_so_confirmed = true;
        } else {
          data.auto_so_skip = true;
        }
        await saveWorkflow(data);
      } else if (error.data?.code === 407) {
        // 407 - PO was issued, but the linked Sales Order auto-creation failed.
        // Non-blocking: the PO is already saved; just inform the user.
        await this.$alert(
          `The purchase order was issued successfully, but the linked Sales Order could not be created automatically:<br><br>${escapeHtml(error.data.msg)}<br><br>Please create the Sales Order manually or contact your administrator.`,
          "Sales Order not created",
          {
            confirmButtonText: "OK",
            type: "warning",
            dangerouslyUseHTMLString: true,
          },
        );
        closeDialog();
      } else {
        this.$message.error(error.data?.msg || error.toString());
      }
    },
  );
};

(async () => {
  this.showLoading("Saving Purchase Orders...");
  const data = this.getValues();
  let entry = data;
  console.log("data", data);
  for (const [index, lineItem] of data.table_po.entries()) {
    await this.validate(`table_po.${index}.unit_price`);
  }

  entry.po_status = "Issued";

  const {
    draft_status,
    issued_status,
    processing_status,
    completed_status,
    cancelled_status,
    ...cleanData
  } = entry;

  await saveWorkflow(cleanData);
})();
