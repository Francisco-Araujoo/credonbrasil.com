/*
  src/js/auth_manager.js
  Gerenciador de autenticação centralizado
*/
(function () {
  'use strict';

  const AuthManager = {
    
    // Verificar se o usuário parceiro está logado
    checkUserAuth() {
      const userData = localStorage.getItem('credon_user');
      if (!userData) {
        this.redirectToLogin('Sessão expirada. Faça login novamente.');
        return null;
      }

      try {
        return JSON.parse(userData);
      } catch (error) {
        console.error('Erro ao decodificar dados do usuário:', error);
        localStorage.removeItem('credon_user');
        this.redirectToLogin('Dados de sessão corrompidos. Faça login novamente.');
        return null;
      }
    },

    // Verificar se o admin está logado
    checkAdminAuth() {
      const adminData = localStorage.getItem('credon_admin');
      if (!adminData) {
        this.redirectToLogin('Acesso negado. Faça login como administrador.');
        return null;
      }

      try {
        return JSON.parse(adminData);
      } catch (error) {
        console.error('Erro ao decodificar dados do admin:', error);
        localStorage.removeItem('credon_admin');
        this.redirectToLogin('Dados de sessão corrompidos. Faça login novamente.');
        return null;
      }
    },

    // Logout do usuário parceiro
    logoutUser() {
      try {
        localStorage.removeItem('credon_user');
        window.location.href = '../index.html';
      } catch (error) {
        console.error('Erro durante logout:', error);
        window.location.href = '../index.html';
      }
    },

    // Logout do admin
    logoutAdmin() {
      try {
        localStorage.removeItem('credon_admin');
        window.location.href = '../index.html';
      } catch (error) {
        console.error('Erro durante logout do admin:', error);
        window.location.href = '../index.html';
      }
    },

    // Redirecionar para login
    redirectToLogin(message) {
      if (message) {
        alert(message);
      }
      window.location.href = '../index.html';
    },

    // Verificar qual tipo de usuário está logado
    getLoggedUserType() {
      const userData = localStorage.getItem('credon_user');
      const adminData = localStorage.getItem('credon_admin');
      
      if (adminData) return 'admin';
      if (userData) return 'user';
      return null;
    },

    // Verificar se está logado (qualquer tipo)
    isLoggedIn() {
      return this.getLoggedUserType() !== null;
    },

    // Alias para checkUserAuth() - para compatibilidade
    getUserData() {
      return this.checkUserAuth();
    }
  };

  // Expose to window
  window.AuthManager = AuthManager;

})();