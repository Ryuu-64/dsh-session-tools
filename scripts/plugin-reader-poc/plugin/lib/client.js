// Deliberately small, read-only, text-only feasibility view. Not native Chat.
// Only documented services, a new conversation.view registration and owned DOM.
window.__ModuleLoader__.load({
  id: '@ryuu-64/dsh-reading-view-poc',
  factory(require) {
    const React = require('react');
    const { createElement: h, useState, useRef, useEffect, useLayoutEffect, useSyncExternalStore } = React;
    const EMPTY = { getSnapshot: () => undefined, subscribe: () => () => {} };
    return {
      inject: ['slots', 'sessions', 'uiConversation'],
      apply(ctx) {
        let nextInstance = 0;
        function Reader({ sessionId: initialId, copy = 0 }) {
          const [id, setId] = useState(initialId);
          const [loaded, setLoaded] = useState(null);
          const [error, setError] = useState('');
          const [mode, setMode] = useState('following');
          const [second, setSecond] = useState(false);
          const instance = useRef(null);
          if (instance.current === null) instance.current = ++nextInstance;
          const scroller = useRef(null);
          const records = useRef(new Map());
          const refs = useRef(new Map());
          const modeRef = useRef(mode); modeRef.current = mode;
          const pendingRestore = useRef(null);
          const source = loaded?.id === id ? loaded.source : EMPTY;
          const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
          const catalog = useSyncExternalStore(ctx.sessions.list.subscribe, ctx.sessions.list.getSnapshot, ctx.sessions.list.getSnapshot);
          // References are per reader instance and disposed on unmount. Keeping A
          // retained while viewing B lets official Session transport keep updating A.
          useEffect(() => () => { for (const ref of refs.current.values()) ref.release(); refs.current.clear(); }, []);
          useEffect(() => {
            let cancelled = false;
            setError('');
            let reference = refs.current.get(id);
            if (!reference) { reference = ctx.sessions.retain(id, { source: 'readingViewPoc' }); refs.current.set(id, reference); }
            reference.ready.then(binding => {
              if (cancelled) return;
              const saved = records.current.get(id);
              pendingRestore.current = saved ?? null;
              modeRef.current = saved ? 'holding' : 'following';
              setMode(modeRef.current);
              const target = ctx.uiConversation.binding(binding).target('chat');
              setLoaded({ id, source: target });
            }).catch(e => { if (!cancelled) setError(String(e)); });
            return () => { cancelled = true; };
          }, [id]);
          function capture() {
            const element = scroller.current;
            if (!element) return null;
            const top = element.getBoundingClientRect().top + element.clientTop;
            const node = [...element.querySelectorAll('[data-reader-anchor]')].find(row => row.getBoundingClientRect().bottom > top);
            return node ? { key: node.dataset.readerAnchor, offset: node.getBoundingClientRect().top - top, text: node.textContent } : null;
          }
          function navigate(next) {
            if (next === id) return;
            const record = capture();
            if (record) records.current.set(id, record);
            // A departure ALWAYS saves content position, even if A was following.
            // Being at the old tail is never interpreted as permission to follow on return.
            setId(next);
          }
          useLayoutEffect(() => {
            const element = scroller.current;
            if (!element || loaded?.id !== id || !snapshot) return;
            const saved = pendingRestore.current;
            if (saved) {
              const row = [...element.querySelectorAll('[data-reader-anchor]')].find(item => item.dataset.readerAnchor === saved.key);
              if (!row) { setError('Saved content is outside loaded history; this small PoC does not page it back.'); return; }
              // A single restore on this owned scrollport; no host scroll writes,
              // timers, mutation observer or attempts to fight the host follow loop.
              element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - element.clientTop - saved.offset;
              pendingRestore.current = null;
            } else if (modeRef.current === 'following') element.scrollTop = element.scrollHeight;
          }, [snapshot, id, loaded]);
          const rows = [];
          for (const key of snapshot?.order ?? []) {
            const node = snapshot.nodes.get(key);
            if (!node || node.visibility === 'hidden') continue;
            const parts = node.kind === 'user' ? node.data.content.filter(p => p.type === 'text').map(p => p.text)
              : node.kind === 'assistant-step' ? node.data.blocks.filter(p => p.kind === 'text').map(p => p.text) : [];
            parts.forEach((text, block) => text.split(/\n\n/).forEach((paragraph, part) => {
              if (!paragraph) return;
              const anchor = `${key}:${block}:${part}`;
              rows.push(h('p', { key: anchor, 'data-reader-anchor': anchor, 'data-reader-node': key,
                style: { margin: '0 0 14px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, paragraph));
            }));
          }
          const button = (label, onClick, extra = {}) => h('button', { type: 'button', onClick, ...extra }, label);
          return h('section', { 'data-reader-instance': instance.current, 'data-reader-session': id, 'data-reader-mode': mode,
            style: { width: '100%', maxWidth: 720, minWidth: 0, marginInline: 'auto', boxSizing: 'border-box', padding: 12, border: '1px solid #999', background: '#fff', color: '#17202a' } },
            h('strong', null, `Reading PoC ${copy ? 'independent copy' : ''}: ${catalog.byId[id]?.displayTitle ?? id}`),
            h('div', null, 'Text-only plugin view. The native composer below still targets the outer session.'),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0' } },
              h('select', { 'aria-label': `Reading session ${copy}`, value: id, onChange: e => navigate(e.target.value) },
                catalog.ids.map(value => h('option', { key: value, value }, catalog.byId[value]?.displayTitle ?? value))),
              button('Return to source', () => navigate(initialId), { disabled: id === initialId }),
              button('Go to latest', () => { records.current.delete(id); pendingRestore.current = null; modeRef.current = 'following'; setMode('following'); if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }),
              !copy && button(second ? 'Close independent reader' : 'Open independent reader', () => setSecond(!second))),
            error && h('div', { role: 'alert' }, error),
            h('div', { ref: scroller, 'data-reader-scroll': '', tabIndex: 0,
              // User scrolling exits follow. Only Go to latest enables it again.
              onWheel: () => { modeRef.current = 'holding'; setMode('holding'); },
              onKeyDown: e => { if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) { modeRef.current = 'holding'; setMode('holding'); } },
              style: { height: copy ? 240 : 420, overflowY: 'auto', overflowAnchor: 'none', border: '1px solid #ccd', padding: 12, boxSizing: 'border-box' } }, rows),
            second && h(Reader, { key: 'independent', sessionId: initialId, copy: 1 }));
        }
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view', id: 'reading-view-poc', label: 'Reading PoC', order: 50,
        }, Reader));
      },
    };
  },
});
