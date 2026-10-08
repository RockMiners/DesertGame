import { App } from './app.js';

const app = new App();
window.app = app;
app.boot().then(() => { window.game = app.game; }).catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:20px;background:#fff;color:#900;padding:20px;z-index:99;white-space:pre-wrap">Failed to start: ${e.message}\n${e.stack}</pre>`);
});
