const data = this.getValues();

// Reusable function to format address (now properly returning a Promise)
const formatAddress = (addressData, countryId, stateId) => {
    return Promise.all([  // Added return here
      db.collection('country').where({ id: countryId }).get(),
      db.collection('state').where({ id: stateId }).get(),
    ])
    .then(([resCountry, resState]) => {
        const countryName = resCountry?.data[0]?.country_name || '';
        const stateName = resState?.data[0]?.state_name || '';
    
        const addressComponents = [
          addressData.line1,
          addressData.line2,
          addressData.line3,
          addressData.line4,
          addressData.city,
          addressData.postalCode,
          stateName,
          countryName,
        ].filter(component => component && component.trim() !== '');
    
        return addressComponents.join(',\n');
    });
};

// Process both addresses in parallel
Promise.all([
  formatAddress(
    {
      line1: data.shipping_address_line_1,
      line2: data.shipping_address_line_2,
      line3: data.shipping_address_line_3,
      line4: data.shipping_address_line_4,
      city: data.shipping_address_city,
      postalCode: data.shipping_postal_code,
    },
    data.shipping_address_country,
    data.shipping_address_state
  ),
  formatAddress(
    {
      line1: data.billing_address_line_1,
      line2: data.billing_address_line_2,
      line3: data.billing_address_line_3,
      line4: data.billing_address_line_4,
      city: data.billing_address_city,
      postalCode: data.billing_postal_code,
    },
    data.billing_address_country,
    data.billing_address_state
  ),
])
.then(([shippingAddress, billingAddress]) => {
  // Set both addresses at once
  this.setData({
    'si_shipping_address': shippingAddress,
    'si_billing_address': billingAddress
  });
})
.catch(err => {
  console.error('Error processing addresses:', err);
});