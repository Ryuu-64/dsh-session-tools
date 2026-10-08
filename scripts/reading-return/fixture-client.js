// Temporary profile-only consumer of public services. It neither reads React internals nor sets scroll results.
window.__ModuleLoader__.load({
  id: '@reading-return/fixture',
  factory() {
    return {
      inject: ['sessions', 'sidebarRight', 'configForms', 'uiConversation', 'uiChatReading'],
      apply(ctx) {
        const occurrences = new Map();
        const bookmarks = new Map(), restores = new Map();
        const address = (parent, child) => `dsh-resource://subagentchat/session/${encodeURIComponent(child)}?parent=${encodeURIComponent(parent)}&mode=unknown`;
        const bridge = {
          captureNative(id, key) {
            const root = document.querySelector(`[data-slot="main"] [data-conversation-session="${id}"]`);
            const bookmark = ctx.uiChatReading.capture(root.querySelector('[data-chat-reading-root]'));
            if (!bookmark) throw new Error('native service did not capture a mounted reader');
            bookmarks.set(key, bookmark);
          },
          beginNativeRestore(key) {
            const controller = new AbortController(), state = { controller, pending: true, result: null };
            restores.set(key, state);
            void ctx.uiChatReading.restore(bookmarks.get(key), controller.signal).then(
              result => { state.result = result; state.pending = false; },
              error => { state.result = { error: String(error) }; state.pending = false; },
            );
          },
          nativeStatus(key) { const state = restores.get(key); return state && { pending: state.pending, result: state.result }; },
          sourceEvent(id, nodeKey) {
            const binding = ctx.sessions.binding(id);
            return binding && ctx.uiConversation.binding(binding).target('chat').getSnapshot()?.nodes.get(nodeKey)?.anchorSeq;
          },
          setTranscript(mode) { return ctx.configForms.get('ui-chat').set('transcriptView', mode); },
          openSidebar(parent, child, key, duplicate = false) {
            const before = new Set(ctx.sidebarRight.tabsIn(parent).map(tab => tab.id));
            ctx.sidebarRight.openResource(address(parent, child), { revealIfOpened: !duplicate, preferNewPane: duplicate });
            const tab = ctx.sidebarRight.tabsIn(parent).find(tab => !before.has(tab.id) && tab.contentId === address(parent, child)) ?? ctx.sidebarRight.active();
            if (!tab) throw new Error('fixture Sidebar did not open a real tab');
            const occurrence = ctx.sidebarRight.tabDomain.occurrence(parent, { id: tab.id });
            occurrences.set(key, occurrence);
            return { id: occurrence.id, tabId: tab.id };
          },
          occurrence(key) {
            const value = occurrences.get(key);
            if (!value) throw new Error('unknown fixture tab');
            return { id: value.id, aborted: value.signal.aborted, address: value.navigation.getSnapshot().address };
          },
          closeSidebar(key) { occurrences.get(key).tabActions.close(); },
          replaceSidebar(key, parent, child) {
            occurrences.get(key).tabActions.openResource(address(parent, child), { replaceTab: true });
          },
          references(id) { return { ...(ctx.sessions.list.getSnapshot().byId[id]?.retainedBy ?? {}) }; },
        };
        ctx.effect(() => {
          window.__readingReturnFixture = bridge;
          return () => {
            if (window.__readingReturnFixture === bridge) delete window.__readingReturnFixture;
            for (const state of restores.values()) state.controller.abort();
            restores.clear(); bookmarks.clear(); occurrences.clear();
          };
        });
      },
    };
  },
});
