// API para gerenciar operações do admin
class AdminAPI {
    static API_BASE_URL = "https://5ljkqdjuuh.execute-api.us-east-1.amazonaws.com";
    static currentAdmin = null;
    static parceiros = [];
    static currentParceiro = null;

    // Verificar se o admin está logado
    static checkAuth() {
        const adminData = localStorage.getItem('credon_admin');
        if (!adminData) {
            this.redirectToLogin();
            return false;
        }

        try {
            this.currentAdmin = JSON.parse(adminData);
            this.loadAdminData();
            this.loadParceiros();
            return true;
        } catch (error) {
            console.error('Erro ao verificar autenticação do admin:', error);
            this.redirectToLogin();
            return false;
        }
    }

    // Carregar dados do admin na interface
    static loadAdminData() {
        if (!this.currentAdmin) return;

        const adminNameEl = document.getElementById('adminName');
        if (adminNameEl) {
            adminNameEl.textContent = this.currentAdmin.nome || 'Admin';
        }
    }

    // Logout do admin
    static logout() {
        localStorage.removeItem('credon_admin');
        window.location.href = '../index.html';
    }

    // Redirecionar para login
    static redirectToLogin() {
        alert('Acesso negado. Faça login como administrador.');
        window.location.href = '../index.html';
    }

    // Carregar lista de parceiros
    static async loadParceiros() {
        if (!this.currentAdmin) {
            this.redirectToLogin();
            return;
        }

        try {
            const response = await fetch(`${this.API_BASE_URL}/admin/parceiros?adminId=${this.currentAdmin.id}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            this.parceiros = data.parceiros || [];
            
            // Atualizar estatísticas
            this.updateStats(data.total || 0, this.parceiros);
            
            // Renderizar lista de parceiros
            this.renderParceiros();

        } catch (error) {
            console.error('Erro ao carregar parceiros:', error);
            this.showError('Erro ao carregar dados dos parceiros');
        }
    }

    // Atualizar estatísticas no dashboard
    static updateStats(total, parceiros) {
        const totalEl = document.getElementById('totalParceiros');
        const novosEl = document.getElementById('novosEesteMes');

        if (totalEl) {
            totalEl.textContent = total.toString();
        }

        // Calcular quantos se cadastraram este mês
        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();
        
        const novosEsteMes = parceiros.filter(p => {
            if (!p.created_at) return false;
            const created = new Date(p.created_at);
            return created.getMonth() === currentMonth && created.getFullYear() === currentYear;
        }).length;

        if (novosEl) {
            novosEl.textContent = novosEsteMes.toString();
        }
    }

    // Renderizar lista de parceiros
    static renderParceiros() {
        const listContainer = document.getElementById('parceirosList');
        if (!listContainer) return;

        if (this.parceiros.length === 0) {
            listContainer.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
                    <i class="fas fa-users" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;"></i>
                    <p>Nenhum parceiro cadastrado ainda</p>
                </div>
            `;
            return;
        }

        const parceirosHTML = this.parceiros.map(parceiro => {
            const dataFormatada = this.formatDate(parceiro.created_at);
            
            return `
                <div class="parceiro-card" onclick="AdminAPI.viewParceiro(${parceiro.id})">
                    <div class="parceiro-info">
                        <div class="parceiro-name">${this.sanitizeHTML(parceiro.nome)}</div>
                        <div class="parceiro-email">${this.sanitizeHTML(parceiro.email)}</div>
                        <div class="parceiro-date">Cadastrado em: ${dataFormatada}</div>
                    </div>
                    <div class="parceiro-actions" onclick="event.stopPropagation()">
                        <button class="action-btn-small" onclick="AdminAPI.viewParceiro(${parceiro.id})" title="Ver detalhes">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="action-btn-small" onclick="AdminAPI.editPassword(${parceiro.id})" title="Alterar senha">
                            <i class="fas fa-key"></i>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        listContainer.innerHTML = parceirosHTML;
    }

    // Visualizar detalhes de um parceiro
    static async viewParceiro(parceiroId) {
        if (!this.currentAdmin) {
            this.redirectToLogin();
            return;
        }

        try {
            const response = await fetch(`${this.API_BASE_URL}/admin/parceiros/view?adminId=${this.currentAdmin.id}&parceiroId=${parceiroId}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            this.currentParceiro = data.parceiro;
            this.showParceiroModal();

        } catch (error) {
            console.error('Erro ao carregar dados do parceiro:', error);
            this.showError('Erro ao carregar dados do parceiro');
        }
    }

    // Mostrar modal com dados do parceiro
    static showParceiroModal() {
        if (!this.currentParceiro) return;

        const modal = document.getElementById('parceiroModal');
        const nomeInput = document.getElementById('parceiroNome');
        const emailInput = document.getElementById('parceiroEmail');
        const dataInput = document.getElementById('parceiroData');
        const senhaInput = document.getElementById('novaSenha');

        if (modal && nomeInput && emailInput && dataInput && senhaInput) {
            nomeInput.value = this.currentParceiro.nome || '';
            emailInput.value = this.currentParceiro.email || '';
            dataInput.value = this.formatDate(this.currentParceiro.created_at);
            senhaInput.value = '';

            modal.style.display = 'block';
            modal.classList.add('show');
        }
    }

    // Fechar modal
    static closeModal() {
        const modal = document.getElementById('parceiroModal');
        if (modal) {
            modal.classList.remove('show');
            setTimeout(() => {
                modal.style.display = 'none';
                this.currentParceiro = null;
            }, 300);
        }
    }

    // Abrir modal direto para alterar senha
    static editPassword(parceiroId) {
        this.viewParceiro(parceiroId);
    }

    // Atualizar senha do parceiro
    static async updatePassword() {
        if (!this.currentAdmin || !this.currentParceiro) {
            this.showError('Erro: dados não carregados');
            return;
        }

        const novaSenhaInput = document.getElementById('novaSenha');
        if (!novaSenhaInput || !novaSenhaInput.value.trim()) {
            this.showError('Por favor, digite uma nova senha');
            return;
        }

        const novaSenha = novaSenhaInput.value.trim();
        if (novaSenha.length < 6) {
            this.showError('A senha deve ter pelo menos 6 caracteres');
            return;
        }

        try {
            const response = await fetch(`${this.API_BASE_URL}/admin/parceiros/senha`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    adminId: this.currentAdmin.id,
                    parceiroId: this.currentParceiro.id,
                    novaSenha: novaSenha
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            this.showSuccess('Senha alterada com sucesso!');
            this.closeModal();

        } catch (error) {
            console.error('Erro ao alterar senha:', error);
            this.showError('Erro ao alterar senha do parceiro');
        }
    }

    // Utilitários
    static formatDate(dateString) {
        if (!dateString) return 'Data não disponível';
        
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (error) {
            return 'Data inválida';
        }
    }

    static sanitizeHTML(str) {
        if (!str) return '';
        const temp = document.createElement('div');
        temp.textContent = str;
        return temp.innerHTML;
    }

    static showError(message) {
        alert('ERRO: ' + message);
    }

    static showSuccess(message) {
        alert('SUCESSO: ' + message);
    }
}

// Event listeners para fechar modal clicando fora
document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('parceiroModal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                AdminAPI.closeModal();
            }
        });
    }

    // Tecla ESC para fechar modal
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            AdminAPI.closeModal();
        }
    });
});