// =============================================
// SISTEMA DE CONVERSÃO DE IMAGENS PARA BASE64
// =============================================

/**
 * Converte um arquivo (imagem/PDF) para Base64
 * @param {File} file - Arquivo a ser convertido
 * @returns {Promise<string>} - String Base64 do arquivo
 */
function convertFileToBase64(file) {
    return new Promise((resolve, reject) => {
        // Verificar se o arquivo está dentro dos limites permitidos
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (file.size > maxSize) {
            reject(new Error(`Arquivo muito grande. Máximo: ${maxSize / 1024 / 1024}MB`));
            return;
        }

        // Verificar tipo de arquivo
        const allowedTypes = [
            'image/jpeg', 
            'image/jpg', 
            'image/png', 
            'application/pdf'
        ];
        
        if (!allowedTypes.includes(file.type)) {
            reject(new Error('Tipo de arquivo não permitido. Use: JPEG, PNG ou PDF'));
            return;
        }

        const reader = new FileReader();
        
        reader.onload = function(e) {
            // Pegar apenas a parte Base64, sem o data:mime;base64,
            const base64String = e.target.result;
            resolve(base64String);
        };
        
        reader.onerror = function(error) {
            reject(new Error('Erro ao ler arquivo: ' + error));
        };
        
        reader.readAsDataURL(file);
    });
}

/**
 * Converte Base64 de volta para URL de imagem
 * @param {string} base64String - String Base64
 * @returns {string} - URL da imagem para usar em src
 */
function base64ToImageUrl(base64String) {
    // Se já é uma URL completa, retorna como está
    if (base64String.startsWith('data:')) {
        return base64String;
    }
    
    // Se é só o Base64, precisa identificar o tipo
    // Por padrão assume JPEG se não especificado
    if (!base64String.includes('data:')) {
        return `data:image/jpeg;base64,${base64String}`;
    }
    
    return base64String;
}

/**
 * Compacta imagem antes de converter para Base64 (opcional)
 * @param {File} file - Arquivo de imagem
 * @param {number} quality - Qualidade (0.1 a 1.0)
 * @param {number} maxWidth - Largura máxima
 * @returns {Promise<string>} - Base64 da imagem compactada
 */
function compressImageToBase64(file, quality = 0.8, maxWidth = 1920) {
    return new Promise((resolve, reject) => {
        // Só funciona com imagens
        if (!file.type.startsWith('image/')) {
            // Se não for imagem, converte normalmente
            convertFileToBase64(file).then(resolve).catch(reject);
            return;
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        img.onload = function() {
            // Calcular novas dimensões mantendo proporção
            let { width, height } = img;
            
            if (width > maxWidth) {
                height = (height * maxWidth) / width;
                width = maxWidth;
            }
            
            // Configurar canvas
            canvas.width = width;
            canvas.height = height;
            
            // Desenhar imagem redimensionada
            ctx.drawImage(img, 0, 0, width, height);
            
            // Converter para Base64 com qualidade
            const base64String = canvas.toDataURL(file.type, quality);
            resolve(base64String);
        };
        
        img.onerror = function() {
            reject(new Error('Erro ao carregar imagem para compressão'));
        };
        
        // Carregar arquivo como URL para a imagem
        const reader = new FileReader();
        reader.onload = (e) => img.src = e.target.result;
        reader.readAsDataURL(file);
    });
}

/**
 * Gerencia o upload de múltiplos arquivos convertendo para Base64
 * @param {FileList} files - Lista de arquivos
 * @param {Function} onProgress - Callback de progresso (index, total, fileName)
 * @param {Function} onSuccess - Callback de sucesso (index, base64, fileName, fileType)
 * @param {Function} onError - Callback de erro (index, error, fileName)
 * @param {boolean} compress - Se deve comprimir imagens
 */
async function uploadFilesToBase64(files, onProgress, onSuccess, onError, compress = true) {
    const fileArray = Array.from(files);
    
    for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i];
        
        try {
            if (onProgress) onProgress(i + 1, fileArray.length, file.name);
            
            let base64String;
            
            if (compress && file.type.startsWith('image/')) {
                base64String = await compressImageToBase64(file, 0.8, 1920);
            } else {
                base64String = await convertFileToBase64(file);
            }
            
            if (onSuccess) onSuccess(i, base64String, file.name, file.type);
            
        } catch (error) {
            if (onError) onError(i, error, file.name);
        }
    }
}

/**
 * Cria um preview de imagem Base64
 * @param {string} base64String - String Base64
 * @param {string} fileName - Nome do arquivo
 * @returns {HTMLElement} - Elemento de preview
 */
function createImagePreview(base64String, fileName) {
    const preview = document.createElement('div');
    preview.className = 'image-preview';
    preview.style.cssText = `
        display: inline-block;
        margin: 10px;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 10px;
        background: #f9f9f9;
        text-align: center;
        max-width: 200px;
    `;
    
    const img = document.createElement('img');
    img.src = base64ToImageUrl(base64String);
    img.style.cssText = `
        max-width: 180px;
        max-height: 120px;
        object-fit: cover;
        border-radius: 4px;
    `;
    
    const label = document.createElement('p');
    label.textContent = fileName;
    label.style.cssText = `
        margin: 5px 0 0 0;
        font-size: 12px;
        color: #666;
        word-break: break-word;
    `;
    
    preview.appendChild(img);
    preview.appendChild(label);
    
    return preview;
}

/**
 * Valida se uma string é Base64 válida
 * @param {string} str - String para validar
 * @returns {boolean} - Se é Base64 válida
 */
function isValidBase64(str) {
    try {
        if (typeof str !== 'string') return false;
        
        // Remover prefixo data: se existir
        const base64Part = str.includes(',') ? str.split(',')[1] : str;
        
        // Verificar se é Base64 válida
        return btoa(atob(base64Part)) === base64Part;
    } catch (err) {
        return false;
    }
}

/**
 * Obter informações sobre um arquivo Base64
 * @param {string} base64String - String Base64
 * @returns {Object} - Informações do arquivo
 */
function getBase64FileInfo(base64String) {
    try {
        // Extrair tipo MIME
        const mimeMatch = base64String.match(/data:([^;]+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
        
        // Extrair apenas a parte Base64
        const base64Data = base64String.includes(',') 
            ? base64String.split(',')[1] 
            : base64String;
        
        // Calcular tamanho aproximado em bytes
        const padding = base64Data.match(/=*$/)[0].length;
        const sizeBytes = (base64Data.length * 3 / 4) - padding;
        
        return {
            mimeType,
            sizeBytes,
            sizeMB: (sizeBytes / 1024 / 1024).toFixed(2),
            isImage: mimeType.startsWith('image/'),
            isPDF: mimeType === 'application/pdf'
        };
    } catch (err) {
        return {
            mimeType: 'unknown',
            sizeBytes: 0,
            sizeMB: '0.00',
            isImage: false,
            isPDF: false
        };
    }
}

// Exportar funções para uso global
window.ImageBase64Utils = {
    convertFileToBase64,
    base64ToImageUrl,
    compressImageToBase64,
    uploadFilesToBase64,
    createImagePreview,
    isValidBase64,
    getBase64FileInfo
};

console.log('Sistema de conversão Base64 carregado com sucesso!');