const data = this.getValues();
const supplierId = this.getValue('po_receiving_supplier');

// Address 
if(supplierId) {
    this.display('address_grid');
    const resetFormFields = () => {
        this.setData({
        'billing_address_line_1': '',
        'billing_address_line_2': '',
        'billing_address_line_3': '',
        'billing_address_line_4': '',
        'billing_address_city': '',
        'billing_address_state': '',
        'billing_postal_code': '',
        'billing_address_country': '',
        'shipping_address_line_1': '',
        'shipping_address_line_2': '',
        'shipping_address_line_3': '',
        'shipping_address_line_4': '',
        'shipping_address_city': '',
        'shipping_address_state': '',
        'shipping_postal_code': '',
        'shipping_address_country': '',
        });
    }

    const setAddressFields = (addressType, address, stateId, countryId) => {
        this.setData({
            [`${addressType}_address_line_1`]: address.address_line_1,
            [`${addressType}_address_line_2`]: address.address_line_2,
            [`${addressType}_address_line_3`]: address.address_line_3,
            [`${addressType}_address_line_4`]: address.address_line_4,
            [`${addressType}_address_city`]: address.address_city,
            [`${addressType}_address_state`]: stateId,
            [`${addressType}_postal_code`]: address.address_postal_code,
            [`${addressType}_address_country`]: countryId,
        });
    };

    resetFormFields();

    Promise.all([
        db.collection('address_purpose').where({ purpose_name: 'Shipping' }).get(),
        db.collection('supplier_head').where({ id: supplierId }).get(),
    ]).then(([resShipping, resSupplier]) => {
        
        if (resSupplier.data.length === 0 || resShipping.data.length === 0) return;
        
        const supplierData = resSupplier.data[0];
        const shippingAddrId = resShipping.data[0].id;
        const addresses = supplierData.address_list.filter(address => 
            address.switch_save_as_default
        );

        addresses.forEach((address) => {
            Promise.all([
                db.collection('country').where({ id: address.address_country_id }).get(),
                db.collection('state').where({ id: address.adddress_state }).get(),
                ]).then(([resCountry, resState]) => {
                if (resCountry.data.length === 0 || resState.data.length === 0) return;

                const countryName = resCountry.data[0].country_name;
                const stateName = resState.data[0].state_name;

                const addressComponents = [
                    address.address_line_1,
                    address.address_line_2,
                    address.address_line_3,
                    address.address_line_4,
                    address.address_city,
                    address.address_postal_code,
                    stateName,
                    countryName,
                ].filter(component => component);

                const formattedAddress = addressComponents.join(',\n');

                const isShipping = address.address_purpose_id === shippingAddrId;
                const addressType = isShipping ? 'shipping' : 'billing';

                setAddressFields(
                    addressType,
                    address,
                    resState.data[0].id,
                    resCountry.data[0].id
                );

                if(addressType === 'shipping') {
                    this.setData({ 'po_shipping_address': formattedAddress });
                } else {
                    this.setData({ 
                        'po_billing_address': formattedAddress, 
                        'po_billing_name': address.address_name,
                        'po_billing_cp': address.address_phone, });
                }
            })
        })
    })
}