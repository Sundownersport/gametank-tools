# GameTank Tools

VS Code extension for [GameTank](https://gametank.zone) development with the [gametank_sdk](https://github.com/clydeshaffer/gametank_sdk).

- **Emulator panel**: runs your ROM inside VS Code and reloads it every time it is rebuilt.
- **Build tasks**: `make import && make` as the default build task, with compiler errors linked to your source.
- **Live preview**: an optional per-game script that redraws on every keystroke, with a tile editor for level data.
- **Palette colours**: swatches next to colour values in C, a colour picker that snaps to the GameTank palette, and a palette panel.
- **Sprite viewer**: shows `.bmp` assets in real GameTank colours and warns when a file's palette differs.

A project is any folder with `project.json` and `makefile`, as created from gametank_sdk. Projects at the workspace root or one folder down are found automatically.

## Install

Download `gametank-tools.vsix` from the [latest release](https://github.com/Sundownersport/gametank-tools/releases), then in VS Code run **Extensions: Install from VSIX...** and pick the file.

## Emulator

**GameTank: Build and Run** (▶ in the editor title bar) saves all files, runs the build task, and opens the ROM in an emulator panel. **GameTank: Run ROM in Emulator** opens the ROM without building, and `.gtr` files have a "Run ROM in Emulator" entry in the explorer's right-click menu.

The panel watches the ROM file and reloads it whenever it changes, whether the build ran from VS Code or a terminal. The emulator pauses while the panel is hidden.

| Key | GameTank |
| --- | --- |
| Arrows | D-pad |
| Z / X / C | A / B / C |
| Enter | Start |

Gamepads work too. Click the screen first so it has keyboard focus.

The emulator is [GameTankEmulator](https://github.com/clydeshaffer/GameTankEmulator) by Clyde Shaffer (MIT), built to WebAssembly.

## Build tasks

The extension provides `gametank` tasks for each project: `build`, `clean` and `prereqs`. Run them with **Terminal > Run Build Task** (Ctrl+Shift+B) or **Tasks: Run Task**. Errors from cc65 and ca65 appear in the Problems panel.

## Palette colours

In C files, colour values get a swatch:

- `#define` constants whose name looks like a colour (`C_SKY`, `COLOR_BG`, `PLAYER_COLOUR`), when the value is a number.
- Calls to any 3-argument `#define` macro that shifts its first argument left by 5, such as `#define COL(h, s, l) (((h) << 5) | ((s) << 3) | (l))`.
- Literal colours in `queue_draw_box`, `queue_clear_screen` and `queue_clear_border`.

Clicking a swatch opens VS Code's colour picker. Whatever you pick is snapped to the nearest GameTank colour and written back in the same form: decimal, hex or macro.

**GameTank: Show Palette** opens all 256 colours by hue, saturation and luminance. Clicking one inserts it at the cursor.

## Sprite viewer

Right-click a `.bmp` and choose **Open in Sprite Viewer**, or use **Reopen Editor With...** on an open one. It shows the image as the GameTank will draw it, with zoom, a tile grid and the colour index under the mouse. If the file's embedded palette differs from the GameTank palette, it says so and can show both side by side.

## Live preview

The emulator needs a build to show changes. For things you tweak constantly, such as level layouts or physics constants, a game can include a small JavaScript copy of its logic that the extension runs on every keystroke. **GameTank: Open Live Preview** opens it.

Add `.gametank/preview.js` to the project:

```js
GameTank.defineGame({
    source: 'src/main.c',          // file to watch, relative to the project
    requires: ['GRAVITY', 'C_BG'],  // #defines that must parse, or a problem is shown

    load(gt) { },                   // source changed: read gt.defines, gt.table(), report gt.problem()
    levels(gt) { return []; },      // optional: [{ name?, first, last, rows }] from gt.table()
    start(gt, level) { },           // reset to a level
    step(gt) { },                   // one 60 Hz frame of game logic
    draw(gt) { },                   // draw the current frame into gt.screen
    drawLevel(gt, level) { },       // optional: static view, used for thumbnails and edit mode
    editor: { },                    // optional: tile editor, see below
});
```

`start` runs on first load, when you switch level, and when the text of the current level changes. Changing constants does not restart, so you can tune physics while the game is running. Return `true` from `load` to force a restart.

The `gt` object:

| Member | |
| --- | --- |
| `gt.defines` | every `#define` in the source that evaluates to a number, including function-like macros |
| `gt.table(name)` | string tables such as `levels[][H][W+1]`: `[{ first, last, rows: [{ line, col, text }] }]` |
| `gt.source` | `{ text, lines, file }` |
| `gt.input` | `{ held, pressed }`, each with `up down left right a b c start` |
| `gt.screen` | 128×128 `Uint8Array` of GameTank colour indexes |
| `gt.clear(c)`, `gt.box(x, y, w, h, c)`, `gt.pixel(x, y, c)` | drawing |
| `gt.blit(pixels, width, x, y, sx?, sy?, w?, h?, transparent?)` | copy from your own pixel buffer, skipping colour 0 |
| `gt.text(x, y, str, 'white' \| 'black')` | the SDK's 8×8 font |
| `gt.color(h, s, l)` | colour index from hue, saturation and luminance |
| `gt.problem(message)` | show a problem under the preview |
| `gt.frame` | frame counter |

With `editor`, an Edit mode appears. Clicking a cell writes the tile's character straight into the level's string in the source.

```js
editor: {
    x: 0, y: 16,                 // screen position of the grid (numbers or gt => number)
    cellW: 8, cellH: 8,
    empty: '.',                  // right click paints this
    unique: ['S'],               // placing one removes the others in the level
    tiles: [{ ch: '#', name: 'Wall' }, { ch: 'S', name: 'Start' }],
    drawTile(gt, ch) { },        // optional: draw an icon at 0,0 for the toolbar
},
```

Moving the editor cursor into a level in the source switches the preview to it, and clicking a thumbnail jumps to the level in the source.

The preview is a copy of your game's logic. Level data and constants come from the real source, but if you change the C logic, update the preview script to match. [Boing Boing!](https://github.com/Sundownersport/boing-boing/blob/main/.gametank/preview.js) has a complete example.

## Development

```
git clone https://github.com/Sundownersport/gametank-tools.git
cd gametank-tools
sh scripts/fetch-emulator.sh      # or build it: sh scripts/build-emulator.sh (needs emsdk)
ln -s "$PWD" ~/.vscode/extensions/sundownersport.gametank-tools-0.1.0
```

Restart VS Code after linking. CI builds the emulator and the `.vsix` on every push, and attaches the `.vsix` to a release when a `v*` tag is pushed.

## License

MIT. The bundled emulator is MIT, © Clyde Shaffer.
