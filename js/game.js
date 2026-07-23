(() => {
  "use strict";

  const SESSION_LENGTH = 20;
  const MAX_LIVES = 5;
  const RESCUE_LIVES = 3;
  const BASE_SCORE = 100;

  const screens = {
    start: document.getElementById("startScreen"),
    game: document.getElementById("gameScreen"),
    results: document.getElementById("resultsScreen")
  };

  const elements = {
    levelSelect: document.getElementById("levelSelect"),
    startButton: document.getElementById("startButton"),
    pauseButton: document.getElementById("pauseButton"),
    playAgainButton: document.getElementById("playAgainButton"),
    changeLevelButton: document.getElementById("changeLevelButton"),
    score: document.getElementById("scoreValue"),
    question: document.getElementById("questionValue"),
    lives: document.getElementById("livesValue"),
    progress: document.getElementById("progressBar"),
    formPrompt: document.getElementById("formPrompt"),
    infinitive: document.getElementById("infinitiveValue"),
    feedback: document.getElementById("feedbackText"),
    arena: document.getElementById("gameArena"),
    pauseOverlay: document.getElementById("pauseOverlay"),
    finalScore: document.getElementById("finalScore"),
    finalCorrect: document.getElementById("finalCorrect"),
    finalAccuracy: document.getElementById("finalAccuracy"),
    highScore: document.getElementById("highScoreValue"),
    resultTitle: document.getElementById("resultTitle"),
    resultMessage: document.getElementById("resultMessage"),
    reviewList: document.getElementById("reviewList")
  };

  const state = {
    level: 1,
    sessionVerbs: [],
    currentIndex: 0,
    targetForm: "past",
    score: 0,
    lives: MAX_LIVES,
    mastered: 0,
    questionHadError: false,
    reviewMap: new Map(),
    fallingItems: [],
    isPaused: false,
    isRunning: false,
    questionResolved: false,
    animationId: null,
    lastTimestamp: 0,
    questionStartedAt: 0,
    audioContext: null
  };

  function shuffle(array) {
    const copy = [...array];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
    }
    return copy;
  }

  function showScreen(screenName) {
    Object.entries(screens).forEach(([name, screen]) => {
      screen.classList.toggle("hidden", name !== screenName);
    });
  }

  function updateHud() {
    elements.score.textContent = state.score.toLocaleString("es-EC");
    elements.question.textContent = Math.min(state.currentIndex + 1, SESSION_LENGTH);
    elements.lives.textContent = "❤️".repeat(state.lives);
    elements.progress.style.width = `${(state.currentIndex / SESSION_LENGTH) * 100}%`;
  }

  function setFeedback(message, type = "") {
    elements.feedback.textContent = message;
    elements.feedback.className = `feedback-text ${type}`.trim();
  }

  function playTone(frequency, duration = 0.11) {
    try {
      if (!state.audioContext) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        state.audioContext = new AudioContextClass();
      }
      const oscillator = state.audioContext.createOscillator();
      const gain = state.audioContext.createGain();
      oscillator.connect(gain);
      gain.connect(state.audioContext.destination);
      oscillator.frequency.value = frequency;
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.06, state.audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, state.audioContext.currentTime + duration);
      oscillator.start();
      oscillator.stop(state.audioContext.currentTime + duration);
    } catch (error) {
      console.debug("Audio unavailable", error);
    }
  }

  function getLevelVerbs(level) {
    if (!Array.isArray(window.IRREGULAR_VERBS)) {
      throw new Error("No se pudo cargar js/verbs.js.");
    }
    return window.IRREGULAR_VERBS.filter((verb) => verb.level === Number(level));
  }

  function makeSession(level) {
    const levelVerbs = getLevelVerbs(level);
    if (levelVerbs.length < SESSION_LENGTH) {
      throw new Error("No hay suficientes verbos para crear una sesión.");
    }
    return shuffle(levelVerbs).slice(0, SESSION_LENGTH);
  }

  function clearFallingItems() {
    state.fallingItems.forEach((item) => item.element.remove());
    state.fallingItems = [];
  }

  function startGame() {
    state.level = Number(elements.levelSelect.value);
    state.sessionVerbs = makeSession(state.level);
    state.currentIndex = 0;
    state.score = 0;
    state.lives = MAX_LIVES;
    state.mastered = 0;
    state.reviewMap.clear();
    state.isPaused = false;
    state.isRunning = true;
    state.questionResolved = false;
    state.lastTimestamp = 0;
    clearFallingItems();
    showScreen("game");
    elements.pauseOverlay.classList.add("hidden");
    elements.pauseButton.textContent = "⏸";
    updateHud();
    beginQuestion();
    elements.arena.focus();
    cancelAnimationFrame(state.animationId);
    state.animationId = requestAnimationFrame(gameLoop);
  }

  function beginQuestion() {
    if (state.currentIndex >= SESSION_LENGTH) {
      finishGame();
      return;
    }

    clearFallingItems();
    state.questionResolved = false;
    state.questionHadError = false;
    state.targetForm = Math.random() < 0.5 ? "past" : "participle";
    state.questionStartedAt = performance.now();

    const verb = state.sessionVerbs[state.currentIndex];
    const targetLabel = state.targetForm === "past" ? "Simple Past" : "Past Participle";
    elements.formPrompt.textContent = `Selecciona el ${targetLabel} de:`;
    elements.infinitive.textContent = verb.infinitive.toUpperCase();
    setFeedback("Haz clic o toca la palabra correcta antes de que caiga.");
    updateHud();

    // Mostrar las opciones inmediatamente. Esto evita que la pantalla parezca congelada.
    spawnOptions(verb);
  }

  function createOptions(verb) {
    const correct = verb[state.targetForm];
    const pool = shuffle(getLevelVerbs(state.level))
      .map((candidate) => candidate[state.targetForm])
      .filter((word) => word !== correct);

    const distractors = [];
    for (const word of pool) {
      if (!distractors.includes(word)) distractors.push(word);
      if (distractors.length === 3) break;
    }

    return shuffle([
      { word: correct, isCorrect: true },
      ...distractors.map((word) => ({ word, isCorrect: false }))
    ]);
  }

  function spawnOptions(verb) {
    const options = createOptions(verb);
    const arenaWidth = elements.arena.clientWidth;
    const columns = options.length;
    const columnWidth = arenaWidth / columns;
    const baseSpeed = { 1: 72, 2: 84, 3: 96 }[state.level];

    options.forEach((option, index) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "falling-word";
      element.textContent = option.word;
      element.dataset.correct = String(option.isCorrect);
      element.setAttribute("aria-label", `Seleccionar ${option.word}`);
      elements.arena.appendChild(element);

      const width = element.offsetWidth;
      const columnStart = index * columnWidth;
      const maxWithinColumn = Math.max(0, columnWidth - width - 10);
      const x = Math.min(
        arenaWidth - width - 6,
        Math.max(6, columnStart + 5 + Math.random() * maxWithinColumn)
      );

      const y = 12 + Math.random() * 34;
      const speed = baseSpeed + Math.random() * 18;

      const item = {
        element,
        x,
        y,
        speed,
        isCorrect: option.isCorrect,
        word: option.word,
        removed: false
      };

      element.addEventListener("click", (event) => {
        event.preventDefault();
        selectItem(item);
      });

      state.fallingItems.push(item);
    });
  }

  function gameLoop(timestamp) {
    if (!state.isRunning) return;

    if (!state.lastTimestamp) state.lastTimestamp = timestamp;
    const deltaSeconds = Math.min((timestamp - state.lastTimestamp) / 1000, 0.04);
    state.lastTimestamp = timestamp;

    if (!state.isPaused && !state.questionResolved) {
      updateFallingItems(deltaSeconds);
    }

    state.animationId = requestAnimationFrame(gameLoop);
  }

  function updateFallingItems(deltaSeconds) {
    const arenaHeight = elements.arena.clientHeight;

    for (const item of state.fallingItems) {
      if (item.removed) continue;
      item.y += item.speed * deltaSeconds;
      item.element.style.transform = `translate(${item.x}px, ${item.y}px)`;

      if (item.y > arenaHeight + 90) {
        missItem(item);
        if (state.questionResolved) break;
      }
    }

    state.fallingItems = state.fallingItems.filter((item) => !item.removed);
  }

  function removeItem(item) {
    item.removed = true;
    item.element.remove();
  }

  function selectItem(item) {
    if (!state.isRunning || state.isPaused || state.questionResolved || item.removed) return;
    removeItem(item);
    if (item.isCorrect) {
      resolveCorrect(item.word);
    } else {
      state.questionHadError = true;
      addCurrentVerbToReview();
      loseLife();
      playTone(190);
      setFeedback(`“${item.word}” no es correcto. Sigue intentando.`, "wrong");
    }
  }

  function missItem(item) {
    removeItem(item);
    if (item.isCorrect) {
      state.questionHadError = true;
      addCurrentVerbToReview();
      loseLife();
      playTone(170, 0.16);
      resolveQuestion(false, `La respuesta correcta era “${item.word}”.`);
    }
  }

  function loseLife() {
    state.lives -= 1;
    if (state.lives <= 0) {
      state.score = Math.max(0, state.score - 200);
      state.lives = RESCUE_LIVES;
      setFeedback("Rescate activado: recuperaste energía, pero perdiste 200 puntos.", "wrong");
    }
    updateHud();
  }

  function addCurrentVerbToReview() {
    const verb = state.sessionVerbs[state.currentIndex];
    state.reviewMap.set(verb.infinitive, verb);
  }

  function resolveCorrect(word) {
    const elapsedSeconds = (performance.now() - state.questionStartedAt) / 1000;
    const speedBonus = Math.max(0, Math.round(50 - elapsedSeconds * 4));
    const cleanBonus = state.questionHadError ? 0 : 35;
    state.score += BASE_SCORE + speedBonus + cleanBonus;
    if (!state.questionHadError) state.mastered += 1;
    playTone(620, 0.12);
    resolveQuestion(true, `¡Correcto! La respuesta es “${word}”.`);
  }

  function resolveQuestion(wasCorrect, message) {
    if (state.questionResolved) return;
    state.questionResolved = true;
    clearFallingItems();
    setFeedback(message, wasCorrect ? "correct" : "wrong");
    updateHud();

    window.setTimeout(() => {
      state.currentIndex += 1;
      elements.progress.style.width = `${(state.currentIndex / SESSION_LENGTH) * 100}%`;
      beginQuestion();
    }, 1000);
  }

  function togglePause() {
    if (!state.isRunning) return;
    state.isPaused = !state.isPaused;
    state.lastTimestamp = 0;
    elements.pauseOverlay.classList.toggle("hidden", !state.isPaused);
    elements.pauseButton.textContent = state.isPaused ? "▶" : "⏸";
    elements.pauseButton.setAttribute("aria-label", state.isPaused ? "Continuar juego" : "Pausar juego");
  }

  function finishGame() {
    state.isRunning = false;
    cancelAnimationFrame(state.animationId);
    clearFallingItems();
    elements.progress.style.width = "100%";

    const accuracy = Math.round((state.mastered / SESSION_LENGTH) * 100);
    const highScoreKey = `verbRainHighScoreLevel${state.level}`;
    const previousHighScore = Number(localStorage.getItem(highScoreKey) || 0);
    const newHighScore = Math.max(previousHighScore, state.score);
    localStorage.setItem(highScoreKey, String(newHighScore));

    elements.finalScore.textContent = state.score.toLocaleString("es-EC");
    elements.finalCorrect.textContent = `${state.mastered}/${SESSION_LENGTH}`;
    elements.finalAccuracy.textContent = `${accuracy}%`;
    elements.highScore.textContent = newHighScore.toLocaleString("es-EC");

    if (accuracy >= 90) {
      elements.resultTitle.textContent = "¡Excelente dominio!";
      elements.resultMessage.textContent = "Tu memoria y velocidad fueron sobresalientes.";
    } else if (accuracy >= 70) {
      elements.resultTitle.textContent = "¡Muy buen trabajo!";
      elements.resultMessage.textContent = "Estás cerca de dominar este nivel. Repasa los verbos marcados.";
    } else {
      elements.resultTitle.textContent = "¡Sigue practicando!";
      elements.resultMessage.textContent = "Cada partida refuerza tu memoria. Repite el nivel y mejora tu récord.";
    }

    renderReviewList();
    showScreen("results");
  }

  function renderReviewList() {
    elements.reviewList.innerHTML = "";
    const verbs = [...state.reviewMap.values()];

    if (verbs.length === 0) {
      const message = document.createElement("p");
      message.textContent = "¡No tienes verbos pendientes! Completaste una sesión perfecta.";
      elements.reviewList.appendChild(message);
      return;
    }

    verbs.forEach((verb) => {
      const chip = document.createElement("span");
      chip.className = "review-chip";
      chip.textContent = `${verb.infinitive} · ${verb.past} · ${verb.participle}`;
      elements.reviewList.appendChild(chip);
    });
  }

  function handleKeydown(event) {
    if (event.key === " " || event.key === "Escape") {
      event.preventDefault();
      togglePause();
    }
  }

  elements.startButton.addEventListener("click", startGame);
  elements.playAgainButton.addEventListener("click", startGame);
  elements.changeLevelButton.addEventListener("click", () => showScreen("start"));
  elements.pauseButton.addEventListener("click", togglePause);
  window.addEventListener("keydown", handleKeydown);
})();
