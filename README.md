# BrainStorm — a rapid outliner

A single-page, keyboard-driven outliner inspired by [brainstormsw.com](https://brainstormsw.com)'s
"single-cell" idea tree. Type an idea, hit Enter for the next one, indent to nest it — and it saves
straight to a file on your own machine. No accounts, no server, no tracking.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure and toolbar |
| `styles.css` | Look and feel (light/dark themes) |
| `app.js` | All app logic |

Keep all three in the same folder and open `index.html` in a browser. That's the whole install.

## Features

- **Single-cell editing** — every idea is its own line; click anywhere in the tree and type.
- **Full keyboard control** — create, indent, reorder, and merge items without touching the mouse.
- **Drag and drop** — grab the `⋮⋮` handle on any item to reorder it or nest it under another.
- **Zoom / focus** — click an item's dot to zero in on just that branch, with a breadcrumb trail back out.
- **Collapse / expand** — fold branches you're not working on; expand-all / collapse-all in the toolbar.
- **Undo / redo** — every structural change and each burst of typing is one undo step.
- **Save and open files** — outlines are saved as `.json` files you keep wherever you like.
- **Autosave** — once a file is open (Chrome/Edge), edits write back to it automatically a moment
  after you stop typing. A local browser backup also protects you in other browsers or before your
  first save.
- **Light and dark themes** — dark by default, toggle in the toolbar, remembered between visits.
- **Fullscreen** — the editor already fills the window; the toolbar button additionally requests
  true browser fullscreen.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `Enter` | New item below (splits the text at your cursor) |
| `Shift + Enter` | New line inside the same item |
| `Tab` | Indent — make it a child of the item above |
| `Shift + Tab` | Outdent — move it up a level (later siblings become its children) |
| `Ctrl/Cmd + ↑` / `↓` | Move the item up or down among its siblings |
| `↑` / `↓` | Move the cursor to the item above or below |
| `Backspace` at the start of an item | Merge it into the item above |
| `Ctrl/Cmd + Backspace` | Delete the item (asks first if it has children) |
| `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z` | Undo / redo |
| `Ctrl/Cmd + S` | Save |
| `Ctrl/Cmd + O` | Open a file |

Mouse-only equivalents: the ▸/▾ triangle collapses or expands a branch, the dot zooms in, the `⋮⋮`
handle drags, and the `×` deletes.

## Saving and opening files

- **Save / Save As** write a `.json` file. In Chrome or Edge, this uses the native file picker and
  writes straight to disk — after that, subsequent edits autosave to the same file.
- In other browsers, Save always downloads a new copy (there's no way for a web page to silently
  overwrite a file without that browser API), and Save As lets you rename it first.
- **Open** loads a previously saved `.json` file back in.
- There's no other import or export format — this app only reads and writes its own file.

### File format

A saved file looks like this:

```json
{
  "app": "brainstorm-outline",
  "version": 1,
  "rootChildren": ["n1a2b3"],
  "nodes": {
    "n1a2b3": { "id": "n1a2b3", "text": "My idea", "children": [], "collapsed": false }
  }
}
```

It's plain JSON, so it's easy to inspect, back up, or sync with any tool you like.

## Browser support

Works in any modern browser. The File System Access API (used for in-place saving and autosave to
disk) is currently Chromium-only (Chrome, Edge, Opera, Brave); Firefox and Safari fall back to
download-based saving, and autosave falls back to a local browser backup instead of writing to disk.

## Known limitations

- No import/export beyond this app's own `.json` file, by design.
- Each item has exactly one place in the tree. Some outliners (including the original BrainStorm)
  let a single entry appear — and stay linked — in multiple places at once; that's not implemented
  here to keep the core outliner reliable.
- Drag-and-drop uses the browser's native HTML5 drag API, which doesn't support touch — on
  touchscreens, use indent/outdent and move-up/down instead.
