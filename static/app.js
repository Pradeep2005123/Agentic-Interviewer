const startForm = document.getElementById("startForm");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const answersForm = document.getElementById("answersForm");
const authPhase = document.getElementById("authPhase");
const authMessage = document.getElementById("authMessage");
const interviewShell = document.getElementById("interviewShell");
const userBar = document.getElementById("userBar");
const userGreeting = document.getElementById("userGreeting");
const logoutBtn = document.getElementById("logoutBtn");
const messagePanel = document.getElementById("messagePanel");
const proctorPanel = document.getElementById("proctorPanel");
const proctorPreview = document.getElementById("proctorPreview");
const proctorStatus = document.getElementById("proctorStatus");
const startPhase = document.getElementById("startPhase");
const questionPhase = document.getElementById("questionPhase");
const reviewPhase = document.getElementById("reviewPhase");
const evaluationPhase = document.getElementById("evaluationPhase");
const hrRoundPhase = document.getElementById("hrRoundPhase");
const submitAnswersBtn = document.getElementById("submitAnswersBtn");
const evaluateBtn = document.getElementById("evaluateBtn");
const startHrRoundBtn = document.getElementById("startHrRoundBtn");
const submitHrAnswersBtn = document.getElementById("submitHrAnswersBtn");
const endBtn = document.getElementById("endBtn");
const completionCard = document.getElementById("completionCard");
const completionActions = document.getElementById("completionActions");
const anotherAttemptBtn = document.getElementById("anotherAttemptBtn");
const exitInterviewBtn = document.getElementById("exitInterviewBtn");
const reviewList = document.getElementById("reviewList");
const evaluationContent = document.getElementById("evaluationContent");
const hrAnswersForm = document.getElementById("hrAnswersForm");
const finalOutcomeContent = document.getElementById("finalOutcomeContent");
const answerKeyContent = document.getElementById("answerKeyContent");
const reportLinkCard = document.getElementById("reportLinkCard");
const reportLinkInput = document.getElementById("reportLinkInput");
const copyReportLinkBtn = document.getElementById("copyReportLinkBtn");
const interviewType = document.getElementById("interviewType");
const scenarioCategoryWrap = document.getElementById("scenarioCategoryWrap");
const scenarioCategory = document.getElementById("scenarioCategory");
const scenarioContextWrap = document.getElementById("scenarioContextWrap");
const scenarioContext = document.getElementById("scenarioContext");
const spokenLanguage = document.getElementById("spokenLanguage");
const resumeFile = document.getElementById("resumeFile");
const resumeFileName = document.getElementById("resumeFileName");
const defaultModel = document.body.dataset.defaultModel || "llama-3.3-70b-versatile";
const initialAuth = document.body.dataset.authenticated === "true";
const initialUsername = document.body.dataset.username || "";

let mediaRecorder = null;
let activeQuestionId = null;
let recordedChunks = [];
let activeMimeType = "";
let recordingStartedAt = 0;
let malpracticeEnding = false;
let proctorRecorder = null;
let proctorStream = null;
let proctorChunks = [];
let proctorRound = "";

const scenarioTemplates = {
  "app-development": `E-commerce Checkout Failure

You are working on an e-commerce platform. Users report that payments are sometimes deducted, but orders are not created.

Questions:
- What logs or systems would you check first?
- How would you identify whether the issue is in the payment gateway or order service?
- How would you handle affected customers?
- What steps would you take to prevent this in the future?`,
  "website-development": `Slow Web Application

A web application that usually loads in 2 seconds is now taking 10+ seconds during peak hours.

Questions:
- How would you diagnose whether the issue is frontend, backend, or database-related?
- What metrics or tools would you use?
- How would you optimize performance under heavy load?
- Would caching help? Where and how?`,
  "api-development": `E-commerce Checkout Failure

You are working on an e-commerce platform. Users report that payments are sometimes deducted, but orders are not created.

Questions:
- What logs or systems would you check first?
- How would you identify whether the issue is in the payment gateway or order service?
- How would you handle affected customers?
- What steps would you take to prevent this in the future?`,
  "team-management": `Team Conflict Scenario

Two team members strongly disagree on the design approach for a project, delaying progress.

Questions:
- How would you mediate the situation?
- What factors would you consider in choosing the right approach?
- How would you ensure the team stays productive?
- How do you prevent similar conflicts in the future?`,
  "data-recovery": `Data Loss Incident

A bug caused partial deletion of user data in a production database.

Questions:
- What is your immediate response?
- How would you recover the lost data?
- How would you communicate this issue to stakeholders or users?
- What safeguards would you implement afterward?`,
  "product-prioritization": `Feature Prioritization

Your manager asks you to deliver 5 features in a tight deadline, but you estimate only 3 can be completed properly.

Questions:
- How would you communicate this to your manager?
- How would you prioritize which features to build?
- Would you compromise on quality or scope?
- How would you manage stakeholder expectations?`,
};

const defaultState = {
  phase: 0,
  language: "",
  type: "",
  model: defaultModel,
  resume_filename: "",
  resume_profile: {},
  scenario_category: "",
  scenario_context: "",
  questions: [],
  answers: [],
  reviews: [],
  evaluation: {},
  plagiarism_report: {},
  report_link: "",
  hr_questions: [],
  hr_answers: [],
  hr_report_sent: false,
  final_outcome: {},
  answer_key: [],
};

let interviewState = { ...defaultState };
let isAuthenticated = initialAuth;
let currentUsername = initialUsername;
const resumeUploadHint = "PDF, DOCX, TXT, PNG, JPG, JPEG, or WEBP";

function setAuthMessage(text, type = "info") {
  authMessage.className = `auth-message ${type}`;
  authMessage.textContent = text;
}

function setMessage(text, type = "info") {
  messagePanel.className = `panel message ${type}`;
  messagePanel.textContent = text;
}

function toggleVisible(element, visible) {
  element.classList.toggle("hidden", !visible);
}

function setPhasePills(activePhase) {
  const authPill = document.querySelector("[data-auth-pill]");
  if (authPill) {
    authPill.classList.toggle("active", !isAuthenticated);
    authPill.classList.toggle("completed", isAuthenticated);
  }
  document.querySelectorAll("[data-phase-pill]").forEach((pill) => {
    const phase = Number(pill.dataset.phasePill);
    pill.classList.toggle("active", isAuthenticated && phase === activePhase);
    pill.classList.toggle("completed", isAuthenticated && phase < activePhase);
  });
}

function setAuthUi(authenticated, username = "") {
  isAuthenticated = authenticated;
  currentUsername = username;
  toggleVisible(authPhase, !authenticated);
  toggleVisible(interviewShell, authenticated);
  toggleVisible(userBar, authenticated);
  userGreeting.textContent = username ? `Logged in as ${username}` : "Logged in";
  setPhasePills(interviewState.phase ?? 0);
  if (!authenticated) {
    interviewState = { ...defaultState };
    loginForm.reset();
    registerForm.reset();
    startForm.reset();
    resumeFile.value = "";
    resumeFileName.textContent = resumeUploadHint;
    scenarioContext.value = "";
    scenarioCategory.dataset.lastValue = "";
    updateScenarioUi();
  }
}

function updateScenarioUi() {
  const isScenario = interviewType.value === "scenario";
  toggleVisible(scenarioCategoryWrap, isScenario);
  toggleVisible(scenarioContextWrap, isScenario);
  scenarioCategory.required = isScenario;
  scenarioContext.required = isScenario;
}

function applyScenarioTemplate() {
  const template = scenarioTemplates[scenarioCategory.value] || "";
  if (!scenarioContext.value.trim() || scenarioContext.value === scenarioTemplates[scenarioCategory.dataset.lastValue || ""]) {
    scenarioContext.value = template;
  }
  scenarioCategory.dataset.lastValue = scenarioCategory.value;
}

function renderAnswerInputs(container, questions, labelPrefix) {
  container.innerHTML = "";
  questions.forEach((item, index) => {
    const wrapper = document.createElement("label");
    wrapper.className = "qa-card";

    const questionId = item.id || `${labelPrefix.toLowerCase().replace(/\s+/g, "-")}-${index + 1}`;
    const number = document.createElement("span");
    number.className = "question-number";
    number.textContent = `${labelPrefix} ${index + 1}`;

    const question = document.createElement("strong");
    question.textContent = item.question || item.text || "Question unavailable. Please generate again.";

    const textarea = document.createElement("textarea");
    textarea.rows = 5;
    textarea.dataset.questionId = questionId;
    textarea.placeholder = "Write your answer here...";
    textarea.required = true;

    const audioTools = document.createElement("div");
    audioTools.className = "audio-tools";

    const startButton = document.createElement("button");
    startButton.type = "button";
    startButton.className = "secondary-btn audio-btn";
    startButton.dataset.audioAction = "start";
    startButton.dataset.questionId = questionId;
    startButton.textContent = "Start Recording";

    const stopButton = document.createElement("button");
    stopButton.type = "button";
    stopButton.className = "secondary-btn audio-btn hidden";
    stopButton.dataset.audioAction = "stop";
    stopButton.dataset.questionId = questionId;
    stopButton.textContent = "Stop Recording";

    const audioStatus = document.createElement("span");
    audioStatus.className = "audio-status";
    audioStatus.dataset.audioStatus = questionId;
    audioStatus.textContent = "You can type or record your answer.";

    audioTools.append(startButton, stopButton, audioStatus);
    wrapper.append(number, question, textarea, audioTools);
    container.appendChild(wrapper);
  });
}

function renderQuestions(questions) {
  renderAnswerInputs(answersForm, questions, "Question");
}

function getTranscriptionPrompt() {
  const parts = [
    `Interview type: ${interviewState.type || interviewType.value || "general"}`,
    `Interview focus: ${interviewState.language || "resume based technical skills"}`,
  ];
  if ((interviewState.type || interviewType.value) === "scenario") {
    const activeScenarioCategory = interviewState.scenario_category || scenarioCategory.value || "general";
    const activeScenarioContext = interviewState.scenario_context || scenarioContext.value.trim();
    parts.push(`Scenario category: ${activeScenarioCategory}`);
    if (activeScenarioContext) {
      parts.push(`Scenario context: ${activeScenarioContext}`);
    }
  }
  return parts.join("\n");
}

function findAudioContainer(questionId) {
  return (
    answersForm.querySelector(`[data-audio-action="start"][data-question-id="${questionId}"]`)?.closest(".qa-card") ||
    hrAnswersForm.querySelector(`[data-audio-action="start"][data-question-id="${questionId}"]`)?.closest(".qa-card")
  );
}

function setAudioControls(questionId, isRecording, statusText) {
  const container = findAudioContainer(questionId);
  if (!container) {
    return;
  }
  const startBtn = container.querySelector(`[data-audio-action="start"][data-question-id="${questionId}"]`);
  const stopBtn = container.querySelector(`[data-audio-action="stop"][data-question-id="${questionId}"]`);
  const status = container.querySelector(`[data-audio-status="${questionId}"]`);
  if (startBtn) {
    startBtn.classList.toggle("hidden", isRecording);
    startBtn.disabled = mediaRecorder !== null && activeQuestionId !== questionId;
  }
  if (stopBtn) {
    stopBtn.classList.toggle("hidden", !isRecording);
  }
  if (status) {
    status.textContent = statusText;
  }
}

async function transcribeRecordedAudio(questionId, audioBlob) {
  const formData = new FormData();
  const fileExtension = audioBlob.type.includes("mp4") ? "mp4" : "webm";
  formData.append("audio", audioBlob, `${questionId}.${fileExtension}`);
  formData.append("spoken_language", spokenLanguage.value || "en");
  formData.append("prompt", getTranscriptionPrompt());

  const response = await fetch("/api/transcribe-audio", {
    method: "POST",
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Unable to transcribe audio.");
  }
  return data;
}

function getSupportedMimeType() {
  const mimeTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "",
  ];
  return mimeTypes.find((mimeType) => !mimeType || MediaRecorder.isTypeSupported(mimeType)) || "";
}

async function startRecording(questionId) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Audio recording is not supported in this browser.");
  }
  if (typeof MediaRecorder === "undefined") {
    throw new Error("Audio recording is not supported in this browser.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  recordedChunks = [];
  activeQuestionId = questionId;
  recordingStartedAt = Date.now();
  activeMimeType = getSupportedMimeType();
  mediaRecorder = activeMimeType ? new MediaRecorder(stream, { mimeType: activeMimeType }) : new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      recordedChunks.push(event.data);
    }
  };
  mediaRecorder.onstop = async () => {
    const localQuestionId = activeQuestionId;
    const recordingDurationMs = Date.now() - recordingStartedAt;
    const tracks = mediaRecorder?.stream?.getTracks() || [];
    tracks.forEach((track) => track.stop());
    mediaRecorder = null;
    activeQuestionId = null;
    recordingStartedAt = 0;

    if (!recordedChunks.length) {
      setAudioControls(localQuestionId, false, "No audio captured. Try again.");
      return;
    }

    if (recordingDurationMs < 2000) {
      recordedChunks = [];
      setAudioControls(localQuestionId, false, "Recording was too short. Please record for at least 2 seconds.");
      document.querySelectorAll('[data-audio-action="start"]').forEach((button) => {
        button.disabled = false;
      });
      return;
    }

    const needsTranslation = spokenLanguage.value !== "en";
    setAudioControls(
      localQuestionId,
      false,
      needsTranslation ? "Transcribing and translating to English..." : "Transcribing audio..."
    );
    try {
      const blobType = activeMimeType || recordedChunks[0]?.type || "audio/webm";
      const audioBlob = new Blob(recordedChunks, { type: blobType });
      const result = await transcribeRecordedAudio(localQuestionId, audioBlob);
      const text = (result.text || "").trim();
      if (!text) {
        throw new Error("No text was produced from the recording. Please try again.");
      }
      const textarea =
        answersForm.querySelector(`textarea[data-question-id="${localQuestionId}"]`) ||
        hrAnswersForm.querySelector(`textarea[data-question-id="${localQuestionId}"]`);
      if (textarea) {
        textarea.value = textarea.value ? `${textarea.value}\n${text}` : text;
      }
      const isScenarioQuestion = (interviewState.type || interviewType.value) === "scenario";
      setAudioControls(
        localQuestionId,
        false,
        isScenarioQuestion
          ? "Audio converted to text successfully for this scenario question."
          : result.translated_to_english
            ? "Audio translated to English and added to your answer."
            : "Audio transcribed and added to your answer."
      );
    } catch (error) {
      setAudioControls(localQuestionId, false, error.message);
    } finally {
      recordedChunks = [];
      activeMimeType = "";
      document.querySelectorAll('[data-audio-action="start"]').forEach((button) => {
        button.disabled = false;
      });
    }
  };
  mediaRecorder.start();
  document.querySelectorAll('[data-audio-action="start"]').forEach((button) => {
    button.disabled = button.dataset.questionId !== questionId;
  });
  setAudioControls(questionId, true, "Recording... click stop when you are done.");
}

function stopRecording(questionId) {
  if (mediaRecorder && activeQuestionId === questionId) {
    mediaRecorder.stop();
  }
}

function renderReviews(questions, answers, reviews) {
  reviewList.innerHTML = "";
  renderPlagiarismReport(interviewState.plagiarism_report || {});
  questions.forEach((question, index) => {
    const review = reviews.find((item) => item.id === question.id) || {};
    const answer = answers.find((item) => item.id === question.id) || {};
    const card = document.createElement("article");
    card.className = "review-card";
    card.innerHTML = `
      <div class="review-top">
        <span class="question-number">Question ${index + 1}</span>
        <span class="score-badge">${review.score ?? 0}/5</span>
      </div>
      <h3>${question.question}</h3>
      <p><strong>Your answer:</strong> ${answer.answer || ""}</p>
      <p><strong>Review:</strong> ${review.review || "No review returned."}</p>
      <p><strong>Strength:</strong> ${review.strength || "Not available."}</p>
      <p><strong>Improvement:</strong> ${review.improvement || "Not available."}</p>
    `;
    reviewList.appendChild(card);
  });
}

function renderPlagiarismReport(report) {
  if (!report || !Object.keys(report).length) {
    return;
  }
  const riskClass = String(report.overall_risk || "LOW").toLowerCase();
  const card = document.createElement("article");
  card.className = `evaluation-card originality-card ${riskClass}`;
  card.innerHTML = `
    <div class="score-banner">
      <span>Originality Check</span>
      <strong>${report.overall_risk || "LOW"} Risk</strong>
    </div>
    <p><strong>Summary:</strong> ${report.summary || "No originality concerns detected."}</p>
    <p><strong>Note:</strong> ${report.note || "AI-based originality risk only; no external plagiarism database was checked."}</p>
    <div class="correction-grid">
      ${(report.results || []).map((item, index) => `
        <article class="correction-card">
          <span class="question-number">Answer ${index + 1} - ${item.risk_level || "LOW"} ${item.risk_percent ?? 0}%</span>
          <p><strong>Reason:</strong> ${item.reason || "No concern found."}</p>
          <p><strong>Tip:</strong> ${item.originality_tip || "Use your own examples and explain your thinking."}</p>
        </article>
      `).join("")}
    </div>
  `;
  reviewList.appendChild(card);
}

function renderEvaluation(evaluation) {
  evaluationContent.innerHTML = `
    <article class="evaluation-card">
      <div class="score-banner">
        <span>Overall Score</span>
        <strong>${evaluation.overall_score ?? 0}/25</strong>
      </div>
      <p><strong>Rating:</strong> ${evaluation.rating || "Not available"}</p>
      <p><strong>Summary:</strong> ${evaluation.summary || "Not available"}</p>
      <p><strong>Recommendation:</strong> ${evaluation.recommendation || "Not available"}</p>
      <div class="list-block">
        <strong>Strengths</strong>
        <ul>${(evaluation.strengths || []).map((item) => `<li>${item}</li>`).join("")}</ul>
      </div>
      <div class="list-block">
        <strong>Improvements</strong>
        <ul>${(evaluation.improvements || []).map((item) => `<li>${item}</li>`).join("")}</ul>
      </div>
    </article>
  `;
}

function renderHrRoundQuestions(questions) {
  renderAnswerInputs(hrAnswersForm, questions, "HR Question");
}

function renderFinalOutcome(finalOutcome) {
  if (!finalOutcome || !Object.keys(finalOutcome).length) {
    finalOutcomeContent.classList.add("hidden");
    finalOutcomeContent.innerHTML = "";
    return;
  }

  finalOutcomeContent.classList.remove("hidden");
  finalOutcomeContent.innerHTML = `
    <article class="evaluation-card">
      <div class="score-banner">
        <span>Interview Result</span>
        <strong>${finalOutcome.status || "Not available"}</strong>
      </div>
      <p><strong>Readiness:</strong> ${finalOutcome.readiness || "Not available"}</p>
      <p><strong>Summary:</strong> ${finalOutcome.final_summary || "Not available"}</p>
      <p><strong>Decision Reason:</strong> ${finalOutcome.decision_reason || "Not available"}</p>
      <div class="list-block">
        <strong>Practical Corrections</strong>
        <div class="correction-grid">
          ${(finalOutcome.topic_corrections || []).map((item) => `
            <article class="correction-card">
              <span class="question-number">${item.topic || "Topic"}</span>
              <p><strong>What went wrong:</strong> ${item.issue || "Not available"}</p>
              <p><strong>Fix now:</strong> ${item.correction || "Not available"}</p>
              <p><strong>Practice next:</strong> ${item.practice || "Not available"}</p>
            </article>
          `).join("")}
        </div>
      </div>
      <div class="list-block">
        <strong>Future Interview Roadmap</strong>
        <div class="roadmap-flow">
          ${(finalOutcome.roadmap || []).map((item, index, arr) => `
            <div class="roadmap-step">
              <div class="roadmap-node">
                <span class="roadmap-badge">${item.step || `Step ${index + 1}`}</span>
                <h3>${item.title || item.focus || `Stage ${index + 1}`}</h3>
                <p><strong>Focus:</strong> ${item.focus || "Not available"}</p>
                <p><strong>Action:</strong> ${item.action || "Not available"}</p>
                <p><strong>Outcome:</strong> ${item.outcome || "Not available"}</p>
              </div>
              ${index < arr.length - 1 ? '<div class="roadmap-arrow">&rarr;</div>' : ""}
            </div>
          `).join("")}
        </div>
      </div>
    </article>
  `;
}

function renderAnswerKey(answerKey) {
  if (!answerKey || !answerKey.length) {
    answerKeyContent.classList.add("hidden");
    answerKeyContent.innerHTML = "";
    return;
  }

  answerKeyContent.classList.remove("hidden");
  answerKeyContent.innerHTML = `
    <div class="panel-header">
      <h2>Answer Comparison</h2>
      <p>See what you answered in each phase and what a stronger answer should have included.</p>
    </div>
    ${(answerKey || []).map((item, index) => `
      <article class="review-card">
        <div class="review-top">
          <span class="question-number">${item.phase || "Round"} ${index + 1}</span>
        </div>
        <h3>${item.question || "Question"}</h3>
        <p><strong>Your answer:</strong> ${item.candidate_answer || "Not available"}</p>
        <p><strong>Expected answer:</strong> ${item.expected_answer || "Not available"}</p>
        <p><strong>What was missing:</strong> ${item.gap || "Not available"}</p>
        <p><strong>How to improve:</strong> ${item.improvement_tip || "Not available"}</p>
      </article>
    `).join("")}
  `;
}

function renderReportLink(reportLink) {
  if (!reportLink) {
    reportLinkCard.classList.add("hidden");
    reportLinkInput.value = "";
    return;
  }
  reportLinkCard.classList.remove("hidden");
  reportLinkInput.value = reportLink;
}

function isTestActive() {
  return interviewState.phase === 1 || interviewState.phase === 4;
}

function getSupportedVideoMimeType() {
  const mimeTypes = [
    "video/webm;codecs=vp8",
    "video/webm",
    "",
  ];
  return mimeTypes.find((mimeType) => !mimeType || MediaRecorder.isTypeSupported(mimeType)) || "";
}

async function uploadProctoringVideo(videoBlob, round, reason) {
  if (!videoBlob || !videoBlob.size) {
    return;
  }
  const formData = new FormData();
  formData.append("video", videoBlob, `${round || "interview"}-${Date.now()}.webm`);
  formData.append("round", round || "interview");
  formData.append("reason", reason || "completed");

  const response = await fetch("/api/upload-proctoring", {
    method: "POST",
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Unable to upload proctoring video.");
  }
}

async function startProctoring(round) {
  if (proctorRecorder || proctorStream) {
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("Camera recording is not supported in this browser.");
  }
  proctorRound = round;
  proctorChunks = [];
  proctorStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  proctorPreview.srcObject = proctorStream;
  proctorStatus.textContent = "Camera recording is active. Please stay on this tab until the round is complete.";

  const mimeType = getSupportedVideoMimeType();
  proctorRecorder = mimeType ? new MediaRecorder(proctorStream, { mimeType }) : new MediaRecorder(proctorStream);
  proctorRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      proctorChunks.push(event.data);
    }
  };
  proctorRecorder.start();
}

function stopProctoring(reason = "completed") {
  return new Promise((resolve) => {
    if (!proctorRecorder && !proctorStream) {
      resolve();
      return;
    }

    const activeRecorder = proctorRecorder;
    const activeStream = proctorStream;
    const activeRound = proctorRound;

    const finish = async () => {
      const chunks = proctorChunks;
      proctorRecorder = null;
      proctorStream = null;
      proctorRound = "";
      proctorChunks = [];
      proctorPreview.srcObject = null;
      if (activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
      }
      if (chunks.length) {
        const blobType = chunks[0]?.type || "video/webm";
        try {
          await uploadProctoringVideo(new Blob(chunks, { type: blobType }), activeRound, reason);
          proctorStatus.textContent = "Camera recording saved.";
        } catch (error) {
          proctorStatus.textContent = error.message;
        }
      }
      resolve();
    };

    if (activeRecorder && activeRecorder.state !== "inactive") {
      activeRecorder.onstop = finish;
      activeRecorder.stop();
    } else {
      finish();
    }
  });
}

function stopActiveRecording() {
  if (!mediaRecorder) {
    return;
  }
  const tracks = mediaRecorder.stream?.getTracks() || [];
  tracks.forEach((track) => track.stop());
  mediaRecorder = null;
  activeQuestionId = null;
  recordedChunks = [];
  activeMimeType = "";
  recordingStartedAt = 0;
}

function showMalpracticeEndState() {
  interviewState = { ...defaultState };
  startForm.reset();
  resumeFile.value = "";
  scenarioContext.value = "";
  scenarioCategory.dataset.lastValue = "";
  updateScenarioUi();
  syncUi(interviewState);
  setMessage("Your test has ended because you switched tabs. You have malpracticed it.", "error");
}

async function endTestForMalpractice() {
  if (malpracticeEnding || !isTestActive()) {
    return;
  }
  malpracticeEnding = true;
  stopActiveRecording();
  await stopProctoring("tab_switch");
  showMalpracticeEndState();

  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/end", new Blob(["{}"], { type: "application/json" }));
    return;
  }

  fetch("/api/end", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    keepalive: true,
  }).catch(() => {});
}

function syncUi(state) {
  interviewState = { ...interviewState, ...state };
  const phase = interviewState.phase ?? 0;
  setPhasePills(phase);
  toggleVisible(startPhase, phase === 0);
  toggleVisible(questionPhase, phase === 1);
  toggleVisible(reviewPhase, phase === 2);
  toggleVisible(evaluationPhase, phase === 3);
  toggleVisible(hrRoundPhase, phase === 4 || phase === 5);
  toggleVisible(proctorPanel, phase === 1 || phase === 4);

  if (phase === 1) {
    renderQuestions(interviewState.questions || []);
    setMessage("Your 5 questions are ready. Submit all answers to continue to review.", "success");
    startProctoring("technical").catch((error) => {
      setMessage(error.message, "error");
    });
  } else if (phase === 2) {
    renderReviews(interviewState.questions || [], interviewState.answers || [], interviewState.reviews || []);
    setMessage("Each answer has been reviewed, scored, and checked for originality risk.", "success");
  } else if (phase === 3) {
    renderEvaluation(interviewState.evaluation || {});
    renderReportLink(interviewState.report_link || "");
    setMessage("Final evaluation is ready. Share the report with HR and begin the final HR round.", "success");
  } else if (phase === 4) {
    renderHrRoundQuestions(interviewState.hr_questions || []);
    renderFinalOutcome({});
    renderAnswerKey([]);
    renderReportLink(interviewState.report_link || "");
    submitHrAnswersBtn.classList.remove("hidden");
    completionCard.classList.add("hidden");
    completionActions.classList.add("hidden");
    setMessage("HR round questions are ready based on the evaluation report.", "success");
    startProctoring("hr").catch((error) => {
      setMessage(error.message, "error");
    });
  } else if (phase === 5) {
    renderHrRoundQuestions(interviewState.hr_questions || []);
    renderFinalOutcome(interviewState.final_outcome || {});
    renderAnswerKey(interviewState.answer_key || []);
    renderReportLink(interviewState.report_link || "");
    submitHrAnswersBtn.classList.add("hidden");
    completionCard.classList.remove("hidden");
    completionActions.classList.remove("hidden");
    setPhasePills(5);
    setMessage("Thank you for using Online Agentic Interviewer. You can submit another attempt or exit.", "success");
  } else {
    malpracticeEnding = false;
    renderReportLink("");
    renderFinalOutcome({});
    renderAnswerKey([]);
    submitHrAnswersBtn.classList.remove("hidden");
    completionCard.classList.add("hidden");
    completionActions.classList.add("hidden");
    setMessage("Start a new interview by uploading a resume and selecting a category.", "info");
  }
}

async function apiRequest(url, method = "GET", body) {
  const options = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      setAuthUi(false);
      setAuthMessage(data.error || "Please login again.", "error");
    }
    throw new Error(data.error || "Something went wrong.");
  }
  return data;
}

async function authRequest(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Authentication failed.");
  }
  return data;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthMessage("Logging in...", "info");
  try {
    const data = await authRequest("/api/login", {
      email: document.getElementById("loginEmail").value,
      password: document.getElementById("loginPassword").value,
    });
    interviewState = { ...defaultState, ...(data.interview || {}) };
    setAuthUi(true, data.user?.name || "");
    syncUi(interviewState);
    setMessage("Login successful. Upload a resume to begin.", "success");
  } catch (error) {
    setAuthMessage(error.message, "error");
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAuthMessage("Creating account...", "info");
  try {
    const data = await authRequest("/api/register", {
      name: document.getElementById("registerName").value,
      email: document.getElementById("registerEmail").value,
      password: document.getElementById("registerPassword").value,
    });
    interviewState = { ...defaultState, ...(data.interview || {}) };
    setAuthUi(true, data.user?.name || "");
    syncUi(interviewState);
    setMessage("Registration successful. Upload a resume to begin.", "success");
  } catch (error) {
    setAuthMessage(error.message, "error");
  }
});

logoutBtn.addEventListener("click", async () => {
  setMessage("Logging out...", "info");
  try {
    await stopProctoring("logout");
    await apiRequest("/api/logout", "POST");
  } catch (error) {
    // The UI should still leave the protected area even if the server session already expired.
  }
  setAuthUi(false);
  setAuthMessage("You have logged out.", "success");
});

startForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!resumeFile.files.length) {
    setMessage("Please upload a resume before generating questions.", "error");
    return;
  }
  setMessage("Reading resume and generating 5 interview questions...", "info");
  try {
    const formData = new FormData();
    formData.append("resume", resumeFile.files[0]);
    formData.append("interview_type", interviewType.value);
    formData.append("model_name", interviewState.model);
    formData.append("scenario_category", scenarioCategory.value);
    formData.append("scenario_context", scenarioContext.value.trim());

    const response = await fetch("/api/start", {
      method: "POST",
      body: formData,
    });
    const state = await response.json();
    if (!response.ok) {
      throw new Error(state.error || "Something went wrong.");
    }
    if (state.scenario_category) {
      scenarioCategory.value = state.scenario_category;
    }
    if (state.scenario_context) {
      scenarioContext.value = state.scenario_context;
    }
    syncUi(state);
  } catch (error) {
    setMessage(error.message, "error");
  }
});

submitAnswersBtn.addEventListener("click", async () => {
  const answers = Array.from(answersForm.querySelectorAll("textarea")).map((textarea) => ({
    id: textarea.dataset.questionId,
    answer: textarea.value.trim(),
  }));

  const emptyAnswers = answers.filter((item) => !item.answer);
  if (emptyAnswers.length) {
    setMessage("Some answers are still empty. Type them manually or record again before submitting.", "error");
    return;
  }

  setMessage("Reviewing answers, assigning scores, and checking originality...", "info");
  try {
    const state = await apiRequest("/api/submit-answers", "POST", {
      language: interviewState.language,
      interview_type: interviewState.type,
      model_name: interviewState.model,
      questions: interviewState.questions,
      answers,
    });
    await stopProctoring("technical_submitted");
    syncUi(state);
  } catch (error) {
    setMessage(error.message, "error");
  }
});

answersForm.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-audio-action]");
  if (!button) {
    return;
  }

  const questionId = button.dataset.questionId;
  const action = button.dataset.audioAction;

  try {
    if (action === "start") {
      await startRecording(questionId);
    } else if (action === "stop") {
      stopRecording(questionId);
    }
  } catch (error) {
    setAudioControls(questionId, false, error.message);
  }
});

hrAnswersForm.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-audio-action]");
  if (!button) {
    return;
  }

  const questionId = button.dataset.questionId;
  const action = button.dataset.audioAction;

  try {
    if (action === "start") {
      await startRecording(questionId);
    } else if (action === "stop") {
      stopRecording(questionId);
    }
  } catch (error) {
    setAudioControls(questionId, false, error.message);
  }
});

evaluateBtn.addEventListener("click", async () => {
  setMessage("Generating final evaluation...", "info");
  try {
    const state = await apiRequest("/api/evaluate", "POST", {
      language: interviewState.language,
      interview_type: interviewState.type,
      model_name: interviewState.model,
      questions: interviewState.questions,
      answers: interviewState.answers,
      reviews: interviewState.reviews,
    });
    syncUi(state);
  } catch (error) {
    setMessage(error.message, "error");
  }
});

startHrRoundBtn.addEventListener("click", async () => {
  setMessage("Uploading evaluation report to HR and preparing the HR round...", "info");
  try {
    const state = await apiRequest("/api/start-hr-round", "POST");
    syncUi(state);
  } catch (error) {
    setMessage(error.message, "error");
  }
});

submitHrAnswersBtn.addEventListener("click", async () => {
  const answers = Array.from(hrAnswersForm.querySelectorAll("textarea")).map((textarea) => ({
    id: textarea.dataset.questionId,
    answer: textarea.value.trim(),
  }));

  const emptyAnswers = answers.filter((item) => !item.answer);
  if (emptyAnswers.length) {
    setMessage("Some HR answers are still empty. Type them manually or record again before submitting.", "error");
    return;
  }

  setMessage("Submitting HR round answers...", "info");
  try {
    const state = await apiRequest("/api/submit-hr-answers", "POST", { answers });
    await stopProctoring("hr_submitted");
    syncUi(state);
  } catch (error) {
    setMessage(error.message, "error");
  }
});

endBtn.addEventListener("click", async () => {
  setMessage("Ending interview and clearing progress...", "info");
  try {
    await stopProctoring("ended");
    const state = await apiRequest("/api/end", "POST");
    interviewState = { ...defaultState, ...state };
    startForm.reset();
    resumeFile.value = "";
    resumeFileName.textContent = resumeUploadHint;
    scenarioContext.value = "";
    scenarioCategory.dataset.lastValue = "";
    updateScenarioUi();
    syncUi(interviewState);
  } catch (error) {
    setMessage(error.message, "error");
  }
});

anotherAttemptBtn.addEventListener("click", async () => {
  setMessage("Preparing another attempt...", "info");
  try {
    await stopProctoring("another_attempt");
    const state = await apiRequest("/api/end", "POST");
    interviewState = { ...defaultState, ...state };
    startForm.reset();
    resumeFile.value = "";
    resumeFileName.textContent = resumeUploadHint;
    scenarioContext.value = "";
    scenarioCategory.dataset.lastValue = "";
    updateScenarioUi();
    syncUi(interviewState);
  } catch (error) {
    setMessage(error.message, "error");
  }
});

exitInterviewBtn.addEventListener("click", async () => {
  setMessage("Thank you for using Online Agentic Interviewer. Exiting now...", "info");
  try {
    await stopProctoring("exit");
    await apiRequest("/api/logout", "POST");
  } catch (error) {
    // Still move the user out of the interview area if the session already ended.
  }
  setAuthUi(false);
  setAuthMessage("Thank you for using Online Agentic Interviewer. You have exited successfully.", "success");
});

copyReportLinkBtn.addEventListener("click", async () => {
  if (!reportLinkInput.value) {
    return;
  }
  try {
    await navigator.clipboard.writeText(reportLinkInput.value);
    setMessage("HR report link copied.", "success");
  } catch (error) {
    reportLinkInput.select();
    document.execCommand("copy");
    setMessage("HR report link copied.", "success");
  }
});

interviewType.addEventListener("change", () => {
  updateScenarioUi();
});

scenarioCategory.addEventListener("change", () => {
  applyScenarioTemplate();
});

resumeFile.addEventListener("change", () => {
  resumeFileName.textContent = resumeFile.files[0]?.name || resumeUploadHint;
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    endTestForMalpractice();
  }
});

window.addEventListener("DOMContentLoaded", async () => {
  updateScenarioUi();
  setAuthUi(isAuthenticated, currentUsername);
  if (!isAuthenticated) {
    setAuthMessage("Please login or create an account to continue.", "info");
    return;
  }
  try {
    const state = await apiRequest("/api/state");
    syncUi(state);
  } catch (error) {
    setMessage(error.message, "error");
  }
});
