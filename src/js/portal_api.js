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

      // Carregar estatísticas das operações
      try {
        await listarOperacoes();
      } catch (operError) {
        console.warn('Erro ao carregar estatísticas das operações:', operError);
        // Inicializar com valores zerados se falhar
        updateDashboardStats([]);
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

  /**
   * Criar nova operação
   * @param {Object} operacaoData - Dados da operação
   * @returns {Promise<Object>} Resposta da API
   */
  async function criarOperacao(operacaoData) {
    try {
      const user = checkUserAuth();
      if (!user || !user.id) {
        throw new Error('Usuário não autenticado');
      }

      // Adiciona o ID do parceiro aos dados
      const dataWithParceiro = {
        ...operacaoData,
        parceiro_id: user.id
      };

      const response = await fetch(`${API_BASE_URL}/operacoes/criar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(dataWithParceiro)
      });

      // Tentar parsear a resposta; se falhar, gerar um objeto padrão
      let data;
      try {
        data = await response.json();
      } catch (e) {
        data = { message: 'Resposta inválida da API', raw: await response.text().catch(() => '') };
      }

      if (!response.ok) {
        // Log detalhado para depuração
        console.error('Falha ao criar operação', {
          status: response.status,
          statusText: response.statusText,
          body: data
        });

        const detailedMsgParts = [
          data.message || 'Erro ao criar operação',
          `HTTP ${response.status}`,
          data.details || data.error || (data.raw ? String(data.raw).slice(0, 300) : null)
        ].filter(Boolean);

        throw new Error(detailedMsgParts.join(' | '));
      }

      return data;
    } catch (error) {
      console.error('Erro ao criar operação:', error?.message || error);
      throw error;
    }
  }

  /**
   * Atualizar estatísticas do dashboard
   * @param {Array} operacoes - Array de operações do parceiro
   * @param {Object} estatisticas - Estatísticas calculadas pelo backend
   */
  function updateDashboardStats(operacoes = [], estatisticas = null) {
    let elementos;
    
    if (estatisticas) {
      // Usar estatísticas do backend se disponíveis
      const aprovadas = operacoes.filter(op => op.status_operacao === 'aprovada');
      const comissaoTotal = aprovadas.reduce((total, op) => {
        const valor = parseFloat(op.operacao_valor_pretendido || 0);
        return total + (valor * 0.02); // 2% de comissão
      }, 0);
      
      // Propostas enviadas este mês
      const agora = new Date();
      const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
      const enviadasEsteMes = operacoes.filter(op => {
        const dataOperacao = new Date(op.created_at);
        return dataOperacao >= inicioMes;
      }).length;
      
      elementos = {
        'propostasEnviadas': estatisticas.total || 0,
        'propostasAprovadas': estatisticas.aprovada || 0,
        'comissaoTotal': `R$ ${comissaoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        'enviadasEsteMes': enviadasEsteMes
      };
    } else {
      // Fallback - calcular manualmente
      const totalEnviadas = operacoes.length;
      
      const aprovadas = operacoes.filter(op => op.status_operacao === 'aprovada');
      const totalAprovadas = aprovadas.length;
      
      const comissaoTotal = aprovadas.reduce((total, op) => {
        const valor = parseFloat(op.operacao_valor_pretendido || 0);
        return total + (valor * 0.02);
      }, 0);
      
      const agora = new Date();
      const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
      const enviadasEsteMes = operacoes.filter(op => {
        const dataOperacao = new Date(op.created_at);
        return dataOperacao >= inicioMes;
      }).length;

      elementos = {
        'propostasEnviadas': totalEnviadas,
        'propostasAprovadas': totalAprovadas,
        'comissaoTotal': `R$ ${comissaoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
        'enviadasEsteMes': enviadasEsteMes
      };
    }

    // Atualizar elementos do dashboard
    Object.entries(elementos).forEach(([id, value]) => {
      const el = document.querySelector(`[data-stat="${id}"]`) || document.getElementById(id);
      if (el) {
        el.textContent = value;
      }
    });

    console.log('Dashboard atualizado:', elementos);
  }

  /**
   * Listar operações do parceiro
   * @returns {Promise<Object>} Lista de operações e estatísticas
   */
  async function listarOperacoes() {
    try {
      const user = checkUserAuth();
      if (!user || !user.id) {
        throw new Error('Usuário não autenticado');
      }

      const response = await fetch(`${API_BASE_URL}/operacoes/parceiro?parceiro_id=${user.id}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || `Erro ${response.status}`);
      }

      // Atualizar dashboard com dados das operações
      updateDashboardStats(data.operacoes || [], data.estatisticas);

      return data;
    } catch (error) {
      console.error('Erro ao listar operações:', error);
      throw error;
    }
  }

  /**
   * Buscar operação específica
   * @param {string} operacaoId - ID da operação
   * @returns {Promise<Object>} Dados da operação
   */
  async function buscarOperacao(operacaoId) {
    try {
      const user = checkUserAuth();
      if (!user || !user.id) {
        throw new Error('Usuário não autenticado');
      }

      const response = await fetch(`${API_BASE_URL}/operacoes/buscar?operacao_id=${operacaoId}&parceiro_id=${user.id}`, {
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
      console.error('Erro ao buscar operação:', error);
      throw error;
    }
  }

  /**
   * Atualizar operação
   * @param {string} operacaoId - ID da operação
   * @param {Object} updateData - Dados para atualizar
   * @returns {Promise<Object>} Resposta da API
   */
  async function atualizarOperacao(operacaoId, updateData) {
    try {
      const user = checkUserAuth();
      if (!user || !user.id) {
        throw new Error('Usuário não autenticado');
      }

      const dataWithIds = {
        ...updateData,
        operacao_id: operacaoId,
        parceiro_id: user.id
      };

      const response = await fetch(`${API_BASE_URL}/operacoes/atualizar`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(dataWithIds)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || `Erro ${response.status}`);
      }

      return data;
    } catch (error) {
      console.error('Erro ao atualizar operação:', error);
      throw error;
    }
  }

  /**
   * Formatar valor monetário
   * @param {number} value - Valor numérico
   * @returns {string} Valor formatado
   */
  function formatMoney(value) {
    if (!value || isNaN(value)) return 'R$ 0,00';
    
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  }

  /**
   * Obter rótulo do status
   * @param {string} status - Status da operação
   * @returns {string} Rótulo do status
   */
  function getStatusLabel(status) {
    const statusLabels = {
      'rascunho': 'Rascunho',
      'recebida': 'Recebida',
      'em_analise': 'Em Análise',
      'pendencia_docs': 'Pendência de Documentos',
      'aprovada': 'Aprovada',
      'recusada': 'Recusada',
      'cancelada': 'Cancelada'
    };
    
    return statusLabels[status] || status;
  }

  // Exposição das funções para o escopo global
  window.PortalAPI = {
    loadUserPortalData,
    fetchUserData,
    formatCpfMask,
    formatDate,
    logout,
    initPortal,
    // Novas funções para operações
    criarOperacao,
    listarOperacoes,
    buscarOperacao,
    atualizarOperacao,
    formatMoney,
    getStatusLabel,
    updateDashboardStats
  };

  // Auto-inicialização quando o DOM estiver pronto
  document.addEventListener('DOMContentLoaded', initPortal);

})();