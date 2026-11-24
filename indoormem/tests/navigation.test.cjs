// Run with: node tests/navigation.test.cjs
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");

class Element {
  constructor(attrs = {}) { this.attrs = attrs; this.dataset = {}; this.events = {}; }
  getAttribute(name) { return this.attrs[name]; }
  setAttribute(name, value) { this.attrs[name] = value; }
  removeAttribute(name) { delete this.attrs[name]; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  emit(name, event = {}) { for (const callback of this.events[name] || []) callback(event); }
  focus() { this.focused = true; }
}

module.exports = function runTests() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const markup = html.match(/<aside class="floating-toc"[\s\S]*?<\/aside>/)[0];
  const links = Array.from(markup.matchAll(/<a href="(#[^"]+)">/g), (match) => new Element({ href: match[1] }));
  assert.deepEqual(links.map((link) => link.getAttribute("href")), [
    "#overview", "#showcases", "#comparisons", "#ablation-study",
    "#one-image-multiple-floorplans", "#palace-generation", "#additional-videos",
  ]);
  const ids = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]));
  assert.ok(links.every((link) => ids.has(link.getAttribute("href").slice(1))));

  const toggle = new Element();
  const toc = new Element();
  toc.dataset.open = "false";
  toc.querySelector = () => toggle;
  toc.querySelectorAll = () => links;
  toc.contains = (target) => target === toc || target === toggle || links.includes(target);
  const document = new Element();
  const window = new Element();
  Object.assign(window, { scrollY: 0, innerHeight: 800 });
  const frames = [];
  window.requestAnimationFrame = (callback) => frames.push(callback);
  const breakpoint = new Element();
  window.matchMedia = () => breakpoint;
  const starts = [350, 1200, 2100, 3000, 3900, 5300, 6100];
  const sections = Object.fromEntries(links.map((link, index) => [link.getAttribute("href").slice(1), {
    getBoundingClientRect: () => ({ top: starts[index] - window.scrollY }),
  }]));
  document.documentElement = { scrollHeight: 6800 };
  document.getElementById = (id) => sections[id];
  document.querySelector = (selector) => selector === "[data-floating-toc]" ? toc : selector === ".back-to-top" ? {} : null;
  document.querySelectorAll = () => [];
  vm.runInNewContext(fs.readFileSync(path.join(root, "script.js"), "utf8"), { document, window });
  const active = () => links.filter((link) => link.getAttribute("aria-current") === "location");
  const flush = () => { while (frames.length) frames.shift()(); };
  const scrollTo = (y) => { window.scrollY = y; window.emit("scroll"); flush(); };

  assert.equal(active().length, 0, "leave the directory inactive above the demo");
  scrollTo(200);
  assert.deepEqual(active(), [links[0]]);
  scrollTo(2000);
  assert.deepEqual(active(), [links[2]], "highlight the section being read");
  scrollTo(3100);
  assert.deepEqual(active(), [links[3]]);
  scrollTo(2000);
  assert.deepEqual(active(), [links[2]], "update when scrolling upward");
  scrollTo(6000);
  assert.deepEqual(active(), [links[6]], "select the final section at the page bottom");
  scrollTo(0);
  assert.equal(active().length, 0);

  window.emit("scroll");
  window.emit("resize");
  window.emit("hashchange");
  assert.equal(frames.length, 1, "batch position reads into one animation frame");
  flush();
  toggle.emit("click");
  assert.equal(toc.dataset.open, "true");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  document.emit("click", { target: toggle });
  assert.equal(toc.dataset.open, "true", "clicking within the directory keeps it open");
  links[4].emit("click");
  assert.equal(toc.dataset.open, "false", "collapse after following an anchor");
  toggle.emit("click");
  document.emit("keydown", { key: "Escape" });
  assert.equal(toc.dataset.open, "false");
  assert.equal(toggle.focused, true);
  toggle.emit("click");
  document.emit("click", { target: {} });
  assert.equal(toc.dataset.open, "false", "outside clicks close the compact directory");
  toggle.emit("click");
  breakpoint.emit("change");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  console.log("PASS: seven valid section anchors; current section in both scroll directions and at page bottom; batched scroll updates; compact menu, Escape/focus, outside click, and resize behavior.");
};

if (require.main === module) module.exports();
