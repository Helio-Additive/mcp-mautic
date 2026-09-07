export function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export function setParam(params: Record<string, unknown>, key: string, value: unknown): void {
  if (hasValue(value)) {
    params[key] = value;
  }
}

export function setLimitedParam(params: Record<string, unknown>, key: string, value: unknown, max: number): void {
  if (hasValue(value)) {
    const numberValue = Math.floor(Number(value));
    if (Number.isFinite(numberValue)) {
      params[key] = Math.min(Math.max(numberValue, 1), max);
    }
  }
}

export function setNonNegativeParam(params: Record<string, unknown>, key: string, value: unknown): void {
  if (hasValue(value)) {
    const numberValue = Math.floor(Number(value));
    if (Number.isFinite(numberValue)) {
      params[key] = Math.max(numberValue, 0);
    }
  }
}

export function buildPagination(total: unknown, start: unknown, limit: unknown, count: number): Record<string, unknown> {
  const totalNumber = Number(total ?? 0);
  const rawStartNumber = Number(start ?? 0);
  const rawLimitNumber = Number(limit ?? count);
  const startNumber = Number.isFinite(rawStartNumber) ? Math.max(Math.floor(rawStartNumber), 0) : 0;
  const limitNumber = Number.isFinite(rawLimitNumber) ? Math.max(Math.floor(rawLimitNumber), 1) : Math.max(count, 1);
  const nextStart = startNumber + count;

  return {
    total: Number.isFinite(totalNumber) ? totalNumber : total,
    start: startNumber,
    limit: limitNumber,
    count,
    hasMore: Number.isFinite(totalNumber) ? nextStart < totalNumber : count >= limitNumber,
    nextStart: Number.isFinite(totalNumber) && nextStart < totalNumber ? nextStart : null,
  };
}

export function buildMutationResult(
  action: string,
  id: unknown,
  entityKey: string,
  entity: unknown,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    success: extra.success ?? true,
    action,
    id,
    [entityKey]: entity,
    ...Object.fromEntries(Object.entries(extra).filter(([key]) => key !== 'success')),
  };
}

export function summarizePayload(value: unknown, depth = 2, maxKeys = 20): unknown {
  if (depth <= 0 || value === null || value === undefined || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return {
      type: 'array',
      count: value.length,
      sample: value.slice(0, 5).map(item => summarizePayload(item, depth - 1, maxKeys)),
    };
  }

  const entries = Object.entries(value as Record<string, unknown>);
  return {
    type: 'object',
    keyCount: entries.length,
    keys: entries.slice(0, maxKeys).map(([key]) => key),
    values: Object.fromEntries(
      entries.slice(0, maxKeys).map(([key, entryValue]) => [key, summarizePayload(entryValue, depth - 1, maxKeys)]),
    ),
  };
}

function pickFields(fields: Record<string, unknown>, aliases?: string[]): Record<string, unknown> {
  if (!aliases?.length) {
    return fields;
  }

  return Object.fromEntries(aliases.map(alias => [alias, fields[alias] ?? null]));
}

export function normalizeContact(contact: any, aliases?: string[]): Record<string, unknown> {
  const fields = contact?.fields?.all ?? {};
  const fieldValues = Object.fromEntries(
    Object.entries(fields).map(([alias, field]: [string, any]) => [
      alias,
      field && typeof field === 'object' && 'value' in field ? field.value : field,
    ]),
  );

  return {
    id: contact?.id,
    isPublished: contact?.isPublished,
    dateAdded: contact?.dateAdded,
    dateModified: contact?.dateModified,
    dateIdentified: contact?.dateIdentified,
    lastActive: contact?.lastActive,
    points: contact?.points,
    color: contact?.color,
    fields: pickFields(fieldValues, aliases),
    tags: contact?.tags,
    companies: contact?.companies,
    owner: contact?.owner,
  };
}

export function normalizeContacts(contacts: any, aliases?: string[]): Record<string, unknown>[] {
  const values = Array.isArray(contacts) ? contacts : Object.values(contacts ?? {});
  return values.map(contact => normalizeContact(contact, aliases));
}
