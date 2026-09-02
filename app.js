(() => {
  'use strict';

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  let state = { nodes: {}, rootChildren: [], todoMode: false };
  let zoomStack = [];
  let visibleOrder = [];
  let rowCounter = 0;
  let undoStack = [];
  let redoStack = [];
  let dirty = false;
  let currentFileHandle = null;
  let currentFileName = 'Untitled.json';
  let autosaveToFileEnabled = true;
  let fileAutosaveTimer = null;
  let typingActive = false;
  let typingTimer = null;
  let autosaveTimer = null;
  let idCounter = 0;
  let draggedId = null;
  let currentDropTarget = null;
  let currentDropMode = null;

  // ---------------------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------------------
  const outlineEl = document.getElementById('outline');
  const breadcrumbEl = document.getElementById('breadcrumb');
  const countEl = document.getElementById('countEl');
  const fileInput = document.getElementById('fileInput');
  const helpDialog = document.getElementById('helpDialog');

  // ---------------------------------------------------------------------
  // Node helpers
  // ---------------------------------------------------------------------
  function createNode(text) {
    idCounter++;
    const id = 'n' + Date.now().toString(36) + idCounter.toString(36) + Math.random().toString(36).slice(2, 5);
    state.nodes[id] = { id, text: text || '', children: [], collapsed: false, checked: false };
    return id;
  }

  // Find the array (and index within it) that currently holds `id`.
  function locate(id) {
    const rootIdx = state.rootChildren.indexOf(id);
    if (rootIdx !== -1) return { arr: state.rootChildren, index: rootIdx, parentId: null };
    for (const pid in state.nodes) {
      const idx = state.nodes[pid].children.indexOf(id);
      if (idx !== -1) return { arr: state.nodes[pid].children, index: idx, parentId: pid };
    }
    return null;
  }

  function collectSubtreeIds(id) {
    const ids = [id];
    state.nodes[id].children.forEach((cid) => ids.push(...collectSubtreeIds(cid)));
    return ids;
  }

  function subtreeContains(rootId, id) {
    if (rootId === id) return true;
    const node = state.nodes[rootId];
    if (!node) return false;
    return node.children.some((c) => subtreeContains(c, id));
  }

  function getCurrentRootChildren() {
    if (zoomStack.length === 0) return state.rootChildren;
    return state.nodes[zoomStack[zoomStack.length - 1]].children;
  }

  function visiblePrev(id) {
    const i = visibleOrder.indexOf(id);
    return i > 0 ? visibleOrder[i - 1] : null;
  }
  function visibleNext(id) {
    const i = visibleOrder.indexOf(id);
    return i !== -1 && i < visibleOrder.length - 1 ? visibleOrder[i + 1] : null;
  }

  function getCellEl(id) {
    return outlineEl.querySelector('.cell[data-id="' + id + '"]');
  }

  // ---------------------------------------------------------------------
  // Undo / redo
  // ---------------------------------------------------------------------
  function cloneState() {
    return JSON.stringify({ nodes: state.nodes, rootChildren: state.rootChildren, todoMode: state.todoMode, zoomStack });
  }
  function restoreState(json) {
    const obj = JSON.parse(json);
    state.nodes = obj.nodes;
    state.rootChildren = obj.rootChildren;
    state.todoMode = !!obj.todoMode;
    zoomStack = obj.zoomStack || [];
  }
  function snapshot() {
    redoStack = [];
    undoStack.push(cloneState());
    if (undoStack.length > 150) undoStack.shift();
  }
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(cloneState());
    restoreState(undoStack.pop());
    typingActive = false;
    markDirty();
    render();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(cloneState());
    restoreState(redoStack.pop());
    typingActive = false;
    markDirty();
    render();
  }

  // ---------------------------------------------------------------------
  // Caret utilities
  // ---------------------------------------------------------------------
  function getCaretOffset(el) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return 0;
    const range = sel.getRangeAt(0);
    if (range.startContainer === el || range.startContainer.parentNode === el) {
      return range.startOffset;
    }
    return 0;
  }

  function placeCaret(el, pos) {
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    const textNode = el.firstChild;
    if (textNode && textNode.nodeType === 3) {
      const len = textNode.length;
      const off = pos === 'end' ? len : Math.max(0, Math.min(pos, len));
      range.setStart(textNode, off);
    } else {
      range.selectNodeContents(el);
    }
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // ---------------------------------------------------------------------
  // Structural edits
  // ---------------------------------------------------------------------
  function handleEnter(id, cell) {
    const offset = getCaretOffset(cell);
    const fullText = cell.innerText;
    snapshot();
    const before = fullText.slice(0, offset);
    const after = fullText.slice(offset);
    state.nodes[id].text = before;
    const newId = createNode(after);
    const loc = locate(id);
    loc.arr.splice(loc.index + 1, 0, newId);
    markDirty();
    render();
    placeCaret(getCellEl(newId), 0);
  }

  function insertLineBreak(cell) {
    document.execCommand('insertText', false, '\n');
  }

  function handleIndent(id) {
    const loc = locate(id);
    if (!loc || loc.index === 0) return;
    snapshot();
    const prevSiblingId = loc.arr[loc.index - 1];
    loc.arr.splice(loc.index, 1);
    state.nodes[prevSiblingId].children.push(id);
    state.nodes[prevSiblingId].collapsed = false;
    markDirty();
    render();
    placeCaret(getCellEl(id), 'end');
  }

  function handleOutdent(id) {
    const loc = locate(id);
    if (!loc || loc.parentId === null) return;
    const parentLoc = locate(loc.parentId);
    if (!parentLoc) return;
    snapshot();
    const youngerSiblings = loc.arr.splice(loc.index + 1);
    loc.arr.splice(loc.index, 1);
    state.nodes[id].children.push(...youngerSiblings);
    parentLoc.arr.splice(parentLoc.index + 1, 0, id);
    markDirty();
    render();
    placeCaret(getCellEl(id), 'end');
  }

  function moveSibling(id, delta) {
    const loc = locate(id);
    if (!loc) return;
    const newIndex = loc.index + delta;
    if (newIndex < 0 || newIndex >= loc.arr.length) return;
    snapshot();
    [loc.arr[loc.index], loc.arr[newIndex]] = [loc.arr[newIndex], loc.arr[loc.index]];
    markDirty();
    render();
    placeCaret(getCellEl(id), 'end');
  }

  // Drag-and-drop: move draggedId to be a sibling before/after targetId, or a child of it.
  function performDrop(draggedId, targetId, mode) {
    if (!draggedId || targetId === draggedId) return false;
    let ownerId;
    if (mode === 'child') {
      ownerId = targetId;
    } else {
      const tLoc = locate(targetId);
      if (!tLoc) return false;
      ownerId = tLoc.parentId;
    }
    if (ownerId !== null && subtreeContains(draggedId, ownerId)) return false;

    const srcLoc = locate(draggedId);
    if (!srcLoc) return false;

    snapshot();
    srcLoc.arr.splice(srcLoc.index, 1);

    if (mode === 'child') {
      state.nodes[targetId].children.push(draggedId);
      state.nodes[targetId].collapsed = false;
    } else {
      const tLoc2 = locate(targetId);
      if (!tLoc2) { srcLoc.arr.splice(srcLoc.index, 0, draggedId); undoStack.pop(); return false; }
      const insertIndex = mode === 'before' ? tLoc2.index : tLoc2.index + 1;
      tLoc2.arr.splice(insertIndex, 0, draggedId);
    }
    markDirty();
    render();
    return true;
  }

  // Drag-and-drop: move draggedId to the end of the currently visible (zoomed) level.
  function performDropToRoot(draggedId) {
    if (!draggedId) return false;
    const ownerId = zoomStack.length ? zoomStack[zoomStack.length - 1] : null;
    if (ownerId !== null && (ownerId === draggedId || subtreeContains(draggedId, ownerId))) return false;
    const srcLoc = locate(draggedId);
    if (!srcLoc) return false;
    snapshot();
    srcLoc.arr.splice(srcLoc.index, 1);
    getCurrentRootChildren().push(draggedId);
    markDirty();
    render();
    return true;
  }

  function handleBackspaceMerge(id) {
    const node = state.nodes[id];
    if (node.children.length > 0) return;
    const prevId = visiblePrev(id);
    if (!prevId) return;
    snapshot();
    const prevNode = state.nodes[prevId];
    const mergeOffset = prevNode.text.length;
    prevNode.text = prevNode.text + node.text;
    const loc = locate(id);
    loc.arr.splice(loc.index, 1);
    delete state.nodes[id];
    markDirty();
    render();
    placeCaret(getCellEl(prevId), mergeOffset);
  }

  function toggleCollapse(id) {
    state.nodes[id].collapsed = !state.nodes[id].collapsed;
    render();
  }

  // Checking or unchecking an item applies the same state to everything under it.
  function setCheckedRecursive(id, value) {
    state.nodes[id].checked = value;
    state.nodes[id].children.forEach((cid) => setCheckedRecursive(cid, value));
  }

  function toggleChecked(id) {
    snapshot();
    const value = !state.nodes[id].checked;
    setCheckedRecursive(id, value);
    markDirty();
    render();
  }

  function toggleTodoMode() {
    snapshot();
    state.todoMode = !state.todoMode;
    markDirty();
    render();
  }

  function deleteNode(id) {
    const node = state.nodes[id];
    if (node.children.length > 0 && !confirm('Delete this item and everything under it?')) return;
    snapshot();
    const toDelete = collectSubtreeIds(id);
    const loc = locate(id);
    loc.arr.splice(loc.index, 1);
    toDelete.forEach((nid) => delete state.nodes[nid]);
    markDirty();
    render();
  }

  function setAllCollapsed(val) {
    Object.values(state.nodes).forEach((n) => {
      if (n.children.length) n.collapsed = val;
    });
    render();
  }

  function zoomInto(id) {
    zoomStack.push(id);
    render();
  }
  function zoomToIndex(i) {
    zoomStack = i < 0 ? [] : zoomStack.slice(0, i + 1);
    render();
  }

  function addItemToCurrentLevel() {
    snapshot();
    const id = createNode('');
    getCurrentRootChildren().push(id);
    markDirty();
    render();
    placeCaret(getCellEl(id), 0);
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function render() {
    visibleOrder = [];
    rowCounter = 0;
    outlineEl.innerHTML = '';
    const rootList = getCurrentRootChildren();
    if (rootList.length === 0) {
      outlineEl.appendChild(emptyStateEl());
    } else {
      rootList.forEach((id) => outlineEl.appendChild(renderNode(id)));
    }
    renderBreadcrumb();
    updateStatus();
    scheduleAutosave();
  }

  function renderNode(id) {
    const node = state.nodes[id];
    visibleOrder.push(id);

    const wrap = document.createElement('div');
    wrap.className = 'node';
    wrap.dataset.id = id;

    const row = document.createElement('div');
    row.className = 'node-row' + (rowCounter % 2 === 1 ? ' stripe' : '');
    rowCounter++;

    const dragHandle = document.createElement('button');
    dragHandle.type = 'button';
    dragHandle.tabIndex = -1;
    dragHandle.className = 'drag-handle';
    dragHandle.title = 'Drag to move this item';
    dragHandle.textContent = '⋮⋮';
    dragHandle.draggable = true;

    const twisty = document.createElement('button');
    twisty.type = 'button';
    twisty.tabIndex = -1;
    twisty.className = 'twisty' + (node.children.length ? '' : ' empty');
    twisty.textContent = node.children.length ? (node.collapsed ? '▸' : '▾') : '';
    if (node.children.length) twisty.addEventListener('click', () => toggleCollapse(id));

    const bullet = document.createElement('button');
    bullet.type = 'button';
    bullet.tabIndex = -1;
    bullet.className = 'bullet' + (node.children.length ? ' has-children' : '');
    bullet.title = 'Zoom in on this item';
    bullet.addEventListener('click', () => zoomInto(id));

    const cell = document.createElement('div');
    cell.className = 'cell' + (state.todoMode && node.checked ? ' done' : '');
    cell.contentEditable = 'true';
    cell.spellcheck = false;
    cell.dataset.id = id;
    cell.dataset.placeholder = 'Type an idea…';
    cell.innerText = node.text;

    const del = document.createElement('button');
    del.type = 'button';
    del.tabIndex = -1;
    del.className = 'del-btn';
    del.title = 'Delete this item';
    del.textContent = '×';
    del.addEventListener('click', () => deleteNode(id));

    if (state.todoMode) {
      const checkbox = document.createElement('button');
      checkbox.type = 'button';
      checkbox.tabIndex = -1;
      checkbox.className = 'todo-check' + (node.checked ? ' checked' : '');
      checkbox.title = node.checked ? 'Mark as not done' : 'Mark as done';
      checkbox.textContent = node.checked ? '✓' : '';
      checkbox.addEventListener('click', () => toggleChecked(id));
      row.append(dragHandle, twisty, bullet, checkbox, cell, del);
    } else {
      row.append(dragHandle, twisty, bullet, cell, del);
    }
    wrap.appendChild(row);

    if (node.children.length && !node.collapsed) {
      const childrenWrap = document.createElement('div');
      childrenWrap.className = 'children';
      node.children.forEach((cid) => childrenWrap.appendChild(renderNode(cid)));
      wrap.appendChild(childrenWrap);
    }

    return wrap;
  }

  function emptyStateEl() {
    const div = document.createElement('div');
    div.className = 'empty-state';
    const p = document.createElement('p');
    p.textContent = zoomStack.length ? 'This item has no notes yet.' : 'Nothing here yet — start brainstorming.';
    const btn = document.createElement('button');
    btn.className = 'btn btn-accent';
    btn.textContent = 'Add an item';
    btn.addEventListener('click', addItemToCurrentLevel);
    div.append(p, btn);
    return div;
  }

  function truncate(text, n) {
    const t = (text || '').split('\n')[0];
    return t.length > n ? t.slice(0, n) + '…' : (t || '(untitled)');
  }

  function renderBreadcrumb() {
    breadcrumbEl.innerHTML = '';
    const home = document.createElement('button');
    home.className = 'crumb' + (zoomStack.length === 0 ? ' current' : '');
    home.textContent = 'Outline';
    home.addEventListener('click', () => zoomToIndex(-1));
    breadcrumbEl.appendChild(home);

    zoomStack.forEach((id, i) => {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      breadcrumbEl.appendChild(sep);

      const btn = document.createElement('button');
      btn.className = 'crumb' + (i === zoomStack.length - 1 ? ' current' : '');
      btn.textContent = truncate(state.nodes[id].text, 28);
      btn.addEventListener('click', () => zoomToIndex(i));
      breadcrumbEl.appendChild(btn);
    });
  }

  function markDirty() {
    dirty = true;
    updateStatus();
    scheduleFileAutosave();
  }

  function updateStatus() {
    const n = Object.keys(state.nodes).length;
    countEl.textContent = n + (n === 1 ? ' item' : ' items');
    todoModeBtn.classList.toggle('active', !!state.todoMode);
    todoModeBtn.title = state.todoMode
      ? 'Turn off to-do checkboxes for this note'
      : 'Turn on to-do checkboxes for this note';
  }

  // ---------------------------------------------------------------------
  // Autosave (local safety net, not a file — see file save/open below)
  // ---------------------------------------------------------------------
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      try {
        localStorage.setItem('brainstorm-autosave', JSON.stringify({
          nodes: state.nodes,
          rootChildren: state.rootChildren,
          todoMode: state.todoMode,
          fileName: currentFileName,
        }));
      } catch (e) { /* storage unavailable — ignore */ }
    }, 800);
  }

  // ---------------------------------------------------------------------
  // Autosave to the open file (Chrome/Edge, once a file handle exists)
  // ---------------------------------------------------------------------
  async function writeStateToHandle(handle) {
    const dataStr = JSON.stringify(
      { app: 'brainstorm-outline', version: 1, rootChildren: state.rootChildren, nodes: state.nodes, todoMode: state.todoMode },
      null, 2
    );
    const writable = await handle.createWritable();
    await writable.write(dataStr);
    await writable.close();
  }

  function scheduleFileAutosave() {
    if (!autosaveToFileEnabled || !currentFileHandle) return;
    clearTimeout(fileAutosaveTimer);
    fileAutosaveTimer = setTimeout(async () => {
      try {
        await writeStateToHandle(currentFileHandle);
        dirty = false;
        updateStatus();
      } catch (e) { /* permission revoked or handle stale — next manual Save will recover */ }
    }, 1200);
  }

  // ---------------------------------------------------------------------
  // Document lifecycle
  // ---------------------------------------------------------------------
  function freshDocument() {
    state = { nodes: {}, rootChildren: [], todoMode: false };
    zoomStack = [];
    undoStack = [];
    redoStack = [];
    const id = createNode('');
    state.rootChildren.push(id);
    currentFileHandle = null;
    currentFileName = 'Untitled.json';
    dirty = false;
  }

  function loadFromText(text) {
    try {
      const obj = JSON.parse(text);
      if (!obj || typeof obj.nodes !== 'object' || !Array.isArray(obj.rootChildren)) {
        throw new Error('Unexpected shape');
      }
      state = { nodes: obj.nodes, rootChildren: obj.rootChildren, todoMode: !!obj.todoMode };
      zoomStack = [];
      undoStack = [];
      redoStack = [];
      dirty = false;
      render();
      return true;
    } catch (e) {
      alert("That file doesn't look like a BrainStorm outline (expecting a .json file saved from this app).");
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Save / Open (file only — no other import/export)
  // ---------------------------------------------------------------------
  async function doSave(saveAsNew) {
    const dataStr = JSON.stringify(
      { app: 'brainstorm-outline', version: 1, rootChildren: state.rootChildren, nodes: state.nodes, todoMode: state.todoMode },
      null, 2
    );

    if (window.showSaveFilePicker) {
      if (saveAsNew || !currentFileHandle) {
        try {
          currentFileHandle = await window.showSaveFilePicker({
            suggestedName: currentFileName.endsWith('.json') ? currentFileName : currentFileName + '.json',
            types: [{ description: 'BrainStorm outline', accept: { 'application/json': ['.json'] } }],
          });
          currentFileName = currentFileHandle.name;
        } catch (err) {
          if (err.name === 'AbortError') return;
          throw err;
        }
      }
      const writable = await currentFileHandle.createWritable();
      await writable.write(dataStr);
      await writable.close();
    } else {
      let name = currentFileName;
      if (saveAsNew || name === 'Untitled.json') {
        const entered = prompt('Save as file name:', name);
        if (entered === null) return;
        name = entered.trim() || name;
        if (!name.toLowerCase().endsWith('.json')) name += '.json';
      }
      currentFileName = name;
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
    dirty = false;
    updateStatus();
  }

  async function doOpen() {
    if (dirty && !confirm('Open a different file? Unsaved changes will be lost.')) return;

    if (window.showOpenFilePicker) {
      let handle;
      try {
        [handle] = await window.showOpenFilePicker({
          types: [{ description: 'BrainStorm outline', accept: { 'application/json': ['.json'] } }],
        });
      } catch (err) {
        if (err.name === 'AbortError') return;
        throw err;
      }
      const file = await handle.getFile();
      const text = await file.text();
      if (loadFromText(text)) {
        currentFileHandle = handle;
        currentFileName = handle.name;
      }
    } else {
      fileInput.click();
    }
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    const text = await file.text();
    if (loadFromText(text)) {
      currentFileHandle = null;
      currentFileName = file.name;
    }
    fileInput.value = '';
  });

  // ---------------------------------------------------------------------
  // Toolbar wiring
  // ---------------------------------------------------------------------
  document.getElementById('newBtn').addEventListener('click', () => {
    if (dirty && !confirm('Start a new outline? Unsaved changes will be lost unless already saved to a file.')) return;
    freshDocument();
    try { localStorage.removeItem('brainstorm-autosave'); } catch (e) {}
    render();
    placeCaret(getCellEl(state.rootChildren[0]), 0);
  });
  document.getElementById('openBtn').addEventListener('click', doOpen);
  document.getElementById('saveBtn').addEventListener('click', () => doSave(false));
  document.getElementById('saveAsBtn').addEventListener('click', () => doSave(true));
  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('redoBtn').addEventListener('click', redo);

  const autosaveBtn = document.getElementById('autosaveBtn');
  function updateAutosaveBtn() {
    autosaveBtn.classList.toggle('active', autosaveToFileEnabled);
    autosaveBtn.title = autosaveToFileEnabled
      ? 'Autosave to file: on (click to turn off)'
      : 'Autosave to file: off (click to turn on)';
  }
  try {
    const storedAutosave = localStorage.getItem('brainstorm-autosave-file');
    if (storedAutosave !== null) autosaveToFileEnabled = storedAutosave === 'true';
  } catch (e) {}
  updateAutosaveBtn();
  autosaveBtn.addEventListener('click', () => {
    autosaveToFileEnabled = !autosaveToFileEnabled;
    try { localStorage.setItem('brainstorm-autosave-file', String(autosaveToFileEnabled)); } catch (e) {}
    updateAutosaveBtn();
    if (autosaveToFileEnabled) scheduleFileAutosave();
  });
  document.getElementById('expandAllBtn').addEventListener('click', () => setAllCollapsed(false));
  document.getElementById('collapseAllBtn').addEventListener('click', () => setAllCollapsed(true));
  const todoModeBtn = document.getElementById('todoModeBtn');
  todoModeBtn.addEventListener('click', toggleTodoMode);

  const fullscreenBtn = document.getElementById('fullscreenBtn');
  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });
  document.addEventListener('fullscreenchange', () => {
    fullscreenBtn.textContent = document.fullscreenElement ? '⤢' : '⛶';
    fullscreenBtn.title = document.fullscreenElement ? 'Exit fullscreen' : 'Toggle fullscreen';
  });

  const themeBtn = document.getElementById('themeBtn');
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    themeBtn.textContent = theme === 'dark' ? '☀' : '☾';
    themeBtn.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    try { localStorage.setItem('brainstorm-theme', theme); } catch (e) {}
  }
  let storedTheme = null;
  try { storedTheme = localStorage.getItem('brainstorm-theme'); } catch (e) {}
  applyTheme(storedTheme === 'light' ? 'light' : 'dark');
  themeBtn.addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  document.getElementById('helpBtn').addEventListener('click', () => helpDialog.showModal());
  document.getElementById('closeHelpBtn').addEventListener('click', () => helpDialog.close());

  // ---------------------------------------------------------------------
  // Outline interactions: typing, keyboard, paste, click-below-to-add
  // ---------------------------------------------------------------------
  outlineEl.addEventListener('input', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const id = cell.dataset.id;
    if (!typingActive) {
      snapshot();
      typingActive = true;
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { typingActive = false; }, 800);
    state.nodes[id].text = cell.innerText.replace(/\n$/, (m) => m); // keep as-is
    markDirty();
    scheduleAutosave();
  });

  outlineEl.addEventListener('paste', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  outlineEl.addEventListener('click', (e) => {
    if (e.target === outlineEl) addItemToCurrentLevel();
  });

  // ---------------------------------------------------------------------
  // Drag and drop reordering / reparenting
  // ---------------------------------------------------------------------
  function clearDropIndicators() {
    outlineEl.querySelectorAll('.node-row.drop-before, .node-row.drop-after, .node-row.drop-child')
      .forEach((el) => el.classList.remove('drop-before', 'drop-after', 'drop-child'));
    outlineEl.classList.remove('drop-root');
  }

  outlineEl.addEventListener('dragstart', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) { e.preventDefault(); return; }
    const nodeEl = handle.closest('.node');
    draggedId = nodeEl.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', draggedId);
    requestAnimationFrame(() => nodeEl.classList.add('dragging'));
  });

  outlineEl.addEventListener('dragend', () => {
    outlineEl.querySelectorAll('.node.dragging').forEach((n) => n.classList.remove('dragging'));
    clearDropIndicators();
    draggedId = null;
    currentDropTarget = null;
    currentDropMode = null;
  });

  outlineEl.addEventListener('dragover', (e) => {
    if (!draggedId) return;
    const row = e.target.closest('.node-row');
    if (row) {
      e.preventDefault();
      const targetId = row.closest('.node').dataset.id;
      clearDropIndicators();
      if (targetId === draggedId) { currentDropTarget = null; currentDropMode = null; return; }
      const rect = row.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      const mode = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'child';
      row.classList.add('drop-' + mode);
      currentDropTarget = targetId;
      currentDropMode = mode;
    } else if (e.target === outlineEl) {
      e.preventDefault();
      clearDropIndicators();
      outlineEl.classList.add('drop-root');
      currentDropTarget = 'ROOT';
      currentDropMode = null;
    }
  });

  outlineEl.addEventListener('drop', (e) => {
    if (!draggedId) return;
    e.preventDefault();
    if (currentDropTarget === 'ROOT') {
      performDropToRoot(draggedId);
    } else if (currentDropTarget) {
      performDrop(draggedId, currentDropTarget, currentDropMode);
    }
    clearDropIndicators();
    draggedId = null;
    currentDropTarget = null;
    currentDropMode = null;
  });

  outlineEl.addEventListener('keydown', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const id = cell.dataset.id;
    if (!state.nodes[id]) return;

    const mod = e.ctrlKey || e.metaKey;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEnter(id, cell);
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      insertLineBreak(cell);
    } else if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      handleIndent(id);
    } else if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      handleOutdent(id);
    } else if (e.key === 'Backspace' && !mod) {
      if (getCaretOffset(cell) === 0 && window.getSelection().isCollapsed) {
        e.preventDefault();
        handleBackspaceMerge(id);
      }
    } else if (mod && e.key === 'ArrowUp') {
      e.preventDefault();
      moveSibling(id, -1);
    } else if (mod && e.key === 'ArrowDown') {
      e.preventDefault();
      moveSibling(id, 1);
    } else if (!mod && !e.altKey && e.key === 'ArrowUp') {
      const prev = visiblePrev(id);
      if (prev) { e.preventDefault(); placeCaret(getCellEl(prev), 'end'); }
    } else if (!mod && !e.altKey && e.key === 'ArrowDown') {
      const next = visibleNext(id);
      if (next) { e.preventDefault(); placeCaret(getCellEl(next), 0); }
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    } else if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      e.preventDefault();
      redo();
    } else if (mod && e.key === 'Backspace') {
      e.preventDefault();
      deleteNode(id);
    }
  });

  // Global shortcuts (save / open / new) regardless of focus
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      doSave(false);
    } else if (mod && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      doOpen();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function init() {
    let auto = null;
    try { auto = localStorage.getItem('brainstorm-autosave'); } catch (e) {}
    if (auto) {
      try {
        const obj = JSON.parse(auto);
        if (obj.nodes && Object.keys(obj.nodes).length) {
          state = { nodes: obj.nodes, rootChildren: obj.rootChildren, todoMode: !!obj.todoMode };
          zoomStack = [];
          currentFileName = obj.fileName || 'Untitled.json';
          currentFileHandle = null;
          dirty = false;
          render();
          return;
        }
      } catch (e) {}
    }
    freshDocument();
    render();
  }

  init();
})();
