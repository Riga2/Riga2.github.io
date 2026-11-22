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
  const pairs = Array.from(html.matchAll(/<div class="multi-floorplan-case"([^>]*)>([\s\S]*?)\n        <\/div>/g), (match) => {
    const data = attrs(match[1]);
    const generatedTag = match[2].match(/<video data-pair-video[^>]*>/)[0];
    const floorplanTag = match[2].match(/<video data-pair-floorplan[^>]*>/)[0];
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
    };
  });
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
      querySelectorAll: (selector) => selector === "[data-floorplan-pair]" ? pairs : [],
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
  console.log("PASS: four correct video/floorplan pairs; independent controls and stop at end; complete responsive crops; high-quality staged downsampling; retina/standard pixel ratios; decoded-frame and paused-seek redraws.");
};

if (require.main === module) module.exports();
