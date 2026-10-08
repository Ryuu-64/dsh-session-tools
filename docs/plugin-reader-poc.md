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

## Optional reading-mode card return

This experiment now pairs the source version of `dsh-session-tools` with the
optional reader plugin. The main plugin exposes its own `SessionCreateRow`
through `sessionToolsCards.renderCreatedSession`; both views use the same card
component and the same durable result metadata. No host Slot entry is copied,
mutated or redeclared.

1. In source Session A, explicitly select the **Reading PoC** tab.
2. Click the existing created-session card in that reader.
3. The official `uiWorkspace.openSession` navigates the main Conversation to B.
   B keeps its existing view, including native Chat; it is not forced into a reader.
4. The title area offers **返回 RETURN_A 的原位置**. It navigates back through the
   same official API. A gets a new reader mount and restores its captured content
   and offset while holding position through further streamed output.
5. **Go to latest** resumes following. Another native navigation, explicit cancel,
   or plugin unload discards the pending return and releases its source reference.

Ordinary cards clicked in native Chat retain their original navigation behavior.
They do **not** promise exact source return. This is an opt-in reading-mode
extension, not a replacement of default Chat or a native-Chat scroll interception.

## Scope and remaining integration work

- The implemented return owner is the main navigation in one browser/plugin root.
  The independent reader-copy demo retains its separate scroll state but does not
  originate exact main-navigation returns. Sidebar return ownership is not added.
- A reload or plugin unload discards pending return state. Missing history or an
  unavailable source view reports failure rather than guessing a successful offset.
- Internal A/B controls remain in this experimental reader solely to preserve the
  earlier mechanism tests. The new card test separately proves native Session
  navigation, absence of the source reader in B, and a different source mount on return.
- The native composer addresses the outer Session. During real main navigation
  it therefore follows A/B correctly. The old internal A/B demo labels its limitation.
- Most content is still plain text, with the shared created-session cards added.
  Other tool cards, images, process folding, groups, fork controls and rails are
  not integrated. Official `MarkdownText` is a public reusable primitive, but
  faithful block-level rendering and anchor/reflow handling remain separate work.
- Native tool/image rendering lives under owner-specific declared child slots.
  Registering those same children in a second view conflicts; the renderer rejects
  calls outside an entry's declared children. This implementation reuses only the
  card component owned by this plugin, not private host component objects.
- Only loaded content is anchored. Source rewrites, image/font/reflow changes,
  touch and scrollbar follow cancellation remain outside this experiment.
- Removing the optional reader restores the official Chat selection. The
  companion session-tools plugin can remain installed with its ordinary cards.

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
    npm pack --ignore-scripts --pack-destination evidence/plugin-reader
    npm pack ./scripts/plugin-reader-poc/plugin --ignore-scripts --pack-destination evidence/plugin-reader
    node scripts/plugin-reader-poc/real-host-browser.mjs 0.2.0-rc.2 \
      evidence/plugin-reader/ryuu-64-dsh-reading-view-poc-0.0.0.tgz \
      evidence/plugin-reader/browser --session-tools-artifact evidence/plugin-reader/ryuu-64-dsh-session-tools-0.6.0.tgz

The runner rejects any host-patch argument. It pins official DSH dependencies,
installs without scripts, downloads independent official registry tarballs,
checks their SHA512 against registry metadata and the runtime lock, and compares
every file in four key official packages. Actual HTTP client responses must
contain those original official bundles. It rechecks official files after plugin
installation and removal. No old host candidate artifacts are loaded.

The workflow runs only on the separate experiment branch or explicit dispatch.
No merge, upstream submission or npm publication is included. The package version
remains unchanged because this is an unreleased source experiment. A browser-startup
failure is not a passing UI test. The first expected UI evidence covers old-tail
A → B → A, growth while away and after returning, explicit latest, independent
reader instances, and uninstall restoring native Chat. The additional integration
case uses the real shared card, native A/B navigation, source unmount/remount and
continued source streaming; a native-Chat card baseline stays unchanged.
