// Pointer sorting keeps file drops available and lets the other icons make room immediately.
export function sortable(root, selector, key, save, refresh) {
  let gesture, blockedUntil = 0;
  const nodes = () => [...root.querySelectorAll(selector)];
  const order = () => nodes().map(node => node.dataset[key]);
  window.addEventListener('pointerdown', () => { blockedUntil = 0; }, true);
  function finish(cancel = false) {
    if (!gesture) return;
    const g = gesture; gesture = null;
    if (root.hasPointerCapture(g.pointerId)) root.releasePointerCapture(g.pointerId);
    cancelAnimationFrame(g.frame);
    g.ghost?.remove(); g.node.classList.remove('sort-placeholder');
    document.body.classList.remove('sorting-icons');
    if (!g.started) return;
    blockedUntil = performance.now() + 350;
    const ids = order();
    if (cancel) {
      const anchor = nodes().at(-1)?.nextSibling;
      for (const id of g.ids) g.parent.insertBefore(nodes().find(n => n.dataset[key] === id), anchor);
      refresh(); return;
    }
    if (ids.join() === g.ids.join()) { refresh(); return; }
    Promise.resolve(save({ ids: g.ids, id: g.node.dataset[key], beforeId: ids[ids.indexOf(g.node.dataset[key]) + 1] || null })).finally(refresh);
  }
  function move() {
    const g = gesture; if (!g?.started) return;
    g.ghost.style.left = `${g.x - g.offsetX}px`; g.ghost.style.top = `${g.y - g.offsetY}px`;
    const bounds = root.getBoundingClientRect();
    if (g.y >= bounds.top && g.y <= bounds.bottom && g.x >= bounds.left && g.x <= bounds.right) {
      const scroller = g.parent;
      if (scroller.scrollHeight > scroller.clientHeight) scroller.scrollTop += g.y > bounds.bottom - 32 ? 9 : g.y < bounds.top + 32 ? -9 : 0;
      if (scroller.scrollWidth > scroller.clientWidth) scroller.scrollLeft += g.x > bounds.right - 28 ? 9 : g.x < bounds.left + 28 ? -9 : 0;
      // Fixed slot centers prevent animated neighbours from repeatedly swapping back under the cursor.
      const distances = g.slots.map(r => (g.x - r.x + scroller.scrollLeft - g.scrollX) ** 2 + (g.y - r.y + scroller.scrollTop - g.scrollY) ** 2);
      const targetIndex = distances.indexOf(Math.min(...distances)), items = nodes();
      if (items.indexOf(g.node) !== targetIndex) {
        items.forEach(n => n.getAnimations().forEach(a => a.cancel()));
        const rects = new Map(items.map(n => [n, n.getBoundingClientRect()]));
        const others = items.filter(n => n !== g.node);
        g.parent.insertBefore(g.node, others[targetIndex] || g.after);
        for (const [node, rect] of rects) {
          const next = node.getBoundingClientRect();
          if (node !== g.node) node.animate([{ transform: `translate(${rect.left - next.left}px,${rect.top - next.top}px)` }, { transform: 'none' }], { duration: 150, easing: 'ease-out' });
        }
      }
    }
    g.frame = requestAnimationFrame(move);
  }
  root.addEventListener('pointerdown', event => {
    if (event.button !== 0 || gesture || event.target.closest('.app-card-actions')) return;
    const node = event.target.closest(selector); if (!node || !root.contains(node)) return;
    blockedUntil = 0;
    const rect = node.getBoundingClientRect();
    gesture = { node, parent: node.parentElement, pointerId:event.pointerId, ids: order(), after:nodes().at(-1).nextSibling,
      slots:nodes().map(n=>{ const r=n.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; }), scrollX:node.parentElement.scrollLeft, scrollY:node.parentElement.scrollTop,
      x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
  });
  window.addEventListener('pointermove', event => {
    const g = gesture; if (!g) return;
    g.x = event.clientX; g.y = event.clientY;
    if (!g.started && Math.hypot(g.x - g.startX, g.y - g.startY) >= 6) {
      g.started = true;
      root.setPointerCapture(event.pointerId);
      const rect = g.node.getBoundingClientRect(); g.ghost = g.node.cloneNode(true);
      g.ghost.classList.add('sort-ghost'); Object.assign(g.ghost.style, { width: `${rect.width}px`, height: `${rect.height}px` });
      if (g.node.matches('[data-app]')) g.ghost.lastElementChild.style.display = getComputedStyle(g.node.lastElementChild).display;
      document.body.append(g.ghost); g.node.classList.add('sort-placeholder'); document.body.classList.add('sorting-icons');
      move();
    }
    if (g.started) event.preventDefault();
  }, { passive: false });
  window.addEventListener('pointerup', () => finish());
  window.addEventListener('pointercancel', () => finish(true));
  window.addEventListener('blur', () => finish(true));
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && gesture?.started) { event.preventDefault(); event.stopImmediatePropagation(); finish(true); } }, true);
  root.addEventListener('click', event => { if (performance.now() < blockedUntil) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  root.addEventListener('dragstart', event => { if (event.target.closest(selector)) event.preventDefault(); });
  return { get active() { return Boolean(gesture); } };
}
