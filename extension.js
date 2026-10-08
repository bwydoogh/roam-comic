const LOG_PREFIX = "[roam-comic]";
const STYLE_ID = "roam-comic-style";
const NOTICE_ID = "roam-comic-notice";
const GLOBAL_CLEANUP_KEY = "__roamComicCleanup";
const NOTICE_DURATION_MS = 2500;
const BLOCK_UID_PATTERN = /([\w-]{9})$/;

// The Worker in worker/ knows each site; the extension only knows the route.
const WORKER_URL = "https://roam-comic.bwydoogh.workers.dev";

// Adding a source: a handler in worker/src/index.js plus an entry here.
const SOURCES = [{ id: "xkcd", label: "xkcd" }];

const SETTINGS = { tag: "tag" };
const DEFAULT_TAG = "comic";

const css = `
#${NOTICE_ID} {
  position: fixed;
  display: none;
  right: 16px;
  bottom: 16px;
  max-width: 320px;
  padding: 8px 12px;
  border-radius: 4px;
  background: #394b59;
  color: #f5f8fa;
  font-size: 13px;
  z-index: 2147483002;
}

body.bp3-dark #${NOTICE_ID} {
  background: #d3d8de;
  color: #182026;
}
`;

let cleanup = null;
let extensionSettings = null;
let styleEl = null;
let noticeEl = null;
let noticeTimer = null;

function commandLabel(source) {
  return `Comic Strip: ${source.label}`;
}

// --- pure logic --------------------------------------------------------------

function formatTag(tag) {
  const name = String(tag ?? "").trim().replace(/^#/, "").replace(/^\[\[(.*)\]\]$/, "$1").trim();

  if (!name) {
    return "";
  }

  return /^[\w/-]+$/.test(name) ? `#${name}` : `#[[${name}]]`;
}

// Roam has no escape for brackets inside a link label, so they become parentheses.
function escapeLinkLabel(text) {
  return String(text).replace(/\[/g, "(").replace(/\]/g, ")");
}

function buildBlockString(comic, imageUrl, tag) {
  const parts = [`[${escapeLinkLabel(`${comic.source}: ${comic.title}`)}](${comic.pageUrl})`];
  const formattedTag = formatTag(tag);

  if (formattedTag) {
    parts.push(formattedTag);
  }

  parts.push(`![](${imageUrl})`);
  return parts.join(" ");
}

// Text to insert at the caret so the comic does not glue onto a preceding word.
function textForCaret(text, caret, insert) {
  const before = text.slice(0, caret);
  return before.length === 0 || /\s$/.test(before) ? insert : ` ${insert}`;
}

function extractUploadUrl(result) {
  if (typeof result !== "string") {
    return null;
  }

  const match = /\((https?:\/\/[^)\s]+)\)/.exec(result);

  if (match) {
    return match[1];
  }

  return /^https?:\/\/\S+$/.test(result.trim()) ? result.trim() : null;
}

function isComic(value) {
  return ["source", "title", "pageUrl", "imageUrl"].every((key) => typeof value?.[key] === "string" && value[key]);
}

function fileNameFor(comic, contentType) {
  const fromUrl = /\.(png|jpe?g|gif|webp)(?:$|\?)/i.exec(comic.imageUrl)?.[1];
  const fromType = /^image\/(png|jpeg|gif|webp)/.exec(contentType || "")?.[1];
  const ext = (fromUrl || fromType || "png").toLowerCase().replace("jpeg", "jpg");
  const slug = `${comic.source}-${comic.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "comic"}.${ext}`;
}

// --- network -----------------------------------------------------------------

async function fetchComic(source) {
  const response = await fetch(`${WORKER_URL}/${source.id}`);

  if (!response.ok) {
    throw new Error(`the comic service answered ${response.status}`);
  }

  const comic = await response.json();

  if (!isComic(comic)) {
    throw new Error("the comic service sent an unexpected answer");
  }

  return comic;
}

// Upload into the graph so the comic survives the source going away. Any
// failure (CORS, upload API, offline) falls back to linking the original.
async function storeImage(comic) {
  const upload = roamAPI()?.file?.upload;

  if (typeof upload !== "function") {
    return comic.imageUrl;
  }

  try {
    const response = await fetch(comic.imageUrl);

    if (!response.ok) {
      throw new Error(`image answered ${response.status}`);
    }

    const blob = await response.blob();
    const file = new File([blob], fileNameFor(comic, blob.type), { type: blob.type || "image/png" });
    const result = await upload.call(roamAPI().file, { file, toast: { hide: true } });
    return extractUploadUrl(result) ?? comic.imageUrl;
  } catch (error) {
    console.warn(`${LOG_PREFIX} upload failed, linking the original image instead:`, error);
    return comic.imageUrl;
  }
}

// --- Roam API ----------------------------------------------------------------

function roamAPI() {
  return globalThis.window?.roamAlphaAPI ?? null;
}

function pull(pattern, uid) {
  try {
    return roamAPI()?.data?.pull?.(pattern, [":block/uid", uid]) ?? null;
  } catch (error) {
    console.error(`${LOG_PREFIX} failed to read ${uid}:`, error);
    return null;
  }
}

async function createBlock(parentUid, order, string) {
  await roamAPI().data.block.create({ location: { "parent-uid": parentUid, order }, block: { string } });
}

async function insertAfter(uid, string) {
  const block = pull("[:block/order {:block/_children [:block/uid]}]", uid);
  const parentUid = block?.[":block/_children"]?.[0]?.[":block/uid"];

  if (!parentUid || typeof block?.[":block/order"] !== "number") {
    return false;
  }

  await createBlock(parentUid, block[":block/order"] + 1, string);
  return true;
}

async function appendToDailyNote(string) {
  const api = roamAPI();
  const today = new Date();
  const uid = api.util.dateToPageUid(today);

  if (!pull("[:node/title]", uid)?.[":node/title"]) {
    await api.data.page.create({ page: { title: api.util.dateToPageTitle(today), uid } });
  }

  await createBlock(uid, "last", string);
}

// --- DOM ---------------------------------------------------------------------

function ensureStyle() {
  if (styleEl?.isConnected) {
    return styleEl;
  }

  styleEl = document.getElementById(STYLE_ID);

  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
  }

  return styleEl;
}

function showNotice(message) {
  ensureStyle();

  if (!noticeEl?.isConnected) {
    noticeEl = document.createElement("div");
    noticeEl.id = NOTICE_ID;
    document.body.appendChild(noticeEl);
  }

  noticeEl.textContent = message;
  noticeEl.style.display = "block";

  if (noticeTimer) {
    clearTimeout(noticeTimer);
  }

  noticeTimer = setTimeout(() => {
    noticeTimer = null;

    if (noticeEl) {
      noticeEl.style.display = "none";
    }
  }, NOTICE_DURATION_MS);
}

function fail(message, error) {
  console.error(`${LOG_PREFIX} ${message}`, error ?? "");
  showNotice(message);
  return false;
}

// The command palette and the context menu both take focus, so the editor is
// looked up by uid even when it is no longer the active element.
function findEditingTextarea(uid) {
  const matches = (el) => el?.tagName === "TEXTAREA"
    && el.classList.contains("rm-block-input")
    && (!uid || BLOCK_UID_PATTERN.exec(el.id || "")?.[1] === uid);

  return matches(document.activeElement)
    ? document.activeElement
    : Array.from(document.querySelectorAll("textarea.rm-block-input")).find(matches) ?? null;
}

// The editor holds text Roam has not saved yet, so the comic goes in through
// execCommand at the caret; never by assigning textarea.value or by writing the
// block with roamAlphaAPI.
function insertAtCaret(textarea, string) {
  const caret = textarea.selectionEnd ?? textarea.value.length;
  textarea.focus();
  textarea.setSelectionRange(caret, caret);

  try {
    return document.execCommand("insertText", false, textForCaret(textarea.value, caret, string));
  } catch (error) {
    console.error(`${LOG_PREFIX} insertText threw:`, error);
    return false;
  }
}

// --- the command -------------------------------------------------------------

function editingUid() {
  return roamAPI()?.ui?.getFocusedBlock?.()?.["block-uid"]
    ?? BLOCK_UID_PATTERN.exec(document.activeElement?.id || "")?.[1]
    ?? null;
}

// Where it lands: at the caret of the block being edited; after the block whose
// bullet menu was used; otherwise at the bottom of today's daily note.
async function insertComic(source, blockUid = null) {
  const uid = blockUid ?? editingUid();
  let comic;

  try {
    comic = await fetchComic(source);
  } catch (error) {
    return fail(`Could not fetch a ${source.label} comic: ${error.message}.`, error);
  }

  const string = buildBlockString(comic, await storeImage(comic), readTag());

  try {
    // Re-resolved after the fetch: the user may have left the block meanwhile.
    const textarea = uid ? findEditingTextarea(uid) : null;

    if (textarea && !blockUid && insertAtCaret(textarea, string)) {
      return true;
    }

    if (uid && await insertAfter(uid, string)) {
      return true;
    }

    await appendToDailyNote(string);
    showNotice(`Added ${comic.source} to today's daily note.`);
    return true;
  } catch (error) {
    return fail("Could not write the comic into the graph.", error);
  }
}

function registerCommands() {
  const api = roamAPI();

  for (const source of SOURCES) {
    api?.ui?.commandPalette?.addCommand?.({
      label: commandLabel(source),
      callback: () => insertComic(source),
    });
    api?.ui?.blockContextMenu?.addCommand?.({
      label: commandLabel(source),
      "display-conditional": (context) => !context?.["read-only?"],
      callback: (context) => insertComic(source, context?.["block-uid"] ?? null),
    });
  }
}

function removeCommands() {
  const api = roamAPI();

  for (const source of SOURCES) {
    api?.ui?.commandPalette?.removeCommand?.({ label: commandLabel(source) });
    api?.ui?.blockContextMenu?.removeCommand?.({ label: commandLabel(source) });
  }
}

// --- settings ----------------------------------------------------------------

// An empty tag is a real choice ("no tag"), so only a missing value falls back.
function readTag() {
  const value = extensionSettings?.get?.(SETTINGS.tag);
  return value === null || typeof value === "undefined" ? DEFAULT_TAG : String(value);
}

function createSettingsPanel(extensionAPI) {
  extensionAPI?.settings?.panel?.create?.({
    tabTitle: "Comic Strip",
    settings: [
      {
        id: SETTINGS.tag,
        name: "Tag",
        description: "Added to every comic block. Leave empty for no tag.",
        action: {
          type: "input",
          placeholder: DEFAULT_TAG,
          onChange: (event) => {
            const value = event?.target?.value ?? event;
            extensionSettings?.set?.(SETTINGS.tag, String(value ?? ""));
          },
        },
      },
    ],
  });
}

// --- lifecycle ---------------------------------------------------------------

async function onload(options = {}) {
  // Depot developer mode reloads this module without calling onunload.
  if (cleanup) {
    cleanup();
  } else if (window[GLOBAL_CLEANUP_KEY]) {
    window[GLOBAL_CLEANUP_KEY]();
  }

  const { extensionAPI } = options;
  extensionSettings = extensionAPI?.settings || null;

  if (extensionSettings && extensionSettings.get(SETTINGS.tag) == null) {
    await extensionSettings.set(SETTINGS.tag, DEFAULT_TAG);
  }

  createSettingsPanel(extensionAPI);
  registerCommands();

  cleanup = () => {
    removeCommands();

    if (noticeTimer) {
      clearTimeout(noticeTimer);
      noticeTimer = null;
    }

    for (const node of [styleEl, noticeEl]) {
      node?.parentNode?.removeChild(node);
    }

    extensionSettings = null;
    styleEl = null;
    noticeEl = null;

    if (window[GLOBAL_CLEANUP_KEY] === cleanup) {
      delete window[GLOBAL_CLEANUP_KEY];
    }

    cleanup = null;
  };

  window[GLOBAL_CLEANUP_KEY] = cleanup;
}

function onunload() {
  cleanup?.();
}

export default { onload, onunload };
