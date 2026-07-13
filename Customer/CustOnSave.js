const closeDialog = () => {
  if (this.parentGenerateForm) {
    this.parentGenerateForm.$refs.SuPageDialogRef.hide();
    this.parentGenerateForm.refresh();
    this.hideLoading();
  }
};

const validateForm = (data, requiredFields) => {
  const missingFields = requiredFields.filter((field) => {
    const value = data[field.name];
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "string") return value.trim() === "";
    return !value;
  });
  return missingFields;
};

const validateContactList = async (contactList, currentCustomerId) => {
  const list = contactList || [];

  // for (let i = 0; i < list.length; i++) {
  //   const name = list[i].person_name;
  //   if (!name || (typeof name === "string" && name.trim() === "")) {
  //     return {
  //       ok: false,
  //       message: `Contact at row ${i + 1} is missing a person name`,
  //     };
  //   }
  // }

  const stripLeadingZero = (m) => {
    const s = (m || "").toString();
    return s.startsWith("0") ? s.slice(1) : s;
  };

  const seen = new Map();
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (!c.mobile_number) continue;
    const key = stripLeadingZero(c.mobile_number);
    if (seen.has(key)) {
      return {
        ok: false,
        message: `Duplicate mobile number ${c.mobile_number} in contacts (rows ${
          seen.get(key) + 1
        } and ${i + 1})`,
      };
    }
    seen.set(key, i);
  }

  const contactsWithMobile = list.filter((c) => c.mobile_number);
  if (contactsWithMobile.length === 0) return { ok: true };

  const variants = new Set();
  for (const c of contactsWithMobile) {
    const noLead = stripLeadingZero(c.mobile_number);
    variants.add(noLead);
    variants.add("0" + noLead);
  }
  const mobileFilter = new Filter()
    .in("mobile_number", Array.from(variants))
    .build();
  const dbResult = await db
    .collection("customer_wyjlo2tg_sub")
    .filter(mobileFilter)
    .get();

  const activeRows = (dbResult.data || []).filter((r) => r.is_deleted === 0);
  const inMemoryIds = new Set(list.filter((c) => c.id).map((c) => c.id));

  for (const c of contactsWithMobile) {
    const noLead = stripLeadingZero(c.mobile_number);
    const collision = activeRows.find(
      (r) =>
        !inMemoryIds.has(r.id) && stripLeadingZero(r.mobile_number) === noLead,
    );
    if (collision) {
      const sameCustomer = collision.Customer_id === currentCustomerId;
      return {
        ok: false,
        message: sameCustomer
          ? `Mobile number ${c.mobile_number} already exists in this customer's other contacts`
          : `Mobile number ${c.mobile_number} is already registered to another customer`,
      };
    }
  }

  return { ok: true };
};

const AI_AGENT_UPSERT_WORKFLOW_ID = "2075496757336727553";

// Pushes the customer to the AI agent's external directory. Never let a failure
// here fail the save — the record is already committed at this point.
const triggerAIAgentUpsert = async (customerId, customerCode, customerName) => {
  if (!customerId) return;
  try {
    await this.runWorkflow(
      AI_AGENT_UPSERT_WORKFLOW_ID,
      {
        id: customerId,
        customer_code: customerCode || "",
        customer_name: customerName || "",
      },
      () => {},
      (error) => console.error("AI agent customer upsert failed", error),
    );
  } catch (error) {
    console.error("AI agent customer upsert failed", error);
  }
};

const addEntry = async (organizationId, entry) => {
  try {
    const res = await db.collection("Customer").add(entry);
    const customerId = res?.data?.[0]?.id;
    this.$message.success("Add successfully");

    let customerCode = entry.customer_id;
    // Auto-numbered codes are assigned server-side, so read back the real one.
    if (customerCode === "issued" && customerId) {
      const resCustomer = await db.collection("Customer").doc(customerId).get();
      customerCode = resCustomer?.data?.[0]?.customer_id || "";
    }

    await triggerAIAgentUpsert(
      customerId,
      customerCode,
      entry.customer_com_name,
    );
  } catch (error) {
    this.$message.error(error);
  }
};

const updateEntry = async (entry, customerId) => {
  try {
    await db.collection("Customer").doc(customerId).update(entry);
    this.$message.success("Update successfully");

    await triggerAIAgentUpsert(
      customerId,
      entry.customer_id,
      entry.customer_com_name,
    );
  } catch (error) {
    this.$message.error(error);
  }
};

const findFieldMessage = (obj) => {
  // Base case: if current object has the structure we want
  if (obj && typeof obj === "object") {
    if (obj.field && obj.message) {
      return obj.message;
    }

    // Check array elements
    if (Array.isArray(obj)) {
      for (const item of obj) {
        const found = findFieldMessage(item);
        if (found) return found;
      }
    }

    // Check all object properties
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const found = findFieldMessage(obj[key]);
        if (found) return found;
      }
    }
  }
  return null;
};

(async () => {
  try {
    this.showLoading();
    const data = this.getValues();
    let entry = data;
    const requiredFields = [
      { name: "customer_status", label: "Customer Status" },
      ...(data.customer_id_type === -9999
        ? [{ name: "customer_id", label: "Customer Code" }]
        : []),
      { name: "customer_com_name", label: "Company Name" },
      { name: "customer_currency_id", label: "Currency" },
      { name: "customer_payment_term_id", label: "Payment Terms" },
    ];

    await this.validate("customer_id");
    entry.customer_id =
      entry.customer_id_type === -9999 || this.isEdit
        ? entry.customer_id
        : "issued";
    const missingFields = await validateForm(data, requiredFields);

    if (missingFields.length === 0) {
      const contactValidation = await validateContactList(
        data.contact_list,
        this.getValue("id"),
      );
      if (!contactValidation.ok) {
        this.hideLoading();
        this.$message.error(contactValidation.message);
        return;
      }

      const page_status = data.page_status;

      let organizationId = this.getVarGlobal("deptParentId");
      if (organizationId === "0") {
        organizationId = this.getVarSystem("deptIds").split(",")[0];
      }

      if (page_status === "Add") {
        await addEntry(organizationId, entry);
        await closeDialog();
      } else if (page_status === "Edit") {
        const customerId = this.getValue("id");
        await updateEntry(entry, customerId);
        await closeDialog();
      }
    } else {
      this.hideLoading();
      const missingFieldNames = missingFields.map((f) => f.label).join(", ");
      this.$message.error(`Missing required fields: ${missingFieldNames}`);
    }
  } catch (error) {
    this.hideLoading();

    let errorMessage = "";

    if (error && typeof error === "object") {
      errorMessage = findFieldMessage(error) || "An error occurred";
    } else {
      errorMessage = error;
    }

    this.$message.error(errorMessage);
    console.error(errorMessage);
  }
})();
