'use strict';
const root = document.documentElement;
document.querySelector('#theme').addEventListener('change', (event) => {
  if (event.target.value === 'auto') delete root.dataset.theme;
  else root.dataset.theme = event.target.value;
});
document.querySelector('#fallback').addEventListener('change', (event) => {
  root.dataset.fontMode = event.target.checked ? 'fallback' : 'token-stacks';
});
document.querySelector('#sample-action').addEventListener('click', () => {
  document.querySelector('#sample-status').textContent = 'Confirmed sample — no order was created.';
});
document.querySelector('#motion-toggle').addEventListener('click', (event) => {
  const paused = root.dataset.paused !== 'true';
  root.dataset.paused = String(paused);
  event.target.textContent = paused ? 'Resume decorative motion' : 'Pause decorative motion';
});
