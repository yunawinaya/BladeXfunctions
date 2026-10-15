const resetAddrFields = async () => {
  this.setData({
    'po_shipping_address': '',
    'po_billing_address': '',
    'billing_address_line_1': '',
    'billing_address_line_2': '',
    'billing_address_line_3': '',
    'billing_address_line_4': '',
    'billing_address_city': '',
    'billing_address_state': '',
    'billing_postal_code': '',
    'billing_address_country': '',
    'billing_address_name': "",
    'billing_address_phone': "",
    'billing_attention': "",
    'shipping_address_line_1': '',
    'shipping_address_line_2': '',
    'shipping_address_line_3': '',
    'shipping_address_line_4': '',
    'shipping_address_city': '',
    'shipping_address_state': '',
    'shipping_postal_code': '',
    'shipping_address_country': '',
    'shipping_address_name': "",
    'shipping_address_phone': "",
    'shipping_attention': "",
    'billing_address_fax': '',
    'shipping_address_fax': ''
    });
}

const setAddressFields = (addressType, address) => {
    this.setData({
    [`${addressType}_address_line_1`]: address.address_line_1,
    [`${addressType}_address_line_2`]: address.address_line_2,
    [`${addressType}_address_line_3`]: address.address_line_3,
    [`${addressType}_address_line_4`]: address.address_line_4,
    [`${addressType}_address_city`]: address.address_city,
    [`${addressType}_address_state`]: address.address_state,
    [`${addressType}_postal_code`]: address.address_postal_code,
    [`${addressType}_address_country`]: address.address_country_id,
    [`${addressType}_address_name`]: address.address_name,
    [`${addressType}_address_phone`]: address.address_phone,
    [`${addressType}_attention`]: address.address_attention,
    });
};

(async () => {
  
  console.log('arguments', arguments[0])
  const plant = this.getValue('po_plant');

  if (plant) {
    this.display('address_grid');
    await resetAddrFields();

    const [resShipping, resPlant] = await Promise.all([
        db.collection('address_purpose').where({ purpose_name: 'Shipping' }).get(),
        db.collection('plant_address').where({ plant_id: plant, is_default: 1 }).get(), ])

    if (resPlant.data.length === 0 || resShipping.data.length === 0) return;

    const addresses = resPlant.data;
    const shippingAddrId = resShipping.data[0].id;

    addresses.forEach(async (address) => {

      let country = '';
      let state = '';

      if(address.address_country_id) {
          const resCountry = await db.collection("country").where({ id: address.address_country_id }).get();
          country = resCountry?.data[0]?.country_name || '';
      }

      if(address.address_state) {
          const resState = await db.collection("state").where({ id: address.address_state }).get();
          state = resState?.data[0]?.state_name || '';
      }

      const isShipping = address.plant_purpose === shippingAddrId;
      const addressType = isShipping ? 'shipping' : 'billing';
      const addressTypeUpperCase = isShipping ? "Shipping" : "Billing";

      const addressLines = [
        address.address_line_1,
        address.address_line_2,
        address.address_line_3,
        address.address_line_4,
      ]
      .filter((line) => line) 
      .join(
        ([address.address_line_1, address.address_line_2, address.address_line_3, address.address_line_4]
          .filter((line) => line)
          .pop() || "").endsWith(",") ? " " : ", "
      );

      const cityDetails = [
        address.address_city,
        address.address_postal_code,
        address.address_state ? state : '',
        address.address_country_id ? country : ""
      ]
      .filter((detail) => detail) 
      .join(
        ([address.address_city, address.address_postal_code, address.address_state ? state : '', address.address_country_id ? country : ""]
          .filter((detail) => detail)
          .pop() || "").endsWith(",") ? " " : ", "
      );

      const addressAttention = address.address_attention ? '\nAttention: ' + address.address_attention : ''

      const addressPurposeName =`\n${addressTypeUpperCase}` + ' Address';

      const addressPersonParts = [
      address.address_name,
      address.address_phone
      ].filter((part) => part); // Remove undefined or null
      const addressPerson = addressPersonParts.length > 0 ? addressPersonParts.join(' | ') : '';
                
      const formattedAddress = [
        addressPerson,
        addressPurposeName,
        addressLines,
        cityDetails,
        addressAttention
      ].filter(Boolean).join('\n');

        setAddressFields(
        addressType,
        address,
        );

        if(addressType === 'shipping') {
        this.setData({ 'po_shipping_address': formattedAddress });
        } else {
        this.setData({ 
            'po_billing_address': formattedAddress, 
            });
        }
    });
  }
})();
