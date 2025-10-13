# Sistema de Arquivamento de Grupos - Alteração Importante

## 🔄 **Mudança Implementada**

**ANTES:** Grupos podiam ser **deletados** permanentemente
**AGORA:** Grupos são **arquivados** para preservar o histórico

## ✅ **Razões da Mudança**

1. **Preservação do Histórico**: Todas as transações e divisões de gastos ficam disponíveis para consulta
2. **Auditoria**: Mantém rastro de quais grupos existiram e quando foram arquivados
3. **Conformidade**: Evita perda de dados financeiros importantes
4. **Reversibilidade**: Grupos arquivados podem ser restaurados se necessário

## 🚀 **Novos Endpoints**

### 1. Arquivar Grupo (substitui DELETE)

```http
DELETE /api/expense-groups/{groupId}
```

- **Função**: Arquiva o grupo (marca como inativo)
- **Requisitos**: Apenas administradores podem arquivar
- **Validação**: Não permite arquivar se há transações pendentes
- **Resultado**: Grupo fica oculto mas histórico é preservado

### 2. Listar Grupos Arquivados

```http
GET /api/expense-groups/archived
```

- **Função**: Lista todos os grupos arquivados onde o usuário participava
- **Resposta**: Inclui informações de quando foi arquivado e por quem

### 3. Restaurar Grupo

```http
POST /api/expense-groups/{groupId}/restore
```

- **Função**: Reativa um grupo arquivado
- **Requisitos**: Apenas ex-administradores podem restaurar
- **Resultado**: Grupo volta a aparecer normalmente

## 📊 **Comportamento das APIs**

### Grupos Ativos (GET /api/expense-groups)

- ✅ Mostra apenas grupos ativos
- ✅ Filtra grupos arquivados automaticamente

### Detalhes do Grupo (GET /api/expense-groups/{id})

- ✅ Funciona normalmente para grupos ativos
- ❌ Retorna erro 404 para grupos arquivados

### Transações e Divisões

- ✅ **MANTIDAS**: Todas as transações ficam acessíveis via histórico
- ✅ **AUDITORIA**: Dados preservados para relatórios e consultas
- ✅ **INTEGRIDADE**: Referências entre tabelas mantidas

## 🛡️ **Validações Implementadas**

1. **Permissão**: Apenas admins podem arquivar/restaurar
2. **Transações Pendentes**: Impede arquivamento se há divisões não finalizadas
3. **Estado Atual**: Verifica se grupo já está arquivado/ativo antes da ação
4. **Auditoria**: Registra quem e quando arquivou/restaurou

## 💡 **Para o Frontend**

### Atualizar Interface:

1. **Botão "Excluir"** → **Botão "Arquivar"**
2. **Mensagem de confirmação**: "Este grupo será arquivado (não excluído)"
3. **Nova seção**: "Grupos Arquivados" nas configurações
4. **Opção**: "Restaurar" para grupos arquivados

### Exemplos de Uso:

```javascript
// Arquivar grupo
const response = await fetch(`/api/expense-groups/${groupId}`, {
  method: "DELETE",
});

// Listar arquivados
const archived = await fetch("/api/expense-groups/archived");

// Restaurar grupo
const restore = await fetch(`/api/expense-groups/${groupId}/restore`, {
  method: "POST",
});
```

## 🎯 **Benefícios**

- ✅ **Segurança**: Impossível perder dados por acidente
- ✅ **Compliance**: Atende requisitos de auditoria financeira
- ✅ **Flexibilidade**: Grupos podem ser reativados quando necessário
- ✅ **Histórico**: Relatórios completos mesmo de grupos antigos
- ✅ **UX**: Interface mais clara sobre o que acontece com os dados

---

**Status**: ✅ **IMPLEMENTADO E TESTADO**
**Compatibilidade**: ✅ **Backwards compatible** (DELETE continua funcionando, mas com novo comportamento)
