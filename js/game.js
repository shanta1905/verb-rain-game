(() => {
  "use strict";

  const SESSION_LENGTH = 20;
  const MAX_LIVES = 5;
  const RESCUE_LIVES = 3;
  const BASE_SCORE = 100;
  const MOVE_STEP = 32;

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
    leftButton: document.getElementById("leftButton"),
    rightButton: document.getElementById("rightButton"),
    score: document.getElementById("scoreValue"),
    question: document.getElementById("questionValue"),
    lives: document.getElementById("livesValue"),
    progress: document.getElementById("progressBar"),
    formPrompt: document.getElementById("formPrompt"),
    infinitive: document.getElementById("infinitiveValue"),
    feedback: document.getElementById("feedbackText"),
    arena: document.getElementById("gameArena"),
    basket: document.getElementById("basket"),
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
    basketX: 0,
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
      state.audioContext ??= new (window.AudioContext || window.webkitAudioContext)();
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
    resetBasket();
    updateHud();
    beginQuestion();
    elements.arena.focus();
    cancelAnimationFrame(state.animationId);
    state.animationId = requestAnimationFrame(gameLoop);
  }

  function resetBasket() {
    const arenaWidth = elements.arena.clientWidth;
    state.basketX = Math.max(0, (arenaWidth - elements.basket.offsetWidth) / 2);
    renderBasket();
  }

  function renderBasket() {
    const maxX = Math.max(0, elements.arena.clientWidth - elements.basket.offsetWidth);
    state.basketX = Math.min(Math.max(0, state.basketX), maxX);
    elements.basket.style.left = `${state.basketX}px`;
    elements.basket.style.transform = "none";
  }

  function moveBasket(amount) {
    if (!state.isRunning || state.isPaused) return;
    state.basketX += amount;
    renderBasket();
  }

  function moveBasketToPointer(clientX) {
    if (!state.isRunning || state.isPaused) return;
    const arenaRect = elements.arena.getBoundingClientRect();
    state.basketX = clientX - arenaRect.left - elements.basket.offsetWidth / 2;
    renderBasket();
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
    elements.formPrompt.textContent = `Atrapa el ${targetLabel} de:`;
    elements.infinitive.textContent = verb.infinitive.toUpperCase();
    setFeedback("Mueve la canasta y atrapa la palabra correcta.");
    updateHud();

    window.setTimeout(() => {
      if (state.isRunning && !state.questionResolved) spawnOptions(verb);
    }, 450);
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
      const element = document.createElement("div");
      element.className = "falling-word";
      element.textContent = option.word;
      element.dataset.correct = String(option.isCorrect);
      elements.arena.appendChild(element);

      const width = element.offsetWidth;
      const columnStart = index * columnWidth;
      const maxWithinColumn = Math.max(0, columnWidth - width - 10);
      const x = Math.min(
        arenaWidth - width - 6,
        Math.max(6, columnStart + 5 + Math.random() * maxWithinColumn)
      );

      const y = -80 - Math.random() * 160;
      const speed = baseSpeed + Math.random() * 18;

      state.fallingItems.push({
        element,
        x,
        y,
        speed,
        isCorrect: option.isCorrect,
        word: option.word,
        removed: false
      });
    });
  }

  function rectanglesOverlap(rectA, rectB) {
    return !(
      rectA.right < rectB.left ||
      rectA.left > rectB.right ||
      rectA.bottom < rectB.top ||
      rectA.top > rectB.bottom
    );
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
    const basketRect = elements.basket.getBoundingClientRect();
    const arenaHeight = elements.arena.clientHeight;

    for (const item of state.fallingItems) {
      if (item.removed) continue;
      item.y += item.speed * deltaSeconds;
      item.element.style.transform = `translate(${item.x}px, ${item.y}px)`;

      const itemRect = item.element.getBoundingClientRect();
      if (rectanglesOverlap(itemRect, basketRect)) {
        catchItem(item);
        if (state.questionResolved) break;
      } else if (item.y > arenaHeight + 90) {
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

  function catchItem(item) {
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
    if (["ArrowLeft", "a", "A"].includes(event.key)) {
      event.preventDefault();
      moveBasket(-MOVE_STEP);
    }
    if (["ArrowRight", "d", "D"].includes(event.key)) {
      event.preventDefault();
      moveBasket(MOVE_STEP);
    }
    if (event.key === " " || event.key === "Escape") {
      event.preventDefault();
      togglePause();
    }
  }

  function bindHoldButton(button, direction) {
    let intervalId = null;
    const startMoving = (event) => {
      event.preventDefault();
      moveBasket(direction * MOVE_STEP);
      intervalId = window.setInterval(() => moveBasket(direction * 18), 70);
    };
    const stopMoving = () => {
      window.clearInterval(intervalId);
      intervalId = null;
    };
    button.addEventListener("pointerdown", startMoving);
    button.addEventListener("pointerup", stopMoving);
    button.addEventListener("pointercancel", stopMoving);
    button.addEventListener("pointerleave", stopMoving);
  }

  elements.startButton.addEventListener("click", startGame);
  elements.playAgainButton.addEventListener("click", startGame);
  elements.changeLevelButton.addEventListener("click", () => showScreen("start"));
  elements.pauseButton.addEventListener("click", togglePause);
  elements.arena.addEventListener("pointermove", (event) => moveBasketToPointer(event.clientX));
  elements.arena.addEventListener("pointerdown", (event) => moveBasketToPointer(event.clientX));
  window.addEventListener("keydown", handleKeydown);
  window.addEventListener("resize", renderBasket);
  bindHoldButton(elements.leftButton, -1);
  bindHoldButton(elements.rightButton, 1);
})();
