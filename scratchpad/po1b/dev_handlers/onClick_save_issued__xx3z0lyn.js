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

const findFieldMessage = (obj) => {
  // Base case: if current object has the structure we want
  if (obj && typeof obj === "object") {
    // Check for the specific error structure: { "table_so.1dz9gq2q.so_item_price": { "message": "..." } }
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key];
        // If value has a message property, return it
        if (value && typeof value === "object" && value.message) {
          return value.message;
        }
        // Recursively search
        const found = findFieldMessage(value);
        if (found) return found;
      }
    }
  }
  return null;
};
// The save payload without what PO_SAVE never reads: each line's copies of the item's UOM table (alt_uom is kept as one
// JSON layer with the four keys Goods Receiving reads - it gained a layer on every form load - and table_uom_conversion
// is dropped), the header fields Fillback copies onto every line itself, and the status banners. Built once; the
// workflow's prompts re-send this same object.
const poSlimPayload = (values) => {
  const dropHeader = ["draft_status", "issued_status", "processing_status", "completed_status", "cancelled_status"];
  const dropLine = ["table_uom_conversion", "supplier_id", "plant_id", "payment_term_id", "shipping_preference_id", "billing_state_id",
    "billing_country_id", "shipping_state_id", "shipping_country_id", "organization_id", "po_created_by"];
  const altUom = (v) => {
    if (v === undefined || v === null || v === "") return v;
    try {
      let x = v;
      for (let i = 0; i < 64 && typeof x === "string"; i++) x = JSON.parse(x);
      const keep = (c) => (c && typeof c === "object" ? { alt_uom_id: c.alt_uom_id, alt_qty: c.alt_qty, base_qty: c.base_qty, base_uom_id: c.base_uom_id } : c);
      return JSON.stringify(Array.isArray(x) ? x.map(keep) : keep(x));
    } catch (e) {
      return v;
    }
  };
  const slimLine = (row) => {
    const out = {};
    for (const k of Object.keys(row || {})) if (!dropLine.includes(k)) out[k] = row[k];
    if ("alt_uom" in out) out.alt_uom = altUom(out.alt_uom);
    if (Array.isArray(row && row.children)) out.children = row.children.map(slimLine);
    return out;
  };
  const out = {};
  for (const k of Object.keys(values || {})) if (!dropHeader.includes(k)) out[k] = values[k];
  out.table_po = Array.isArray(values && values.table_po) ? values.table_po.map(slimLine) : values && values.table_po;
  return out;
};

const saveWorkflow = async (data) => {
  await this.runWorkflow(
    "2069257894280118274",
    { allData: data },
    async (res) => {
      // The pre-save gate returns code 200 with { so_confirm, msg } when it needs
      // a user decision — so it does NOT trigger the platform's error toast.
      const out = (res && res.data && res.data.data) || (res && res.data) || {};
      const soConfirm = Number(out.so_confirm);

      if (Number(out.pi_confirm) === 405) {
        // 405 - Direct Invoice PO with a 0 total: confirm before its PI is created.
        this.hideLoading();
        const proceed = await this.$confirm(
          `${escapeHtml(out.msg)}`,
          `0 total amount detected`,
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
          this.hideLoading();
          return;
        }
        this.showLoading("Saving Purchase Orders...");
        data.create_pi = "Yes";
        await saveWorkflow(data);
        return;
      }

      if (soConfirm === 406) {
        // Not eligible (item not in Item Alias / currency mismatch).
        this.hideLoading();
        const proceed = await this.$confirm(
          `${escapeHtml(out.msg)}<br><br><strong>If you proceed, the purchase order will be issued but no Sales Order will be created or linked. Continue?</strong>`,
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
          this.hideLoading();
          return;
        }
        this.showLoading("Saving Purchase Orders...");
        data.auto_so_skip = true;
        await saveWorkflow(data);
        return;
      }

      if (soConfirm === 408) {
        // Eligible — ask whether to auto-create the linked Sales Order.
        this.hideLoading();
        const createSO = await this.$confirm(
          `${escapeHtml(out.msg)}<br><br><strong>Do you want to auto-create the linked Sales Order now?</strong>`,
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
        return;
      }

      if (soConfirm === 409) {
        // Linked PO no longer eligible — confirm unlinking the SO.
        this.hideLoading();
        const proceed = await this.$confirm(
          `${escapeHtml(out.msg)}<br><br><strong>Proceed and issue the purchase order unlinked?</strong>`,
          `Sales Order will be unlinked`,
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
          this.hideLoading();
          return;
        }
        this.showLoading("Saving Purchase Orders...");
        data.unlink_confirmed = true;
        await saveWorkflow(data);
        return;
      }

      if (soConfirm === 410) {
        // Supplier changed to a different internal org — unlink old + create new.
        this.hideLoading();
        const proceed = await this.$confirm(
          `${escapeHtml(out.msg)}<br><br><strong>Proceed?</strong>`,
          `Internal Trading – Re-link Sales Order`,
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
          this.hideLoading();
          return;
        }
        this.showLoading("Saving Purchase Orders...");
        data.swap_confirmed = true;
        await saveWorkflow(data);
        return;
      }

      if (soConfirm === 411) {
        // Linked SO already being fulfilled — block the edit (no retry).
        this.hideLoading();
        await this.$alert(
          `${escapeHtml(out.msg)}<br><br>The purchase order was not saved.`,
          "Cannot edit a fulfilled Sales Order's purchase order",
          {
            confirmButtonText: "OK",
            type: "error",
            dangerouslyUseHTMLString: true,
          },
        );
        this.hideLoading();
        return;
      }

      if (soConfirm === 412) {
        // PO saved, but reflecting changes into the linked SO failed (non-blocking).
        this.hideLoading();
        await this.$alert(
          `The purchase order was saved, but the linked Sales Order could not be updated:<br><br>${escapeHtml(out.msg)}<br><br>Please update the Sales Order manually or contact your administrator.`,
          "Sales Order not updated",
          {
            confirmButtonText: "OK",
            type: "warning",
            dangerouslyUseHTMLString: true,
          },
        );
        closeDialog();
        return;
      }

      // Saved, but waiting in the approval flow.
      if (res && res.enteredSlotApproval) {
        this.hideLoading();
        await this.$alert(
          "This Purchase Order requires approval.<br><br>It has been saved and is pending approval.",
          "Approval Required",
          {
            confirmButtonText: "OK",
            dangerouslyUseHTMLString: true,
            type: "info",
          },
        );
      }

      // Normal success. A Direct Invoice PO also names the PI it created.
      this.$message.success(
        out.pi_no
          ? `${this.isEdit ? "Update" : "Add"} successfully. Purchase Invoice ${out.pi_no} created`
          : `${this.isEdit ? "Update" : "Add"} successfully`,
      );
      closeDialog();
    },
    async (error) => {
      this.hideLoading();
      console.error(error);
      if (error.data?.code === 404) {
        // 404 - Existing draft GR/PI (end_draft_404 in the save workflow): delete then retry
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
      } else if (error.data?.code === 402) {
        // 402 - Unit price outside min/max and no approval needed
        await this.$alert(escapeHtml(error.data.msg).replace(/&lt;br&gt;/g, "<br>"), "Invalid Unit Price", {
          confirmButtonText: "OK",
          type: "error",
          dangerouslyUseHTMLString: true,
        });
      } else {
        this.$message.error(error.data?.msg || error.toString());
      }
    },
  );
};

(async () => {
  try {
    this.showLoading("Saving Purchase Orders...");
    const data = this.getValues();
    let entry = data;
    console.log("data", data);
    // Unit price is not validated here: min/max price is checked by the save workflow,
    // which either routes it to approval or rejects it with 402. Every line's quantity in
    // one pass: a call per line re-walked (and deep-copied) the whole table each time.
    if (data.table_po.length > 0) {
      await this.validate(data.table_po.map((lineItem, index) => `table_po.${index}.quantity`));
    }

    //Check Min/ Max qty before save
    const  qtyErrors = [];

    for(const [index, lineItem] of data.table_po.entries()){
      const quantity = parseFloat(lineItem.quantity) || 0;
      const minQty = parseFloat(lineItem.min_qty) || 0;
      const maxQty = parseFloat(lineItem.max_qty) || 0;

      if(minQty > 0 && quantity < minQty){
        qtyErrors.push(
          `Line ${index + 1}: Quantity ${quantity} is below Min Qty ${minQty}`,
        );
      }
      
      if(maxQty > 0 && quantity > maxQty){
        qtyErrors.push(
          `Line ${index + 1}: Quantity ${quantity} exceeds Max Qty ${maxQty}`,
        );
      }
    }

    if(qtyErrors.length > 0){
      this.hideLoading();

      await this.$alert(
        qtyErrors.join("<br>"),
        "Invalid Quantity",
        {
          confirmButtonText: "OK",
          type: 'error',
          dangerouslyUseHTMLString: true,
        },
      );

      return;
    }

    entry.po_status = "Issued";

    const cleanData = poSlimPayload(entry);

    await saveWorkflow(cleanData);
  } catch (error) {
    console.error("error", error);
    this.hideLoading();
    // Try to get message from standard locations first
    let errorMessage = "";

    if (error && typeof error === "object") {
      errorMessage = findFieldMessage(error) || error.toString();
    } else {
      errorMessage = error.toString() || error.message;
    }

    this.$message.error(errorMessage);
    console.error(errorMessage);
  }
})();
