# Vibesearch Extension

## Dev Mode

Use dev mode when you want development-only tooling such as React Grab.

Install dependencies:

```sh
bun install
```

Start the Chrome dev build watcher:

```sh
bun run dev:chrome
```

If you are using npm instead:

```sh
npm run dev:chrome
```

This script builds the extension with both:

- `NODE_ENV=development`
- `vite --mode development`

Both are important. React Grab is only loaded when Vite mode is `development`, and the Chrome config uses `NODE_ENV=development` to emit the dev extension manifest.

After the build finishes, load the extension in Chrome:

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the `dist_chrome` folder from this repo.

The loaded extension should be named `Vibesearch (Dev)`. If you already had it loaded, click the reload button on the extension card after each rebuild.

### React Grab Check

Open the popup, search page, or options page, then check the page console:

```js
window.__REACT_GRAB_DEV_READY__
```

It should be `true` in dev mode. If it is not, make sure you ran `bun run dev:chrome` or `npm run dev:chrome`, not `build` or `build:chrome`.
