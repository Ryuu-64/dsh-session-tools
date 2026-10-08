// Deliberately small, read-only, text-only feasibility view. Not native Chat.
// Only documented services, a new conversation.view registration and owned DOM.
window.__ModuleLoader__.load({
  id: '@ryuu-64/dsh-reading-view-poc',
  factory(require) {
    const React = require('react');
    const { MarkdownText } = require('@deepseek-ai/dsh-client-ui-primitives');
    const markdownLabels = { code: { copyLabel: 'Copy code', copiedLabel: 'Copied' }, footnotes: 'Footnotes' };
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
          const flow = useRef(null);
          const heldAnchor = useRef(null);
          const holdSuspended = useRef(false);
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
              holdSuspended.current = false;
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
          // Positions are owned by this reader, not by Markdown's React tree.
          // A text quote plus its occurrence survives formatting changes before
          // it (for example, reference links resolving on stream settlement).
          function textParts(row) {
            const walker = row.ownerDocument.createTreeWalker(row, 4);
            const parts = []; let text = '', node;
            while ((node = walker.nextNode())) {
              if (!node.textContent || node.parentElement?.closest('button, [aria-hidden="true"], script, style')) continue;
              parts.push({ node, start: text.length }); text += node.textContent;
            }
            return { text, parts };
          }
          function rectAt(node, index) {
            const range = node.ownerDocument.createRange();
            range.setStart(node, index); range.setEnd(node, Math.min(index + 1, node.length));
            return range.getBoundingClientRect();
          }
          function capture() {
            const element = scroller.current;
            if (!element) return null;
            const top = element.getBoundingClientRect().top + element.clientTop;
            for (const row of element.querySelectorAll('[data-reader-anchor]')) {
              if (row.getBoundingClientRect().bottom <= top) continue;
              const { text, parts } = textParts(row);
              for (const part of parts) {
                const range = row.ownerDocument.createRange(); range.selectNodeContents(part.node);
                const bounds = range.getBoundingClientRect();
                if (!bounds.width || !bounds.height || bounds.bottom <= top) continue;
                let low = 0, high = part.node.length - 1;
                while (low < high) {
                  const mid = Math.floor((low + high) / 2);
                  if (rectAt(part.node, mid).bottom > top) high = mid; else low = mid + 1;
                }
                const index = part.start + low, quote = text.slice(index, index + 48);
                if (!quote) continue;
                let occurrence = 0, found = text.indexOf(quote);
                while (found !== -1 && found < index) { occurrence++; found = text.indexOf(quote, found + 1); }
                return { key: row.dataset.readerAnchor, quote, occurrence, offset: rectAt(part.node, low).top - top };
              }
            }
            return null;
          }
          function restoreOwnedAnchor(saved) {
            const element = scroller.current;
            if (!element) return false;
            const row = [...element.querySelectorAll('[data-reader-anchor]')].find(item => item.dataset.readerAnchor === saved.key);
            if (!row) return false;
            const { text, parts } = textParts(row);
            let index = text.indexOf(saved.quote);
            for (let count = 0; count < saved.occurrence && index !== -1; count++) index = text.indexOf(saved.quote, index + 1);
            if (index === -1) return false;
            const part = parts.find(item => index >= item.start && index < item.start + item.node.length);
            if (!part) return false;
            const delta = rectAt(part.node, index - part.start).top - element.getBoundingClientRect().top - element.clientTop - saved.offset;
            if (Math.abs(delta) > 0.5) element.scrollTop += delta;
            return true;
          }
          // Only our own transcript is observed. This preserves a held text
          // position through Markdown reflow; it does not fight a host scroller.
          useLayoutEffect(() => {
            if (!flow.current) return;
            const observer = new ResizeObserver(() => {
              if (modeRef.current === 'following') {
                if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
              } else if (heldAnchor.current && !restoreOwnedAnchor(heldAnchor.current)) {
                holdSuspended.current = true; heldAnchor.current = null; setError('The held text changed; automatic position correction has stopped.');
              }
            });
            observer.observe(flow.current);
            return () => observer.disconnect();
          }, [id]);
          function navigate(next) {
            if (next === id) return;
            const record = capture();
            if (record) records.current.set(id, record);
            // A departure ALWAYS saves content position, even if A was following.
            // Being at the old tail is never interpreted as permission to follow on return.
            heldAnchor.current = null;
            setId(next);
          }
          useLayoutEffect(() => {
            const element = scroller.current;
            if (!element || loaded?.id !== id || !snapshot) return;
            const saved = pendingRestore.current;
            if (saved) {
              if (!restoreOwnedAnchor(saved)) { holdSuspended.current = true; setError('Saved text is outside loaded history or has changed; exact return is unavailable.'); return; }
              heldAnchor.current = saved;
              pendingRestore.current = null;
              if (!copy && returnPoint?.sourceId === id && ['returning', 'error'].includes(returnPoint.phase)) clearReturn();
            } else if (modeRef.current === 'following') element.scrollTop = element.scrollHeight;
            else if (heldAnchor.current && !restoreOwnedAnchor(heldAnchor.current)) {
              holdSuspended.current = true; heldAnchor.current = null; setError('The held text changed; automatic position correction has stopped.');
            }
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
            parts.forEach((text, block) => {
              if (node.kind === 'assistant-step') {
                const anchor = `${key}:${block}:markdown`;
                rows.push(h('div', { key: anchor, 'data-reader-anchor': anchor, 'data-reader-node': key,
                  'data-reader-markdown': '', style: { marginBottom: 14, overflowWrap: 'anywhere', minWidth: 0 } },
                  h(MarkdownText, { text, streaming: node.data.status === 'running', labels: markdownLabels })));
              } else text.split(/\n\n/).forEach((paragraph, part) => {
                if (!paragraph) return;
                const anchor = `${key}:${block}:${part}`;
                rows.push(h('p', { key: anchor, 'data-reader-anchor': anchor, 'data-reader-node': key,
                  style: { margin: '0 0 14px', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, paragraph));
              });
            });
          }
          const button = (label, onClick, extra = {}) => h('button', { type: 'button', onClick, ...extra }, label);
          return h('section', { 'data-reader-instance': instance.current, 'data-reader-session': id, 'data-reader-mode': mode,
            style: { width: '100%', maxWidth: 720, minWidth: 0, marginInline: 'auto', boxSizing: 'border-box', padding: 12, border: '1px solid #999', background: '#fff', color: '#17202a' } },
            h('strong', null, `Reading PoC ${copy ? 'independent copy' : ''}: ${catalog.byId[id]?.displayTitle ?? id}`),
            h('div', null, 'Reading mode with session cards. Assistant Markdown is rendered. Other tools and attachment galleries remain in native Chat. The composer targets the outer session.'),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0' } },
              h('select', { 'aria-label': `Reading session ${copy}`, value: id, onChange: e => navigate(e.target.value) },
                catalog.ids.map(value => h('option', { key: value, value }, catalog.byId[value]?.displayTitle ?? value))),
              button('Return to source', () => navigate(initialId), { disabled: id === initialId }),
              button('Go to latest', () => { records.current.delete(id); pendingRestore.current = null; holdSuspended.current = false; heldAnchor.current = null; setError(''); modeRef.current = 'following'; setMode('following'); if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }),
              !copy && button(second ? 'Close independent reader' : 'Open independent reader', () => setSecond(!second))),
            error && h('div', { role: 'alert' }, error),
            h('div', { ref: scroller, 'data-reader-scroll': '', tabIndex: 0,
              // User scrolling exits follow. Only Go to latest enables it again.
              onScroll: () => { if (modeRef.current === 'holding' && !pendingRestore.current && !holdSuspended.current) heldAnchor.current = capture(); },
              onWheel: () => { holdSuspended.current = false; heldAnchor.current = null; setError(''); modeRef.current = 'holding'; setMode('holding'); },
              onKeyDown: e => { if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) { holdSuspended.current = false; heldAnchor.current = null; setError(''); modeRef.current = 'holding'; setMode('holding'); } },
              style: { height: copy ? 240 : 420, overflowY: 'auto', overflowAnchor: 'none', border: '1px solid #ccd', padding: 12, boxSizing: 'border-box' } }, h('div', { ref: flow }, rows)),
            second && h(Reader, { key: 'independent', sessionId: initialId, copy: 1 }));
        }
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view', id: 'reading-view-poc', label: 'Reading PoC', order: 50,
        }, Reader));
      },
    };
  },
});
