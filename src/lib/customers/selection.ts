export interface CustomerChoice {
  value: string;
  name: string;
  disabled: boolean;
}

export function customerChoices(rows: readonly unknown[]): CustomerChoice[] {
  const valid = rows.flatMap((row, index) => {
    if (!row || typeof row !== 'object' || !Object.hasOwn(row, 'id') || !Object.hasOwn(row, 'name')) return [];
    const { id, name } = row as { id: unknown; name: unknown };
    if ((typeof id !== 'string' && typeof id !== 'number') || !String(id).trim() ||
      (typeof id === 'number' && !Number.isSafeInteger(id)) || typeof name !== 'string' || !name.trim()) return [];
    return [{ id: String(id), value: `customer-${index}`, name, normalized: name.normalize('NFC').trim().toLocaleLowerCase('pt-BR') }];
  });
  return valid.map((row) => ({
    value: row.value,
    name: row.name,
    // The current writer persists names. Do not pretend it can distinguish homonyms.
    disabled: valid.some((other) => other !== row && (other.normalized === row.normalized || other.id === row.id)),
  }));
}

export function selectedCustomerValue(choices: readonly CustomerChoice[], name: string): string {
  return choices.find((choice) => !choice.disabled && choice.name === name)?.value ?? '';
}

export function customerNameFromChoice(choices: readonly CustomerChoice[], value: string): string | null {
  return choices.find((choice) => !choice.disabled && choice.value === value)?.name ?? null;
}

export function isCurrentCustomerSource(
  source: { userId: string; membership: object } | null,
  userId: string | undefined,
  membership: object | null,
): boolean {
  return Boolean(source && userId && membership && source.userId === userId && source.membership === membership);
}
