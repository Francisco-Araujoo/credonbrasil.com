/*
  src/js/portal_api.js
  API helper para o portal do parceiro
  Conecta com o backend para buscar dados atualizados do usuário
*/
(function () {
  'use strict';

  // URL base da API - mesma do login
  const API_BASE_URL = "https://5ljkqdjuuh.execute-api.us-east-1.amazonaws.com";

  /**
   * Verificar autenticação do usuário
   * @returns {Object|null} Dados do usuário ou null se não autenticado
   */
  function checkUserAuth() {
    return window.AuthManager ? window.AuthManager.checkUserAuth() : null;
  }

  /**
   * Busca dados atualizados do usuário
   * @param {string} userId - ID do usuário
   * @returns {Promise<Object>} Dados do usuário
   */
  async function fetchUserData(userId) {
    try {
      const response = await fetch(`${API_BASE_URL}/parceiros/me?userId=${userId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || `Erro ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error('Erro ao buscar dados do usuário:', error);
      throw error;
    }
  }

  /**
   * Formata CPF com máscara de segurança
   * @param {string} cpf - CPF completo
   * @returns {string} CPF mascarado
   */
  function formatCpfMask(cpf) {
    if (!cpf) return 'Não informado';
    
    // Remove caracteres não numéricos
    const cleanCpf = cpf.replace(/\D/g, '');
    
    if (cleanCpf.length === 11) {
      // Formata: 123.***.**-45
      return `${cleanCpf.substring(0, 3)}.***.**-${cleanCpf.substring(9, 11)}`;
    }
    
    return cpf; // Retorna original se não for válido
  }

  /**
   * Formata data para exibição
   * @param {string} dateString - Data em string
   * @returns {string} Data formatada
   */
  function formatDate(dateString) {
    if (!dateString) return 'Não informado';
    
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch (error) {
      return 'Data inválida';
    }
  }

  /**
   * Carrega e exibe dados do usuário no portal
   */
  async function loadUserPortalData() {
    try {
      // Busca dados do localStorage primeiro
      const localUser = localStorage.getItem('credon_user');
      
      if (!localUser) {
        throw new Error('Usuário não encontrado no localStorage');
      }

      const userData = JSON.parse(localUser);
      
      if (!userData.id) {
        throw new Error('ID do usuário não encontrado');
      }

      // Exibe dados iniciais (do localStorage)
      displayUserData(userData);
      showLoading(false);

      // Busca dados atualizados do servidor
      try {
        const response = await fetchUserData(userData.id);
        
        if (response.user) {
          // Atualiza localStorage com dados atualizados
          localStorage.setItem('credon_user', JSON.stringify(response.user));
          
          // Exibe dados atualizados
          displayUserData(response.user);
          
          console.log('Dados do usuário atualizados com sucesso');
        }
      } catch (apiError) {
        console.warn('Erro ao buscar dados atualizados, usando dados locais:', apiError);
        // Continua usando dados do localStorage se a API falhar
      }

    } catch (error) {
      console.error('Erro ao carregar dados do usuário:', error);
      showError('Erro ao carregar dados do usuário');
    }
  }

  /**
   * Exibe dados do usuário na interface
   * @param {Object} user - Dados do usuário
   */
  function displayUserData(user) {
    // Nome no header
    const userNameEl = document.getElementById('userName');
    if (userNameEl && user.nome) {
      userNameEl.textContent = user.nome.split(' ')[0];
    }

    // Nome completo
    const fullNameEl = document.getElementById('userFullName');
    if (fullNameEl) {
      fullNameEl.textContent = user.nome || 'Não informado';
    }

    // CPF mascarado
    const cpfEl = document.getElementById('userCpf');
    if (cpfEl) {
      cpfEl.textContent = formatCpfMask(user.cpf);
    }

    // Email
    const emailEl = document.getElementById('userEmail');
    if (emailEl) {
      emailEl.textContent = user.email || 'Não informado';
    }

    // Data de cadastro
    const createdAtEl = document.getElementById('userCreatedAt');
    if (createdAtEl) {
      createdAtEl.textContent = formatDate(user.created_at);
    }
  }

  /**
   * Mostra/esconde indicador de carregamento
   * @param {boolean} show - Mostrar ou esconder
   */
  function showLoading(show = true) {
    const elements = [
      'userName', 'userFullName', 'userCpf', 'userEmail', 'userCreatedAt'
    ];

    elements.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = show ? 'Carregando...' : el.textContent;
      }
    });
  }

  /**
   * Exibe mensagem de erro
   * @param {string} message - Mensagem de erro
   */
  function showError(message) {
    const elements = [
      'userName', 'userFullName', 'userCpf', 'userEmail', 'userCreatedAt'
    ];

    elements.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = 'Erro ao carregar';
        el.style.color = '#ef4444';
      }
    });

    console.error(message);
  }

  /**
   * Função de logout
   */
  function logout() {
    if (window.AuthManager) {
      window.AuthManager.logoutUser();
    } else {
      // Fallback se AuthManager não estiver disponível
      try {
        localStorage.removeItem('credon_user');
        window.location.href = '../index.html';
      } catch (error) {
        console.error('Erro durante logout:', error);
        window.location.href = '../index.html';
      }
    }
  }

  /**
   * Inicializa o portal
   */
  function initPortal() {
    // Verifica autenticação
    const user = checkUserAuth();
    if (!user) return; // Já foi redirecionado

    console.log('Portal do Parceiro inicializando para usuário:', user.nome);

    // Carrega dados do usuário
    loadUserPortalData();
  }

  // Exposição das funções para o escopo global
  window.PortalAPI = {
    loadUserPortalData,
    fetchUserData,
    formatCpfMask,
    formatDate,
    logout,
    initPortal
  };

  // Auto-inicialização quando o DOM estiver pronto
  document.addEventListener('DOMContentLoaded', initPortal);

})();