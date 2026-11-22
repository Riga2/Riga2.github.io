// Run with: node tests/ablation.test.cjs
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = fs.readFileSync(path.join(root, "script.js"), "utf8");
const attributes = (tag) => Object.fromEntries(Array.from(tag.matchAll(/([\w-]+)="([^"]*)"/g), (match) => [match[1], match[2]]));

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
  addEventListener(name, handler) { this.events[name] = handler; }
  emit(name, event = {}) { this.events[name]?.(event); }
  focus() { this.focused = true; }
}

function createCarousel(kind) {
  const buttons = Array.from(html.matchAll(new RegExp(`<button class="${kind}-thumbnail"[^>]*>`, "g")), (match) => new Element(attributes(match[0])));
  const tag = html.match(new RegExp(`<video id="${kind}-video"[^>]*>`))[0];
  const video = new Element(attributes(tag));
  Object.assign(video, {
    src: video.attrs.src, poster: video.attrs.poster, currentTime: 0, paused: true,
    pause() { this.paused = true; },
    load() { this.currentTime = 0; },
    play() {
      if (this.rejectPlay) return Promise.reject({ name: "NotAllowedError" });
      this.paused = false;
      return Promise.resolve();
    },
  });
  const status = new Element();
  const error = new Element();
  const title = kind === "ablation" ? new Element() : null;
  const gallery = {
    querySelectorAll: () => buttons,
    querySelector: (selector) => ({
      [`[data-${kind}-video]`]: video,
      [`[data-${kind}-status]`]: status,
      [`[data-${kind}-error]`]: error,
      [`[data-${kind}-title]`]: title,
    })[selector],
  };
  return { gallery, buttons, video, status, error, title, tag };
}

module.exports = async function runTests() {
  const ablation = createCarousel("ablation");
  const comparison = createCarousel("comparison");
  vm.runInNewContext(script, {
    document: {
      querySelectorAll: () => [],
      querySelector: (selector) => ({
        "[data-ablation-gallery]": ablation.gallery,
        "[data-comparison-gallery]": comparison.gallery,
        ".back-to-top": {},
      })[selector] || null,
    },
    window: { location: { hash: "" }, scrollY: 0, addEventListener() {} },
  });
  const { buttons, video, title, status, error, tag } = ablation;
  assert.deepEqual(buttons.map((button) => button.dataset.ablationCase), ["memory", "layout", "semantic"]);
  assert.equal(video.src, buttons[0].dataset.video);
  assert.match(tag, /\bcontrols\b/);
  assert.ok(!/\bloop\b/.test(tag) && !/\bautoplay\b/.test(tag));
  const comparisonSource = comparison.video.src;

  for (const button of [...buttons.slice(1), buttons[0]]) {
    video.currentTime = 8;
    button.emit("click");
    assert.equal(video.currentTime, 0);
    assert.equal(video.paused, false);
    assert.equal(video.src, button.dataset.video);
    assert.equal(video.poster, button.dataset.poster);
    assert.equal(title.textContent, button.dataset.title);
    assert.equal(video.attrs["aria-label"], `Ablation study — ${button.dataset.title}`);
    assert.equal(status.textContent, `${button.dataset.title} selected.`);
    assert.equal(buttons.filter((item) => item.attrs["aria-pressed"] === "true").length, 1);
    assert.equal(path.dirname(video.src.split("?")[0]), "ablations");
    assert.ok(fs.existsSync(path.join(root, video.src.split("?")[0])));
    assert.ok(fs.existsSync(path.join(root, video.poster.split("?")[0])));
    assert.equal(comparison.video.src, comparisonSource, "Ablation selection is isolated from comparisons");
  }

  buttons[1].emit("click");
  video.currentTime = 46.4;
  video.paused = true;
  video.emit("ended");
  assert.equal(video.currentTime, 46.4);
  assert.equal(video.paused, true);
  assert.equal(buttons[1].attrs["aria-pressed"], "true", "Ending holds the selected topic");
  buttons[1].emit("click");
  assert.equal(video.currentTime, 46.4, "Clicking the active thumbnail does not restart the video");

  const press = (button, key) => button.emit("keydown", { key, preventDefault() {} });
  press(buttons[1], "Home");
  press(buttons[0], "ArrowLeft");
  assert.equal(buttons[2].attrs["aria-pressed"], "true");
  assert.equal(title.textContent, "Semantic labels");
  press(buttons[2], "ArrowRight");
  assert.equal(buttons[0].attrs["aria-pressed"], "true");
  press(buttons[0], "End");
  assert.equal(buttons[2].focused, true);
  assert.equal(title.textContent, "Semantic labels");

  const ablationSource = video.src;
  comparison.buttons[1].emit("click");
  assert.equal(video.src, ablationSource, "Comparison selection is isolated from ablations");
  assert.equal(title.textContent, "Semantic labels");
  video.emit("error");
  assert.equal(error.hidden, false);
  video.rejectPlay = true;
  buttons[0].emit("click");
  assert.equal(error.hidden, true);
  assert.equal(video.paused, true);
  assert.equal(title.textContent, "Memory mechanism");
  await Promise.resolve();
  console.log("PASS: Memory/Layout/Semantic order; manual selection; current heading and poster; original-file paths; final-frame stop; keyboard navigation; error recovery; independent comparison and ablation players.");
};

if (require.main === module) module.exports();
