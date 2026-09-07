import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { MauticApiClient } from '../api/client.js';
import type { ToolDefinition, ToolHandler } from '../types/index.js';
import { buildMutationResult, buildPagination, normalizeContact, normalizeContacts, setLimitedParam, setNonNegativeParam, setParam } from './utils.js';

function buildContactPayload(args: any) {
  const { firstName, lastName, ownerId, customFields, ...rest } = args;

  return {
    ...rest,
    ...customFields,
    ...(firstName !== undefined ? { firstname: firstName } : {}),
    ...(lastName !== undefined ? { lastname: lastName } : {}),
    ...(ownerId !== undefined ? { owner: ownerId } : {}),
  };
}

async function getContactByIdOrEmail(client: MauticApiClient, args: any) {
  const { id, email } = args;

  if (id !== undefined) {
    const response = await client.v1.get(`/contacts/${id}`);
    return response.data.contact;
  }

  if (email) {
    const searchResponse = await client.v1.get('/contacts', {
      params: { search: `email:${email}`, limit: 1 },
    });

    if (searchResponse.data.total === 0) {
      return null;
    }

    const contactId = Object.keys(searchResponse.data.contacts)[0];
    const response = await client.v1.get(`/contacts/${contactId}`);
    return response.data.contact;
  }

  throw new McpError(ErrorCode.InvalidParams, 'Either id or email must be provided');
}

function getFieldValue(contact: any, alias: string): unknown {
  const field = contact?.fields?.all?.[alias];
  return field && typeof field === 'object' && 'value' in field ? field.value : field;
}

function normalizeBulkContactRows(rows: unknown): any[] {
  if (!Array.isArray(rows)) {
    throw new McpError(ErrorCode.InvalidParams, 'contacts must be an array');
  }

  if (rows.length > 200) {
    throw new McpError(ErrorCode.InvalidParams, 'bulk_upsert_contacts accepts at most 200 contacts per call');
  }

  return rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new McpError(ErrorCode.InvalidParams, `contacts[${index}] must be an object`);
    }
    return row;
  });
}

async function findContactByField(client: MauticApiClient, field: string, value: unknown): Promise<any | null> {
  const normalizedValue = String(value ?? '').trim();
  if (!normalizedValue) {
    return null;
  }

  const response = await client.v1.get('/contacts', {
    params: { search: `${field}:${normalizedValue}`, limit: 1 },
  });

  if (Number(response.data.total ?? 0) === 0) {
    return null;
  }

  return Object.values(response.data.contacts ?? {})[0] ?? null;
}

function buildBulkContactPayload(row: any): Record<string, unknown> {
  return buildContactPayload(row);
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map(value => String(value ?? '').trim()).filter(Boolean)));
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalizeDuplicateValue(value: unknown, field: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (field === 'email') return raw.toLowerCase();
  if (field === 'phone' || field === 'mobile') return raw.replace(/\D/g, '');
  return raw.toLowerCase();
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || String(value).trim() === '';
}

function normalizedFieldValues(contact: any): Record<string, unknown> {
  const normalized = normalizeContact(contact) as { fields?: Record<string, unknown> };
  return normalized.fields ?? {};
}

function currentTagNames(contact: any): string[] {
  const tags = contact?.tags;

  if (Array.isArray(tags)) {
    return tags.map((tag: any) => String(tag?.tag ?? tag?.name ?? tag)).filter(Boolean);
  }

  return Object.values(tags ?? {}).map((tag: any) => String(tag?.tag ?? tag?.name ?? tag)).filter(Boolean);
}

function buildMergeFieldUpdates(primary: any, secondary: any, strategy: string, allowEmailOverwrite: boolean): Record<string, unknown> {
  const primaryFields = normalizedFieldValues(primary);
  const secondaryFields = normalizedFieldValues(secondary);
  const updates: Record<string, unknown> = {};

  for (const [alias, secondaryValue] of Object.entries(secondaryFields)) {
    if (alias === 'email' && !allowEmailOverwrite) continue;
    if (isBlank(secondaryValue)) continue;

    const primaryValue = primaryFields[alias];
    if (strategy === 'prefer_secondary' || isBlank(primaryValue)) {
      updates[alias] = secondaryValue;
    }
  }

  return updates;
}

async function getContactRelations(client: MauticApiClient, contactId: number, relation: 'segments' | 'companies'): Promise<any[]> {
  try {
    const response = await client.v1.get(`/contacts/${contactId}/${relation}`);
    return Object.values(response.data.lists ?? response.data.companies ?? response.data ?? {});
  } catch (_error) {
    return [];
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

function readHtmlInputValue(html: string, inputName: string): string | null {
  const escapedName = inputName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const inputMatch = html.match(new RegExp(`<input\\b[^>]*name=["']${escapedName}["'][^>]*>`, 'i'));
  if (!inputMatch) {
    return null;
  }

  const valueMatch = inputMatch[0].match(/\bvalue=["']([^"']*)["']/i);
  return valueMatch ? decodeHtmlEntities(valueMatch[1]) : null;
}

function htmlHasSelectOption(html: string, selectName: string, optionValue: number): boolean {
  const escapedName = selectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const selectMatch = html.match(new RegExp(`<select\\b[^>]*name=["']${escapedName}["'][\\s\\S]*?<\\/select>`, 'i'));
  if (!selectMatch) {
    return false;
  }

  return new RegExp(`<option\\b[^>]*value=["']${optionValue}["']`, 'i').test(selectMatch[0]);
}

function contactPrimaryIdentifier(contact: any): string {
  const fields = normalizedFieldValues(contact);
  return String(fields.email ?? fields.firstname ?? fields.lastname ?? contact?.id ?? '').trim();
}

async function fetchNativeMergeForm(
  client: MauticApiClient,
  primaryContactId: number,
  secondaryContact: any,
): Promise<{ search: string; token: string; secondaryIsChoice: boolean }> {
  const search = contactPrimaryIdentifier(secondaryContact);
  const response = await client.web.get(`/contacts/merge/${primaryContactId}`, {
    params: { tmpl: 'update', search },
  });
  const html = String(response.data ?? '');
  const token = readHtmlInputValue(html, 'lead_merge[_token]');

  if (!token) {
    throw new McpError(ErrorCode.InternalError, 'Native Mautic merge form did not include lead_merge[_token]');
  }

  return {
    search,
    token,
    secondaryIsChoice: htmlHasSelectOption(html, 'lead_merge[lead_to_merge]', Number(secondaryContact.id)),
  };
}

async function nativeMergeContacts(client: MauticApiClient, args: any, primary: any, secondary: any, live: boolean) {
  const primaryContactId = Number(args.primaryContactId);
  const secondaryContactId = Number(args.secondaryContactId);
  const form = await fetchNativeMergeForm(client, primaryContactId, secondary);
  const operations = [
    {
      action: 'native_mautic_merge',
      route: `/s/contacts/merge/${primaryContactId}`,
      primaryContactId,
      secondaryContactId,
      secondaryIsSelectable: form.secondaryIsChoice,
    },
  ];

  if (!form.secondaryIsChoice) {
    const result = {
      success: false,
      dryRun: !live,
      action: 'native_merge_unavailable',
      mergeMode: 'native',
      primaryContactId,
      secondaryContactId,
      operations,
      reason: 'secondary_contact_not_available_in_merge_form_choices',
      message: 'Mautic did not expose the secondary contact as a valid merge choice for the native merge form.',
      fallback: { mergeMode: 'managed' },
    };

    return {
      content: [{ type: 'text', text: `Native contact merge unavailable:\n${JSON.stringify(result, null, 2)}` }],
      isError: true,
    };
  }

  if (live) {
    const payload = new URLSearchParams();
    payload.set('lead_merge[lead_to_merge]', String(secondaryContactId));
    payload.set('lead_merge[_token]', form.token);
    payload.set('lead_merge[buttons][save]', '');

    await client.web.post(`/contacts/merge/${primaryContactId}`, payload, {
      params: { tmpl: 'update', search: form.search },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  }

  const primaryAfterResponse = await client.v1.get(`/contacts/${primaryContactId}`);
  let secondaryAfter: Record<string, unknown> | null = normalizeContact(secondary, args?.fields);

  if (live) {
    try {
      const secondaryAfterResponse = await client.v1.get(`/contacts/${secondaryContactId}`);
      secondaryAfter = normalizeContact(secondaryAfterResponse.data.contact, args?.fields);
    } catch (_error) {
      secondaryAfter = null;
    }
  }

  const result = {
    success: true,
    dryRun: !live,
    action: live ? 'native_merge_applied' : 'native_merge_preview',
    mergeMode: 'native',
    primaryContactId,
    secondaryContactId,
    operations,
    warnings: [
      'Native Mautic merge deletes the secondary contact when applied.',
      'Mautic 6.0.x native merge has a known company-association transfer caveat; use managed mode when company relation preservation matters.',
    ],
    requiresConfirmation: !live,
    confirmation: {
      tool: 'merge_contacts',
      requiredArgs: { mergeMode: 'native', dryRun: false, confirmMerge: true },
    },
    primaryContactBefore: normalizeContact(primary, args?.fields),
    secondaryContactBefore: normalizeContact(secondary, args?.fields),
    primaryContact: normalizeContact(primaryAfterResponse.data.contact, args?.fields),
    secondaryContact: secondaryAfter,
  };

  return {
    content: [{ type: 'text', text: `Native contact merge ${live ? 'complete' : 'preview; no contacts were changed'}:\n${JSON.stringify(result, null, 2)}` }],
  };
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'create_contact',
    description: 'Create a new contact in Mautic',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Contact email address' },
        firstName: { type: 'string', description: 'First name' },
        lastName: { type: 'string', description: 'Last name' },
        phone: { type: 'string', description: 'Phone number' },
        company: { type: 'string', description: 'Company name' },
        position: { type: 'string', description: 'Job position' },
        ownerId: { type: ['number', 'null'], description: 'Mautic user ID to assign as owner; null clears owner' },
        customFields: { type: 'object', description: 'Custom field values keyed by Mautic field alias' },
      },
      required: ['email'],
    },
  },
  {
    name: 'update_contact',
    description: 'Update an existing contact',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Contact ID' },
        email: { type: 'string', description: 'Contact email address' },
        firstName: { type: 'string', description: 'First name' },
        lastName: { type: 'string', description: 'Last name' },
        phone: { type: 'string', description: 'Phone number' },
        company: { type: 'string', description: 'Company name' },
        position: { type: 'string', description: 'Job position' },
        ownerId: { type: ['number', 'null'], description: 'Mautic user ID to assign as owner; null clears owner' },
        customFields: { type: 'object', description: 'Custom field values keyed by Mautic field alias' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_contact',
    description: 'Get contact details by ID or email',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Contact ID' },
        email: { type: 'string', description: 'Contact email address' },
        minimal: { type: 'boolean', description: 'Return normalized contact data instead of full Mautic metadata' },
        fieldsOnly: { type: 'boolean', description: 'Return only normalized contact field values plus id' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Field aliases to include when minimal or fieldsOnly is true' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic contact payload instead of normalized contact data' },
      },
    },
  },
  {
    name: 'search_contacts',
    description: 'Search contacts with filters and pagination',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search term' },
        limit: { type: 'number', description: 'Number of results (max 200)', maximum: 200 },
        start: { type: 'number', description: 'Starting offset for pagination' },
        orderBy: { type: 'string', description: 'Field to order by' },
        orderByDir: { type: 'string', enum: ['ASC', 'DESC'], description: 'Order direction' },
        publishedOnly: { type: 'boolean', description: 'Only published contacts' },
        minimal: { type: 'boolean', description: 'Return normalized contact data instead of full Mautic metadata' },
        fieldsOnly: { type: 'boolean', description: 'Return only normalized contact field values plus id' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Field aliases to include when minimal or fieldsOnly is true' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic contact payloads instead of normalized contact data' },
      },
    },
  },
  {
    name: 'bulk_upsert_contacts',
    description: 'Create or update contacts in bulk by resolving each row against an upsert field; dry-run by default',
    inputSchema: {
      type: 'object',
      properties: {
        contacts: {
          type: 'array',
          description: 'Contact rows using Mautic field aliases plus optional firstName, lastName, ownerId, and customFields',
          items: { type: 'object' },
        },
        upsertField: { type: 'string', description: 'Field alias used to find existing contacts; defaults to email' },
        dryRun: { type: 'boolean', description: 'Preview creates/updates without mutating; defaults to true' },
        confirmUpsert: { type: 'boolean', description: 'Must be true to perform live create/update operations' },
        batchSize: { type: 'number', description: 'Rows to process concurrently during live or dry-run execution; defaults to 3, maximum 10' },
        segmentId: { type: 'number', description: 'Optional segment ID to add successfully upserted contacts to' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags to add to successfully upserted contacts' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Field aliases to include in result contact summaries' },
      },
      required: ['contacts'],
    },
  },
  {
    name: 'find_duplicates',
    description: 'Find likely duplicate contacts by grouping normalized field values',
    inputSchema: {
      type: 'object',
      properties: {
        matchFields: { type: 'array', items: { type: 'string' }, description: 'Field aliases used to group duplicates; defaults to email' },
        search: { type: 'string', description: 'Optional contact search filter before duplicate grouping' },
        maxContacts: { type: 'number', description: 'Maximum contacts to scan, capped at 5000; defaults to 1000' },
        start: { type: 'number', description: 'Starting contact offset for resumable duplicate scans' },
        summaryOnly: { type: 'boolean', description: 'Return duplicate group counts without contact details' },
        limitGroups: { type: 'number', description: 'Maximum duplicate groups to return, capped at 200' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Field aliases to include in duplicate contact summaries' },
      },
    },
  },
  {
    name: 'merge_contacts',
    description: 'Contact merge preview/update for two contact IDs; managed mode is default, native mode calls Mautic UI merge',
    inputSchema: {
      type: 'object',
      properties: {
        primaryContactId: { type: 'number', description: 'Surviving contact ID' },
        secondaryContactId: { type: 'number', description: 'Duplicate contact ID to merge from' },
        mergeMode: { type: 'string', enum: ['managed', 'native'], description: 'managed copies selected data; native calls Mautic UI merge and deletes the secondary contact' },
        strategy: { type: 'string', enum: ['fill_blanks', 'prefer_secondary'], description: 'How to copy field values; defaults to fill_blanks' },
        allowEmailOverwrite: { type: 'boolean', description: 'Allow secondary email to overwrite the primary email when strategy permits' },
        transferTags: { type: 'boolean', description: 'Transfer tags from secondary to primary; defaults to true' },
        transferSegments: { type: 'boolean', description: 'Transfer segment membership from secondary to primary; defaults to true' },
        transferCompanies: { type: 'boolean', description: 'Transfer company associations from secondary to primary; defaults to true' },
        deleteSecondary: { type: 'boolean', description: 'Delete the duplicate contact after copying data; defaults to false' },
        dryRun: { type: 'boolean', description: 'Preview merge actions without mutating; defaults to true' },
        confirmMerge: { type: 'boolean', description: 'Must be true to perform live merge actions' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Field aliases to include in result contact summaries' },
      },
      required: ['primaryContactId', 'secondaryContactId'],
    },
  },
  {
    name: 'get_contact_preferences',
    description: 'Get contact preference and contactability state without mutating it',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Contact ID' },
        email: { type: 'string', description: 'Contact email address' },
      },
    },
  },
  {
    name: 'delete_contact',
    description: 'Delete a contact from Mautic; requires explicit confirmation',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Contact ID to delete' },
        confirmDelete: { type: 'boolean', description: 'Must be true to delete the contact' },
      },
      required: ['id', 'confirmDelete'],
    },
  },
  {
    name: 'assign_contact_owner',
    description: 'Assign or clear a Mautic contact owner',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'number', description: 'Contact ID' },
        ownerId: { type: ['number', 'null'], description: 'Mautic user ID to assign as owner; null clears owner' },
        dryRun: { type: 'boolean', description: 'Preview owner assignment without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to update contact owner' },
      },
      required: ['contactId', 'ownerId'],
    },
  },
  {
    name: 'add_contact_dnc',
    description: 'Add a Do Not Contact entry for a contact channel',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'number', description: 'Contact ID' },
        channel: { type: 'string', description: 'DNC channel, usually email or sms' },
        reason: { type: 'number', description: 'Mautic DNC reason code; defaults to manual if omitted' },
        comments: { type: 'string', description: 'Optional DNC comments' },
        channelId: { type: 'number', description: 'Optional channel entity ID' },
        dryRun: { type: 'boolean', description: 'Preview DNC add without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to add DNC' },
      },
      required: ['contactId', 'channel'],
    },
  },
  {
    name: 'remove_contact_dnc',
    description: 'Remove a Do Not Contact entry for a contact channel',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'number', description: 'Contact ID' },
        channel: { type: 'string', description: 'DNC channel, usually email or sms' },
        dryRun: { type: 'boolean', description: 'Preview DNC removal without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to remove DNC' },
      },
      required: ['contactId', 'channel'],
    },
  },
  {
    name: 'add_contact_to_segment',
    description: 'Add a contact to a specific segment',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'number', description: 'Contact ID' },
        segmentId: { type: 'number', description: 'Segment ID' },
        dryRun: { type: 'boolean', description: 'Preview segment membership add without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to add contact to segment' },
      },
      required: ['contactId', 'segmentId'],
    },
  },
  {
    name: 'remove_contact_from_segment',
    description: 'Remove a contact from a specific segment',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'number', description: 'Contact ID' },
        segmentId: { type: 'number', description: 'Segment ID' },
        dryRun: { type: 'boolean', description: 'Preview segment membership removal without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to remove contact from segment' },
      },
      required: ['contactId', 'segmentId'],
    },
  },
];

export const toolHandlers: Record<string, ToolHandler> = {
  async create_contact(client: MauticApiClient, args: any) {
    const response = await client.v1.post('/contacts/new', buildContactPayload(args));
    const contact = normalizeContact(response.data.contact);
    const result = buildMutationResult('created', contact.id, 'contact', contact, { success: response.data?.success ?? true });
    return {
      content: [{ type: 'text', text: `Contact created successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async update_contact(client: MauticApiClient, args: any) {
    const { id, ...updateData } = args;
    const response = await client.v1.patch(`/contacts/${id}/edit`, buildContactPayload(updateData));
    const contact = normalizeContact(response.data.contact);
    const result = buildMutationResult('updated', contact.id ?? id, 'contact', contact, { success: response.data?.success ?? true });
    return {
      content: [{ type: 'text', text: `Contact updated successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async get_contact(client: MauticApiClient, args: any) {
    const { email, minimal, fieldsOnly, fields } = args;
    const contact = await getContactByIdOrEmail(client, args);

    if (!contact) {
      return { content: [{ type: 'text', text: `No contact found with email: ${email}` }] };
    }

    const includeRaw = args?.includeRaw === true || minimal === false;
    const output = fieldsOnly
      ? { id: contact?.id, fields: normalizeContact(contact, fields).fields }
      : includeRaw
        ? contact
        : normalizeContact(contact, fields);

    return {
      content: [{ type: 'text', text: `Contact details:\n${JSON.stringify(output, null, 2)}` }],
    };
  },

  async get_contact_preferences(client: MauticApiClient, args: any) {
    const { email } = args;
    const contact = await getContactByIdOrEmail(client, args);

    if (!contact) {
      return { content: [{ type: 'text', text: `No contact found with email: ${email}` }] };
    }

    const segmentsResponse = await client.v1.get(`/contacts/${contact.id}/segments`);
    const campaignsResponse = await client.v1.get(`/contacts/${contact.id}/campaigns`);
    const preferences = {
      id: contact.id,
      email: getFieldValue(contact, 'email'),
      doNotContact: contact.doNotContact ?? [],
      frequencyRules: contact.frequencyRules ?? [],
      owner: contact.owner ?? null,
      tags: contact.tags ?? [],
      segments: segmentsResponse.data.lists ?? segmentsResponse.data,
      campaigns: campaignsResponse.data.campaigns ?? campaignsResponse.data,
    };

    return {
      content: [{ type: 'text', text: `Contact preferences:\n${JSON.stringify(preferences, null, 2)}` }],
    };
  },

  async search_contacts(client: MauticApiClient, args: any) {
    const params: any = {};
    setParam(params, 'search', args?.search);
    setLimitedParam(params, 'limit', args?.limit, 200);
    setNonNegativeParam(params, 'start', args?.start);
    setParam(params, 'orderBy', args?.orderBy);
    setParam(params, 'orderByDir', args?.orderByDir);
    setParam(params, 'publishedOnly', args?.publishedOnly);

    const response = await client.v1.get('/contacts', { params });
    const includeRaw = args?.includeRaw === true || args?.minimal === false;
    const contacts = args?.fieldsOnly
      ? normalizeContacts(response.data.contacts, args?.fields).map(contact => ({ id: contact.id, fields: contact.fields }))
      : includeRaw
        ? response.data.contacts
        : normalizeContacts(response.data.contacts, args?.fields);
    const count = Array.isArray(contacts) ? contacts.length : Object.keys(contacts ?? {}).length;
    const result = {
      pagination: buildPagination(response.data.total, params.start, params.limit, count),
      contacts,
    };

    return {
      content: [{ type: 'text', text: `Found ${response.data.total} contacts:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async bulk_upsert_contacts(client: MauticApiClient, args: any) {
    const rows = normalizeBulkContactRows(args?.contacts);
    const upsertField = String(args?.upsertField ?? 'email');
    const live = args?.dryRun === false && args?.confirmUpsert === true;
    const batchSize = Math.min(Math.max(Math.floor(Number(args?.batchSize ?? 3)), 1), 10);
    const segmentId = Number(args?.segmentId);
    const hasSegmentAssignment = Number.isFinite(segmentId);
    const tags = normalizeStringArray(args?.tags);
    const seen = new Set<string>();
    const results: any[] = new Array(rows.length);
    const preparedRows = [];

    for (const [index, row] of rows.entries()) {
      const upsertValue = String(row?.[upsertField] ?? row?.customFields?.[upsertField] ?? '').trim();

      if (!upsertValue) {
        results[index] = {
          index,
          success: false,
          action: 'skipped',
          reason: 'missing_upsert_value',
          upsertField,
        };
        continue;
      }

      const dedupeKey = `${upsertField}:${upsertValue.toLowerCase()}`;
      if (seen.has(dedupeKey)) {
        results[index] = {
          index,
          success: false,
          action: 'skipped',
          reason: 'duplicate_input_row',
          upsertField,
          upsertValue,
        };
        continue;
      }

      seen.add(dedupeKey);
      preparedRows.push({ row, index, upsertValue });
    }

    const processRow = async ({ row, index, upsertValue }: { row: any; index: number; upsertValue: string }) => {
      try {
        const existing = await findContactByField(client, upsertField, upsertValue);
        const payload = buildBulkContactPayload(row);
        const action = existing ? 'update' : 'create';

        if (!live) {
          return {
            index,
            success: true,
            action: `${action}_preview`,
            upsertField,
            upsertValue,
            id: existing?.id ?? null,
            contact: existing ? normalizeContact(existing, args?.fields) : null,
            postUpsertOperations: {
              addToSegmentId: hasSegmentAssignment ? segmentId : null,
              addTags: tags,
            },
          };
        }

        const response = existing
          ? await client.v1.patch(`/contacts/${existing.id}/edit`, payload)
          : await client.v1.post('/contacts/new', payload);
        const contact = normalizeContact(response.data.contact, args?.fields);

        if (tags.length > 0) {
          await client.v1.patch(`/contacts/${contact.id}/edit`, { tags: tags.join(',') });
        }

        if (hasSegmentAssignment) {
          await client.v1.post(`/segments/${segmentId}/contact/${contact.id}/add`);
        }

        return {
          index,
          success: response.data?.success ?? true,
          action: existing ? 'updated' : 'created',
          upsertField,
          upsertValue,
          id: contact.id,
          contact,
          postUpsertOperations: {
            addToSegmentId: hasSegmentAssignment ? segmentId : null,
            addTags: tags,
          },
        };
      } catch (error) {
        return {
          index,
          success: false,
          action: 'error',
          upsertField,
          upsertValue,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    };

    for (const chunk of chunkArray(preparedRows, batchSize)) {
      const chunkResults = await Promise.all(chunk.map(processRow));
      for (const result of chunkResults) {
        results[result.index] = result;
      }
    }

    const createCount = results.filter(result => result?.action === 'created' || result?.action === 'create_preview').length;
    const updateCount = results.filter(result => result?.action === 'updated' || result?.action === 'update_preview').length;
    const skippedCount = results.filter(result => result?.action === 'skipped').length;
    const errorCount = results.filter(result => result?.action === 'error').length;

    const result = {
      success: errorCount === 0,
      dryRun: !live,
      action: live ? 'bulk_upserted' : 'bulk_upsert_preview',
      upsertField,
      batchSize,
      postUpsertOperations: {
        addToSegmentId: hasSegmentAssignment ? segmentId : null,
        addTags: tags,
      },
      counts: {
        total: rows.length,
        creates: createCount,
        updates: updateCount,
        skipped: skippedCount,
        errors: errorCount,
      },
      requiresConfirmation: !live,
      confirmation: {
        tool: 'bulk_upsert_contacts',
        requiredArgs: { dryRun: false, confirmUpsert: true },
      },
      results,
    };

    return {
      content: [{ type: 'text', text: `Bulk contact upsert ${live ? 'complete' : 'preview; no contacts were changed'}:\n${JSON.stringify(result, null, 2)}` }],
      isError: errorCount > 0,
    };
  },

  async find_duplicates(client: MauticApiClient, args: any) {
    const matchFields = Array.isArray(args?.matchFields) && args.matchFields.length ? args.matchFields : ['email'];
    const requestedMaxContacts = Math.floor(Number(args?.maxContacts ?? 1000));
    const maxContacts = Number.isFinite(requestedMaxContacts) ? Math.min(Math.max(requestedMaxContacts, 1), 5000) : 1000;
    const requestedStart = Math.floor(Number(args?.start ?? 0));
    const initialStart = Number.isFinite(requestedStart) ? Math.max(requestedStart, 0) : 0;
    const requestedLimitGroups = Math.floor(Number(args?.limitGroups ?? 200));
    const limitGroups = Number.isFinite(requestedLimitGroups) ? Math.min(Math.max(requestedLimitGroups, 1), 200) : 200;
    const pageSize = 200;
    const groups = new Map<string, any[]>();
    let scanned = 0;
    let start = initialStart;
    let total: unknown = null;

    while (scanned < maxContacts) {
      const params: any = { start, limit: Math.min(pageSize, maxContacts - scanned) };
      setParam(params, 'search', args?.search);
      const response = await client.v1.get('/contacts', { params });
      const contacts = Object.values(response.data.contacts ?? {});
      total = response.data.total;

      for (const contact of contacts) {
        const fields = normalizedFieldValues(contact);
        for (const field of matchFields) {
          const value = normalizeDuplicateValue(fields[field], field);
          if (!value) continue;
          const key = `${field}:${value}`;
          groups.set(key, [...(groups.get(key) ?? []), contact]);
        }
      }

      scanned += contacts.length;
      start += contacts.length;
      if (contacts.length < params.limit) break;
    }

    const allDuplicateGroups = Array.from(groups.entries())
      .filter(([, contacts]) => contacts.length > 1)
      .map(([key, contacts]) => {
        const [field, ...valueParts] = key.split(':');
        return {
          field,
          value: valueParts.join(':'),
          count: contacts.length,
          ...(args?.summaryOnly === true ? {} : { contacts: contacts.map(contact => normalizeContact(contact, args?.fields)) }),
        };
      });
    const duplicates = allDuplicateGroups.slice(0, limitGroups);
    const nextStart = scanned >= maxContacts && (total === null || start < Number(total)) ? start : null;

    const result = {
      pagination: {
        start: initialStart,
        scanned,
        maxContacts,
        totalAvailable: total,
        hasMore: nextStart !== null,
        nextStart,
      },
      scanned,
      totalAvailable: total,
      duplicateGroupCount: allDuplicateGroups.length,
      returnedDuplicateGroupCount: duplicates.length,
      duplicateContactCount: allDuplicateGroups.reduce((sum, group) => sum + group.count, 0),
      matchFields,
      summaryOnly: args?.summaryOnly === true,
      duplicates,
    };

    return {
      content: [{ type: 'text', text: `Duplicate contact scan complete:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async merge_contacts(client: MauticApiClient, args: any) {
    const {
      primaryContactId,
      secondaryContactId,
      allowEmailOverwrite,
      fields,
    } = args;
    const mergeMode = args?.mergeMode ?? 'managed';
    const strategy = args?.strategy ?? 'fill_blanks';
    const live = args?.dryRun === false && args?.confirmMerge === true;

    if (Number(primaryContactId) === Number(secondaryContactId)) {
      throw new McpError(ErrorCode.InvalidParams, 'primaryContactId and secondaryContactId must be different');
    }

    const primaryResponse = await client.v1.get(`/contacts/${primaryContactId}`);
    const secondaryResponse = await client.v1.get(`/contacts/${secondaryContactId}`);
    const primary = primaryResponse.data.contact;
    const secondary = secondaryResponse.data.contact;

    if (mergeMode === 'native') {
      return nativeMergeContacts(client, args, primary, secondary, live);
    }

    const fieldUpdates = buildMergeFieldUpdates(primary, secondary, strategy, allowEmailOverwrite === true);
    const transferTags = args?.transferTags !== false;
    const transferSegments = args?.transferSegments !== false;
    const transferCompanies = args?.transferCompanies !== false;
    const deleteSecondary = args?.deleteSecondary === true;
    const secondaryTags = transferTags ? currentTagNames(secondary) : [];
    const secondarySegments = transferSegments ? await getContactRelations(client, secondaryContactId, 'segments') : [];
    const secondaryCompanies = transferCompanies ? await getContactRelations(client, secondaryContactId, 'companies') : [];
    const operations: Record<string, unknown>[] = [
      { action: 'update_primary_fields', fieldCount: Object.keys(fieldUpdates).length, fields: Object.keys(fieldUpdates) },
      { action: 'transfer_tags', count: secondaryTags.length, tags: secondaryTags },
      { action: 'transfer_segments', count: secondarySegments.length, segmentIds: secondarySegments.map((segment: any) => segment?.id).filter(Boolean) },
      { action: 'transfer_companies', count: secondaryCompanies.length, companyIds: secondaryCompanies.map((company: any) => company?.id).filter(Boolean) },
      { action: 'delete_secondary', enabled: deleteSecondary },
    ];

    const appliedOperations: Record<string, unknown>[] = [];

    if (live) {
      const failMerge = async (failedOperation: Record<string, unknown>) => {
        const currentPrimaryResponse = await client.v1.get(`/contacts/${primaryContactId}`);
        const result = {
          success: false,
          dryRun: false,
          action: 'managed_merge_partial_failure',
          mergeMode: 'managed_copy_then_optional_delete',
          primaryContactId,
          secondaryContactId,
          strategy,
          operations,
          appliedOperations,
          failedOperation,
          secondaryDeleted: false,
          message: 'Managed merge stopped after a failed operation. The secondary contact was not deleted.',
          primaryContact: normalizeContact(currentPrimaryResponse.data.contact, fields),
          secondaryContact: normalizeContact(secondary, fields),
        };
        return {
          content: [{ type: 'text', text: `Contact merge partially failed:\n${JSON.stringify(result, null, 2)}` }],
          isError: true,
        };
      };

      try {
        if (Object.keys(fieldUpdates).length > 0) {
          await client.v1.patch(`/contacts/${primaryContactId}/edit`, fieldUpdates);
          appliedOperations.push({ action: 'update_primary_fields', success: true, fieldCount: Object.keys(fieldUpdates).length });
        }
      } catch (error) {
        return failMerge({ action: 'update_primary_fields', success: false, error: error instanceof Error ? error.message : String(error) });
      }

      try {
        if (secondaryTags.length > 0) {
          await client.v1.patch(`/contacts/${primaryContactId}/edit`, { tags: secondaryTags.join(',') });
          appliedOperations.push({ action: 'transfer_tags', success: true, count: secondaryTags.length });
        }
      } catch (error) {
        return failMerge({ action: 'transfer_tags', success: false, error: error instanceof Error ? error.message : String(error) });
      }

      for (const segment of secondarySegments) {
        if (!segment?.id) continue;
        try {
          await client.v1.post(`/segments/${segment.id}/contact/${primaryContactId}/add`);
          appliedOperations.push({ action: 'transfer_segment', success: true, segmentId: segment.id });
        } catch (error) {
          return failMerge({ action: 'transfer_segment', success: false, segmentId: segment.id, error: error instanceof Error ? error.message : String(error) });
        }
      }

      for (const company of secondaryCompanies) {
        if (!company?.id) continue;
        try {
          await client.v1.post(`/companies/${company.id}/contact/${primaryContactId}/add`);
          appliedOperations.push({ action: 'transfer_company', success: true, companyId: company.id });
        } catch (error) {
          return failMerge({ action: 'transfer_company', success: false, companyId: company.id, error: error instanceof Error ? error.message : String(error) });
        }
      }

      if (deleteSecondary) {
        try {
          await client.v1.delete(`/contacts/${secondaryContactId}/delete`);
          appliedOperations.push({ action: 'delete_secondary', success: true });
        } catch (error) {
          return failMerge({ action: 'delete_secondary', success: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    const mergedResponse = await client.v1.get(`/contacts/${primaryContactId}`);
    const result = {
      success: true,
      dryRun: !live,
      action: live ? 'managed_merge_applied' : 'managed_merge_preview',
      mergeMode: 'managed_copy_then_optional_delete',
      primaryContactId,
      secondaryContactId,
      strategy,
      operations,
      appliedOperations,
      warnings: [
        'This managed merge does not call an audited native Mautic merge API route.',
        'Activity history, email statistics, and other internal relation merges may differ from the Mautic UI merge behavior.',
      ],
      requiresConfirmation: !live,
      confirmation: {
        tool: 'merge_contacts',
        requiredArgs: { dryRun: false, confirmMerge: true },
      },
      primaryContact: normalizeContact(mergedResponse.data.contact, fields),
      secondaryContact: deleteSecondary && live ? null : normalizeContact(secondary, fields),
    };

    return {
      content: [{ type: 'text', text: `Contact merge ${live ? 'complete' : 'preview; no contacts were changed'}:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async delete_contact(client: MauticApiClient, args: any) {
    const { id, confirmDelete } = args;
    const existing = await client.v1.get(`/contacts/${id}`);
    const contact = normalizeContact(existing.data.contact);

    if (confirmDelete !== true) {
      const result = {
        success: false,
        action: 'delete_rejected',
        id,
        reason: 'confirmation_required',
        contact,
        message: 'Pass confirmDelete: true to delete this contact.',
      };
      return { content: [{ type: 'text', text: `Contact delete rejected:\n${JSON.stringify(result, null, 2)}` }] };
    }

    await client.v1.delete(`/contacts/${id}/delete`);
    const result = buildMutationResult('deleted', id, 'contact', contact);
    return { content: [{ type: 'text', text: `Contact deleted successfully:\n${JSON.stringify(result, null, 2)}` }] };
  },

  async assign_contact_owner(client: MauticApiClient, args: any) {
    const { contactId, ownerId } = args;
    const live = args?.dryRun === false && args?.confirmMutation === true;
    if (!live) {
      const existing = await client.v1.get(`/contacts/${contactId}`);
      const result = {
        success: true,
        dryRun: true,
        action: 'owner_update_preview',
        id: contactId,
        contact: normalizeContact(existing.data.contact),
        ownerId,
        requiresConfirmation: true,
        confirmation: { tool: 'assign_contact_owner', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `Contact owner update preview; no contact was changed:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    const response = await client.v1.patch(`/contacts/${contactId}/edit`, { owner: ownerId });
    const contact = normalizeContact(response.data.contact);
    const result = buildMutationResult('owner_updated', contact.id ?? contactId, 'contact', contact, { ownerId });
    return {
      content: [{ type: 'text', text: `Contact owner updated successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async add_contact_dnc(client: MauticApiClient, args: any) {
    const { contactId, channel, reason, comments, channelId } = args;
    const live = args?.dryRun === false && args?.confirmMutation === true;
    const payload: any = {};
    setParam(payload, 'reason', reason);
    setParam(payload, 'comments', comments);
    setParam(payload, 'channelId', channelId);

    if (!live) {
      const existing = await client.v1.get(`/contacts/${contactId}`);
      const result = {
        success: true,
        dryRun: true,
        action: 'dnc_add_preview',
        id: contactId,
        contact: normalizeContact(existing.data.contact),
        channel,
        payload,
        requiresConfirmation: true,
        confirmation: { tool: 'add_contact_dnc', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `DNC add preview; no contact was changed:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    const response = await client.v1.post(`/contacts/${contactId}/dnc/${encodeURIComponent(channel)}/add`, payload);
    const contact = normalizeContact(response.data.contact);
    const result = buildMutationResult('dnc_added', contact.id ?? contactId, 'contact', contact, { channel });
    return {
      content: [{ type: 'text', text: `DNC added successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async remove_contact_dnc(client: MauticApiClient, args: any) {
    const { contactId, channel } = args;
    const live = args?.dryRun === false && args?.confirmMutation === true;
    if (!live) {
      const existing = await client.v1.get(`/contacts/${contactId}`);
      const result = {
        success: true,
        dryRun: true,
        action: 'dnc_remove_preview',
        id: contactId,
        contact: normalizeContact(existing.data.contact),
        channel,
        requiresConfirmation: true,
        confirmation: { tool: 'remove_contact_dnc', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `DNC removal preview; no contact was changed:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    const response = await client.v1.post(`/contacts/${contactId}/dnc/${encodeURIComponent(channel)}/remove`);
    const contact = normalizeContact(response.data.contact);
    const result = {
      ...buildMutationResult('dnc_removed', contact.id ?? contactId, 'contact', contact, { channel }),
      recordFound: response.data.recordFound,
    };

    return {
      content: [{ type: 'text', text: `DNC removed successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async add_contact_to_segment(client: MauticApiClient, args: any) {
    const { contactId, segmentId } = args;
    const live = args?.dryRun === false && args?.confirmMutation === true;
    if (!live) {
      const existing = await client.v1.get(`/contacts/${contactId}`);
      const segmentResponse = await client.v1.get(`/segments/${segmentId}`);
      const result = {
        success: true,
        dryRun: true,
        action: 'added_to_segment_preview',
        id: contactId,
        membership: { contactId, segmentId },
        contact: normalizeContact(existing.data.contact),
        segment: {
          id: segmentResponse.data.list?.id,
          name: segmentResponse.data.list?.name,
          alias: segmentResponse.data.list?.alias,
        },
        requiresConfirmation: true,
        confirmation: { tool: 'add_contact_to_segment', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `Segment membership add preview; no contact was changed:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    await client.v1.post(`/segments/${segmentId}/contact/${contactId}/add`);
    const result = buildMutationResult('added_to_segment', contactId, 'membership', { contactId, segmentId });
    return {
      content: [{ type: 'text', text: `Contact added to segment successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async remove_contact_from_segment(client: MauticApiClient, args: any) {
    const { contactId, segmentId } = args;
    const live = args?.dryRun === false && args?.confirmMutation === true;
    if (!live) {
      const existing = await client.v1.get(`/contacts/${contactId}`);
      const segmentResponse = await client.v1.get(`/segments/${segmentId}`);
      const result = {
        success: true,
        dryRun: true,
        action: 'removed_from_segment_preview',
        id: contactId,
        membership: { contactId, segmentId },
        contact: normalizeContact(existing.data.contact),
        segment: {
          id: segmentResponse.data.list?.id,
          name: segmentResponse.data.list?.name,
          alias: segmentResponse.data.list?.alias,
        },
        requiresConfirmation: true,
        confirmation: { tool: 'remove_contact_from_segment', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `Segment membership removal preview; no contact was changed:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    await client.v1.post(`/segments/${segmentId}/contact/${contactId}/remove`);
    const result = buildMutationResult('removed_from_segment', contactId, 'membership', { contactId, segmentId });
    return {
      content: [{ type: 'text', text: `Contact removed from segment successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },
};
