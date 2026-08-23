const embedded = window.self !== window.top;
const desktopPet = embedded ? window.parent.desktopPet : window.desktopPet;
document.body.classList.toggle("embedded", embedded);

const title = document.getElementById("title");
const detail = document.getElementById("detail");
const stop = document.getElementById("stop");
const questions = document.getElementById("questions");
const actions = document.getElementById("actions");
const pager = document.getElementById("pager");
const pageLabel = document.getElementById("page-label");
const previousQuestion = document.getElementById("previous-question");
const nextQuestion = document.getElementById("next-question");
let context;
let interactionId;
let renderedLauncherId;
let questionIndex = 0;
let uiScale = 1;
let resizeQueued = false;
let lastReportedHeight = 0;
const answers = new Map();
const labels = {
  thinking: "正在思考", streaming: "正在回复", working: "正在执行工具", waiting: "等待你的确认",
  success: "任务已完成", error: "任务执行失败", cancelled: "任务已取消", blocked: "任务被阻塞", idle: "等待任务"
};
desktopPet.onDialogTheme(theme => window.AsterPet.applyDialogTheme(theme));
desktopPet.getDialogThemes()
  .then(state => window.AsterPet.applyDialogTheme(state.current))
  .catch(() => {});

function button(label, callback, className = "") {
  const element = document.createElement("button");
  element.textContent = label;
  element.className = className;
  element.onclick = callback;
  return element;
}

function resize() {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    document.body.classList.add("measuring");
    const height = document.getElementById("card").scrollHeight + 12;
    document.body.classList.remove("measuring");
    if (height === lastReportedHeight) return;
    lastReportedHeight = height;
    desktopPet.resizeStatus(height);
  });
}

function sendAnswers(interaction) {
  return desktopPet.respondInteraction({
    rpcId: interaction.rpcId,
    answers: (interaction.questions || []).map(question => {
      const answer = answers.get(question.id) || { id: question.id, selected: [] };
      const custom = answer.custom?.trim() || "";
      return {
        id: question.id,
        selected: custom === "" || question.multiSelect ? answer.selected : [],
        ...(custom ? { custom } : {})
      };
    })
  });
}

const launcherView = new window.AsterPet.LauncherView({
  desktopPet,
  embedded,
  questions,
  actions,
  pager,
  stop,
  button,
  resize,
  getScale: () => uiScale
});

function renderQuestion(interaction) {
  launcherView.deactivate();
  questions.replaceChildren();
  const list = interaction.questions || [];
  const question = list[questionIndex];
  pager.hidden = list.length <= 1;
  pageLabel.textContent = `${questionIndex + 1} / ${list.length}`;
  previousQuestion.disabled = questionIndex === 0;
  nextQuestion.disabled = questionIndex >= list.length - 1;
  if (!question) { resize(); return; }
  const block = document.createElement("div");
  block.className = "question";
  const questionText = document.createElement("div");
  questionText.className = "question-text";
  questionText.textContent = question.question;
  block.append(questionText);
  if (question.detail) {
    const questionDetail = document.createElement("div");
    questionDetail.className = "question-detail";
    questionDetail.textContent = question.detail;
    block.append(questionDetail);
  }
  const options = document.createElement("div");
  options.className = "options";
  const current = answers.get(question.id) || { id: question.id, selected: [] };
  for (const option of question.options || []) {
    const choice = button("", () => {
      const previous = answers.get(question.id) || { id: question.id, selected: [] };
      const selected = question.multiSelect
        ? previous.selected.includes(option.label)
          ? previous.selected.filter(item => item !== option.label)
          : [...previous.selected, option.label]
        : [option.label];
      answers.set(question.id, { id: question.id, selected, custom: question.multiSelect ? previous.custom : "" });
      if (!question.multiSelect && questionIndex < list.length - 1) questionIndex += 1;
      renderQuestion(interaction);
    });
    const optionLabel = document.createElement("span");
    optionLabel.className = "option-label";
    optionLabel.textContent = option.label;
    choice.append(optionLabel);
    if (option.description) {
      const optionDescription = document.createElement("span");
      optionDescription.className = "option-description";
      optionDescription.textContent = option.description;
      choice.append(optionDescription);
    }
    choice.classList.toggle("selected", current.selected.includes(option.label));
    options.append(choice);
  }
  const custom = document.createElement("input");
  custom.placeholder = "输入其他回复…";
  custom.value = current.custom || "";
  custom.oninput = () => answers.set(question.id, {
    id: question.id,
    selected: question.multiSelect ? (answers.get(question.id)?.selected || []) : [],
    custom: custom.value
  });
  custom.onkeydown = event => {
    if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    answers.set(question.id, {
      id: question.id,
      selected: question.multiSelect ? (answers.get(question.id)?.selected || []) : [],
      custom: custom.value
    });
    sendAnswers(interaction);
  };
  block.append(options, custom);
  questions.append(block);
  resize();
}

function render(interaction) {
  questions.replaceChildren();
  actions.replaceChildren();
  pager.hidden = true;
  if (!interaction) { launcherView.deactivate(); resize(); return; }
  if (interaction.kind === "launcher") { launcherView.render(interaction); return; }
  if (interaction.kind === "launcher-error") { launcherView.renderError(interaction); return; }
  launcherView.deactivate();
  if (interaction.rpcId !== interactionId) {
    interactionId = interaction.rpcId;
    questionIndex = 0;
    answers.clear();
  }
  detail.textContent = interaction.message || "等待你的操作";
  if (interaction.kind === "approval") {
    actions.append(
      button("允许一次", () => desktopPet.respondInteraction({ rpcId: interaction.rpcId, outcome: "allowed-once" }), "primary"),
      button("拒绝", () => desktopPet.respondInteraction({ rpcId: interaction.rpcId, outcome: "rejected" }))
    );
    resize();
    return;
  }
  renderQuestion(interaction);
  actions.append(button("发送回复", () => sendAnswers(interaction), "primary"));
}

previousQuestion.onclick = () => {
  if (questionIndex > 0) { questionIndex -= 1; renderQuestion(context.interaction); }
};
nextQuestion.onclick = () => {
  if (questionIndex < context.interaction.questions.length - 1) { questionIndex += 1; renderQuestion(context.interaction); }
};
desktopPet.onAgentContext(payload => {
  context = payload;
  title.textContent = payload.interaction?.title || payload.title || payload.driver?.name || "外部 AI";
  const isLauncher = Boolean(payload.interaction?.kind?.startsWith("launcher"));
  document.body.classList.toggle("launcher-view", isLauncher);
  detail.textContent = isLauncher
    ? (payload.interaction.kind === "launcher-error" ? "连接失败" : "配置会话并发送消息")
    : payload.detail || labels[payload.state] || payload.state;
  stop.textContent = isLauncher ? "关闭" : "停止";
  stop.hidden = payload.state === "idle" && !payload.interaction;
  const launcherId = isLauncher ? payload.interaction.rpcId : undefined;
  if (launcherId && launcherId === renderedLauncherId) {
    resize();
    return;
  }
  renderedLauncherId = launcherId;
  render(payload.interaction);
});
desktopPet.onStatusSide(side => { document.body.dataset.side = side; });
desktopPet.onStatusScale(scale => {
  uiScale = scale;
  document.documentElement.style.setProperty("--ui-scale", String(scale));
  resize();
});
desktopPet.onResetStatusView(() => {
  questions.scrollTop = 0;
  window.scrollTo(0, 0);
});
stop.onclick = () => context?.interaction?.kind?.startsWith("launcher")
  ? desktopPet.closeLauncher()
  : desktopPet.cancelAgent(context?.sessionId);
