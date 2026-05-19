(async () => {
  try {
    const rowIndex = Number(arguments[0].rowIndex);
    const mobileNumber = arguments[0].value;
    const countryCode = arguments[0].row && arguments[0].row.calling_code;
    const rowId = arguments[0].row && arguments[0].row.id;

    if (!mobileNumber) return;

    const currentCustomerId = this.getValue("id");

    const stripLeadingZero = (m) => {
      const s = (m || "").toString();
      return s.startsWith("0") ? s.slice(1) : s;
    };
    const mobileNoLeading = stripLeadingZero(mobileNumber);
    const mobileVariants = Array.from(
      new Set([mobileNoLeading, "0" + mobileNoLeading]),
    );

    const contactList = this.getValue("contact_list") || [];
    const inMemoryDup = contactList.some(
      (c, i) =>
        i !== rowIndex &&
        c.calling_code === countryCode &&
        stripLeadingZero(c.mobile_number) === mobileNoLeading,
    );

    if (inMemoryDup) {
      this.$message.error(
        "Mobile number already exists in this customer's contact list",
      );
      return;
    }

    const mobileFilter = new Filter()
      .in("mobile_number", mobileVariants)
      .build();
    const dbResult = await db
      .collection("customer_wyjlo2tg_sub")
      .filter(mobileFilter)
      .get();

    const collisions = (dbResult.data || []).filter(
      (r) =>
        r.calling_code === countryCode && r.is_deleted === 0 && r.id !== rowId,
    );

    if (collisions.length > 0) {
      const sameCustomer = collisions[0].Customer_id === currentCustomerId;
      this.$message.error(
        sameCustomer
          ? "Mobile number already exists in this customer's other contacts"
          : "Mobile number is already registered to another customer",
      );
    }
  } catch (error) {
    console.error(error);
  }
})();
