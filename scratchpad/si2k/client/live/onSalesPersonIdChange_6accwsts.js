(async () => {
  const agentID = arguments[0].value;

  const resAgent = await db.collection('agent').doc(agentID).get();
  if(!resAgent || !resAgent.data || !resAgent.data.length === 0) return;

  const agentData = resAgent.data[0];
  this.setData({ agent_user_id: agentData.agent_user})
})();