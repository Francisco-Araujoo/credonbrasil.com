/*
  src/js/login_supervisor.js
  Front-end helper para login de supervisores
*/
(function () {
  'use strict';

  const API_BASE_URL = "https://5ljkqdjuuh.execute-api.us-east-1.amazonaws.com";

  function showMessage(form, text, color) {
    if (!form) return alert(text);
    let msg = form.querySelector('#loginSupervisorMessage');
    if (!msg) {
      msg = document.createElement('div');
      msg.id = 'loginSupervisorMessage';
      msg.style.marginTop = '10px';
      form.appendChild(msg);
    }
    msg.textContent = text;
    msg.style.color = color || 'black';
  }

  async function submitSupervisorLogin(email, senha) {
    const response = await fetch(`${API_BASE_URL}/supervisor/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, senha })
    });
    
    const data = await response.json();
    return { ok: response.ok, status: response.status, body: data };
  }

  function defaultOnSuccess(respBody) {
    // Armazenar dados do supervisor
    try {
      if (respBody && respBody.user) {
        localStorage.setItem('credon_supervisor', JSON.stringify(respBody.user));
      }
    } catch (e) { /* ignore storage errors */ }
    
    // Redirecionamento direto
    setTimeout(() => {
      window.location.href = './pages/portal_supervisor.html';
    }, 800);
  }

  async function handleSupervisorSubmit(e, options) {
    console.log('Login Supervisor - handleSupervisorSubmit chamado', e, options);
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('.btn-submit');
    const originalText = submitBtn?.textContent || 'Entrar Supervisor';
    
    const emailInput = form.querySelector('[name="email"]');
    const senhaInput = form.querySelector('[name="senha"]');
    
    const email = emailInput?.value?.trim() || '';
    const senha = senhaInput?.value || '';

    if (!email || !senha) {
      showMessage(form, 'Por favor, preencha todos os campos.', 'red');
      return;
    }

    // Validação básica de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showMessage(form, 'Por favor, insira um email válido.', 'red');
      return;
    }

    // Callback customizado passado via options
    const onSuccess = (options && options.onSuccess) || defaultOnSuccess;
    const onError = (options && options.onError) || null;

    if (submitBtn) {
      submitBtn.textContent = 'Entrando...';
      submitBtn.disabled = true;
    }

    try {
      const result = await submitSupervisorLogin(email, senha);
      
      if (result.ok) {
        showMessage(form, result.body.message || 'Login efetuado com sucesso!', 'green');
        if (typeof onSuccess === 'function') onSuccess(result.body);
      } else {
        const errorMsg = result.body?.message || 'Erro no login.';
        showMessage(form, errorMsg, 'red');
        if (typeof onError === 'function') onError(result);
      }
    } catch (err) {
      console.error('Erro ao fazer login:', err);
      showMessage(form, 'Erro de conexão. Tente novamente.', 'red');
      if (typeof onError === 'function') onError(err);
    } finally {
      if (submitBtn) {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      }
    }
  }

  /**
   * Inicializa o login do supervisor no formulário identificado por "formSelector" (ex: "#loginSupervisorForm").
   * Opções:
   *   - onSuccess: função que recebe o responseBody em caso de sucesso
   *   - onError: função que recebe o erro em caso de falha
   * 
   * Se não passar onSuccess, redireciona para o portal_supervisor.
   */
  function initSupervisorLoginForm(formSelector, options) {
    console.log('Inicializando formulário de login do supervisor:', formSelector);
    
    const form = document.querySelector(formSelector);
    if (!form) {
      console.warn(`Formulário "${formSelector}" não encontrado no DOM.`);
      return;
    }
    
    form.addEventListener('submit', (e) => handleSupervisorSubmit(e, options));
    console.log('Evento de submit adicionado ao formulário:', formSelector);
  }

  // Expor funções globalmente
  window.LoginSupervisorModule = {
    initSupervisorLoginForm,
    handleSupervisorSubmit,
    submitSupervisorLogin,
    showMessage
  };

  // Auto-inicializar quando o DOM estiver pronto
  document.addEventListener('DOMContentLoaded', function () {
    console.log('Login Supervisor - DOM carregado');
    const formSupervisor = document.querySelector('#form-supervisor');
    if (formSupervisor) {
      console.log('Login Supervisor - Formulário encontrado, inicializando...');
      initSupervisorLoginForm('#form-supervisor');
      console.log('Login Supervisor - Inicializado com sucesso');
    } else {
      console.warn('Login Supervisor - Formulário #form-supervisor não encontrado');
    }
  });

  console.log('Login Supervisor Module carregado com sucesso!');
})();
