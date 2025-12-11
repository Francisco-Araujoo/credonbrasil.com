/*
  src/js/login.js
  Front-end helper to submit a login form to the backend endpoint /parceiros/login

  Usage:
    - Set the API base URL on the page, e.g. in a script before this file loads:
        window.API_URL = 'https://SEU_API.execute-api.us-east-1.amazonaws.com';
      or
        window.LOGIN_API_URL = 'https://SEU_API.execute-api.us-east-1.amazonaws.com';

    - Give your login form `id="loginForm"` and inputs named `cpf`, `email`, and `senha` (senha = password).
      If your form uses different selectors, call `initLogin({ formSelector: '#meuForm' })`.

    - The script will store the returned user object (if login succeeds) in localStorage under `credon_user`.
*/
(function () {
  'use strict';

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }

  function showMessage(form, text, color) {
    if (!form) return alert(text);
    let msg = form.querySelector('#loginMessage');
    if (!msg) {
      msg = document.createElement('div');
      msg.id = 'loginMessage';
      msg.style.marginTop = '10px';
      form.appendChild(msg);
    }
    msg.textContent = text;
    msg.style.color = color || 'black';
  }

  function getFieldValue(form, names) {
    for (let name of names) {
      const el = form.querySelector(`[name="${name}"]`);
      if (el && el.value && el.value.trim() !== '') return el.value.trim();
    }
    return null;
  }

  async function submitLogin(apiBase, payload) {
    const urlBase = (apiBase || '').replace(/\/+$/, '');
    const endpoint = (urlBase ? urlBase : '') + '/parceiros/login';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'include'
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { message: text }; }
    return { ok: res.ok, status: res.status, body: json };
  }

  function defaultOnSuccess(respBody) {
    // store user
    try {
      if (respBody && respBody.user) {
        localStorage.setItem('credon_user', JSON.stringify(respBody.user));
      }
    } catch (e) { /* ignore storage errors */ }
    // by default redirect to index
    if (window.location.pathname.indexOf('index') === -1) {
      window.location.href = 'index.html';
    } else {
      showMessage(document.getElementById('loginForm'), 'Login feito com sucesso', 'green');
      setTimeout(() => location.reload(), 600);
    }
  }

  async function handleSubmit(e, options) {
    e.preventDefault();
    const form = e.target;
    const apiBase = options.apiBase || window.API_URL || window.LOGIN_API_URL || '';

    showMessage(form, 'Entrando...', 'gray');

    const senhaEl = form.querySelector('[name="senha"]') || form.querySelector('[name="password"]');
    const senha = senhaEl ? senhaEl.value.trim() : '';
    const cpf = getFieldValue(form, ['cpf', 'documento', 'login']);
    const email = getFieldValue(form, ['email', 'mail']);

    if ((!cpf && !email) || !senha) {
      showMessage(form, 'Informe CPF ou e-mail e a senha', 'red');
      return;
    }

    const payload = {};
    if (cpf) payload.cpf = cpf;
    if (email && !cpf) payload.email = email;
    payload.senha = senha;

    try {
      const resp = await submitLogin(apiBase, payload);
      if (resp.ok) {
        showMessage(form, resp.body.message || 'Sucesso', 'green');
        if (options && typeof options.onSuccess === 'function') {
          options.onSuccess(resp.body);
        } else {
          defaultOnSuccess(resp.body);
        }
      } else {
        const errMsg = (resp.body && resp.body.message) ? resp.body.message : `Erro ${resp.status}`;
        showMessage(form, errMsg, 'red');
        if (options && typeof options.onError === 'function') options.onError(resp);
      }
    } catch (err) {
      showMessage(form, 'Erro de conexão', 'red');
      if (options && typeof options.onError === 'function') options.onError(err);
    }
  }

  function initLogin(opts) {
    const defaults = { formSelector: '#loginForm', apiBase: null, onSuccess: null, onError: null };
    const options = Object.assign({}, defaults, opts || {});
    const form = document.querySelector(options.formSelector);
    if (!form) return null;
    // attach handler
    form.addEventListener('submit', function (e) { handleSubmit(e, options); });
    return { form, options };
  }

  // Auto-initialize if a form with id=loginForm exists
  document.addEventListener('DOMContentLoaded', function () {
    initLogin();
  });

  // Expose to window
  window.CredOnLogin = { initLogin, submitLogin };

})();
