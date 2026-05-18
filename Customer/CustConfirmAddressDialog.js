(async () => {
  const data = this.getValues();

  const newAddress = {
    switch_save_as_default: data.dialog_add_new_address.switch_save_as_default,
    address_purpose_id: data.dialog_add_new_address.address_purpose_id,
    address_name: data.dialog_add_new_address.address_name,
    address_country_id: data.dialog_add_new_address.address_country_id,
    address_line_1: data.dialog_add_new_address.address_line_1,
    address_line_2: data.dialog_add_new_address.address_line_2,
    address_line_3: data.dialog_add_new_address.address_line_3,
    address_line_4: data.dialog_add_new_address.address_line_4,
    adddress_state: data.dialog_add_new_address.adddress_state,
    address_city: data.dialog_add_new_address.address_city,
    address_fax_no: data.dialog_add_new_address.address_fax_no,
    address_phone: data.dialog_add_new_address.address_phone,
    address_postal_code: data.dialog_add_new_address.address_postal_code,
    address_phone2: data.dialog_add_new_address.address_phone2,
    address_mobile: data.dialog_add_new_address.address_mobile,
    address_email: data.dialog_add_new_address.address_email,
    address_fax_no2: data.dialog_add_new_address.address_fax_no2,
    address_attention: data.dialog_add_new_address.address_attention,
  };

  const addressMobile = data.dialog_add_new_address.address_mobile;
  const addressCountryCode = data.dialog_add_new_address.address_country_code;
  const currentCustomerId = this.getValue("id");

  const isEditing = data.dialog_add_new_address.rowIndex !== "-1";
  const oldAddress = isEditing
    ? data.address_list[parseInt(data.dialog_add_new_address.rowIndex)]
    : null;
  const oldMobile = oldAddress ? oldAddress.address_mobile : null;

  // "0178890665" and "178890665" are the same number — compare leading-0-stripped forms.
  const stripZero = (m) => {
    const s = (m || "").toString();
    return s.startsWith("0") ? s.slice(1) : s;
  };

  if (addressMobile) {
    const mobileNoLeading = stripZero(addressMobile);
    const mobileVariants = Array.from(
      new Set([mobileNoLeading, "0" + mobileNoLeading]),
    );

    const contactList = this.getValue("contact_list") || [];

    // When editing, exclude the contact previously synced to this address's old mobile
    // so re-saving the same address doesn't false-positive against its own auto-synced contact.
    let excludeContactIdx = -1;
    if (oldMobile) {
      const oldNoLead = stripZero(oldMobile);
      excludeContactIdx = contactList.findIndex(
        (c) => stripZero(c.mobile_number) === oldNoLead,
      );
    }

    const inMemoryDup = contactList.some(
      (c, i) =>
        i !== excludeContactIdx &&
        c.country_code === addressCountryCode &&
        stripZero(c.mobile_number) === mobileNoLeading,
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
        r.country_code === addressCountryCode &&
        r.is_deleted === 0 &&
        r.Customer_id !== currentCustomerId,
    );

    if (externalRows.length > 0) {
      this.$message.error(
        "Mobile number is already registered to another customer",
      );
      return;
    }
  }

  Promise.all([
    db.collection("address_purpose").where({ purpose_name: "Billing" }).get(),
    db.collection("address_purpose").where({ purpose_name: "Shipping" }).get(),
    db.collection("country").where({ id: newAddress.address_country_id }).get(),
    db.collection("state").where({ id: newAddress.adddress_state }).get(),
  ]).then(([resBilling, resShipping, resCountry, resState]) => {
    const billingAddrId = resBilling.data[0].id;
    const shippingAddrId = resShipping.data[0].id;
    const countryName = resCountry.data[0]?.country_name
      ? resCountry.data[0].country_name
      : null;
    const stateName = resState.data[0]?.state_name
      ? resState.data[0].state_name
      : null;
    const addressPurposeMapping = {
      [billingAddrId]: "Billing Address",
      [shippingAddrId]: "Shipping Address",
    };

    if (newAddress.switch_save_as_default) {
      const existingDefaultIndex = data.address_list.findIndex(
        (address) =>
          address.address_purpose_id === newAddress.address_purpose_id &&
          address.switch_save_as_default,
      );

      if (existingDefaultIndex !== -1) {
        const formattedAddress =
          data.address_list[existingDefaultIndex].address;
        const cleanedAddress = formattedAddress.replace(" (default)", "");

        data.address_list[existingDefaultIndex].address = cleanedAddress;
        data.address_list[existingDefaultIndex].switch_save_as_default = false;
      } else if (
        existingDefaultIndex === parseInt(data.dialog_add_new_address.rowIndex)
      ) {
        newAddress.switch_save_as_default = true;
      }
    }

    const addressLines = [
      newAddress.address_line_1,
      newAddress.address_line_2,
      newAddress.address_line_3,
      newAddress.address_line_4,
    ]
      .filter((line) => line)
      .join(
        (
          [
            newAddress.address_line_1,
            newAddress.address_line_2,
            newAddress.address_line_3,
            newAddress.address_line_4,
          ]
            .filter((line) => line)
            .pop() || ""
        ).endsWith(",")
          ? " "
          : ", ",
      );

    const cityDetails = [
      newAddress.address_city,
      newAddress.address_postal_code,
      stateName,
      countryName,
    ]
      .filter((detail) => detail)
      .join(
        (
          [
            newAddress.address_city,
            newAddress.address_postal_code,
            stateName,
            countryName,
          ]
            .filter((detail) => detail)
            .pop() || ""
        ).endsWith(",")
          ? " "
          : ", ",
      );

    const phoneNumber = `+${newAddress.address_phone}${
      newAddress.switch_save_as_default ? " (default)" : ""
    }`;

    const addressAttention = newAddress.address_attention
      ? "\nAttention: " + newAddress.address_attention
      : "";

    const addressPurposeName =
      addressPurposeMapping[newAddress.address_purpose_id];

    const addressPerson = `${newAddress.address_name} | ${phoneNumber}`;

    const formattedAddress = [
      addressPerson,
      addressPurposeName,
      addressLines,
      cityDetails,
      addressAttention,
    ]
      .filter(Boolean)
      .join("\n");

    if (data.dialog_add_new_address.rowIndex !== "-1") {
      const rowIndex = parseInt(data.dialog_add_new_address.rowIndex);
      data.address_list[rowIndex] = newAddress;
      data.address_list[rowIndex].address = formattedAddress;
    } else {
      const emptyTemplateIndex = data.address_list.findIndex(
        (address) =>
          !address.address_name &&
          !address.address_line_1 &&
          !address.address_line_2 &&
          !address.address_line_3 &&
          !address.address_line_4,
      );

      if (emptyTemplateIndex !== -1) {
        data.address_list[emptyTemplateIndex] = newAddress;
        data.address_list[emptyTemplateIndex].address = formattedAddress;
      } else {
        data.address_list.push({ ...newAddress, address: formattedAddress });
      }
    }

    this.setData({
      address_list: data.address_list,
    });

    if (addressMobile) {
      const currentContacts = this.getValue("contact_list") || [];
      const syncedContact = {
        person_name: data.dialog_add_new_address.address_name,
        country_code: addressCountryCode,
        mobile_number: addressMobile,
        person_email: data.dialog_add_new_address.address_email,
        phone_number: data.dialog_add_new_address.address_phone,
      };

      // In edit mode, find the contact previously synced from this address (matched by old mobile).
      let targetIdx = -1;
      if (isEditing && oldMobile) {
        const oldNoLead = stripZero(oldMobile);
        targetIdx = currentContacts.findIndex(
          (c) => stripZero(c.mobile_number) === oldNoLead,
        );
      }

      if (targetIdx !== -1) {
        currentContacts[targetIdx] = {
          ...currentContacts[targetIdx],
          ...syncedContact,
        };
        this.setData({ contact_list: currentContacts });
      } else {
        const newNoLead = stripZero(addressMobile);
        const alreadyExists = currentContacts.some(
          (c) =>
            c.country_code === addressCountryCode &&
            stripZero(c.mobile_number) === newNoLead,
        );
        if (!alreadyExists) {
          const emptyContactIdx = currentContacts.findIndex(
            (c) => !c.person_name && !c.mobile_number && !c.person_email,
          );
          if (emptyContactIdx !== -1) {
            currentContacts[emptyContactIdx] = syncedContact;
          } else {
            currentContacts.push(syncedContact);
          }
          this.setData({ contact_list: currentContacts });
        }
      }
    }
  });

  this.triggerEvent("func_reset_dialog_address");
})();
