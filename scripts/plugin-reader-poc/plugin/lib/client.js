// Deliberately small, read-only, text-only feasibility view. Not native Chat.
// Only documented services, a new conversation.view registration and owned DOM.
window.__ModuleLoader__.load({
  id: '@ryuu-64/dsh-reading-view-poc',
  factory(require) {
    const React = require('react');
    const { createElement: h, useState, useRef, useEffect, useLayoutEffect, useSyncExternalStore } = React;
    const EMPTY = { getSnapshot: () => undefined, subscribe: () => () => {} };
    return {
      inject: ['slots', 'sessions', 'uiConversation', 'uiWorkspace', 'layout', 'sessionToolsCards'],
      apply(ctx) {
        let nextInstance = 0;
        // One main-navigation return point per plugin/client root, not per Session.
        // A copied reader cannot overwrite it. All references/listeners die on unload.
        let returnPoint = null, stopNavigation = () => {}, returnTimer = null;
        const returnListeners = new Set();
        const publishReturn = () => { for (const listener of returnListeners) listener(); };
        const clearReturn = () => {
          stopNavigation(); stopNavigation = () => {};
          clearTimeout(returnTimer); returnTimer = null;
          const previous = returnPoint; returnPoint = null;
          previous?.reference.release(); publishReturn();
        };
        const returnSource = { getSnapshot: () => returnPoint, subscribe: listener => { returnListeners.add(listener); return () => returnListeners.delete(listener); } };
        function guardReturn() {
          const signal = ctx.layout.beginNavigation();
          const cancelled = () => clearReturn();
          signal.addEventListener('abort', cancelled, { once: true });
          stopNavigation = () => signal.removeEventListener('abort', cancelled);
        }
        function openCard(sourceId, mountId, position, targetId) {
          if (!position || sourceId === targetId) return;
          clearReturn();
          const reference = ctx.sessions.retain(sourceId, { source: 'readingViewReturn' });
          returnPoint = { sourceId, sourceMount: mountId, targetId, position, reference, phase: 'away',
            title: ctx.sessions.list.getSnapshot().byId[sourceId]?.displayTitle ?? sourceId };
          try { ctx.uiWorkspace.openSession(targetId); guardReturn(); publishReturn(); }
          catch (error) { clearReturn(); throw error; }
        }
        function goBack() {
          if (!returnPoint || returnPoint.phase === 'returning') return;
          stopNavigation(); stopNavigation = () => {};
          returnPoint = { ...returnPoint, phase: 'returning' }; publishReturn();
          try {
            ctx.uiWorkspace.openSession(returnPoint.sourceId); guardReturn();
            returnTimer = setTimeout(() => {
              if (returnPoint?.phase === 'returning') {
                returnPoint = { ...returnPoint, phase: 'error' }; publishReturn();
              }
            }, 15000);
          } catch (error) { clearReturn(); throw error; }
        }
        function ReturnAction({ sessionId }) {
          const point = useSyncExternalStore(returnSource.subscribe, returnSource.getSnapshot, returnSource.getSnapshot);
          if (!point || (point.targetId !== sessionId && point.sourceId !== sessionId)) return null;
          return h('span', { 'data-reader-return': point.phase },
            h('button', { type: 'button', disabled: point.phase === 'returning', onClick: goBack }, `返回 ${point.title} 的原位置`),
            point.phase === 'error' && h('span', { role: 'alert' }, '来源阅读模式未恢复。请选择 Reading PoC，或取消返回。'),
            h('button', { type: 'button', onClick: clearReturn }, '取消返回'));
        }
        ctx.effect(() => () => { clearReturn(); returnListeners.clear(); });
        ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
          name: 'conversation.session.header.actions', id: 'reading-view-return', order: -100,
        }, ReturnAction));
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
              const returning = !copy && returnPoint?.sourceId === id && ['returning', 'error'].includes(returnPoint.phase);
              const saved = returning ? returnPoint.position : records.current.get(id);
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
              if (!copy && returnPoint?.sourceId === id && ['returning', 'error'].includes(returnPoint.phase)) clearReturn();
            } else if (modeRef.current === 'following') element.scrollTop = element.scrollHeight;
          }, [snapshot, id, loaded]);
          const rows = [];
          for (const key of snapshot?.order ?? []) {
            const node = snapshot.nodes.get(key);
            if (!node || node.visibility === 'hidden') continue;
            // This is the real session-tools card component, supplied by its
            // owning plugin. The host's tool/image child slots are not redeclared.
            const tool = node.kind === 'tool-call' ? node.data.root : null;
            if (tool?.kind === 'tool-result' && tool.call?.name === 'session_create') {
              rows.push(h('div', { key, 'data-reader-tool': key, 'data-reader-anchor': key + ':card', style: { marginBottom: 14 } },
                ctx.sessionToolsCards.renderCreatedSession({ block: tool, openSession: targetId => {
                  if (copy) ctx.uiWorkspace.openSession(targetId);
                  else openCard(id, instance.current, capture(), targetId);
                } })));
            }
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
            h('div', null, 'Reading mode with session cards. Other tools, images and rich formatting are not rendered. The composer targets the outer session.'),
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
