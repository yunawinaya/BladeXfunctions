const { setModelKey, newModel, oldModel } = arguments[0];
const oldData = oldModel+'_type';
const newData = newModel+'_type';
setModelKey(oldData, newData);