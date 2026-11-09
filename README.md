# todo

A [Beast](https://www.npmjs.com/package/beast-tsrx) project powered by
[TSRX](https://tsrx.dev/) and [Octane](https://octanejs.dev/).

```bash
bun install
bun run dev
```

The starter is one quiet screen: a headline, a counter that shows component
state, and links to the docs. It follows the system light/dark preference. The
palette, type, and motion live in a few custom properties at the top of
`src/style.css`.

Edit `src/App.btsx` to get started. Declare typed props at the top of the BTSX
file; the Beast bundler adapter compiles it into native TSRX and then lets Octane
produce the browser module.

The starter pins the tested `octane@0.16.0` toolchain. Run the complete local
verification before shipping:

```bash
bun run check
```

Use `scope` when setup belongs to an exact child position instead of the whole
component:

```btsx
scope
  setup const label = "Owned by this child";
  p #{label}
```

Octane signals need no build option. Import `octane/signals` in a module to
enable native signal reads there:

```btsx
import { createScope } from "octane/signals"
```

Record application changes in [CHANGELOG.md](CHANGELOG.md).

Node compiler builds require `@tsrx/oxc@0.20.0`, included explicitly in the
starter. The TSRX type-checking plugin is pinned to `0.6.3`.

## Selected stack

- Bundler: vite
- UI: base-ui (@octanejs/base-ui)
- Styling: Tailwind CSS v4

```ts
import { Button } from "@octanejs/base-ui/button";
```

## Optional tools

- Beast Devtools: press **Alt+Shift+D** while the dev server runs. Octane profiling is enabled only in development.
- Beast Page Builder: press **⌘B / Ctrl+B** while the dev server runs. Creating routes requires a TanStack router and an app shell with an Outlet; this starter does not create those automatically.
- Beast UI: `bun run beast-ui add button` copies editable components into `src/components/ui`. Tailwind CSS v4 and the `@/*` alias are already configured.
- Beast icons: import `{ Icon }` from `@/lib/icons`. Add SVGs to `src/lib/icons/svg`, then run `bun run icons:build`. Check generated output with `bun run icons:check`.

Setup commands (the builder runs these after installation; run them yourself with `--no-install`):

```sh
bun install
bun run beast-ui init --package-manager bun
bun run beast-ui icons init --framework beast
```
