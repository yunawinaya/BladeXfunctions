const data = this.getValues();
console.log('address data', data)
db.collection('country').where({ id: data.shipping_address_country }).get().then((resCountry) => {

    const countryName = resCountry?.data[0]?.country_name || null;

    db.collection('state').where({ id: data.shipping_address_state }).get().then((resState) => {

        const stateName = resState?.data[0]?.state_name || null;

        const addressComponents = [
            data.shipping_address_line_1,
            data.shipping_address_line_2,
            data.shipping_address_line_3,
            data.shipping_address_line_4,
            data.shipping_address_city,
            data.shipping_postal_code,
            stateName,
            countryName,
        ].filter(component => component);

        const formattedAddress = addressComponents.join(',\n');

        this.setData({
            [`po_shipping_address`]: formattedAddress,
        })
    })
})
.catch((err) => {
    console.log(err);
})

db.collection('country').where({ id: data.billing_address_country }).get().then((resCountry) => {

    const countryName = resCountry?.data[0]?.country_name || null;

    db.collection('state').where({ id: data.billing_address_state }).get().then((resState) => {

        const stateName = resState?.data[0]?.state_name || null;

        const addressComponents = [
            data.billing_address_line_1,
            data.billing_address_line_2,
            data.billing_address_line_3,
            data.billing_address_line_4,
            data.billing_address_city,
            data.billing_postal_code,
            stateName || null,
            countryName || null,
        ].filter(component => component);

        const formattedAddress = addressComponents.join(',\n');

        this.setData({
            [`po_billing_address`]: formattedAddress,
        })
    })
})
.catch((err) => {
    console.log(err);
})