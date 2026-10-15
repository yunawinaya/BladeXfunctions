const subtractDataRaw = {{node:get_cache_node_BztKo01z.data}};
const subtractData = JSON.parse(subtractDataRaw);

return {
  manufacturing_date: subtractData.manufacturing_date || "",
  expired_date: subtractData.expired_date || "",
}