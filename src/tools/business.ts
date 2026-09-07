import type { MauticApiClient } from '../api/client.js';
import type { ToolDefinition, ToolHandler } from '../types/index.js';
import { buildMutationResult, buildPagination, normalizeContact, setLimitedParam, setNonNegativeParam, setParam } from './utils.js';

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'list_companies',
    description: 'Get all companies',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search term' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        start: { type: 'number', description: 'Starting offset' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic company payloads instead of compact summaries' },
      },
    },
  },
  {
    name: 'create_company',
    description: 'Create new company',
    inputSchema: {
      type: 'object',
      properties: {
        companyname: { type: 'string', description: 'Company name' },
        companyemail: { type: 'string', description: 'Company email' },
        companyphone: { type: 'string', description: 'Company phone' },
        companyaddress1: { type: 'string', description: 'Address line 1' },
        companyaddress2: { type: 'string', description: 'Address line 2' },
        companycity: { type: 'string', description: 'City' },
        companystate: { type: 'string', description: 'State' },
        companyzipcode: { type: 'string', description: 'Zip code' },
        companycountry: { type: 'string', description: 'Country' },
        companywebsite: { type: 'string', description: 'Website URL' },
        dryRun: { type: 'boolean', description: 'Preview company creation without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to create the company' },
      },
      required: ['companyname'],
    },
  },
  {
    name: 'add_contact_to_company',
    description: 'Associate contact with company',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'number', description: 'Contact ID' },
        companyId: { type: 'number', description: 'Company ID' },
        dryRun: { type: 'boolean', description: 'Preview company association without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to associate contact with company' },
      },
      required: ['contactId', 'companyId'],
    },
  },
  {
    name: 'create_note',
    description: 'Add note to contact or company',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Note text' },
        type: { type: 'string', enum: ['general', 'email', 'call', 'meeting'], description: 'Note type' },
        contactId: { type: 'number', description: 'Contact ID (if adding to contact)' },
        companyId: { type: 'number', description: 'Company ID (if adding to company)' },
        dryRun: { type: 'boolean', description: 'Preview note creation without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to create the note' },
      },
      required: ['text', 'type'],
    },
  },
  {
    name: 'get_contact_notes',
    description: 'Get all notes for a contact',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'number', description: 'Contact ID' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic note payloads instead of compact summaries' },
      },
      required: ['contactId'],
    },
  },
  {
    name: 'list_tags',
    description: 'Get all available tags',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search term' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic tag payloads instead of compact summaries' },
      },
    },
  },
  {
    name: 'create_tag',
    description: 'Create new tag',
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Tag name' },
        dryRun: { type: 'boolean', description: 'Preview tag creation without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to create the tag' },
      },
      required: ['tag'],
    },
  },
  {
    name: 'add_contact_tags',
    description: 'Add tags to contact using the Mautic v1 contact edit endpoint',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'number', description: 'Contact ID' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Array of tag names' },
        dryRun: { type: 'boolean', description: 'Preview tag add without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to add tags' },
      },
      required: ['contactId', 'tags'],
    },
  },
  {
    name: 'remove_contact_tags',
    description: 'Remove tags from contact using the Mautic v1 contact edit endpoint',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'number', description: 'Contact ID' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Array of tag names to remove' },
        dryRun: { type: 'boolean', description: 'Preview tag removal without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to remove tags' },
      },
      required: ['contactId', 'tags'],
    },
  },
  {
    name: 'list_categories',
    description: 'Get all categories',
    inputSchema: {
      type: 'object',
      properties: {
        bundle: { type: 'string', description: 'Category type (asset, email, etc.)' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic category payloads instead of compact summaries' },
      },
    },
  },
  {
    name: 'create_category',
    description: 'Create new category',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Category title' },
        alias: { type: 'string', description: 'Category alias' },
        description: { type: 'string', description: 'Category description' },
        bundle: { type: 'string', description: 'Category type' },
        color: { type: 'string', description: 'Hex color code' },
        dryRun: { type: 'boolean', description: 'Preview category creation without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to create the category' },
      },
      required: ['title', 'bundle'],
    },
  },
];

function normalizeTagNames(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .map(tag => String(tag).trim())
    .filter(Boolean);
}

function currentTagNames(contact: any): string[] {
  const tags = contact?.tags;

  if (Array.isArray(tags)) {
    return tags.map((tag: any) => String(tag?.tag ?? tag?.name ?? tag)).filter(Boolean);
  }

  return Object.values(tags ?? {}).map((tag: any) => String(tag?.tag ?? tag?.name ?? tag)).filter(Boolean);
}

function tagMutationResult(contactId: number, requestedTags: string[], contact: any): Record<string, unknown> {
  return buildMutationResult('tags_updated', contactId, 'contact', normalizeContact(contact), {
    requestedTags,
    currentTags: currentTagNames(contact),
  });
}

function summarizeCompany(company: any): Record<string, unknown> {
  return {
    id: company?.id,
    companyname: company?.companyname,
    companyemail: company?.companyemail,
    companywebsite: company?.companywebsite,
    companycity: company?.companycity,
    companycountry: company?.companycountry,
    dateAdded: company?.dateAdded,
    dateModified: company?.dateModified,
  };
}

function summarizeNote(note: any): Record<string, unknown> {
  return {
    id: note?.id,
    type: note?.type,
    text: note?.text,
    dateAdded: note?.dateAdded,
    dateModified: note?.dateModified,
  };
}

function summarizeTag(tag: any): Record<string, unknown> {
  return {
    id: tag?.id,
    tag: tag?.tag,
    dateAdded: tag?.dateAdded,
    dateModified: tag?.dateModified,
  };
}

function summarizeCategory(category: any): Record<string, unknown> {
  return {
    id: category?.id,
    title: category?.title,
    alias: category?.alias,
    bundle: category?.bundle,
    color: category?.color,
  };
}

export const toolHandlers: Record<string, ToolHandler> = {
  async list_companies(client: MauticApiClient, args: any) {
    const params: any = {};
    setParam(params, 'search', args?.search);
    setLimitedParam(params, 'limit', args?.limit, 200);
    setNonNegativeParam(params, 'start', args?.start);

    const response = await client.v1.get('/companies', { params });
    const rawCompanies = response.data.companies || response.data;
    const companies = args?.includeRaw === true
      ? rawCompanies
      : Object.fromEntries(
          Object.entries(rawCompanies ?? {}).map(([id, company]) => [id, summarizeCompany(company)]),
        );
    const count = Array.isArray(companies) ? companies.length : Object.keys(companies ?? {}).length;
    const result = {
      pagination: buildPagination(response.data.total, params.start, params.limit, count),
      companies,
    };
    return {
      content: [{ type: 'text', text: `Found ${response.data.total || 0} companies:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async create_company(client: MauticApiClient, args: any) {
    const { dryRun: _dryRun, confirmMutation: _confirmMutation, ...payload } = args;
    const live = args?.dryRun === false && args?.confirmMutation === true;
    if (!live) {
      const result = {
        success: true,
        dryRun: true,
        action: 'company_create_preview',
        id: null,
        company: summarizeCompany(payload),
        requiresConfirmation: true,
        confirmation: { tool: 'create_company', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `Company create preview; no company was created:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    const response = await client.v1.post('/companies/new', payload);
    const company = summarizeCompany(response.data.company);
    const result = buildMutationResult('created', company.id, 'company', company, { success: response.data?.success ?? true });
    return {
      content: [{ type: 'text', text: `Company created successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async add_contact_to_company(client: MauticApiClient, args: any) {
    const { contactId, companyId } = args;
    const live = args?.dryRun === false && args?.confirmMutation === true;
    if (!live) {
      const result = {
        success: true,
        dryRun: true,
        action: 'added_to_company_preview',
        id: contactId,
        membership: { contactId, companyId },
        requiresConfirmation: true,
        confirmation: { tool: 'add_contact_to_company', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `Company association preview; no contact was changed:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    await client.v1.post(`/companies/${companyId}/contact/${contactId}/add`);
    const result = buildMutationResult('added_to_company', contactId, 'membership', { contactId, companyId });
    return {
      content: [{ type: 'text', text: `Contact added to company successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async create_note(client: MauticApiClient, args: any) {
    const payload: any = { text: args.text, type: args.type || 'general' };
    setParam(payload, 'contact', args.contactId);
    setParam(payload, 'company', args.companyId);

    const live = args?.dryRun === false && args?.confirmMutation === true;
    if (!live) {
      const result = {
        success: true,
        dryRun: true,
        action: 'note_create_preview',
        id: null,
        note: summarizeNote(payload),
        requiresConfirmation: true,
        confirmation: { tool: 'create_note', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `Note create preview; no note was created:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    const response = await client.v1.post('/notes/new', payload);
    const note = summarizeNote(response.data.note);
    const result = buildMutationResult('created', note.id, 'note', note, { success: response.data?.success ?? true });
    return {
      content: [{ type: 'text', text: `Note created successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async get_contact_notes(client: MauticApiClient, args: any) {
    const { contactId, limit } = args;
    const params: any = {};
    setLimitedParam(params, 'limit', limit, 200);

    const response = await client.v1.get(`/contacts/${contactId}/notes`, { params });
    const rawNotes = response.data.notes || response.data;
    const notes = args?.includeRaw === true
      ? rawNotes
      : Object.fromEntries(
          Object.entries(rawNotes ?? {}).map(([id, note]) => [id, summarizeNote(note)]),
        );
    const count = Array.isArray(notes) ? notes.length : Object.keys(notes ?? {}).length;
    const result = {
      pagination: buildPagination(response.data.total, undefined, params.limit, count),
      notes,
    };
    return {
      content: [{ type: 'text', text: `Contact ${contactId} notes:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async list_tags(client: MauticApiClient, args: any) {
    const params: any = {};
    setParam(params, 'search', args?.search);
    setLimitedParam(params, 'limit', args?.limit, 200);

    const response = await client.v1.get('/tags', { params });
    const rawTags = response.data.tags || response.data;
    const tags = args?.includeRaw === true
      ? rawTags
      : Object.fromEntries(
          Object.entries(rawTags ?? {}).map(([id, tag]) => [id, summarizeTag(tag)]),
        );
    const count = Array.isArray(tags) ? tags.length : Object.keys(tags ?? {}).length;
    const result = {
      pagination: buildPagination(response.data.total, undefined, params.limit, count),
      tags,
    };
    return {
      content: [{ type: 'text', text: `Found ${response.data.total || 0} tags:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async create_tag(client: MauticApiClient, args: any) {
    const live = args?.dryRun === false && args?.confirmMutation === true;
    if (!live) {
      const result = {
        success: true,
        dryRun: true,
        action: 'tag_create_preview',
        id: null,
        tag: { tag: args.tag },
        requiresConfirmation: true,
        confirmation: { tool: 'create_tag', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `Tag create preview; no tag was created:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    const response = await client.v1.post('/tags/new', { tag: args.tag });
    const tag = summarizeTag(response.data.tag);
    const result = buildMutationResult('created', tag.id, 'tag', tag, { success: response.data?.success ?? true });
    return {
      content: [{ type: 'text', text: `Tag created successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async add_contact_tags(client: MauticApiClient, args: any) {
    const { contactId } = args;
    const tags = normalizeTagNames(args.tags);
    const live = args?.dryRun === false && args?.confirmMutation === true;

    if (!tags.length) {
      return {
        content: [{ type: 'text', text: 'No tags provided. Provide at least one non-empty tag name.' }],
      };
    }

    if (!live) {
      const result = {
        success: true,
        dryRun: true,
        action: 'tags_add_preview',
        id: contactId,
        tags,
        requiresConfirmation: true,
        confirmation: { tool: 'add_contact_tags', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `Contact tag add preview; no contact was changed:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    const response = await client.v1.patch(`/contacts/${contactId}/edit`, { tags: tags.join(',') });
    const result = {
      ...tagMutationResult(contactId, tags, response.data.contact),
      action: 'tags_added',
    };

    return {
      content: [{ type: 'text', text: `Tags added to contact ${contactId} successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async remove_contact_tags(client: MauticApiClient, args: any) {
    const { contactId } = args;
    const tags = normalizeTagNames(args.tags);
    const live = args?.dryRun === false && args?.confirmMutation === true;

    if (!tags.length) {
      return {
        content: [{ type: 'text', text: 'No tags provided. Provide at least one non-empty tag name.' }],
      };
    }

    if (!live) {
      const result = {
        success: true,
        dryRun: true,
        action: 'tags_remove_preview',
        id: contactId,
        tags,
        requiresConfirmation: true,
        confirmation: { tool: 'remove_contact_tags', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `Contact tag removal preview; no contact was changed:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    const response = await client.v1.patch(`/contacts/${contactId}/edit`, {
      tags: tags.map((tag: string) => `-${tag}`).join(','),
    });
    const result = {
      ...tagMutationResult(contactId, tags, response.data.contact),
      action: 'tags_removed',
    };

    return {
      content: [{ type: 'text', text: `Tags removed from contact ${contactId} successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async list_categories(client: MauticApiClient, args: any) {
    const params: any = {};
    setParam(params, 'bundle', args?.bundle);
    setLimitedParam(params, 'limit', args?.limit, 200);

    const response = await client.v1.get('/categories', { params });
    const rawCategories = response.data.categories || response.data;
    const categories = args?.includeRaw === true
      ? rawCategories
      : Object.fromEntries(
          Object.entries(rawCategories ?? {}).map(([id, category]) => [id, summarizeCategory(category)]),
        );
    const count = Array.isArray(categories) ? categories.length : Object.keys(categories ?? {}).length;
    const result = {
      pagination: buildPagination(response.data.total, undefined, params.limit, count),
      categories,
    };
    return {
      content: [{ type: 'text', text: `Found ${response.data.total || 0} categories:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async create_category(client: MauticApiClient, args: any) {
    const { dryRun: _dryRun, confirmMutation: _confirmMutation, ...payload } = args;
    const live = args?.dryRun === false && args?.confirmMutation === true;
    if (!live) {
      const result = {
        success: true,
        dryRun: true,
        action: 'category_create_preview',
        id: null,
        category: summarizeCategory(payload),
        requiresConfirmation: true,
        confirmation: { tool: 'create_category', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `Category create preview; no category was created:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    const response = await client.v1.post('/categories/new', payload);
    const category = summarizeCategory(response.data.category);
    const result = buildMutationResult('created', category.id, 'category', category, { success: response.data?.success ?? true });
    return {
      content: [{ type: 'text', text: `Category created successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },
};
