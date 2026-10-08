import { esc } from '../format.js';
import { setTitle } from '../ui.js';

export function render(root, params = {}) {
  setTitle('Not found');
  const { kind, id } = params;
  let title = 'This page doesn’t exist';
  let body = `Nothing lives at <span class="mono">#${esc(params.path || '')}</span>. Check the link, or go back to a page you know.`;
  let back = ['#/products', 'View products'];
  if (kind === 'product') {
    title = 'We couldn’t find that SKU';
    body = `There’s no product <span class="mono">${esc(id)}</span>. SKUs look like <span class="mono">NET-RTR-0012</span>. Search the product list instead.`;
  } else if (kind === 'po') {
    title = 'We couldn’t find that purchase order';
    body = `There’s no purchase order <span class="mono">${esc(id)}</span>. It may have been created in another browser, or the demo data was reset.`;
    back = ['#/purchase-orders', 'View purchase orders'];
  }
  root.innerHTML = `<div class="nf">
    <div class="nf-code mono" aria-hidden="true">404</div>
    <h1>${title}</h1>
    <p>${body}</p>
    <div class="actions"><a class="btn btn-primary" href="#/overview">Go to overview</a><a class="btn" href="${back[0]}">${back[1]}</a></div></div>`;
  return {};
}
