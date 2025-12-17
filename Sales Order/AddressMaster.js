const address_name = this.getParamsVariables("address_name");
const address_phone = this.getParamsVariables("address_phone");
const address_line1 = this.getParamsVariables("address_line1");
const address_line2 = this.getParamsVariables("address_line2");
const address_line3 = this.getParamsVariables("address_line3");
const address_line4 = this.getParamsVariables("address_line4");
const city = this.getParamsVariables("city");
const postal_code = this.getParamsVariables("postal_code");
const state = this.getParamsVariables("state");
const country = this.getParamsVariables("country");
const address_purpose = this.getParamsVariables("address_purpose");
const customerId = this.getParamsVariables("customerId");
const address_attention = this.getParamsVariables("address_attention");
const supplierId = this.getParamsVariables("supplierId");

this.setData({
  address_name: address_name,
  address_phone: address_phone,
  address_line_1: address_line1,
  address_line_2: address_line2,
  address_line_3: address_line3,
  address_line_4: address_line4,
  address_city: city,
  postal_code: postal_code,
  address_state: state,
  address_country: country,
  address_attention: address_attention,
});

const findAddressPurpose = async (addressPurpose) => {
  const resPurpose = await db
    .collection("address_purpose")
    .where({ purpose_name: addressPurpose })
    .get();

  const addrPurpose = resPurpose.data[0];

  await this.setData({ address_purpose: addrPurpose.id });

  return addrPurpose.id;
};

const updateCustomerOptionData = async (addrPurpose) => {
  const res = await db.collection("Customer").where({ id: customerId }).get();
  const { address_list } = res.data[0];

  const filteredList = address_list.filter(
    (data) => data.address_purpose_id === addrPurpose
  );
  const defaultAddrIndex =
    filteredList?.findIndex(
      (address) => address.address_name === address_name
    ) ?? -1;

  const optionData = filteredList.map((data, index) => {
    return {
      label: data.address_name,
      value: index.toString(),
    };
  });

  return { optionData, defaultAddrIndex };
};

const updateSupplierOptionData = async (addrPurpose) => {
  const res = await db
    .collection("supplier_head")
    .where({ id: supplierId })
    .get();
  const { address_list } = res.data[0];

  const filteredList = address_list.filter(
    (data) => data.address_purpose_id === addrPurpose
  );
  const defaultAddrIndex =
    filteredList?.findIndex(
      (address) => address.address_name === address_name
    ) ?? -1;

  const optionData = filteredList.map((data, index) => {
    return {
      label: data.address_name,
      value: index.toString(),
    };
  });

  return { optionData, defaultAddrIndex };
};

(async () => {
  const addrPurpose = await findAddressPurpose(address_purpose);

  if (customerId && supplierId === "None") {
    console.log("customerId", customerId);
    const { optionData, defaultAddrIndex } = await updateCustomerOptionData(
      addrPurpose
    );
    if (optionData.length > 1) {
      await this.display(["select_address"]);
      await this.setOptionData("select_address", optionData);
      await this.setData({ select_address: optionData[defaultAddrIndex] });
    }
  } else if (supplierId && customerId === "None") {
    console.log("supplierId", supplierId);

    const { optionData, defaultAddrIndex } = await updateSupplierOptionData(
      addrPurpose
    );
    if (optionData.length > 1) {
      await this.display(["select_address"]);
      await this.setOptionData("select_address", optionData);
      await this.setData({ select_address: optionData[defaultAddrIndex] });
    }
  }
})();
