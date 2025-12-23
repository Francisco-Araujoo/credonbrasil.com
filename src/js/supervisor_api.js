// API para operações de supervisor
class SupervisorAPI {
    static API_BASE_URL = "https://5ljkqdjuuh.execute-api.us-east-1.amazonaws.com";
    static currentSupervisor = null;
    static parceiros = [];
    static currentParceiro = null;

    // Funções utilitárias de formatação
    static formatCPF(cpf) {
        if (!cpf || cpf.trim() === '') return 'Não informado';
        const cleaned = cpf.replace(/\D/g, '');
        if (cleaned.length === 11) {
            return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
        }
        return cpf;
    }

    static formatDate(dateString) {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit', 
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // Inicializar dados do supervisor (deve ser chamado após login)
    static init() {
        const supervisorData = localStorage.getItem('credon_supervisor');
        if (!supervisorData) {
            return false;
        }

        try {
            this.currentSupervisor = JSON.parse(supervisorData);
            this.loadSupervisorData();
            this.refreshData();
            return true;
        } catch (error) {
            console.error('Erro ao inicializar dados do supervisor:', error);
            return false;
        }
    }

    // Atualizar todos os dados
    static async refreshData() {
        try {
            await Promise.all([
                this.loadParceiros(),
                this.loadStats()
            ]);
        } catch (error) {
            console.error('Erro ao atualizar dados:', error);
        }
    }

    // Carregar dados do supervisor
    static loadSupervisorData() {
        const nameElement = document.getElementById('supervisorName');
        if (nameElement && this.currentSupervisor) {
            nameElement.textContent = this.currentSupervisor.nome;
        }
    }

    // Carregar parceiros
    static async loadParceiros() {
        if (!this.currentSupervisor) return;

        try {
            const response = await fetch(
                `${this.API_BASE_URL}/supervisor/parceiros?supervisorId=${this.currentSupervisor.id}`,
                {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                }
            );

            if (!response.ok) {
                throw new Error(`Erro ao buscar parceiros: ${response.status}`);
            }

            const data = await response.json();
            this.parceiros = data.parceiros || [];
            this.renderParceiros();
        } catch (error) {
            console.error('Erro ao carregar parceiros:', error);
            this.showError('Erro ao carregar parceiros');
        }
    }

    // Renderizar lista de parceiros
    static renderParceiros() {
        const container = document.getElementById('parceirosContainer');
        if (!container) return;

        if (this.parceiros.length === 0) {
            container.innerHTML = '<p style="color: #64748b; text-align: center; padding: 2rem;">Nenhum parceiro cadastrado ainda.</p>';
            return;
        }

        container.innerHTML = this.parceiros.map(parceiro => `
            <div class="parceiro-card">
                <div class="parceiro-main-info">
                    <div class="parceiro-person-info">
                        <h3>${this.escapeHtml(parceiro.nome)}</h3>
                        <span class="email">${this.escapeHtml(parceiro.email)}</span>
                        <span class="date">Cadastrado em ${this.formatDate(parceiro.created_at)}</span>
                    </div>
                    <div class="parceiro-business-info">
                        <div class="info-item">
                            <span class="info-label">CPF:</span>
                            <span class="info-value">${this.formatCPF(parceiro.cpf)}</span>
                        </div>
                    </div>
                </div>
                <div class="parceiro-actions">
                    <button class="action-btn-small" onclick="SupervisorAPI.viewParceiro(${parceiro.id})" title="Ver detalhes">
                        <i class="fas fa-eye"></i> Ver Detalhes
                    </button>
                </div>
            </div>
        `).join('');
    }

    // Ver detalhes de um parceiro
    static async viewParceiro(parceiroId) {
        if (!this.currentSupervisor) return;

        try {
            const response = await fetch(
                `${this.API_BASE_URL}/supervisor/parceiros/view?supervisorId=${this.currentSupervisor.id}&parceiroId=${parceiroId}`,
                {
                    method: 'GET',
                    headers: { 'Content-Type': 'application/json' }
                }
            );

            if (!response.ok) {
                throw new Error(`Erro ao buscar parceiro: ${response.status}`);
            }

            const data = await response.json();
            this.currentParceiro = data.parceiro;
            this.showParceiroModal();
        } catch (error) {
            console.error('Erro ao carregar parceiro:', error);
            this.showError('Erro ao carregar dados do parceiro');
        }
    }

    // Mostrar modal com detalhes do parceiro
    static showParceiroModal() {
        if (!this.currentParceiro) return;

        const modal = document.getElementById('parceiroModal');
        if (!modal) return;

        // Preencher dados do modal
        document.getElementById('modalParceiroNome').value = this.currentParceiro.nome || '';
        document.getElementById('modalParceiroEmail').value = this.currentParceiro.email || '';
        document.getElementById('modalParceiroCPF').value = this.formatCPF(this.currentParceiro.cpf) || '';
        document.getElementById('modalParceiroCreatedAt').value = this.formatDate(this.currentParceiro.created_at) || '';

        // Mostrar modal
        modal.classList.add('show');
    }

    // Fechar modal
    static closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('show');
        }
    }

    // Carregar estatísticas
    static async loadStats() {
        const totalParceiros = this.parceiros.length;

        // Atualizar cards de estatísticas
        const statCards = {
            'statTotalParceiros': totalParceiros
        };

        Object.entries(statCards).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = value;
            }
        });
    }

    // Logout
    static logout() {
        localStorage.removeItem('credon_supervisor');
        window.location.href = '../index.html';
    }

    // Escape HTML para prevenir XSS
    static escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return String(text).replace(/[&<>"']/g, m => map[m]);
    }

    // Mostrar erro
    static showError(message) {
        console.error(message);
        alert(message);
    }

    // Mostrar sucesso
    static showSuccess(message) {
        console.log(message);
        alert(message);
    }
}

// Auto-inicializar quando o DOM estiver pronto
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        if (!SupervisorAPI.init()) {
            console.warn('Supervisor não autenticado, redirecionando...');
            window.location.href = '../index.html';
        }
    });
} else {
    if (!SupervisorAPI.init()) {
        console.warn('Supervisor não autenticado, redirecionando...');
        window.location.href = '../index.html';
    }
}
