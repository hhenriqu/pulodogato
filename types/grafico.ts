// =====================================================
// O QUE O RECHARTS PASSA PARA UM TOOLTIP CUSTOMIZADO
// =====================================================
// O recharts chama o componente de `content` com um objeto proprio, e os tipos
// que ele exporta para isso sao genericos demais para usar direto: o `payload`
// vem como lista de `Payload<ValueType, NameType>`, onde os campos que a gente
// le de fato (`color`, `fill`, `dataKey`) aparecem como opcionais de tipos
// amplos. O caminho que os tres tooltips do app tinham tomado era `: any` na
// assinatura, e com isso nada ali era conferido -- nem o nome do campo.
//
// Estes dois tipos nomeiam SO o que os tooltips usam. Sao uma assercao sobre a
// forma que o recharts entrega, igual ao que o `: any` assumia calado, com uma
// diferenca: agora esta escrito, e um campo digitado errado reprova no `tsc`.
// =====================================================

/** Uma serie dentro do tooltip: uma linha, uma barra, uma fatia. */
export type ItemDeTooltip<T = unknown> = {
  name?: string;
  value?: number | string;
  /** `color` nas linhas e barras; a fatia da pizza usa `fill`. */
  color?: string;
  fill?: string;
  dataKey?: string | number;
  /** O ponto de dados inteiro que originou a serie. */
  payload: T;
};

/**
 * As props do componente de tooltip.
 *
 * `active` e `payload` sao opcionais de proposito: o recharts monta o
 * componente antes de haver hover, e e justamente por isso que todo tooltip
 * aqui comeca com `if (!active || !payload?.length) return null`.
 */
export type PropsDeTooltip<T = unknown> = {
  active?: boolean;
  label?: string | number;
  payload?: ItemDeTooltip<T>[];
};
