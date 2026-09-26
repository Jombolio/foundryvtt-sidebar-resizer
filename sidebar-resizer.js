const MODULE_ID = 'sidebar-resizer';
const SIDEBAR_SIZE_KEY = 'sidebar-resizer-init-size';
const CHAT_SIZE_KEY = 'chatform-resizer-init-size';
const SIDEBAR_MIN_SIZE = 300;
const CHAT_MIN_SIZE = 40;
const CHAT_HANDLE_SIZE = 6;
const _sdbFloatingDefaultSize = 2.5;

function _getStoredSize(key) {
  const value = window.localStorage.getItem(key);
  if (!value || !Number.isInteger(+value)) return null;
  return parseInt(value);
}

/* -------------------------------------------- */
/*  Sidebar horizontal resize                   */
/* -------------------------------------------- */

function _getSidebarContent() {
  return ui.sidebar?.element?.querySelector('#sidebar-content') ?? document.querySelector('#sidebar-content');
}

function _applySidebarSize(size, expanded = ui.sidebar?.expanded) {
  const content = _getSidebarContent();
  if (!content) return;
  if (size === null || !expanded) {
    // Let core styles handle the collapsed state (and the default width)
    content.style.removeProperty('width');
    document.body.style.removeProperty('--sidebar-width');
    return;
  }
  content.style.setProperty('width', `${size}px`, 'important');
  // Core layout (e.g. chat notifications) follows this variable
  document.body.style.setProperty('--sidebar-width', `${size}px`);
}

function _assignResizer() {
  const content = _getSidebarContent();
  if (!content || content.querySelector(':scope > .sidebar-resizer-handle')) return;
  let mouseStart, startSize;

  const resizer = document.createElement('div');
  resizer.classList.add('sidebar-resizer-handle');
  resizer.style.width = '6px';
  resizer.style.height = '100%';
  resizer.style.position = 'absolute';
  resizer.style.top = '0';
  resizer.style.left = '0';
  resizer.style.zIndex = '100';
  resizer.style.cursor = 'col-resize';
  if (getComputedStyle(content).position === 'static') content.style.position = 'relative';
  content.appendChild(resizer);

  resizer.addEventListener('pointerdown', startResize, false);

  function startResize(e) {
    if (!ui.sidebar.expanded) return;
    e.preventDefault();
    mouseStart = e.clientX;
    startSize = content.offsetWidth;
    window.addEventListener('pointermove', resize, false);
    window.addEventListener('pointerup', stopResize, false);
  }

  function resize(e) {
    const newSize = Math.round(startSize + mouseStart - e.clientX);
    _applySidebarSize(Math.max(newSize, SIDEBAR_MIN_SIZE));
  }

  function stopResize() {
    window.localStorage.setItem(SIDEBAR_SIZE_KEY, content.offsetWidth);
    window.removeEventListener('pointermove', resize, false);
    window.removeEventListener('pointerup', stopResize, false);
  }
}

/* -------------------------------------------- */
/*  Chat input vertical resize                  */
/* -------------------------------------------- */

// The chat input (#chat-message) is moved by core between the sidebar, the chat popout and the
// notifications area, and is re-rendered often, so its size is driven by a CSS variable and the drag
// handle is its top edge (detected through event delegation) rather than an injected element.

function _injectChatStyle() {
  if (document.getElementById('sidebar-resizer-style')) return;
  const style = document.createElement('style');
  style.id = 'sidebar-resizer-style';
  style.textContent = `
    body.sidebar-resizer-chat-sized #chat-message {
      height: var(--sidebar-resizer-chat-height) !important;
      min-height: var(--sidebar-resizer-chat-height) !important;
      max-height: none !important;
      flex: 0 0 var(--sidebar-resizer-chat-height) !important;
    }
    body.sidebar-resizer-chat-hover, body.sidebar-resizer-chat-hover * {
      cursor: row-resize !important;
    }
  `;
  document.head.appendChild(style);
}

function _applyChatSize(size) {
  if (size === null) {
    document.body.classList.remove('sidebar-resizer-chat-sized');
    document.body.style.removeProperty('--sidebar-resizer-chat-height');
    return;
  }
  document.body.style.setProperty('--sidebar-resizer-chat-height', `${size}px`);
  document.body.classList.add('sidebar-resizer-chat-sized');
}

function _isOnChatTopEdge(e) {
  const chatInput = document.getElementById('chat-message');
  if (!chatInput || !chatInput.offsetParent) return null;
  const rect = chatInput.getBoundingClientRect();
  const onEdge = e.clientX >= rect.left && e.clientX <= rect.right
    && e.clientY >= rect.top - CHAT_HANDLE_SIZE && e.clientY <= rect.top + CHAT_HANDLE_SIZE / 2;
  return onEdge ? chatInput : null;
}

function _assignVerticalResizer() {
  let mouseStart, startSize, chatInput, resizing = false;

  document.addEventListener('pointermove', (e) => {
    if (resizing) return;
    document.body.classList.toggle('sidebar-resizer-chat-hover', !!_isOnChatTopEdge(e));
  }, {passive: true});

  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    chatInput = _isOnChatTopEdge(e);
    if (!chatInput) return;
    e.preventDefault();
    e.stopPropagation();
    resizing = true;
    mouseStart = e.clientY;
    startSize = chatInput.offsetHeight;
    window.addEventListener('pointermove', resize, false);
    window.addEventListener('pointerup', stopResize, false);
  }, true);

  function resize(e) {
    const maxSize = Math.round(window.innerHeight * 0.7);
    const newSize = Math.round(startSize + mouseStart - e.clientY);
    _applyChatSize(Math.min(Math.max(newSize, CHAT_MIN_SIZE), maxSize));
  }

  function stopResize() {
    resizing = false;
    document.body.classList.remove('sidebar-resizer-chat-hover');
    window.localStorage.setItem(CHAT_SIZE_KEY, chatInput.offsetHeight);
    window.removeEventListener('pointermove', resize, false);
    window.removeEventListener('pointerup', stopResize, false);
  }
}

/* -------------------------------------------- */
/*  Resizable sidebar popouts                   */
/* -------------------------------------------- */

function _popoutOptionsWrapper(wrapped, ...args) {
  const result = wrapped(...args);
  // Popped-out sidebar tabs are the only ones rendered with a window frame
  if (!result.window?.frame) return result;
  result.window.resizable = true;
  result.position ??= {};
  result.position.height = Math.round(window.innerHeight / _sdbFloatingDefaultSize);
  const lastSidebarSize = _getStoredSize(SIDEBAR_SIZE_KEY);
  if (lastSidebarSize && this.constructor.tabName === 'chat') result.position.width = lastSidebarSize;
  return result;
}

function _registerPopoutResize() {
  const target = 'foundry.applications.sidebar.AbstractSidebarTab.prototype._initializeApplicationOptions';
  if (game.modules.get('lib-wrapper')?.active) {
    libWrapper.register(MODULE_ID, target, _popoutOptionsWrapper, 'WRAPPER');
  } else {
    const proto = foundry.applications.sidebar.AbstractSidebarTab.prototype;
    const original = proto._initializeApplicationOptions;
    proto._initializeApplicationOptions = function (...args) {
      return _popoutOptionsWrapper.call(this, original.bind(this), ...args);
    };
  }
}

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

Hooks.once('init', function () {
  _registerPopoutResize();
});

Hooks.once('ready', function () {
  _injectChatStyle();
  _assignResizer();
  _assignVerticalResizer();
  _applySidebarSize(_getStoredSize(SIDEBAR_SIZE_KEY));
  _applyChatSize(_getStoredSize(CHAT_SIZE_KEY));
});

Hooks.on('renderSidebar', function () {
  if (!game.ready) return;
  _assignResizer();
  _applySidebarSize(_getStoredSize(SIDEBAR_SIZE_KEY));
});

Hooks.on('collapseSidebar', function (_, isCollapsing) {
  _applySidebarSize(_getStoredSize(SIDEBAR_SIZE_KEY), !isCollapsing);
});
