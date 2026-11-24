// Run with: node tests/multiple-floorplans.test.cjs
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const source = fs.readFileSync(path.join(root, "script.js"), "utf8");
const attrs = (tag) => Object.fromEntries(Array.from(tag.matchAll(/([\w-]+)="([^"]*)"/g), (match) => [match[1], match[2]]));

class Video {
  constructor(tag, duration) {
    this.attrs = attrs(tag);
    this.src = this.attrs.src;
    this.poster = this.attrs.poster;
    this.events = {};
    this.style = {};
    this.duration = duration;
    this.currentTime = 0;
    this.readyState = 4;
    this.paused = true;
    this.seeking = false;
    this.playbackRate = 1;
    this.parentElement = { clientWidth: 146, clientHeight: 192, append(canvas) { this.canvas = canvas; } };
  }
  get currentTime() { return this.time; }
  set currentTime(value) { this.time = value; this.ended = value >= this.duration; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  emit(name) { for (const callback of this.events[name] || []) callback(); }
  play() { this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  requestVideoFrameCallback(callback) { this.frameCallback = callback; }
  renderFrame() { const callback = this.frameCallback; this.frameCallback = null; callback(); }
}

// Queue native media events so programmatic play/pause/seek events cannot hide feedback loops.
const mediaEvents = [];
class GroupVideo extends Video {
  constructor(tag, duration) {
    super(tag, duration);
    this.dispatchMediaEvents = true;
  }
  get currentTime() { return super.currentTime; }
  set currentTime(value) {
    const previous = super.currentTime;
    super.currentTime = value;
    if (!this.dispatchMediaEvents || previous === value) return;
    this.seeking = true;
    mediaEvents.push(() => this.emit("seeking"));
    mediaEvents.push(() => { this.seeking = false; this.emit("seeked"); this.emit("timeupdate"); });
  }
  get playbackRate() { return this.rate; }
  set playbackRate(value) {
    const previous = this.rate;
    this.rate = value;
    if (this.dispatchMediaEvents && previous !== value) mediaEvents.push(() => this.emit("ratechange"));
  }
  play() {
    if (!this.paused) return Promise.resolve();
    if (this.ended) this.currentTime = 0;
    this.paused = false;
    mediaEvents.push(() => this.emit("play"));
    return new Promise((resolve, reject) => {
      mediaEvents.push(() => {
        if (this.paused) reject(Object.assign(new Error("Interrupted"), { name: "AbortError" }));
        else { this.emit("playing"); resolve(); }
      });
    });
  }
  pause() {
    if (this.paused) return;
    this.paused = true;
    mediaEvents.push(() => this.emit("pause"));
  }
}

async function flushMedia() {
  let count = 0;
  for (let pass = 0; pass < 30; pass += 1) {
    while (mediaEvents.length) {
      assert.ok(++count < 1500, "media events must settle without feedback loops");
      mediaEvents.shift()();
    }
    await flush();
    if (!mediaEvents.length) return;
  }
  assert.fail("pending playback operations must settle");
}

class Control {
  constructor() { this.events = {}; this.attrs = {}; this.dataset = {}; this.hidden = true; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  emit(name) { for (const callback of this.events[name] || []) callback(); }
  setAttribute(name, value) { this.attrs[name] = value; }
}

class Canvas {
  constructor() {
    this.context = {
      draws: [],
      drawImage(...args) { this.draws.push(args); },
      fillRect() {},
    };
  }
  setAttribute() {}
  getContext() { return this.context; }
}

async function flush() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); }

module.exports = async function runTests() {
  const pairs = Array.from(html.matchAll(/^([ \t]*)<div class="multi-floorplan-case"([^>]*)>([\s\S]*?)\n\1<\/div>/gm), (match) => {
    const data = attrs(match[2]);
    const generatedTag = match[3].match(/<video data-pair-video[^>]*>/)[0];
    const floorplanTag = match[3].match(/<video data-pair-floorplan[^>]*>/)[0];
    assert.match(generatedTag, /\bcontrols\b/);
    assert.ok(!/\bcontrols\b/.test(floorplanTag));
    assert.ok(!/\b(?:autoplay|loop)\b/.test(generatedTag));
    const video = new Video(generatedTag, 40.375);
    const floorplan = new Video(floorplanTag, 40.5);
    floorplan.readyState = 1;
    return {
      video, floorplan,
      dataset: { floorplanCrop: data["data-floorplan-crop"] },
      querySelector: (selector) => selector === "[data-pair-video]" ? video : floorplan,
      querySelectorAll: (selector) => selector === "[data-pair-video]" ? [video] : [],
    };
  });
  const styleMarkup = html.match(/<div class="multi-style-gallery"([^>]*)>([\s\S]*?)<\/section>/);
  assert.ok(styleMarkup, "include the four-style gallery");
  const styleVideos = Array.from(styleMarkup[2].matchAll(/<video data-pair-video[^>]*>/g), (match) => {
    assert.match(match[0], /\bcontrols\b/);
    assert.match(match[0], /\bmuted\b/);
    assert.ok(!/\b(?:autoplay|loop)\b/.test(match[0]));
    return new GroupVideo(match[0], 40.375);
  });
  const sharedTag = styleMarkup[2].match(/<video data-pair-floorplan[^>]*>/)[0];
  assert.ok(!/\bcontrols\b/.test(sharedTag));
  const sharedFloorplan = new GroupVideo(sharedTag, 40.5);
  const styleControls = new Control();
  const styleToggle = new Control();
  const styleProgress = new Control();
  const styleTime = new Control();
  const styleGroup = {
    dataset: { floorplanCrop: attrs(styleMarkup[1])["data-floorplan-crop"] },
    querySelector: (selector) => ({
      "[data-pair-floorplan]": sharedFloorplan,
      "[data-style-controls]": styleControls,
      "[data-style-toggle]": styleToggle,
      "[data-style-progress]": styleProgress,
      "[data-style-time]": styleTime,
    }[selector]),
    querySelectorAll: (selector) => selector === "[data-pair-video]" ? styleVideos : [],
  };
  styleVideos[0].readyState = 0;
  styleVideos[0].duration = NaN;
  const resizeCallbacks = [];
  class ResizeObserver {
    constructor(callback) { resizeCallbacks.push(callback); }
    observe() {}
  }
  const canvases = [];
  const testWindow = { location: { hash: "" }, scrollY: 0, devicePixelRatio: 2, addEventListener() {}, ResizeObserver };
  vm.runInNewContext(source, {
    document: {
      createElement: (tag) => {
        assert.equal(tag, "canvas");
        const canvas = new Canvas();
        canvases.push(canvas);
        return canvas;
      },
      querySelectorAll: (selector) => selector === "[data-floorplan-pair]" ? [...pairs, styleGroup] : [],
      querySelector: (selector) => selector === ".back-to-top" ? {} : null,
    },
    window: testWindow,
    ResizeObserver,
  });
  assert.equal(pairs.length, 4);
  assert.deepEqual(pairs.map((pair) => path.basename(pair.video.src.split("?")[0])), ["video.mp4", "04.mp4", "05.mp4", "06.mp4"]);
  assert.deepEqual(pairs.map((pair) => path.basename(pair.floorplan.src.split("?")[0])), ["topdown.mp4", "04_topdown.mp4", "05_topdown.mp4", "06_topdown.mp4"]);

  for (const [index, pair] of pairs.entries()) {
    const { video, floorplan } = pair;
    for (const media of [video, floorplan]) {
      assert.ok(fs.existsSync(path.join(root, media.src.split("?")[0])));
      assert.ok(fs.existsSync(path.join(root, media.poster.split("?")[0])));
    }
    const assertCrop = () => {
      const [sw, sh, x, y, w, h] = pair.dataset.floorplanCrop.split(",").map(Number);
      const scale = parseFloat(floorplan.style.width) / sw;
      const left = parseFloat(floorplan.style.left) + x * scale;
      const top = parseFloat(floorplan.style.top) + y * scale;
      assert.ok(left >= -0.001 && top >= -0.001);
      assert.ok(left + w * scale <= floorplan.parentElement.clientWidth + 0.001);
      assert.ok(top + h * scale <= floorplan.parentElement.clientHeight + 0.001);
      assert.ok(Math.abs(parseFloat(floorplan.style.height) / sh - scale) < 0.001);
    };
    assertCrop();
    const canvas = floorplan.parentElement.canvas;
    assert.equal(canvas.hidden, true, "keep the original poster until a video frame is available");
    floorplan.readyState = 4;
    floorplan.emit("loadeddata");
    assert.equal(canvas.hidden, false);
    assert.equal(canvas.width, 292, "render at the device pixel ratio");
    assert.equal(canvas.height, 384);
    assert.equal(canvas.context.imageSmoothingQuality, "high");
    floorplan.parentElement.clientWidth = 85;
    floorplan.parentElement.clientHeight = 120;
    resizeCallbacks[index]();
    assertCrop();
    assert.equal(canvas.width, 170);
    assert.equal(canvas.height, 240);
    const [, , cropX, cropY, cropW, cropH] = pair.dataset.floorplanCrop.split(",").map(Number);
    const firstPass = canvases.flatMap((item) => item.context.draws).find((draw) => draw[0] === floorplan);
    assert.deepEqual(firstPass.slice(1, 5), [cropX, cropY, cropW, cropH], "include the full measured crop, including top walls");
    const [, , , sourceW, sourceH, x, y, w, h] = canvas.context.draws.at(-1);
    assert.ok(sourceW <= w * 2 && sourceH <= h * 2, "downsample in stages before the final small image");
    assert.ok(x >= 0 && y >= 0 && x + w <= canvas.width && y + h <= canvas.height);
    const beforeNewFrame = canvas.context.draws.length;
    floorplan.renderFrame();
    assert.equal(canvas.context.draws.length, beforeNewFrame + 1, "redraw every decoded video frame");
    assert.equal(typeof floorplan.frameCallback, "function");
    floorplan.emit("seeked");
    assert.equal(canvas.context.draws.length, beforeNewFrame + 2, "refresh after seeking while paused");

    video.currentTime = 12.3;
    video.paused = false;
    video.emit("playing");
    await flush();
    assert.equal(floorplan.currentTime, 12.3);
    assert.equal(floorplan.paused, false);
    assert.ok(pairs.filter((item) => item !== pair).every((item) => item.floorplan.paused));

    video.pause();
    video.emit("pause");
    assert.equal(floorplan.paused, true);
    video.currentTime = 7;
    video.seeking = true;
    video.emit("seeking");
    assert.equal(floorplan.currentTime, 7);
    video.seeking = false;
    video.emit("seeked");
    assert.equal(floorplan.paused, true);
    video.paused = false;
    video.emit("playing");
    await flush();
    assert.equal(floorplan.paused, false);
    video.playbackRate = 2;
    video.emit("ratechange");
    assert.equal(floorplan.playbackRate, 2);

    video.emit("waiting");
    assert.equal(floorplan.paused, true);
    video.emit("playing");
    await flush();
    assert.equal(floorplan.paused, false);

    video.currentTime = video.duration;
    video.pause();
    video.emit("ended");
    assert.equal(floorplan.currentTime, video.duration);
    assert.equal(floorplan.paused, true);
  }
  testWindow.devicePixelRatio = 1;
  resizeCallbacks[0]();
  assert.equal(pairs[0].floorplan.parentElement.canvas.width, 85);
  assert.equal(pairs[0].floorplan.parentElement.canvas.height, 120);
  pairs[0].floorplan.error = {};
  pairs[0].floorplan.emit("error");
  assert.equal(pairs[0].floorplan.parentElement.canvas.hidden, true, "fall back to the video on an error");
  assert.deepEqual(styleVideos.map((item) => path.basename(item.src.split("?")[0])), ["1.mp4", "2.mp4", "3.mp4", "4.mp4"]);
  for (const media of [...styleVideos, sharedFloorplan]) {
    assert.ok(fs.existsSync(path.join(root, media.src.split("?")[0])));
    assert.ok(fs.existsSync(path.join(root, media.poster)));
  }
  const [first, second, third, fourth] = styleVideos;
  const synchronizedMedia = [...styleVideos, sharedFloorplan];
  assert.ok(synchronizedMedia.every((item) => item.paused), "no initial autoplay");
  assert.ok(styleVideos.every((item) => item.controls === false), "hide all four native control bars");
  assert.equal(styleControls.hidden, false);
  assert.equal((styleMarkup[2].match(/<button[^>]*data-style-toggle/g) || []).length, 1, "one shared play/pause button");
  assert.equal(styleToggle.dataset.playing, "false");
  assert.equal(styleToggle.attrs["aria-label"], "Play all five videos");
  assert.equal(styleProgress.disabled, true, "wait for metadata before enabling seeking");
  first.duration = 40.375;
  first.readyState = 4;
  first.emit("loadedmetadata");
  await flushMedia();
  assert.equal(styleProgress.disabled, false);
  assert.equal(styleProgress.max, "40.375");
  assert.equal(styleTime.textContent, "0:00 / 0:40");

  styleToggle.emit("click");
  await flushMedia();
  assert.ok(synchronizedMedia.every((item) => !item.paused), "shared play starts all five videos");
  assert.equal(styleToggle.dataset.playing, "true");
  assert.equal(styleToggle.attrs["aria-label"], "Pause all five videos");

  styleToggle.emit("click");
  await flushMedia();
  assert.ok(synchronizedMedia.every((item) => item.paused), "shared pause stops the whole group");
  assert.equal(styleToggle.dataset.playing, "false");
  styleProgress.value = "12";
  styleProgress.emit("input");
  await flushMedia();
  assert.ok(synchronizedMedia.every((item) => item.currentTime === 12));
  assert.ok(synchronizedMedia.every((item) => item.paused), "paused seeking does not start playback");
  assert.equal(styleTime.textContent, "0:12 / 0:40");

  styleToggle.emit("click");
  await flushMedia();
  assert.ok(synchronizedMedia.every((item) => !item.paused));
  styleProgress.value = "19";
  styleProgress.emit("input");
  await flushMedia();
  assert.ok(synchronizedMedia.every((item) => item.currentTime === 19));
  assert.ok(synchronizedMedia.every((item) => !item.paused), "seeking during playback resumes the whole group");

  first.time = 20;
  first.emit("timeupdate");
  await flushMedia();
  assert.ok(synchronizedMedia.every((item) => item.currentTime === 20), "correct follower drift from the common timeline");
  assert.equal(styleProgress.value, "20");
  assert.equal(styleProgress.attrs["aria-valuetext"], "0:20 of 0:40");

  second.readyState = 2;
  second.emit("waiting");
  await flushMedia();
  assert.equal(second.paused, false, "let the buffering video recover");
  assert.ok(synchronizedMedia.filter((item) => item !== second).every((item) => item.paused));
  assert.equal(styleToggle.dataset.playing, "true", "retain playback intent during buffering");
  second.readyState = 4;
  second.emit("canplay");
  await flushMedia();
  assert.ok(synchronizedMedia.every((item) => !item.paused), "resume together after buffering");

  first.time = first.duration;
  first.ended = true;
  first.pause();
  first.emit("ended");
  await flushMedia();
  assert.ok(synchronizedMedia.every((item) => item.paused), "stop all five videos at the end");
  assert.ok(synchronizedMedia.every((item) => item.currentTime === first.duration));
  assert.equal(styleToggle.dataset.playing, "false");
  assert.equal(styleProgress.value, "40.375");

  styleToggle.emit("click");
  await flushMedia();
  assert.ok(synchronizedMedia.every((item) => item.currentTime === 0), "replay resets the shared timeline");
  assert.ok(synchronizedMedia.every((item) => !item.paused));
  styleToggle.emit("click");
  styleToggle.emit("click");
  styleToggle.emit("click");
  await flushMedia();
  assert.ok(synchronizedMedia.every((item) => item.paused), "rapid toggles preserve the final paused state");
  assert.equal(styleToggle.dataset.playing, "false");

  styleToggle.emit("click");
  await flushMedia();
  fourth.error = {};
  fourth.emit("error");
  await flushMedia();
  assert.ok(synchronizedMedia.every((item) => item.paused), "a media error stops the group");
  assert.equal(styleToggle.dataset.playing, "false");
  assert.equal(styleToggle.attrs["aria-label"], "Play all five videos");

  console.log("PASS: four independent floorplan pairs; one shared play/pause/progress bar for all five style videos; metadata loading, native event feedback, drift correction, buffering, end/replay, rapid toggles, errors; complete crops and high-quality rendering.");
};

if (require.main === module) module.exports();
