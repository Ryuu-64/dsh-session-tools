# Plugin-only reading position feasibility test

This is a separately installed, removable, **text-only Reading PoC view** on
official DSH 0.2.0-rc.2. It does not replace the native Chat view. A new
`conversation.view` entry uses public Session retention and Conversation `chat`
snapshot APIs for real Session data and streamed assistant text. The plugin owns
only its small plain-text reader and its own scrollport.

Each mounted reader keeps independent content-anchor and pixel-offset records.
Departure saves position even at the old tail. Returning restores once, then
holds. Only the explicit "Go to latest" action enables following. No host DOM
scroll writes, host component replacements, React internal lookups, mutation
observers or scroll-correction timers are used.

## Scope and remaining integration work

- A/B navigation is **inside the reader**. Native `session_create` cards, main
  navigation and Sidebar navigation are not integrated.
- The native composer still targets the outer Session. The reader labels this;
  tests read only and do not use that composer.
- State lives in a mounted reader. Switching native Sessions or views, reload,
  or uninstall/remount can destroy it. Cross-remount recovery is not implemented.
- Production integration needs an explicit public navigation/occurrence owner,
  per-occurrence return records, cleanup and history loading. A Session-ID-only
  map would incorrectly join simultaneous readers.
- This tab's removal lets the official view selector fall back to Chat. It does
  not itself provide cross-remount persistence.
- Rendering is text only. Native Markdown, images, tool cards, process folding,
  grouping, forks, rails, prompt inspection and Sidebar resources are not reused.
  Chat's child slots and injected props prevent treating internal components as
  a drop-in complete Chat with a new scroll owner.
- Only loaded text paragraphs are anchored. Missing-history recovery, source
  rewrites, image/font/reflow changes, touch and scrollbar follow cancellation
  are outside this small test. Wheel and scrolling keys leave follow mode.

## Official API evidence

All source references are at
[639ed015397290b3745d163aafe02ffee4aa3f84](https://github.com/deepseek-ai/deepseek-harness/tree/639ed015397290b3745d163aafe02ffee4aa3f84)
(tag `dsh-v0.2.0-rc.2`).

- `packages/client/ui-conversation/src/client/contract/slots.ts`: session-scoped
  `conversation.view` list and standard Session identity.
- `packages/client/ui-conversation/src/client/apply.ts`: view roster and slot
  subscription; `view-selection.ts`: preferred view, then Chat fallback.
- `packages/client/ui-conversation/src/client/conversation/assembly.ts`:
  `binding(...).target('chat')` observable and first-subscriber activation.
- `packages/api/session-controller/src/client/contract/sessions.ts`:
  `retain`, `reference.ready`, `reference.release` lifetime.
- `packages/api/session-controller/src/client/index.ts`: consumer-owned,
  declaration-merge-extensible Session reference-source labels.

## Fixtures and running

Fixtures come from the already published
[0c76cecb5acf160c3c6083ed8c129ee15b7ba23e](https://github.com/Ryuu-64/dsh-session-tools/tree/0c76cecb5acf160c3c6083ed8c129ee15b7ba23e/scripts/reading-return).
`fixture-host.mjs` and `vendor-versions.json` are unchanged;
`seed-history.mjs` is just the imports, identities and `seedHistory` function from
that commit's `browser-scenarios.mjs`, without its native-Chat test cases.
The fixture has no browser client. Its only control channel is the isolated
HTTP endpoint; the old host-patch-specific browser bridge is not included.
These synthetic histories and controlled model output use official Session,
JSONL and Agent APIs in an empty temporary profile. No personal sessions,
credentials or external model requests are used.

From this repository:

    npm ci --ignore-scripts --no-audit --no-fund
    npm install --global --ignore-scripts pnpm@11.7.0
    npm install --no-save --package-lock=false --ignore-scripts --no-audit --no-fund playwright@1.56.1
    npx playwright install --with-deps chromium
    mkdir -p evidence/plugin-reader
    npm pack ./scripts/plugin-reader-poc/plugin --ignore-scripts --pack-destination evidence/plugin-reader
    node scripts/plugin-reader-poc/real-host-browser.mjs 0.2.0-rc.2 \
      evidence/plugin-reader/ryuu-64-dsh-reading-view-poc-0.0.0.tgz \
      evidence/plugin-reader/browser

The runner rejects any host-patch argument. It pins official DSH dependencies,
installs without scripts, downloads independent official registry tarballs,
checks their SHA512 against registry metadata and the runtime lock, and compares
every file in four key official packages. Actual HTTP client responses must
contain those original official bundles. It rechecks official files after plugin
installation and removal. No old host candidate artifacts are loaded.

The workflow runs only on the separate experiment branch or explicit dispatch.
No merge, upstream submission or npm publication is included. A browser-startup
failure is not a passing UI test. The first expected UI evidence covers old-tail
A → B → A, growth while away and after returning, explicit latest, independent
reader instances, and uninstall restoring native Chat.
