const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const findFieldMessage = (obj) => {
  // Base case: if current object has the structure we want
  if (obj && typeof obj === "object") {
    // Check for the specific error structure: { "table_sqt.1dz9gq2q.unit_price": { "message": "..." } }
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

// A gate (414 / 413 / 406) comes back as HTTP 200 with the code in the body, so the
// platform raises no error toast beside the dialog. Handle it before anything treats this
// as a saved quotation. Returns true when it answered and re-submitted, or gave up.
const handleGate = async (payload, data) => {
  const gate = payload.gate || payload;
  const gateCode = gate && gate.gateCode;
  if (!gateCode) return false;

  this.hideLoading();
  const gateMsg = `${gate.message || ""}`;

  if (gateCode === "414" || gateCode === 414) {
    // The order quantity went up. BOTH answers re-run the save; closing the dialog counts
    // as "leave outstanding", so nothing extra is ever allocated.
    const addToDelivery = await this.$confirm(gateMsg, `Delivery quantity`, {
      confirmButtonText: "Add to delivery",
      cancelButtonText: "Leave outstanding",
      type: "warning",
      dangerouslyUseHTMLString: true,
    })
      .then(() => "Yes")
      .catch(() => "No");

    this.showLoading("Saving Quotation...");
    // Kept on data so a following 413 retry cannot drop the answer.
    data.raiseGdQty = addToDelivery;
    await submitForm(data);
    return true;
  }

  if (gateCode === "413" || gateCode === 413) {
    await this.$confirm(gateMsg, `Reverse picked quantities`, {
      confirmButtonText: "Proceed",
      cancelButtonText: "Cancel",
      type: "warning",
      dangerouslyUseHTMLString: true,
    }).catch(() => {
      this.hideLoading();
      throw new Error("Saving quotation cancelled.");
    });
    this.showLoading("Saving Quotation...");
    data.confirmPickReversal = "Yes";
    await submitForm(data);
    return true;
  }

  // 406 - a linked sales order, delivery or picking plan refused the change. The message
  // names each document and says whether the quotation itself was saved.
  await this.$alert(gateMsg, `Linked documents`, {
    confirmButtonText: "OK",
    type: "error",
    dangerouslyUseHTMLString: true,
  });
  return true;
};

const submitForm = async (data) => {
  await this.runWorkflow(
    "1990708878376038401",
    {
      data: data,
    },
    async (res) => {
      console.log("res", res);
      // runWorkflow hands back the whole envelope: {code, data:{data:{...}}} -- the inner
      // `data` is the end-node's OutputParams prop, so the payload sits one level deeper
      // than it looks. Tolerate both shapes rather than depending on the wrapping.
      const payload = res?.data?.data ?? res?.data ?? {};
      if (await handleGate(payload, data)) return;

      // What has to be physically put back after a pick reversal, as the delivery
      // reported it.
      if (payload.pickingReversalNote) {
        await this.$alert(payload.pickingReversalNote, "Stock to put back", {
          confirmButtonText: "OK",
          type: "warning",
          dangerouslyUseHTMLString: true,
        });
      }
      this.$message.success(`${this.isEdit ? "Update" : "Add"} successfully`);
      closeDialog();
    },
    async (error) => {
      this.hideLoading();
      console.error(error);
      if (error.data?.code === 402) {
        // 402 - Credit limit block
        const cleanMessage = error.data?.msg.replace(/^Block - /, "");

        await this.$alert(`${cleanMessage}`, "", {
          confirmButtonText: "OK",
          type: "error",
          dangerouslyUseHTMLString: true,
        });
      } else if (error.data?.code === 403) {
        // 403 - Credit limit override
        const cleanMessage = error.data?.msg.replace(/^Override - /, "");
        await this.$confirm(`${cleanMessage}`, ``, {
          confirmButtonText: "Proceed",
          cancelButtonText: "Cancel",
          type: "error",
          dangerouslyUseHTMLString: true,
        }).catch(() => {
          console.log("User clicked Cancel or closed the dialog");
          this.hideLoading();
          throw new Error("Saving quotation cancelled.");
        });

        this.showLoading("Saving Quotation...");
        data.need_cl = "not required";

        await submitForm(data);
      } else if (
        error.data?.code === 414 ||
        error.data?.code === 413 ||
        error.data?.code === 406
      ) {
        // The same three gates, arriving the old way. Kept so a stale workflow deploy
        // still asks the question instead of failing silently.
        await handleGate(
          { gate: { gateCode: String(error.data.code), message: error.data.msg } },
          data,
        );
      } else {
        // 400 and 401 showed the user nothing at all before this.
        this.$message.error(error.data?.msg || "Failed to save Quotation.");
      }
    },
  );
};

(async () => {
  try {
    this.showLoading("Saving Quotation...");
    const data = this.getValues();
    let entry = data;

    for (const [index, sqtLineItem] of entry.table_sqt.entries()) {
      await this.validate(`table_sqt.${index}.unit_price`);
    }

    // A converted quotation stays Completed. Stamping "Issued" here would fight
    // SO_SAVE, which sets every linked quotation back to Completed on each save.
    const currentStatus = this.getValue("sqt_status");
    entry.sqt_status = currentStatus === "Completed" ? "Completed" : "Issued";
    console.log("entry", entry);

    await submitForm(entry);
  } catch (error) {
    console.error("Submit Quotation failed:", error);
    // runWorkflow rejects AFTER its error callback has run, so anything carrying a
    // workflow code was already reported there -- as a confirm, or as its own alert.
    // Reporting it again here also renders the raw <br> tags, because $message takes no
    // dangerouslyUseHTMLString. A cancellation or a validation failure is a plain Error
    // with no .data, so those still surface.
    if (!(error && error.data && error.data.code)) {
      const msg =
        (error && typeof error === "object"
          ? error.message || findFieldMessage(error)
          : "") || String(error);
      this.$message.error(
        msg && msg !== "[object Object]" ? msg : "Save failed, please try again.",
      );
    }
  } finally {
    this.hideLoading();
  }
})();
