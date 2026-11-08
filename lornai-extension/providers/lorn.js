// providers/lorn.js — lornAI website (lorn.lol / lornai.pages.dev) provider
// Implements the ZSProvider interface so the lornAI Roblox extension can send
// commands through the lornAI chat interface just like any other AI site.
//
// lornAI DOM notes (validated against lornAI app.js):
//  - Composer: <textarea id="input"> inside .composer-wrap
//  - Send button: <button id="sendBtn">
//  - Chat messages: .msg elements; AI replies carry class .ai (or .assistant)
//  - Generating state: #sendBtn has class "busy" while streaming
//  - Message text lives in .msg-content or .bubble inside .msg
// eslint-disable-next-line no-unused-vars
const ZSProvider = (() => {
  "use strict";

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let diag = () => {};   // injected by core via init()

  // ── Selectors ─────────────────────────────────────────────────────────────
  // Validated against lornAI app.js renderThread / addAI / addUser functions:
  //   User:  div.msg.user  → inner text in div.bubble
  //   AI:    div.msg.ai    → inner content text in div.content (inside div.body)
  //                          reasoning in div.reason-slot details
  const S = {
    // Composer elements — validated against index.html
    editor:       "#input",
    sendBtn:      "#sendBtn",
    // Chat turn containers (both user & AI)
    chatItem:     ".msg",
    // AI-turn marker class (set by addAI in app.js: el.className = 'msg ai')
    aiClass:      "ai",
    // Text content nodes inside each turn
    aiContent:    ".content",           // main answer text in AI turns
    userBubble:   ".bubble",            // user message text
    reasoning:    ".reason-slot",       // AI reasoning/thinking container
    // "Busy / generating" — sendBtn gets class "busy" and is disabled during stream
    busyClass:    "busy",
    // Typing indicator while streaming
    typingIndicator: ".caret, .shim",
    // Error surfaces
    errorSurfaces: '[class*="toast"],[class*="error"],[class*="err-text"],[role="alert"]',
  };

  // Completion windows (ms). lornAI streams fast so idle windows are smaller.
  const timings = {
    GEN_IDLE_MS:        600,
    WARMUP_MS:         20000,
    STABLE_MS:          4000,
    RESPONSE_TIMEOUT_MS: 180000,
  };

  // ── Turn helpers ───────────────────────────────────────────────────────────
  const allItems       = () => [...document.querySelectorAll(S.chatItem)];
  const isUserItem     = (el) => el && !el.classList.contains(S.aiClass) && !el.classList.contains("assistant");
  const isAssistantItem = (el) => el && (el.classList.contains(S.aiClass) || el.classList.contains("assistant"));

  function itemText(item) {
    if (!item) return "";
    if (isAssistantItem(item)) {
      // AI turn: read from .content (excludes reasoning slot), fall back to full text
      const content = item.querySelector(S.aiContent);
      if (content) return content.textContent || "";
    } else {
      // User turn: read from .bubble
      const bubble = item.querySelector(S.userBubble);
      if (bubble) return bubble.textContent || "";
    }
    return item.textContent || "";
  }

  function classifyText(item, excludeSel) {
    if (!item) return "";
    if (isAssistantItem(item)) {
      const content = item.querySelector(S.aiContent);
      if (!content) return item.textContent || "";
      if (!excludeSel) return content.textContent || "";
      let t = "";
      for (const n of content.childNodes) {
        if (excludeSel && n.nodeType === 1 && n.matches && n.matches(excludeSel)) continue;
        t += n.textContent || "";
      }
      return t;
    }
    let t = "";
    for (const n of item.childNodes) {
      if (excludeSel && n.nodeType === 1 && n.matches && n.matches(excludeSel)) continue;
      t += n.textContent || "";
    }
    return t;
  }

  const assistantItems  = () => allItems().filter(isAssistantItem);
  const assistantCount  = () => assistantItems().length;
  const userCount       = () => allItems().filter(isUserItem).length;

  const lastAssistant   = () => {
    const its = assistantItems();
    return its.length ? its[its.length - 1] : null;
  };

  // lornAI doesn't virtualise the message list, so indices are stable.
  const lastAssistantId  = () => {
    const last = lastAssistant();
    if (!last) return null;
    return last.dataset.msgId || last.dataset.id || null;
  };

  function itemKey(item) {
    if (!item) return null;
    return item.dataset.msgId || item.dataset.id || null;
  }

  const chatIsEmpty = () => allItems().length === 0;
  const isFreshChat = () => chatIsEmpty() && !!getEditor();

  // ── Composer helpers ───────────────────────────────────────────────────────
  const getEditor = () => {
    const el = document.querySelector(S.editor);
    // Never return our own zs-root textarea
    if (el && el.closest("#zs-root")) return null;
    return el || null;
  };

  const editorText = () => {
    const e = getEditor();
    if (!e) return "";
    return e.value != null ? e.value : e.textContent || "";
  };

  // composerFrame: the entire input area including the send button
  function composerFrame() {
    const ta = getEditor();
    if (!ta) return null;
    const send = document.querySelector(S.sendBtn);
    let n = ta;
    for (let i = 0; i < 10 && n && n.parentElement; i++) {
      if (send && n.contains(send)) return n;
      n = n.parentElement;
    }
    return ta.parentElement || null;
  }

  // barMount: inject the lornAI status bar above the textarea inside the composer
  function barMount() {
    const ta = getEditor();
    if (!ta) return null;
    const box = ta.parentElement;
    if (!box) return null;
    let before = box.firstElementChild;
    if (before && before.id === "zs-bar") before = before.nextElementSibling;
    return { parent: box, before, inside: true };
  }

  // Lock / unlock the textarea during agent activity
  function setInputLock(on) {
    const ed = getEditor();
    if (!ed) return;
    if (on) {
      if (!ed.dataset.zsPlaceholder) ed.dataset.zsPlaceholder = ed.getAttribute("placeholder") || "";
      ed.setAttribute("readonly", "");
      ed.setAttribute("placeholder", "⏳ Agent working… please wait");
    } else {
      ed.removeAttribute("readonly");
      if (ed.dataset.zsPlaceholder != null) ed.setAttribute("placeholder", ed.dataset.zsPlaceholder);
    }
  }

  // ── Generation / completion detection ─────────────────────────────────────
  // Stream growth tracking for idle detection
  let _streamMax = -1, _streamAt = 0, _streamItem = null;

  function sampleStream() {
    const item = lastAssistant();
    const len = itemText(item).length;
    const now = Date.now();
    if (item !== _streamItem || len < _streamMax - 200) {
      _streamItem = item; _streamMax = len; _streamAt = now; return;
    }
    if (len > _streamMax) { _streamMax = len; _streamAt = now; }
  }

  const grewWithin = (ms) => _streamMax > 1 && Date.now() - _streamAt < ms;

  function isGenerating() {
    const btn = document.querySelector(S.sendBtn);
    if (btn && btn.classList.contains(S.busyClass)) return true;
    // .caret and .shim are streaming indicators injected by paintAI
    if (document.querySelector(".caret, .shim")) return true;
    sampleStream();
    return grewWithin(timings.GEN_IDLE_MS);
  }

  function isBusyNow() {
    const btn = document.querySelector(S.sendBtn);
    if (btn && btn.classList.contains(S.busyClass)) return true;
    sampleStream();
    return grewWithin(timings.GEN_IDLE_MS);
  }

  function isHardGenerating() {
    const btn = document.querySelector(S.sendBtn);
    return !!(btn && btn.classList.contains(S.busyClass));
  }

  function genDebug() {
    try {
      sampleStream();
      const btn = document.querySelector(S.sendBtn);
      return {
        busyClass: btn ? btn.classList.contains(S.busyClass) : false,
        caretVisible: !!document.querySelector(".caret"),
        shimVisible: !!document.querySelector(".shim"),
        streamMax: _streamMax,
        streamAgeMs: _streamAt ? Date.now() - _streamAt : -1,
        grewGen: grewWithin(timings.GEN_IDLE_MS),
        gen: isGenerating(),
      };
    } catch (e) { return { err: String(e && e.message || e) }; }
  }

  function snapshot() {
    try {
      const it = lastAssistant();
      if (!it) return { rp: 0 };
      return { rp: itemText(it).trim().length };
    } catch { return {}; }
  }

  // ── Composer mode (lornAI has no model tabs to enforce) ───────────────────
  const composerModeState = () => ({
    expertFound: false, expertOn: true,
    visionFound: false, visionOn: false,
    instantFound: false, instantOn: false,
    deepThinkFound: false, deepThinkOn: false,
    searchFound: false, searchOff: true,
    unified: true,
  });

  const enforceComposer     = () => composerModeState();
  const ensureComposerReady = async () => ({ ...composerModeState(), ready: true });
  const isFreshChatReady    = () => !!getEditor();

  // ── Sending ───────────────────────────────────────────────────────────────
  // lornAI's input is a plain <textarea> driven by vanilla JS event listeners.
  // Set value via the native prototype setter so any framework watcher fires,
  // then dispatch 'input'. lornAI listens for Enter key to send.
  function setTextareaValue(el, v) {
    const proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
    const setter = proto && Object.getOwnPropertyDescriptor(proto, "value");
    if (setter && setter.set) setter.set.call(el, v);
    else el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function pressEnter(editor) {
    const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    editor.dispatchEvent(new KeyboardEvent("keydown", opts));
    editor.dispatchEvent(new KeyboardEvent("keypress", opts));
    editor.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  async function waitFor(pred, timeout) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (pred()) return true;
      await sleep(100);
    }
    return false;
  }

  // Send cap: lornAI doesn't enforce a hard char limit at the DOM level, but
  // cap at 50 000 chars to stay well within sensible API context windows.
  const SEND_MAX = 50000;
  function truncateForSend(text) {
    if (!text || text.length <= SEND_MAX) return text;
    const omitted = text.length - SEND_MAX;
    const marker =
      `\n\n[…lornAI: result truncated to fit context — ${omitted} of ${text.length} ` +
      `characters omitted. Work with the head and tail shown here…]\n\n`;
    const budget = SEND_MAX - marker.length;
    const headLen = Math.floor(budget * 0.85);
    const tailLen = budget - headLen;
    return text.slice(0, headLen) + marker + text.slice(text.length - tailLen);
  }

  async function typeAndSend(text /*, images — lornAI doesn't support image input */) {
    const editor = getEditor();
    if (!editor) throw new Error("lornAI input box (#input) not found");
    editor.focus();
    text = truncateForSend(text);
    setTextareaValue(editor, text);

    // Try click first, then fall back to Enter key
    const btn = document.querySelector(S.sendBtn);
    if (btn && !btn.classList.contains(S.busyClass) && !btn.disabled) {
      btn.click();
    } else {
      pressEnter(editor);
    }

    // Confirm submission: editor should clear or busy class should appear
    await waitFor(
      () => editorText().trim() === "" || isHardGenerating(),
      3000
    );
  }

  function stopGeneration() {
    // lornAI's send button doubles as a stop button when busy
    const btn = document.querySelector(S.sendBtn);
    if (btn && btn.classList.contains(S.busyClass)) {
      try { btn.click(); } catch {}
    }
  }

  // ── Error detection ────────────────────────────────────────────────────────
  function scanError() {
    try {
      for (const el of document.querySelectorAll(S.errorSurfaces)) {
        if (el.offsetParent === null) continue;
        const t = (el.innerText || "").trim();
        if (t.length > 8 && t.length < 400) return t.slice(0, 240);
      }
    } catch {}
    if (!getEditor()) return "lornAI input box disappeared (session ended?).";
    return null;
  }

  const isTooLongMsg = (text) => /context.{0,20}(limit|exceeded)/i.test(text);
  const isBusyMsg    = (text) => /server.{0,15}busy|try again/i.test(text);

  // ── Continuation button (lornAI doesn't have one) ─────────────────────────
  const findContinueBtn  = () => null;
  const clickContinueBtn = () => false;

  // ── Read assistant reply ───────────────────────────────────────────────────
  function readAssistant() {
    const item = lastAssistant();
    if (!item) return { present: false, reply: "", thinking: "", item: null };
    // AI content lives in div.body > div.content; reasoning in div.reason-slot
    const content   = item.querySelector(S.aiContent);
    const reasoning = item.querySelector(S.reasoning);
    const reply   = (content ? content.textContent : item.textContent || "").trim();
    const thinking = reasoning ? reasoning.textContent.trim() : "";
    return { present: true, reply, thinking, item };
  }

  // ── Vision / image support ─────────────────────────────────────────────────
  // lornAI doesn't expose a file-upload composer — no image support.
  const supportsVision    = false;
  const isVisionSelected  = () => false;
  const attachImages      = async () => false;
  const clearAttachments  = () => {};

  // ── Provider identity ──────────────────────────────────────────────────────
  const id          = "lorn";
  const displayName = "lornAI";

  function matches() {
    const h = location.hostname;
    return h === "lorn.lol" || h.endsWith(".lornai.pages.dev") || h === "lornai.pages.dev";
  }

  // ── Core init hook ─────────────────────────────────────────────────────────
  function init(diagFn) {
    diag = diagFn || (() => {});
    diag("provider_init", { id, host: location.hostname });
  }

  // ── Exported interface (must match ZSProvider contract in core/main.js) ────
  return {
    // identity
    id, displayName, matches,
    // init
    init,
    // DOM helpers
    allItems, isUserItem, isAssistantItem, itemText, classifyText,
    assistantCount, userCount, lastAssistant, lastAssistantId, itemKey,
    chatIsEmpty, isFreshChat, isFreshChatReady,
    getEditor, editorText, composerFrame, barMount, setInputLock,
    // mode
    composerModeState, enforceComposer, ensureComposerReady,
    // generation
    isGenerating, isBusyNow, isHardGenerating, genDebug, snapshot, sampleStream,
    timings,
    // sending
    typeAndSend, stopGeneration, truncateForSend,
    // error
    scanError, isTooLongMsg, isBusyMsg,
    // continuation
    findContinueBtn, clickContinueBtn,
    // reading
    readAssistant,
    // vision
    supportsVision, isVisionSelected, attachImages, clearAttachments,
  };
})();
