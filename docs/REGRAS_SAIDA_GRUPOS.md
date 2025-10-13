# Regras de Saída e Arquivamento de Grupos

## 🔄 **Nova Lógica Implementada**

### **Cenários de "Sair do Grupo":**

#### 1. **Usuário Comum (Member)**

- ✅ **Pode sair livremente** se há outros membros
- ✅ Status alterado para `"left"`
- ✅ Grupo continua ativo para outros membros

#### 2. **Último Membro do Grupo**

- ✅ **Grupo é arquivado automaticamente**
- ✅ Não há sentido manter grupo vazio
- ✅ Histórico preservado

#### 3. **Único Administrador com Outros Membros**

- ❌ **NÃO PODE SAIR**
- ❌ Deve promover outro membro a admin primeiro
- ❌ Ou arquivar o grupo inteiro

#### 4. **Admin com Outros Admins**

- ✅ **Pode sair normalmente**
- ✅ Outros admins mantêm o grupo

---

## 🚀 **Endpoints Criados**

### 1. **Sair do Grupo**

```http
POST /api/expense-groups/{groupId}/leave
```

**Respostas possíveis:**

```json
// Sucesso - usuário saiu
{
  "success": true,
  "action": "user_left",
  "message": "Você saiu do grupo com sucesso!"
}

// Sucesso - grupo arquivado
{
  "success": true,
  "action": "group_archived",
  "message": "Grupo foi arquivado pois você era o último membro."
}

// Erro - único admin
{
  "error": "Você é o único administrador...",
  "action_required": "promote_admin_or_archive"
}
```

### 2. **Gerenciar Permissões**

```http
POST /api/expense-groups/{groupId}/members/{memberId}/role
```

**Body:**

```json
{
  "action": "promote" // ou "demote"
}
```

---

## 💡 **Interface Atualizada**

### **Confirmações Inteligentes:**

- ✅ "Sair normalmente" → Confirmação simples
- ✅ "Último membro" → Avisa que grupo será arquivado
- ✅ "Único admin" → Bloqueia e explica como proceder

### **Mensagens de Feedback:**

- ✅ Toast específico para cada cenário
- ✅ Instruções claras em caso de erro
- ✅ Tempo estendido para mensagens importantes

---

## 🛡️ **Validações de Segurança**

1. **Verificação de Permissões**: Só admins alteram roles
2. **Proteção contra Grupo Órfão**: Sempre deve haver 1 admin
3. **Verificação de Transações**: Não arquiva com pendências
4. **Auditoria Completa**: Log de todas as alterações

---

## 🎯 **Benefícios**

- ✅ **Integridade**: Nunca fica grupo sem admin
- ✅ **Flexibilidade**: Usuários podem sair quando apropriado
- ✅ **Preservação**: Histórico sempre mantido
- ✅ **UX Clara**: Interface explica o que vai acontecer
- ✅ **Segurança**: Validações impedem estados inconsistentes

---

**Status**: ✅ **IMPLEMENTADO**
**Compatibilidade**: ✅ **Frontend e Backend atualizados**
