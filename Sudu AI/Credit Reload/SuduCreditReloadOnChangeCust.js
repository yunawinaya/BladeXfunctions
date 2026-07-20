(async () => {
  const customerData = arguments[0].fieldModel.item;
  console.log("Customer Data:", customerData);
  const remainSubCredit = customerData?.remain_sub_credit || 0;
  const remainReloadCredit = customerData?.remain_reload_credit || 0;
  this.setData({
    sub_remain_before: remainSubCredit,
    reload_remain_before: remainReloadCredit,
  });
})();
