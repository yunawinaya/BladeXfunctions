const accIntegrationData = {{node:SC5_get_node_6NZZfFj5.data.data}};
const soData = {{node:code_node_SCc.data.soData}};

if(accIntegrationData.auto_post_so === 1 && soData.posted_status !== 'Posted') {
  return {
    result: 'Auto Post'
  }
}

return {
  result: ''
}