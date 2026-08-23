function textFromContent(content) {
  if (!Array.isArray(content)) return "";
  return content.filter(part => part?.type === "text").map(part => part.text).join(" ").trim();
}

function agentState(state, payload, event, detail) {
  return {
    type: "agent-state",
    state,
    sessionId: payload.sessionId,
    source: "dsh",
    detail,
    seq: event?.seq,
    timestamp: event?.time || Date.now()
  };
}

function mapTurnEnd(payload, event) {
  const reason = event.data?.reason || {};
  if (reason.kind === "completed") return agentState("success", payload, event, "任务已完成");
  if (reason.kind === "blocked") return agentState("blocked", payload, event, "任务被阻塞");
  if (reason.kind === "aborted" || reason.kind === "cancelled") {
    return agentState("cancelled", payload, event, "任务已取消");
  }
  if (reason.kind === "interrupted") return agentState("cancelled", payload, event, "任务意外中断");
  if (reason.kind === "max-tokens") return agentState("error", payload, event, "任务达到输出上限");
  return agentState("error", payload, event, reason.error?.message || "任务执行失败");
}

function mapSessionEvent(payload) {
  const event = payload.event;
  if (!event || typeof event.type !== "string") return [];
  if (event.type === "user/message") {
    const title = textFromContent(event.data?.content);
    return title
      ? [{ type: "user-message", sessionId: payload.sessionId, title: title.slice(0, 160) }]
      : [];
  }
  if (event.type === "turn/start" || event.type === "step/start") {
    return [agentState("thinking", payload, event, "正在思考")];
  }
  if (event.type === "assistant/chunk") {
    const chunk = event.data?.chunk;
    if (chunk?.type === "text-delta") return [agentState("streaming", payload, event, "正在回复")];
    if (chunk?.type === "tool-call-delta") return [agentState("working", payload, event, "正在准备工具调用")];
    if (chunk?.type === "reasoning-delta") return [agentState("thinking", payload, event, "正在深入分析")];
    if (chunk?.type === "block-start") {
      if (chunk.blockType === "text") return [agentState("streaming", payload, event, "正在回复")];
      if (chunk.blockType === "reasoning") return [agentState("thinking", payload, event, "正在深入分析")];
      if (chunk.blockType === "tool-call") return [agentState("working", payload, event, "正在准备工具调用")];
    }
    return [];
  }
  if (event.type === "tool/call") {
    const toolName = typeof event.data?.name === "string" ? event.data.name : "工具";
    return [agentState("working", payload, event, `正在执行 ${toolName}`)];
  }
  if (event.type === "tool/result") {
    return [agentState("thinking", payload, event, "正在处理工具结果")];
  }
  if (event.type === "turn/end") return [mapTurnEnd(payload, event)];
  return [];
}

function mapDshEnvelope(envelope) {
  const payload = envelope?.payload;
  if (!payload || typeof payload.type !== "string") return [];
  const events = [];
  if (payload.type === "session/event") {
    events.push(...mapSessionEvent(payload));
  } else if (payload.type === "approval/requested") {
    events.push(agentState("waiting", payload, undefined, "等待你的确认"));
    events.push({ type: "interaction-requested", interaction: {
      kind: "approval", rpcId: envelope.rpcId, sessionId: payload.sessionId,
      approvalId: payload.approvalId, title: `权限申请 · ${payload.toolName}`,
      message: payload.reason || "此操作需要你的确认"
    } });
  } else if (payload.type === "question/requested") {
    events.push(agentState("waiting", payload, undefined, "等待你的回复"));
    events.push({ type: "interaction-requested", interaction: {
      kind: "question", rpcId: envelope.rpcId, sessionId: payload.sessionId,
      title: payload.questions?.[0]?.header || "需要你的回复", questions: payload.questions || []
    } });
  } else if (payload.type === "approval/resolved") {
    events.push({ type: "interaction-resolved", approvalId: payload.approvalId });
  } else if (payload.type === "question/resolved") {
    events.push({ type: "interaction-resolved", rpcId: payload.questionRpcId });
  } else if (payload.type === "host/session-status") {
    events.push({ type: "agent-running", sessionId: payload.sessionId, running: payload.running, source: "dsh" });
  } else if (payload.type === "host/agent-error") {
    events.push(agentState("error", payload, undefined, payload.message || "Agent 执行失败"));
  }
  return events;
}

module.exports = { mapDshEnvelope, mapSessionEvent };
