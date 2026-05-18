(async () => {
  try {
    const rowIndex = Number(arguments[0].rowIndex);
    const mobileNumber = arguments[0].value;
    const countryCode = arguments[0].row && arguments[0].row.country_code;

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
        c.country_code === countryCode &&
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

    const externalRows = (dbResult.data || []).filter(
      (r) =>
        r.country_code === countryCode &&
        r.is_deleted === 0 &&
        r.Customer_id !== currentCustomerId,
    );

    if (externalRows.length > 0) {
      this.$message.error(
        "Mobile number is already registered to another customer",
      );
    }
  } catch (error) {
    console.error(error);
  }
})();
