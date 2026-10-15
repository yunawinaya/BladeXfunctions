const arrayData = {{workflowparams:arrayData}};
const allData = arrayData[0];
const unique = `${allData.create_user || ""}_${Date.now()}`;

return {
  unique
};