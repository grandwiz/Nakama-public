// A bounded convenience policy, not another inference call or a change to the
// saved role. Detailed/project/manual work keeps its configured effort.
export function needsDetailedReasoning(message) {
  if (
    /\b(?:debug|bugs?|crash(?:es|ing)?|errors?|refactor|implement|development|test suite)\b/i.test(
      message,
    )
  )
    return true;
  return (
    message.length > 500 ||
    message.trim().split(/\s+/).length > 70 ||
    /[`{}]|<\/?[a-z][^>]*>/i.test(message) ||
    /\b(?:detailed|detail|thorough(?:ly)?|comprehensive|exhaustive|extensive|analysis|analytical|complex|complicated|deep(?:ly)?|in[ -]depth|in full|every possible|expand|longer|ultra|ultracode|xhigh|maximum|max effort|high effort|step[ -]by[ -]step|take your time|think (?:hard|carefully)|research|investigate|analyse|analyze|solve|prove|derive|diagnos\w*|medicat\w*|dosage|symptoms?|treatment|chest pain|trouble breathing|insulin|suicid\w*|legal|lawsuit|invest(?:ing|ment)?|mortgage|financial|technical|security|database|cryptograph\w*|code|coding|repository|source|files?|architecture|algorithm)\b/i.test(
      message,
    )
  );
}
export function fasterReply(
  routing,
  message,
  { enabled, projectId, providers = [] } = {},
) {
  if (
    !enabled ||
    routing.pipeline ||
    routing.deepWork ||
    !["chat", "tasks.general"].includes(routing.role)
  )
    return routing;
  if (needsDetailedReasoning(message)) return routing;
  const target = routing.role === "chat" ? "low" : "medium";
  const efforts = [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
    "ultra",
    "ultracode",
  ];
  const configured = efforts.indexOf(routing.effort);
  // A provider-managed default is unknown; never replace it with an assumed
  // effort, or raise a role the owner has already set lower.
  if (configured < 0) return routing;
  const effort = configured > efforts.indexOf(target) ? target : routing.effort;
  const provider = providers.find((item) => item.id === routing.providerId);
  const model = provider?.modelDetails?.find((item) =>
    routing.model ? item.id === routing.model : item.isDefault,
  );
  if (model && !model.efforts?.includes(effort)) return routing;
  return {
    ...routing,
    effort,
    configuredEffort: routing.effort,
    fastReply: true,
    reason: `${routing.reason} Faster everyday replies is on: same model, ${effort} effort. Detailed work keeps its saved effort.`,
  };
}

export const FAST_CHAT_INSTRUCTIONS =
  "This is a short everyday conversation. Give a direct, concise answer, usually one to three short sentences, without an unnecessary introduction or project exploration. Preserve accuracy and necessary qualifications. If the user asks for detail or the question needs a longer answer, provide it. Never invent a tool result or current fact.";
