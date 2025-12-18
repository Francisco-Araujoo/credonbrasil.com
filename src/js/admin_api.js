// API para operações administrativas (sem login)
class AdminAPI {
    static API_BASE_URL = "https://5ljkqdjuuh.execute-api.us-east-1.amazonaws.com";
    static currentAdmin = null;
    static parceiros = [];
    static preCadastros = [];
    static currentParceiro = null;
    static currentPreCadastro = null;

    // Funções utilitárias de formatação
    static formatCPF(cpf) {
        if (!cpf || cpf.trim() === '') return 'Não informado';
        const cleaned = cpf.replace(/\D/g, '');
        if (cleaned.length === 11) {
            return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
        }
        return cpf; // Retorna o valor original se não conseguir formatar
    }

    static formatCNPJ(cnpj) {
        if (!cnpj || cnpj.trim() === '') return 'Não informado';
        const cleaned = cnpj.replace(/\D/g, '');
        if (cleaned.length === 14) {
            return cleaned.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
        }
        return cnpj; // Retorna o valor original se não conseguir formatar
    }

    static formatPhone(phone) {
        if (!phone || phone.trim() === '') return 'Não informado';
        // Remove caracteres não numéricos
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length === 11) {
            return cleaned.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
        } else if (cleaned.length === 10) {
            return cleaned.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
        }
        return phone;
    }

    static formatStatus(status) {
        const statusText = {
            'pendente': 'Pendente',
            'pre-aprovado': 'Pré-Aprovado', 
            'aprovado': 'Aprovado',
            'reprovado': 'Reprovado'
        };
        return statusText[status] || status;
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

    // Inicializar dados do admin (deve ser chamado após login)
    static init() {
        const adminData = localStorage.getItem('credon_admin');
        if (!adminData) {
            return false;
        }

        try {
            this.currentAdmin = JSON.parse(adminData);
            this.loadAdminData();
            this.refreshData();
            return true;
        } catch (error) {
            console.error('Erro ao inicializar dados do admin:', error);
            return false;
        }
    }

    // Atualizar todos os dados
    static async refreshData() {
        try {
            await Promise.all([
                this.loadParceiros(),
                this.loadPreCadastros(),
                this.loadStats()
            ]);
            
            // Feedback visual
            const refreshButtons = document.querySelectorAll('.refresh-btn');
            refreshButtons.forEach(btn => {
                const icon = btn.querySelector('i');
                if (icon) {
                    icon.classList.add('fa-spin');
                    setTimeout(() => icon.classList.remove('fa-spin'), 1000);
                }
            });
        } catch (error) {
            console.error('Erro ao atualizar dados:', error);
            this.showError('Erro ao atualizar dados');
        }
    }

    // Carregar estatísticas
    static async loadStats() {
        if (!this.currentAdmin) return;

        // Atualizar estatísticas baseadas nos dados carregados
        this.updateStatsDisplay();
    }

    // Atualizar display das estatísticas
    static updateStatsDisplay() {
        const totalParceiros = document.getElementById('totalParceiros');
        const totalPreCadastros = document.getElementById('totalPreCadastros');
        const preCadastrosPendentes = document.getElementById('preCadastrosPendentes');
        const preCadastrosAprovados = document.getElementById('preCadastrosAprovados');

        if (totalParceiros) {
            totalParceiros.textContent = this.parceiros.length;
        }

        if (totalPreCadastros) {
            totalPreCadastros.textContent = this.preCadastros.length;
        }

        if (preCadastrosPendentes) {
            const pendentes = this.preCadastros.filter(p => 
                !p.status_elegibilidade || p.status_elegibilidade === 'pendente'
            ).length;
            preCadastrosPendentes.textContent = pendentes;
        }

        if (preCadastrosAprovados) {
            const aprovados = this.preCadastros.filter(p => 
                p.status_elegibilidade === 'aprovado'
            ).length;
            preCadastrosAprovados.textContent = aprovados;
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

    // Carregar lista de parceiros
    static async loadParceiros() {
        if (!this.currentAdmin) {
            console.error('Admin não logado');
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
            
            // Renderizar lista de parceiros
            this.renderParceiros();
            
            // Atualizar estatísticas
            this.updateStatsDisplay();

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
                <div class="parceiro-card">
                    <div class="parceiro-main-info">
                        <div class="parceiro-person-info">
                            <h3>${this.sanitizeHTML(parceiro.nome)}</h3>
                            <div class="email">${this.sanitizeHTML(parceiro.email)}</div>
                            <div class="date">Cadastrado em: ${dataFormatada}</div>
                        </div>
                    </div>
                    
                    <div class="parceiro-business-info">
                        <div class="info-item">
                            <span class="info-label">CPF</span>
                            <span class="info-value">${this.formatCPF(parceiro.cpf)}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">WhatsApp</span>
                            <span class="info-value">${this.formatPhone(parceiro.whatsapp)}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Razão Social</span>
                            <span class="info-value">${this.sanitizeHTML(parceiro.razao_social) || 'Não informado'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">CNPJ</span>
                            <span class="info-value">${this.formatCNPJ(parceiro.cnpj)}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Localização</span>
                            <span class="info-value">${this.sanitizeHTML(parceiro.cidade)} / ${this.sanitizeHTML(parceiro.uf)}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Tipo CNPJ</span>
                            <span class="info-value">${this.sanitizeHTML(parceiro.resp_tipo_cnpj) || 'Não informado'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Perfil Clientes</span>
                            <span class="info-value">${this.sanitizeHTML(parceiro.resp_perfil_clientes) || 'Não informado'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">Volume Indicações</span>
                            <span class="info-value">${this.sanitizeHTML(parceiro.resp_volume_indicacoes) || 'Não informado'}</span>
                        </div>
                    </div>

                    <div class="parceiro-senha-section">
                        <div class="senha-header">
                            <span class="senha-label">Senha Temporária de Acesso</span>
                        </div>
                        <div class="senha-display" onclick="event.stopPropagation(); AdminAPI.copyPassword('${parceiro.senha}', this)" title="Clique para copiar">
                            ${parceiro.senha}
                        </div>
                        <button class="copy-senha-btn" onclick="event.stopPropagation(); AdminAPI.copyPassword('${parceiro.senha}', this)" title="Copiar senha">
                            <i class="fas fa-copy"></i> Copiar Senha
                        </button>
                        <small style="color: var(--text-muted); font-size: 0.8rem;">
                            <i class="fas fa-info-circle"></i> Esta é a senha que o parceiro usa para acessar o portal
                        </small>
                    </div>
                </div>
            `;
        }).join('');

        listContainer.innerHTML = parceirosHTML;
    }

    // Visualizar detalhes de um parceiro
    static async viewParceiro(parceiroId) {
        if (!this.currentAdmin) {
            console.error('Admin não logado');
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

    // ===== PRÉ-CADASTROS =====
    
    // Carregar lista de pré-cadastros
    static async loadPreCadastros() {
        if (!this.currentAdmin) {
            console.error('Admin não autenticado');
            return;
        }

        try {
            console.log('Carregando pré-cadastros...');
            
            const response = await fetch(`${this.API_BASE_URL}/admin/pre-cadastros?adminId=${this.currentAdmin.id}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            this.preCadastros = data.preCadastros || [];
            
            console.log('Pré-cadastros carregados:', this.preCadastros);
            this.renderPreCadastros();
            this.updateStatsDisplay();

        } catch (error) {
            console.error('Erro ao carregar pré-cadastros:', error);
            this.showError('Erro ao carregar pré-cadastros: ' + error.message);
        }
    }

    // Renderizar lista de pré-cadastros
    static renderPreCadastros() {
        const container = document.getElementById('preCadastrosList');
        if (!container) return;

        console.log('Renderizando pré-cadastros - Total:', this.preCadastros.length);
        this.preCadastros.forEach(pre => {
            console.log(`Pré-cadastro ID: ${pre.id}, Status: "${pre.status_elegibilidade}"`);
        });

        if (this.preCadastros.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 3rem; color: var(--text-muted);">
                    <i class="fas fa-clipboard-list" style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.3;"></i>
                    <p>Nenhum pré-cadastro encontrado</p>
                </div>
            `;
            return;
        }

        const html = this.preCadastros.map(preCadastro => `
            <div class="pre-cadastro-card" data-id="${preCadastro.id}" onclick="AdminAPI.viewPreCadastro(${preCadastro.id})">
                <div class="pre-main-info">
                    <div class="pre-person-info">
                        <h3>${this.sanitizeHTML(preCadastro.nome_completo || 'Nome não informado')}</h3>
                        <div class="email">${this.sanitizeHTML(preCadastro.email || 'Email não informado')}</div>
                        <div class="date">Cadastrado em: ${this.formatDate(preCadastro.data_cadastro)}</div>
                    </div>
                    
                    <div class="pre-status">
                        <span class="status-badge status-${preCadastro.status_elegibilidade || 'pendente'}">
                            ${this.getStatusText(preCadastro.status_elegibilidade)}
                        </span>
                    </div>

                    <div class="pre-actions" onclick="event.stopPropagation()">
                        ${(preCadastro.status_elegibilidade === 'pre-aprovado' || !preCadastro.status_elegibilidade || preCadastro.status_elegibilidade === 'aprovado') ? `
                            <button class="action-btn success" onclick="AdminAPI.aprovarPreCadastro(${preCadastro.id})" title="Aprovar e Transformar em Parceiro">
                                <i class="fas fa-check"></i> Aprovar
                            </button>
                        ` : ''}
                        ${preCadastro.status_elegibilidade !== 'reprovado' ? `
                            <button class="action-btn danger" onclick="AdminAPI.recusarProposta(${preCadastro.id})" title="Recusar Proposta">
                                <i class="fas fa-times"></i> Recusar
                            </button>
                        ` : ''}
                    </div>
                </div>
                
                <div class="pre-business-info">
                    <div class="info-item">
                        <span class="info-label">WhatsApp</span>
                        <span class="info-value">${this.formatPhone(preCadastro.whatsapp)}</span>
                    </div>
                    
                    <div class="info-item">
                        <span class="info-label">CPF</span>
                        <span class="info-value">${this.formatCPF(preCadastro.cpf)}</span>
                    </div>
                    
                    <div class="info-item">
                        <span class="info-label">CNPJ</span>
                        <span class="info-value">${this.formatCNPJ(preCadastro.cnpj)}</span>
                    </div>
                    
                    <div class="info-item">
                        <span class="info-label">Localização</span>
                        <span class="info-value">${this.sanitizeHTML((preCadastro.cidade || '') + (preCadastro.uf ? '/' + preCadastro.uf : '')) || 'Não informado'}</span>
                    </div>
                    
                    <div class="info-item">
                        <span class="info-label">Possui CNPJ</span>
                        <span class="info-value">${preCadastro.resp_tipo_cnpj === 'SIM' ? 'Sim' : preCadastro.resp_tipo_cnpj === 'NAO' ? 'Não' : (preCadastro.resp_tipo_cnpj || 'N/A')}</span>
                    </div>
                    
                    <div class="info-item">
                        <span class="info-label">Tem Clientes</span>
                        <span class="info-value">${preCadastro.resp_perfil_clientes === 'SIM' ? 'Sim' : preCadastro.resp_perfil_clientes === 'NAO' ? 'Não' : (preCadastro.resp_perfil_clientes || 'N/A')}</span>
                    </div>
                    
                    <div class="info-item">
                        <span class="info-label">Volume de Indicações</span>
                        <span class="info-value">${this.sanitizeHTML(preCadastro.resp_volume_indicacoes || 'N/A')}</span>
                    </div>
                    
                    <div class="info-item">
                        <span class="info-label">Razão Social</span>
                        <span class="info-value">${this.sanitizeHTML(preCadastro.razao_social || 'Não informado')}</span>
                    </div>
                </div>
            </div>
        `).join('');

        container.innerHTML = html;
    }

    // Visualizar pré-cadastro específico
    static async viewPreCadastro(preCadastroId) {
        if (!this.currentAdmin) {
            this.showError('Admin não autenticado');
            return;
        }

        try {
            const response = await fetch(`${this.API_BASE_URL}/admin/pre-cadastros/view?adminId=${this.currentAdmin.id}&preCadastroId=${preCadastroId}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            this.currentPreCadastro = data.preCadastro;
            this.showPreCadastroModal();

        } catch (error) {
            console.error('Erro ao buscar pré-cadastro:', error);
            this.showError('Erro ao buscar pré-cadastro: ' + error.message);
        }
    }

    // Mostrar modal do pré-cadastro
    static showPreCadastroModal() {
        const modal = document.getElementById('preCadastroModal');
        if (!modal || !this.currentPreCadastro) return;

        const pre = this.currentPreCadastro;

        // Preencher dados pessoais
        document.getElementById('preNome').value = pre.nome_completo || '';
        document.getElementById('preCpf').value = pre.cpf || '';
        document.getElementById('preEmail').value = pre.email || '';
        document.getElementById('preWhatsapp').value = pre.whatsapp || '';
        document.getElementById('preCidade').value = pre.cidade || '';
        document.getElementById('preEstado').value = pre.uf || '';
        
        // Preencher dados empresariais
        document.getElementById('preRazaoSocial').value = pre.razao_social || '';
        document.getElementById('preCnpj').value = pre.cnpj || '';
        
        // Preencher respostas de qualificação
        document.getElementById('preTipoCnpj').textContent = pre.resp_tipo_cnpj || 'N/A';
        document.getElementById('prePerfilClientes').textContent = pre.resp_perfil_clientes || 'N/A';
        document.getElementById('preVolumeIndicacoes').textContent = pre.resp_volume_indicacoes || 'N/A';
        
        // Status e aceites
        document.getElementById('preStatusElegibilidade').value = pre.status_elegibilidade || 'reprovado';
        document.getElementById('preAceiteTermos').textContent = pre.aceite_termos ? 'Sim' : 'Não';
        document.getElementById('preAceiteLgpd').textContent = pre.aceite_lgpd ? 'Sim' : 'Não';
        document.getElementById('preCreatedAt').textContent = this.formatDate(pre.data_cadastro);

        modal.classList.add('show');
    }

    // Atualizar status do pré-cadastro
    static async updatePreCadastroStatus(preCadastroId) {
        const novoStatus = prompt('Digite o novo status (aprovado ou reprovado):');
        
        if (!novoStatus) return;

        const statusPermitidos = ['aprovado', 'reprovado'];
        if (!statusPermitidos.includes(novoStatus)) {
            this.showError('Status inválido! Use: aprovado ou reprovado');
            return;
        }

        try {
            const response = await fetch(`${this.API_BASE_URL}/admin/pre-cadastros/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    adminId: this.currentAdmin.id,
                    preCadastroId: preCadastroId,
                    status: novoStatus
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            this.showSuccess('Status atualizado com sucesso!');
            this.refreshData(); // Recarregar todos os dados

        } catch (error) {
            console.error('Erro ao atualizar status:', error);
            this.showError('Erro ao atualizar status: ' + error.message);
        }
    }

    // Transformar pré-cadastro em parceiro
    // Aprovar pré-cadastro (mesmo que transformar em parceiro)
    static async aprovarPreCadastro(preCadastroId) {
        return this.transformarEmParceiro(preCadastroId);
    }

    static async transformarEmParceiro(preCadastroId) {
        if (!this.currentAdmin) {
            this.showError('Admin não autenticado');
            return;
        }

        const confirmacao = confirm('Tem certeza que deseja transformar este pré-cadastro em parceiro?');
        if (!confirmacao) return;

        try {
            console.log('Transformando pré-cadastro em parceiro:', preCadastroId);
            
            const response = await fetch(`${this.API_BASE_URL}/admin/pre-cadastros/transformar-parceiro`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    adminId: this.currentAdmin.id,
                    preCadastroId: preCadastroId
                })
            });

            if (!response.ok) {
                if (response.status === 409) {
                    const errorData = await response.json();
                    this.showError('Conflito: ' + errorData.message);
                    return;
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            // Mostrar senha temporária gerada
            if (data.senhaTemporaria) {
                this.showPasswordModal(data.senhaTemporaria, preCadastroId);
            } else {
                this.showSuccess('Pré-cadastro transformado em parceiro com sucesso!');
            }
            
            this.refreshData(); // Recarregar todos os dados

        } catch (error) {
            console.error('Erro ao transformar em parceiro:', error);
            this.showError('Erro ao transformar em parceiro: ' + error.message);
        }
    }

    // Recusar proposta de parceria
    static async recusarProposta(preCadastroId) {
        if (!this.currentAdmin) {
            this.showError('Admin não autenticado');
            return;
        }

        const confirmacao = confirm('Tem certeza que deseja recusar esta proposta de parceria?');
        if (!confirmacao) return;

        try {
            console.log('Recusando proposta de parceria:', preCadastroId);
            
            const response = await fetch(`${this.API_BASE_URL}/admin/pre-cadastros/status`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    adminId: this.currentAdmin.id,
                    preCadastroId: preCadastroId,
                    status: 'reprovado'
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            this.showSuccess('Proposta recusada com sucesso!');
            this.refreshData(); // Recarregar todos os dados

        } catch (error) {
            console.error('Erro ao recusar proposta:', error);
            this.showError('Erro ao recusar proposta: ' + error.message);
        }
    }

    // Atualizar estatísticas de pré-cadastros
    static updatePreCadastrosStats() {
        const totalElement = document.getElementById('totalPreCadastros');
        const pendentesElement = document.getElementById('preCadastrosPendentes');
        const aprovadosElement = document.getElementById('preCadastrosAprovados');

        if (totalElement) {
            totalElement.textContent = this.preCadastros.length;
        }

        if (pendentesElement) {
            const pendentes = this.preCadastros.filter(p => p.status === 'pendente' || !p.status).length;
            pendentesElement.textContent = pendentes;
        }

        if (aprovadosElement) {
            const aprovados = this.preCadastros.filter(p => p.status === 'aprovado').length;
            aprovadosElement.textContent = aprovados;
        }
    }

    // Obter texto do status
    static getStatusText(status) {
        const statusMap = {
            'pendente': 'Pendente',
            'em_analise': 'Em Análise',
            'pre-aprovado': 'Pré-Aprovado',
            'aprovado': 'Aprovado', 
            'reprovado': 'Reprovado'
        };
        
        return statusMap[status] || 'Pré-Aprovado';
    }

    // Fechar modal de pré-cadastro
    static closePreCadastroModal() {
        const modal = document.getElementById('preCadastroModal');
        if (modal) {
            modal.classList.remove('show');
        }
        this.currentPreCadastro = null;
    }

    // Exibir modal profissional com senha temporária
    static showPasswordModal(senhaTemporaria, preCadastroId) {
        // Criar modal dinamicamente
        const modalHtml = `
            <div class="modal-overlay show" id="passwordModal" style="z-index: 3000;">
                <div class="modal">
                    <div class="modal-header">
                        <h3 class="modal-title">✅ Parceiro Criado com Sucesso!</h3>
                        <button class="close-modal" onclick="AdminAPI.closePasswordModal()">&times;</button>
                    </div>
                    <div class="modal-content">
                        <div style="text-align: center; margin-bottom: 2rem;">
                            <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid #10b981; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem;">
                                <p style="color: #10b981; font-weight: 600; margin-bottom: 1rem;">Senha Temporária Gerada:</p>
                                <div style="background: rgba(15, 23, 42, 0.8); border: 1px solid var(--line-color); border-radius: 6px; padding: 1rem; font-family: 'Courier New', monospace; font-size: 1.5rem; font-weight: bold; color: var(--accent); letter-spacing: 2px; user-select: all;" id="passwordDisplay">${senhaTemporaria}</div>
                            </div>
                            <p style="color: var(--text-muted); font-size: 0.9rem; line-height: 1.5;">
                                <strong>Importante:</strong> Anote esta senha e forneça ao novo parceiro.<br>
                                Por segurança, ela deve ser alterada no primeiro acesso.
                            </p>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button class="btn-modal btn-secondary" onclick="AdminAPI.copyPassword('${senhaTemporaria}')">
                            <i class="fas fa-copy"></i> Copiar Senha
                        </button>
                        <button class="btn-modal btn-primary" onclick="AdminAPI.closePasswordModal()">
                            Entendi
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // Adicionar modal ao DOM
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        // Mostrar sucesso
        this.showSuccess('Pré-cadastro transformado em parceiro com sucesso!');
    }

    // Copiar senha para área de transferência
    static async copyPassword(password) {
        try {
            await navigator.clipboard.writeText(password);
            this.showSuccess('Senha copiada para a área de transferência!');
        } catch (err) {
            // Fallback para navegadores mais antigos
            const textArea = document.createElement('textarea');
            textArea.value = password;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            this.showSuccess('Senha copiada para a área de transferência!');
        }
    }

    // Fechar modal de senha
    static closePasswordModal() {
        const modal = document.getElementById('passwordModal');
        if (modal) {
            modal.remove();
        }
        this.refreshData(); // Recarregar dados após fechar modal
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