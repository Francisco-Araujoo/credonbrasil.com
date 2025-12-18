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
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch (e) { json = { message: text }; }
    return { ok: res.ok, status: res.status, body: json };
  }

  function defaultOnSuccess(respBody) {
    // Armazenar dados do usuário
    try {
      if (respBody && respBody.user) {
        localStorage.setItem('credon_user', JSON.stringify(respBody.user));
      }
    } catch (e) { /* ignore storage errors */ }
    
    // Redirecionamento direto - sem animação
    setTimeout(() => {
      window.location.href = './pages/portal_parceiro.html';
    }, 800); // Reduzido para 0.8s - entrada rápida
  }



  async function handleSubmit(e, options) {
    console.log('Login Parceiros - handleSubmit chamado', e, options);
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('.btn-submit');
    const originalText = submitBtn?.textContent || 'Acessar Portal';
    const apiBase = options.apiBase || window.API_URL || window.LOGIN_API_URL || '';
    
    console.log('Login Parceiros - API Base URL:', apiBase);

    const senhaEl = form.querySelector('[name="senha"]') || form.querySelector('[name="password"]');
    const senha = senhaEl ? senhaEl.value.trim() : '';
    
    // Buscar o campo CPF/Email (pode conter qualquer um dos dois)
    const cpfEmailEl = form.querySelector('[name="cpf"]') || form.querySelector('[name="email"]');
    const cpfEmailValue = cpfEmailEl ? cpfEmailEl.value.trim() : '';
    
    if (!cpfEmailValue || !senha) {
      showMessage(form, 'Informe CPF ou e-mail e a senha', 'red');
      return;
    }

    // Animação de loading no botão
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.background = '#6b7280';
      submitBtn.style.borderColor = '#6b7280';
      submitBtn.style.transform = 'scale(0.95)';
      submitBtn.textContent = 'Entrando...';
    }

    const payload = { senha };
    // Detectar se é email ou CPF automaticamente
    if (cpfEmailValue.includes('@')) {
      payload.email = cpfEmailValue;
    } else {
      payload.cpf = cpfEmailValue;
    }

    try {
      const resp = await submitLogin(apiBase, payload);
      if (resp.ok) {
        // Animação de sucesso
        if (submitBtn) {
          submitBtn.style.background = '#10b981';
          submitBtn.style.borderColor = '#10b981';
          submitBtn.style.transform = 'scale(1.02)';
          submitBtn.textContent = 'Sucesso!';
          
          // Efeito de brilho
          submitBtn.style.boxShadow = '0 0 20px rgba(16, 185, 129, 0.6)';
        }
        
        showMessage(form, resp.body.message || 'Login realizado com sucesso!', '#10b981');
        
        if (options && typeof options.onSuccess === 'function') {
          options.onSuccess(resp.body);
        } else {
          defaultOnSuccess(resp.body);
        }
      } else {
        // Animação de erro
        if (submitBtn) {
          submitBtn.style.background = '#ef4444';
          submitBtn.style.borderColor = '#ef4444';
          submitBtn.style.transform = 'scale(0.98)';
          submitBtn.textContent = 'Erro!';
          
          // Voltar ao estado original após 2s
          setTimeout(() => {
            submitBtn.disabled = false;
            submitBtn.style.background = '';
            submitBtn.style.borderColor = '';
            submitBtn.style.transform = 'scale(1)';
            submitBtn.style.boxShadow = '';
            submitBtn.textContent = originalText;
          }, 2000);
        }
        
        const errMsg = (resp.body && resp.body.message) ? resp.body.message : `Erro ${resp.status}`;
        showMessage(form, errMsg, 'red');
        if (options && typeof options.onError === 'function') options.onError(resp);
      }
    } catch (err) {
      // Animação de erro de conexão
      if (submitBtn) {
        submitBtn.style.background = '#ef4444';
        submitBtn.style.borderColor = '#ef4444';
        submitBtn.style.transform = 'scale(0.98)';
        submitBtn.textContent = 'Sem conexão!';
        
        setTimeout(() => {
          submitBtn.disabled = false;
          submitBtn.style.background = '';
          submitBtn.style.borderColor = '';
          submitBtn.style.transform = 'scale(1)';
          submitBtn.style.boxShadow = '';
          submitBtn.textContent = originalText;
        }, 2000);
      }
      
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
    console.log('Login Parceiros - DOM carregado');
    const formClient = document.querySelector('#form-client');
    if (formClient) {
      console.log('Login Parceiros - Formulário encontrado, inicializando...');
      const result = initLogin({ formSelector: '#form-client' });
      if (result) {
        console.log('Login Parceiros - Inicializado com sucesso');
      } else {
        console.error('Login Parceiros - Falha na inicialização');
      }
    } else {
      console.warn('Login Parceiros - Formulário #form-client não encontrado');
    }
  });

  // Expose to window
  window.CredOnLogin = { initLogin, submitLogin };

})();
