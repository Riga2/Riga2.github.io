"use strict";

// 使用原生锚点跳转；即使禁用 JavaScript，所有分区链接仍可使用。
(() => {
  const backToTop = document.querySelector(".back-to-top");

  function updateBackToTop() {
    backToTop.hidden = window.scrollY < 400;
  }

  window.addEventListener("scroll", updateBackToTop, { passive: true });
  window.addEventListener("pageshow", updateBackToTop);
  updateBackToTop();
})();

// 路径直接保存在场景按钮上，无需 fetch，因此 file:// 离线打开也能切换。
(() => {
  const gallery = document.querySelector("[data-showcase-gallery]");
  if (!gallery) return;

  const thumbnails = Array.from(gallery.querySelectorAll("[data-scene]"));
  const videos = Array.from(gallery.querySelectorAll("[data-showcase-media]"));
  const status = gallery.querySelector("[data-showcase-status]");
  const generatedVideo = videos.find((video) => video.dataset.showcaseMedia === "video");
  const floorplanVideo = videos.find((video) => video.dataset.showcaseMedia === "floorplan");
  const controls = gallery.querySelector("[data-showcase-controls]");
  const toggle = gallery.querySelector("[data-showcase-toggle]");
  const scrubber = gallery.querySelector("[data-showcase-progress]");
  const timeDisplay = gallery.querySelector("[data-showcase-time]");
  const pendingPlays = new WeakMap();

  let selectedScene = thumbnails.find((button) => button.getAttribute("aria-pressed") === "true");
  let playing = true;
  let position = 0;
  let duration = 0;
  let clockVideo = null;
  let clockBuffering = false;
  let changingScene = false;
  let sceneVersion = 0;

  // 原生进度条只能覆盖 generated video 的时长。统一播放条以最长视频为时钟，
  // 短视频停在末帧，点云继续播放；全部结束后才切换至下个场景，不改变原始速度。
  generatedVideo.controls = false;
  controls.hidden = false;

  function formatTime(seconds) {
    const wholeSeconds = Math.max(0, Math.floor(seconds));
    return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, "0")}`;
  }

  function updateControls() {
    toggle.dataset.playing = String(playing);
    toggle.setAttribute("aria-label", playing ? "Pause all videos" : "Play all videos");
    toggle.title = playing ? "Pause all videos" : "Play all videos";
    scrubber.disabled = duration === 0;
    scrubber.max = String(duration || 1);
    scrubber.value = String(position);
    scrubber.setAttribute("aria-valuetext", `${formatTime(position)} of ${formatTime(duration)}`);
    timeDisplay.textContent = `${formatTime(position)} / ${formatTime(duration)}`;
  }

  function shouldPlay(video) {
    return playing && !changingScene && !video.error && !video.ended &&
      (!clockBuffering || video === clockVideo) && position < video.duration;
  }

  function playVideo(video) {
    if (!video.paused || pendingPlays.has(video)) return;
    const version = sceneVersion;
    let interrupted = false;
    const attempt = video.play();
    pendingPlays.set(video, attempt);
    attempt.then(() => {
      if (version === sceneVersion && !shouldPlay(video)) video.pause();
    }).catch((error) => {
      interrupted = error.name === "AbortError";
      // 自动播放被禁止时保留可操作的播放按钮；旧场景的异步结果不影响新场景。
      if (version === sceneVersion && video === clockVideo && error.name === "NotAllowedError") {
        playing = false;
        videos.forEach((item) => item.pause());
        updateControls();
      }
    }).finally(() => {
      if (pendingPlays.get(video) === attempt) {
        pendingPlays.delete(video);
        if (interrupted && version === sceneVersion && shouldPlay(video)) playVideo(video);
      }
    });
  }

  function syncVideo(video, force = false) {
    if (!clockVideo || changingScene || video.error || video.readyState < 1) return;
    const target = Math.min(position, video.duration);
    if (!Number.isFinite(target)) return;
    if (force || Math.abs(video.currentTime - target) > 0.15) video.currentTime = target;
    video.playbackRate = 1;
    if (shouldPlay(video)) playVideo(video);
    else video.pause();
  }

  function syncVideos(force = false) {
    videos.forEach((video) => syncVideo(video, force));
  }

  function seekTo(seconds) {
    position = Math.max(0, Math.min(seconds, duration));
    clockBuffering = false;
    syncVideos(true);
    updateControls();
  }

  function prepareTimeline() {
    if (changingScene || !videos.every((video) => video.readyState >= 1 || video.error)) return;
    const available = videos.filter((video) => !video.error && Number.isFinite(video.duration) && video.duration > 0);
    clockVideo = available.reduce((longest, video) => !longest || video.duration > longest.duration ? video : longest, null);
    duration = clockVideo ? clockVideo.duration : 0;
    position = Math.min(position, duration);
    if (playing && duration > 0 && position >= duration) position = 0;
    clockBuffering = false;
    if (!clockVideo) playing = false;
    updateControls();
    syncVideos(true);
  }

  // crop 为 [源宽, 源高, 左, 上, 内容宽, 内容高]，由全视频扫描生成。
  // 只在页面中等比缩放和裁白边；原始 MP4 与房间几何保持不变。
  function fitFloorplan() {
    const crop = (selectedScene.dataset.floorplanCrop || "").split(",").map(Number);
    if (crop.length !== 6 || !crop.every(Number.isFinite)) return;
    const [sourceWidth, sourceHeight, left, top, width, height] = crop;
    const frame = floorplanVideo.parentElement;
    if (width <= 0 || height <= 0 || !frame.clientWidth || !frame.clientHeight) return;
    const scale = Math.min(frame.clientWidth / width, frame.clientHeight / height);
    Object.assign(floorplanVideo.style, {
      width: `${sourceWidth * scale}px`,
      height: `${sourceHeight * scale}px`,
      left: `${(frame.clientWidth - width * scale) / 2 - left * scale}px`,
      top: `${(frame.clientHeight - height * scale) / 2 - top * scale}px`,
    });
  }

  function selectScene(button) {
    if (button === selectedScene) return;

    changingScene = true;
    sceneVersion += 1;
    selectedScene = button;
    clockVideo = null;
    clockBuffering = false;
    position = 0;
    duration = 0;
    playing = true;

    for (const thumbnail of thumbnails) {
      thumbnail.setAttribute("aria-pressed", String(thumbnail === button));
    }
    for (const video of videos) {
      const role = video.dataset.showcaseMedia;
      const label = document.getElementById(`showcase-${role}-label`).textContent;
      video.pause();
      pendingPlays.delete(video);
      video.parentElement.querySelector("[data-media-error]").hidden = true;
      video.src = button.dataset[role];
      video.poster = `${button.dataset.posterPrefix}-${role}.jpg`;
      video.setAttribute("aria-label", `${label} — Scene ${button.dataset.scene}`);
      video.load();
    }
    changingScene = false;
    fitFloorplan();
    updateControls();
    prepareTimeline();
    status.textContent = `Scene ${button.dataset.scene} selected.`;
  }

  for (const video of videos) {
    video.addEventListener("loadedmetadata", prepareTimeline);
    video.addEventListener("canplay", () => syncVideo(video));
    video.addEventListener("playing", () => {
      if (video !== clockVideo || changingScene) return;
      clockBuffering = false;
      syncVideos();
    });
    video.addEventListener("waiting", () => {
      if (video !== clockVideo || changingScene) return;
      clockBuffering = true;
      syncVideos();
    });
    video.addEventListener("timeupdate", () => {
      if (video !== clockVideo || changingScene) return;
      position = Math.min(video.currentTime, duration);
      syncVideos();
      updateControls();
    });
    video.addEventListener("ended", () => {
      if (video !== clockVideo || changingScene || !video.ended || !playing) return;
      // 等最长视频播完再切换；最后一个场景回到第一个。
      if (thumbnails.length === 1) seekTo(0);
      else selectScene(thumbnails[(thumbnails.indexOf(selectedScene) + 1) % thumbnails.length]);
    });
    video.addEventListener("error", () => {
      video.parentElement.querySelector("[data-media-error]").hidden = false;
      prepareTimeline();
    });
  }

  toggle.addEventListener("click", () => {
    if (clockVideo) position = Math.min(clockVideo.currentTime, duration);
    playing = !playing;
    if (playing && position >= duration) seekTo(0);
    else {
      syncVideos();
      updateControls();
    }
  });
  scrubber.addEventListener("input", () => seekTo(Number(scrubber.value)));
  floorplanVideo.addEventListener("loadedmetadata", fitFloorplan);
  if ("ResizeObserver" in window) {
    new ResizeObserver(fitFloorplan).observe(floorplanVideo.parentElement);
  } else {
    window.addEventListener("resize", fitFloorplan);
  }

  thumbnails.forEach((button, index) => {
    button.addEventListener("click", () => selectScene(button));
    button.addEventListener("keydown", (event) => {
      let nextIndex;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % thumbnails.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + thumbnails.length) % thumbnails.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = thumbnails.length - 1;
      else return;

      event.preventDefault();
      thumbnails[nextIndex].focus();
      selectScene(thumbnails[nextIndex]);
    });
  });
  fitFloorplan();
  updateControls();
  prepareTimeline();
})();

// Comparisons 与 Ablation study：共享手动选择与键盘导航，播完停留在当前视频末帧。
function initializeVideoCarousel(kind, describe) {
  const gallery = document.querySelector(`[data-${kind}-gallery]`);
  if (!gallery) return;

  const video = gallery.querySelector(`[data-${kind}-video]`);
  const buttons = Array.from(gallery.querySelectorAll(`[data-${kind}-case]`));
  const status = gallery.querySelector(`[data-${kind}-status]`);
  const error = gallery.querySelector(`[data-${kind}-error]`);
  const title = gallery.querySelector(`[data-${kind}-title]`);

  function selectCase(button) {
    if (button.getAttribute("aria-pressed") === "true") return;
    video.pause();
    error.hidden = true;
    for (const item of buttons) {
      item.setAttribute("aria-pressed", String(item === button));
    }
    video.src = button.dataset.video;
    video.poster = button.dataset.poster;
    const description = describe(button);
    video.setAttribute("aria-label", description.label);
    if (title) title.textContent = description.title;
    video.load();
    // 切换后从第一帧播放；若浏览器阻止自动播放，可使用原生播放控件。
    video.play().catch(() => {});
    status.textContent = description.status;
  }

  video.addEventListener("error", () => { error.hidden = false; });

  buttons.forEach((button, index) => {
    button.addEventListener("click", () => selectCase(button));
    button.addEventListener("keydown", (event) => {
      let nextIndex;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % buttons.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = buttons.length - 1;
      else return;

      event.preventDefault();
      buttons[nextIndex].focus();
      selectCase(buttons[nextIndex]);
    });
  });
}

initializeVideoCarousel("comparison", (button) => ({
  label: `Comparison video — Case ${button.dataset.comparisonCase}`,
  status: `Comparison case ${button.dataset.comparisonCase} selected.`,
}));

initializeVideoCarousel("ablation", (button) => ({
  title: button.dataset.title,
  label: `Ablation study — ${button.dataset.title}`,
  status: `${button.dataset.title} selected.`,
}));

// 视频直接大幅缩小时，GPU 采样可能跳过细墙线。先逐级缩小，再按屏幕像素比
// 绘制到 canvas；只显示原视频像素，不改素材，也不读取像素，支持 file:// 离线打开。
function createFloorplanRenderer(video, crop) {
  if (crop.length !== 6 || !crop.every(Number.isFinite) || crop[4] <= 0 || crop[5] <= 0) return () => {};
  const frame = video.parentElement;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return () => {};
  canvas.setAttribute("aria-hidden", "true");
  canvas.hidden = true;
  frame.append(canvas);
  const stages = [];
  const [, , left, top, width, height] = crop;

  function draw() {
    if (video.readyState < 2 || video.error || !frame.clientWidth || !frame.clientHeight) return;
    const ratio = window.devicePixelRatio || 1;
    const canvasWidth = Math.round(frame.clientWidth * ratio);
    const canvasHeight = Math.round(frame.clientHeight * ratio);
    if (canvas.width !== canvasWidth) canvas.width = canvasWidth;
    if (canvas.height !== canvasHeight) canvas.height = canvasHeight;
    const scale = Math.min(canvasWidth / width, canvasHeight / height);
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    let source = video;
    let sourceX = left;
    let sourceY = top;
    let sourceWidth = width;
    let sourceHeight = height;
    let index = 0;

    // 每次最多缩小一半，使原图中几像素宽的线条在小窗内仍有覆盖面积。
    while (sourceWidth > targetWidth * 2 || sourceHeight > targetHeight * 2) {
      if (!stages[index]) {
        const buffer = document.createElement("canvas");
        const bufferContext = buffer.getContext("2d");
        if (!bufferContext) return;
        stages[index] = { buffer, bufferContext };
      }
      const { buffer, bufferContext } = stages[index++];
      const nextWidth = Math.ceil(sourceWidth / 2);
      const nextHeight = Math.ceil(sourceHeight / 2);
      if (buffer.width !== nextWidth) buffer.width = nextWidth;
      if (buffer.height !== nextHeight) buffer.height = nextHeight;
      bufferContext.imageSmoothingEnabled = true;
      bufferContext.imageSmoothingQuality = "high";
      bufferContext.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, nextWidth, nextHeight);
      source = buffer;
      sourceX = sourceY = 0;
      sourceWidth = nextWidth;
      sourceHeight = nextHeight;
    }
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvasWidth, canvasHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, sourceX, sourceY, sourceWidth, sourceHeight,
      Math.round((canvasWidth - targetWidth) / 2), Math.round((canvasHeight - targetHeight) / 2), targetWidth, targetHeight);
    canvas.hidden = false;
  }

  for (const event of ["loadeddata", "seeked", "timeupdate"]) video.addEventListener(event, draw);
  video.addEventListener("error", () => { canvas.hidden = true; });
  if (typeof video.requestVideoFrameCallback === "function") {
    const nextFrame = () => { draw(); video.requestVideoFrameCallback(nextFrame); };
    video.requestVideoFrameCallback(nextFrame);
  } else {
    let animation = null;
    const nextFrame = () => {
      animation = null;
      draw();
      if (!video.paused && !video.ended) animation = window.requestAnimationFrame(nextFrame);
    };
    video.addEventListener("playing", () => { if (animation === null) nextFrame(); });
    for (const event of ["pause", "ended"]) video.addEventListener(event, () => {
      if (animation !== null) window.cancelAnimationFrame(animation);
      animation = null;
      draw();
    });
  }
  return draw;
}

// One Image, Multiple Floorplans：每组由生成视频独立控制对应的 floorplan。
for (const pair of document.querySelectorAll("[data-floorplan-pair]")) {
  const video = pair.querySelector("[data-pair-video]");
  const floorplan = pair.querySelector("[data-pair-floorplan]");
  const drawFloorplan = createFloorplanRenderer(floorplan, (pair.dataset.floorplanCrop || "").split(",").map(Number));
  let buffering = false;
  let pendingPlay = null;

  function shouldPlay() {
    return !video.paused && !video.ended && !video.seeking && !buffering &&
      !floorplan.error && !floorplan.ended && video.currentTime < floorplan.duration;
  }

  function synchronize(force = false) {
    if (floorplan.readyState < 1 || floorplan.error || !Number.isFinite(floorplan.duration)) return;
    const target = Math.min(video.currentTime, floorplan.duration);
    if (force || Math.abs(floorplan.currentTime - target) > 0.15) floorplan.currentTime = target;
    floorplan.playbackRate = video.playbackRate;
    if (!shouldPlay()) {
      floorplan.pause();
    } else if (floorplan.paused && !pendingPlay) {
      const attempt = floorplan.play();
      pendingPlay = attempt;
      attempt.then(() => {
        if (!shouldPlay()) floorplan.pause();
      }).catch(() => {}).finally(() => {
        if (pendingPlay === attempt) pendingPlay = null;
      });
    }
  }

  function fitFloorplan() {
    const crop = (pair.dataset.floorplanCrop || "").split(",").map(Number);
    if (crop.length !== 6 || !crop.every(Number.isFinite)) return;
    const [sourceWidth, sourceHeight, left, top, width, height] = crop;
    const frame = floorplan.parentElement;
    if (width <= 0 || height <= 0 || !frame.clientWidth || !frame.clientHeight) return;
    const scale = Math.min(frame.clientWidth / width, frame.clientHeight / height);
    Object.assign(floorplan.style, {
      width: `${sourceWidth * scale}px`,
      height: `${sourceHeight * scale}px`,
      left: `${(frame.clientWidth - width * scale) / 2 - left * scale}px`,
      top: `${(frame.clientHeight - height * scale) / 2 - top * scale}px`,
    });
    drawFloorplan();
  }

  video.addEventListener("playing", () => { buffering = false; synchronize(true); });
  video.addEventListener("waiting", () => { buffering = true; synchronize(); });
  for (const name of ["pause", "seeking", "ended"]) {
    video.addEventListener(name, () => synchronize(true));
  }
  video.addEventListener("seeked", () => { buffering = video.readyState < 3; synchronize(true); });
  for (const name of ["timeupdate", "ratechange"]) {
    video.addEventListener(name, () => synchronize());
  }
  floorplan.addEventListener("loadedmetadata", () => { fitFloorplan(); synchronize(true); });
  floorplan.addEventListener("canplay", () => synchronize());
  if ("ResizeObserver" in window) new ResizeObserver(fitFloorplan).observe(floorplan.parentElement);
  window.addEventListener("resize", fitFloorplan);
  fitFloorplan();
}
