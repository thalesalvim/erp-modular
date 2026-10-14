const categories = [
  { id: 'overview', label: 'Visão geral', tabs: ['dashboard'] },
  { id: 'appointments', label: 'Agenda e atendimento', tabs: ['calendar', 'atendimentos'] },
  { id: 'people', label: 'Clientes e equipe', tabs: ['customers', 'team', 'my_schedule'] },
  { id: 'commercial', label: 'Serviços e vendas', tabs: ['services', 'promotions', 'pos', 'stock'] },
  { id: 'account', label: 'Financeiro e conta', tabs: ['expenses', 'dre', 'my_plan', 'settings'] },
] as const;

// Presentation only: callers must supply the items already authorized by the application.
export function groupVisibleNavigation<T extends { id: string }>(visibleTabs: readonly T[]) {
  const groups = categories.map((category) => ({
    id: String(category.id),
    label: String(category.label),
    tabs: visibleTabs.filter((tab) => (category.tabs as readonly string[]).includes(tab.id)),
  }));
  const knownIds = new Set<string>(categories.flatMap((category) => [...category.tabs]));
  groups.push({ id: 'other', label: 'Outros módulos', tabs: visibleTabs.filter((tab) => !knownIds.has(tab.id)) });
  return groups.filter((group) => group.tabs.length > 0);
}
