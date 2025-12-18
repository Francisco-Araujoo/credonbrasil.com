/*
  src/js/login_admin.js
  Front-end helper para login de administradores
*/
(function () {
  'use strict';

  const API_BASE_URL = "https://5ljkqdjuuh.execute-api.us-east-1.amazonaws.com";

  function showMessage(form, text, color) {
    if (!form) return alert(text);
    let msg = form.querySelector('#loginAdminMessage');
    if (!msg) {
      msg = document.createElement('div');
      msg.id = 'loginAdminMessage';
      msg.style.marginTop = '10px';
      form.appendChild(msg);
    }
    msg.textContent = text;
    msg.style.color = color || 'black';
  }

  async function submitAdminLogin(email, senha) {
    const response = await fetch(`${API_BASE_URL}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha })
    });
    
    const data = await response.json();
    return { ok: response.ok, status: response.status, body: data };
  }

  function defaultOnSuccess(respBody) {
    // Armazenar dados do admin
    try {
      if (respBody && respBody.user) {
        localStorage.setItem('credon_admin', JSON.stringify(respBody.user));
      }
    } catch (e) { /* ignore storage errors */ }
    
    // Redirecionamento direto - sem animação
    setTimeout(() => {
      window.location.href = './pages/portal_admin.html';
    }, 800); // Reduzido para 0.8s - entrada rápida
  }



  async function handleAdminSubmit(e, options) {
    console.log('Login Admin - handleAdminSubmit chamado', e, options);
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('.btn-submit');
    const originalText = submitBtn?.textContent || 'Entrar Admin';
    
    const emailInput = form.querySelector('[name="email"]');
    const senhaInput = form.querySelector('[name="senha"]');
    
    const email = emailInput?.value?.trim() || '';
    const senha = senhaInput?.value?.trim() || '';
    
    if (!email || !senha) {
      showMessage(form, 'Informe e-mail e senha', 'red');
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

    try {
      const resp = await submitAdminLogin(email, senha);
      
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
            submitBtn.style.background = '#2563eb';
            submitBtn.style.borderColor = '#2563eb';
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
          submitBtn.style.background = '#2563eb';
          submitBtn.style.borderColor = '#2563eb';
          submitBtn.style.transform = 'scale(1)';
          submitBtn.style.boxShadow = '';
          submitBtn.textContent = originalText;
        }, 2000);
      }
      
      showMessage(form, 'Erro de conexão', 'red');
      if (options && typeof options.onError === 'function') options.onError(err);
    }
  }

  function initAdminLogin(opts) {
    const defaults = { formSelector: '#form-admin', onSuccess: null, onError: null };
    const options = Object.assign({}, defaults, opts || {});
    const form = document.querySelector(options.formSelector);
    if (!form) return null;
    
    form.addEventListener('submit', function (e) { handleAdminSubmit(e, options); });
    return { form, options };
  }

  // Auto-initialize se existir form de admin
  document.addEventListener('DOMContentLoaded', function () {
    console.log('Login Admin - DOM carregado');
    const formAdmin = document.querySelector('#form-admin');
    if (formAdmin) {
      console.log('Login Admin - Formulário encontrado, inicializando...');
      const result = initAdminLogin();
      if (result) {
        console.log('Login Admin - Inicializado com sucesso');
      } else {
        console.error('Login Admin - Falha na inicialização');
      }
    } else {
      console.warn('Login Admin - Formulário #form-admin não encontrado');
    }
  });

  // Expose to window
  window.AdminLogin = { initAdminLogin, submitAdminLogin };

})();