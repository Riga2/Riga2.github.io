// Run with: node tests/comparison.test.cjs
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "script.js"), "utf8");
const parseAttrs = (tag) => Object.fromEntries(Array.from(tag.matchAll(/([\w-]+)="([^"]*)"/g), (match) => [match[1], match[2]]));

class Element {
  constructor(attrs = {}) {
    this.attrs = attrs;
    this.dataset = Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith("data-"))
      .map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase()), value]));
    this.events = {};
    this.hidden = true;
  }
  getAttribute(name) { return this.attrs[name]; }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(name, fn) { this.events[name] = fn; }
  emit(name, event = {}) { this.events[name]?.(event); }
  focus() { this.focused = true; }
}

module.exports = async function runTests() {
  const buttons = Array.from(html.matchAll(/<button class="comparison-thumbnail"[^>]*>/g), (match) => new Element(parseAttrs(match[0])));
  const videoTag = html.match(/<video id="comparison-video"[^>]*>/)[0];
  const video = new Element(parseAttrs(videoTag));
  Object.assign(video, {
    src: video.attrs.src, poster: video.attrs.poster, currentTime: 31, paused: true, calls: [],
    pause() { this.paused = true; this.calls.push("pause"); },
    load() { this.currentTime = 0; this.calls.push("load"); },
    play() {
      this.calls.push("play");
      if (this.blockAutoplay) return Promise.reject({ name: "NotAllowedError" });
      this.paused = false;
      return Promise.resolve();
    },
  });
  const error = new Element();
  const status = new Element();
  const gallery = {
    querySelectorAll: () => buttons,
    querySelector: (selector) => ({
      "[data-comparison-video]": video,
      "[data-comparison-error]": error,
      "[data-comparison-status]": status,
    })[selector],
  };
  vm.runInNewContext(script, {
    document: {
      querySelectorAll: () => [],
      querySelector: (selector) => selector === "[data-comparison-gallery]" ? gallery : selector === ".back-to-top" ? {} : null,
    },
    window: { location: { hash: "" }, scrollY: 0, addEventListener() {} },
  });
  assert.equal(buttons.length, 3);
  assert.match(videoTag, /\bcontrols\b/);
  assert.ok(!/\bloop\b/.test(videoTag), "Playback stops at the end");
  assert.ok(!/\bautoplay\b/.test(videoTag));

  for (const button of [...buttons.slice(1), buttons[0]]) {
    video.currentTime = 31;
    video.calls.length = 0;
    button.emit("click");
    assert.deepEqual(video.calls, ["pause", "load", "play"]);
    assert.equal(video.currentTime, 0);
    assert.equal(video.src, button.dataset.video);
    assert.equal(video.poster, button.dataset.poster);
    assert.equal(path.dirname(video.src.split("?")[0]), "comparisons", "Read the original file directly, not a silent copy");
    assert.ok(fs.existsSync(path.join(root, video.src.split("?")[0])));
    assert.ok(fs.existsSync(path.join(root, video.poster.split("?")[0])));
    assert.equal(buttons.filter((item) => item.attrs["aria-pressed"] === "true").length, 1);
    assert.equal(status.textContent, `Comparison case ${button.dataset.comparisonCase} selected.`);
    video.currentTime = 9;
    button.emit("click");
    assert.equal(video.currentTime, 9, "Selecting the active case does not interrupt playback");
  }

  const press = (button, key) => button.emit("keydown", { key, preventDefault() {} });
  press(buttons[0], "ArrowLeft");
  assert.equal(buttons[2].attrs["aria-pressed"], "true");
  assert.equal(buttons[2].focused, true);
  press(buttons[2], "ArrowRight");
  assert.equal(buttons[0].attrs["aria-pressed"], "true");
  press(buttons[0], "End");
  assert.equal(buttons[2].attrs["aria-pressed"], "true");
  press(buttons[2], "Home");
  assert.equal(buttons[0].attrs["aria-pressed"], "true");

  video.currentTime = 46.4;
  video.paused = true;
  video.emit("ended");
  assert.equal(buttons[0].attrs["aria-pressed"], "true", "Video end does not advance the carousel");
  assert.equal(video.currentTime, 46.4, "The final frame is retained");
  assert.equal(video.paused, true, "Playback remains stopped at the end");
  video.emit("error");
  assert.equal(error.hidden, false);
  video.blockAutoplay = true;
  buttons[1].emit("click");
  assert.equal(error.hidden, true);
  assert.equal(video.paused, true);
  await Promise.resolve();
  console.log("PASS: all 3 comparison sources/posters; restart on selection; pause/load/play ordering; keyboard selection; selected state; media errors; autoplay fallback; no automatic case switching.");
};

if (require.main === module) module.exports();
