// Run with: node tests/showcase.test.cjs
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const source = fs.readFileSync(path.join(root, "script.js"), "utf8");

function attributes(tag) {
  return Object.fromEntries(Array.from(tag.matchAll(/([\w-]+)="([^"]*)"/g), (match) => [match[1], match[2]]));
}

class Element {
  constructor(attrs = {}) {
    this.attrs = attrs;
    this.dataset = Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith("data-"))
      .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase()), value]));
    this.events = {};
    this.style = {};
    this.hidden = false;
    this.value = "0";
  }
  addEventListener(name, fn) { (this.events[name] ||= []).push(fn); }
  emit(name, event = {}) { for (const fn of this.events[name] || []) fn(event); }
  getAttribute(name) { return this.attrs[name]; }
  setAttribute(name, value) { this.attrs[name] = value; }
  focus() { this.focused = true; }
}

class Video extends Element {
  constructor(attrs) {
    super(attrs);
    this.src = attrs.src;
    this.poster = attrs.poster;
    this.controls = this.dataset.showcaseMedia === "video";
    this.errorDisplay = { hidden: true };
    this.parentElement = { clientWidth: 192, clientHeight: 240, querySelector: () => this.errorDisplay };
    this.playCount = 0;
    this.load();
  }
  load() {
    this.paused = true;
    this.readyState = 0;
    this.duration = NaN;
    this.currentTime = 0;
    this.error = null;
  }
  play() {
    this.playCount += 1;
    if (this.rejectPlay) return Promise.reject(this.rejectPlay);
    if (this.ended) this.currentTime = 0;
    this.paused = false;
    return Promise.resolve();
  }
  get currentTime() { return this._currentTime; }
  set currentTime(value) {
    this._currentTime = value;
    this.ended = Number.isFinite(this.duration) && value >= this.duration;
  }
  pause() { this.paused = true; }
}

function setup() {
  const buttons = Array.from(html.matchAll(/<button class="showcase-thumbnail"[^>]*>/g), (match) => new Element(attributes(match[0])));
  const videos = Array.from(html.matchAll(/<video data-showcase-media[^>]*>/g), (match) => new Video(attributes(match[0])));
  const labels = Object.fromEntries(Array.from(html.matchAll(/<h3[^>]*id="([^"]+)"[^>]*>([^<]+)<\/h3>/g), (match) => [match[1], { textContent: match[2] }]));
  const elements = Object.fromEntries(["status", "controls", "toggle", "progress", "time"].map((name) => [`[data-showcase-${name}]`, new Element()]));
  let resize;
  class ResizeObserver {
    constructor(callback) { resize = callback; }
    observe() {}
  }
  const gallery = {
    querySelectorAll: (selector) => selector === "[data-scene]" ? buttons : videos,
    querySelector: (selector) => elements[selector],
  };
  vm.runInNewContext(source, {
    document: {
      querySelectorAll: () => [],
      querySelector: (selector) => selector === "[data-showcase-gallery]" ? gallery : selector === ".back-to-top" ? new Element() : null,
      getElementById: (id) => labels[id],
    },
    window: { location: { hash: "" }, scrollY: 0, addEventListener() {}, ResizeObserver },
    ResizeObserver,
  });
  const roles = Object.fromEntries(videos.map((video) => [video.dataset.showcaseMedia, video]));
  return {
    buttons, videos, roles, resize,
    toggle: elements["[data-showcase-toggle]"],
    progress: elements["[data-showcase-progress]"],
    time: elements["[data-showcase-time]"],
  };
}

async function flush() { for (let i = 0; i < 8; i += 1) await Promise.resolve(); }

async function loadScene(state) {
  for (const video of state.videos) {
    video.readyState = 4;
    video.duration = video.dataset.showcaseMedia === "pointcloud" ? 46.375 : video.dataset.showcaseMedia === "video" ? 40.375 : 40.5;
    video.emit("loadedmetadata");
  }
  await flush();
}

function checkCrop(state, button) {
  const [sw, sh, x, y, width, height] = button.dataset.floorplanCrop.split(",").map(Number);
  const video = state.roles.floorplan;
  const scale = parseFloat(video.style.width) / sw;
  const left = parseFloat(video.style.left) + x * scale;
  const top = parseFloat(video.style.top) + y * scale;
  assert.ok(left >= -0.001 && top >= -0.001, "Crop starts inside the frame");
  assert.ok(left + width * scale <= video.parentElement.clientWidth + 0.001);
  assert.ok(top + height * scale <= video.parentElement.clientHeight + 0.001);
  assert.ok(Math.abs(parseFloat(video.style.height) / sh - scale) < 0.0001, "Scaling preserves geometry");
  assert.ok(Math.abs(width * scale - video.parentElement.clientWidth) < 0.001 || Math.abs(height * scale - video.parentElement.clientHeight) < 0.001, "Content uses the largest safe scale");
}

module.exports = async function runTests() {
  const state = setup();
  const { videos, roles, buttons, toggle, progress, time } = state;
  assert.equal(buttons.length, 12);
  assert.ok(videos.every((video) => !video.controls), "Only the shared custom transport is active");
  await loadScene(state);
  assert.ok(videos.every((video) => !video.paused));
  assert.equal(Number(progress.max), 46.375);

  // Generated video ending must not reset or stop the longer point-cloud clip.
  roles.video.currentTime = roles.video.duration;
  roles.video.pause();
  roles.video.emit("ended");
  roles.pointcloud.currentTime = 40.32;
  roles.pointcloud.emit("timeupdate");
  await flush();
  assert.equal(roles.video.currentTime, 40.375, "An early follower EOF must not replay from zero");
  assert.equal(roles.video.paused, true);
  roles.pointcloud.currentTime = 42;
  roles.pointcloud.emit("timeupdate");
  await flush();
  assert.equal(roles.video.currentTime, 40.375);
  assert.equal(roles.video.paused, true);
  assert.equal(roles.pointcloud.currentTime, 42);
  assert.equal(roles.pointcloud.paused, false);
  assert.equal(time.textContent, "0:42 / 0:46");

  // The same button remains functional while only the point cloud is running.
  toggle.emit("click");
  assert.ok(videos.every((video) => video.paused));
  assert.equal(toggle.attrs["aria-label"], "Play all videos");
  toggle.emit("click");
  await flush();
  assert.equal(roles.pointcloud.paused, false);
  assert.equal(roles.video.paused, true);

  // The next scene starts only after the longest clip has ended.
  roles.pointcloud.currentTime = 46.375;
  roles.pointcloud.pause();
  roles.pointcloud.emit("timeupdate");
  roles.pointcloud.emit("ended");
  assert.equal(buttons[1].attrs["aria-pressed"], "true");
  await loadScene(state);
  assert.ok(videos.every((video) => video.currentTime === 0 && !video.paused));

  toggle.emit("click");
  progress.value = "43";
  progress.emit("input");
  assert.equal(roles.video.currentTime, 40.375);
  assert.equal(roles.floorplan.currentTime, 40.5);
  assert.equal(roles.pointcloud.currentTime, 43);
  assert.ok(videos.every((video) => video.paused));
  progress.value = "12";
  progress.emit("input");
  toggle.emit("click");
  await flush();
  assert.ok(videos.every((video) => video.currentTime === 12 && !video.paused && video.playbackRate === 1));

  roles.pointcloud.emit("waiting");
  assert.ok(videos.filter((video) => video !== roles.pointcloud).every((video) => video.paused));
  roles.pointcloud.emit("playing");
  await flush();
  assert.ok(videos.every((video) => !video.paused));

  buttons[0].emit("click");
  await loadScene(state);
  for (const button of [...buttons.slice(1), buttons[0]]) {
    button.emit("click");
    await loadScene(state);
    assert.equal(buttons.filter((item) => item.attrs["aria-pressed"] === "true").length, 1);
    assert.ok(videos.every((video) => video.currentTime === 0 && !video.paused));
    for (const video of videos) {
      assert.equal(video.src, button.dataset[video.dataset.showcaseMedia]);
      assert.ok(fs.existsSync(path.join(root, video.src.split("?")[0])));
      assert.ok(fs.existsSync(path.join(root, video.poster.split("?")[0])));
    }
    checkCrop(state, button);
    roles.floorplan.parentElement.clientWidth = 144;
    roles.floorplan.parentElement.clientHeight = 108;
    state.resize();
    checkCrop(state, button);
  }

  buttons[0].emit("keydown", { key: "ArrowLeft", preventDefault() {} });
  assert.equal(buttons[11].attrs["aria-pressed"], "true");
  buttons[11].emit("keydown", { key: "Home", preventDefault() {} });
  assert.equal(buttons[0].attrs["aria-pressed"], "true");
  await loadScene(state);

  // Completing the last scene wraps back to Scene 01.
  buttons[11].emit("click");
  await loadScene(state);
  roles.pointcloud.currentTime = roles.pointcloud.duration;
  roles.pointcloud.pause();
  roles.pointcloud.emit("timeupdate");
  roles.pointcloud.emit("ended");
  assert.equal(buttons[0].attrs["aria-pressed"], "true");
  await loadScene(state);
  roles.floorplan.error = { code: 4 };
  roles.floorplan.emit("error");
  assert.equal(roles.floorplan.errorDisplay.hidden, false);
  buttons[1].emit("click");
  assert.equal(roles.floorplan.errorDisplay.hidden, true);

  // A blocked autoplay attempt exposes a stopped, usable shared transport.
  const blocked = setup();
  blocked.roles.pointcloud.rejectPlay = { name: "NotAllowedError" };
  await loadScene(blocked);
  assert.equal(blocked.toggle.attrs["aria-label"], "Play all videos");
  assert.ok(blocked.videos.every((video) => video.paused));
  blocked.roles.pointcloud.rejectPlay = null;
  blocked.toggle.emit("click");
  await flush();
  assert.ok(blocked.videos.every((video) => !video.paused));
  console.log("PASS: 12 scene mappings and crops; responsive fitting; shared play/pause/seek; full point-cloud tail; automatic next-scene playback and wraparound; buffering; keyboard navigation; media errors; autoplay recovery.");
};

if (require.main === module) module.exports();
