import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { MauticApiClient } from '../api/client.js';
import type { ToolDefinition, ToolHandler } from '../types/index.js';
import { buildMutationResult, buildPagination, normalizeContacts, setLimitedParam, setNonNegativeParam, setParam } from './utils.js';

function summarizeSegment(segment: any): Record<string, unknown> {
  return {
    id: segment?.id,
    name: segment?.name,
    alias: segment?.alias,
    publicName: segment?.publicName,
    description: segment?.description,
    isPublished: segment?.isPublished,
    isGlobal: segment?.isGlobal,
    filterCount: Array.isArray(segment?.filters) ? segment.filters.length : Object.keys(segment?.filters ?? {}).length,
    dateAdded: segment?.dateAdded,
    dateModified: segment?.dateModified,
  };
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'list_segments',
    description: 'Get all contact segments',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search term' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        start: { type: 'number', description: 'Starting offset' },
        publishedOnly: { type: 'boolean', description: 'Only published segments' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic segment payloads instead of compact summaries' },
      },
    },
  },
  {
    name: 'create_segment',
    description: 'Create a new contact segment',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Segment name' },
        alias: { type: 'string', description: 'Segment alias' },
        description: { type: 'string', description: 'Segment description' },
        isPublished: { type: 'boolean', description: 'Publish immediately' },
        isGlobal: { type: 'boolean', description: 'Global segment' },
        filters: { type: 'array', description: 'Segment filters' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_segment',
    description: 'Get contact segment details',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Segment ID' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic segment payload instead of compact summary' },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_segment_summary',
    description: 'Get compact segment metadata and audience count without paging the full segment',
    inputSchema: {
      type: 'object',
      properties: {
        segmentId: { type: 'number', description: 'Segment ID' },
        sampleLimit: { type: 'number', description: 'Optional number of sample contacts to include, maximum 10' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Contact field aliases to include in samples' },
        includeFilters: { type: 'boolean', description: 'Include raw segment filters for audit/preview use' },
      },
      required: ['segmentId'],
    },
  },
  {
    name: 'update_segment',
    description: 'Update an existing contact segment',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Segment ID' },
        name: { type: 'string', description: 'Segment name' },
        alias: { type: 'string', description: 'Segment alias' },
        description: { type: 'string', description: 'Segment description' },
        isPublished: { type: 'boolean', description: 'Publish segment' },
        isGlobal: { type: 'boolean', description: 'Global segment' },
        filters: { type: 'array', description: 'Segment filters' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_segment',
    description: 'Delete a contact segment; requires explicit confirmation',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Segment ID' },
        confirmDelete: { type: 'boolean', description: 'Must be true to delete the segment' },
      },
      required: ['id', 'confirmDelete'],
    },
  },
  {
    name: 'get_segment_contacts',
    description: 'Get contacts in a specific segment',
    inputSchema: {
      type: 'object',
      properties: {
        segmentId: { type: 'number', description: 'Segment ID' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        start: { type: 'number', description: 'Starting offset' },
        minimal: { type: 'boolean', description: 'Return normalized contact data instead of full Mautic metadata' },
        fieldsOnly: { type: 'boolean', description: 'Return only normalized contact field values plus id' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Field aliases to include when minimal or fieldsOnly is true' },
      },
      required: ['segmentId'],
    },
  },
];

export const toolHandlers: Record<string, ToolHandler> = {
  async list_segments(client: MauticApiClient, args: any) {
    const params: any = {};
    setParam(params, 'search', args?.search);
    setLimitedParam(params, 'limit', args?.limit, 200);
    setNonNegativeParam(params, 'start', args?.start);
    setParam(params, 'publishedOnly', args?.publishedOnly);

    const response = await client.v1.get('/segments', { params });
    const rawSegments = response.data.lists ?? {};
    const segments = args?.includeRaw === true
      ? rawSegments
      : Object.fromEntries(
          Object.entries(rawSegments).map(([id, segment]) => [id, summarizeSegment(segment)]),
        );
    const result = {
      pagination: buildPagination(response.data.total, params.start, params.limit, Object.keys(segments).length),
      segments,
    };
    return {
      content: [{ type: 'text', text: `Found ${response.data.total} segments:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async create_segment(client: MauticApiClient, args: any) {
    const response = await client.v1.post('/segments/new', args);
    const segment = summarizeSegment(response.data.list);
    const result = buildMutationResult('created', segment.id, 'segment', segment, { success: response.data?.success ?? true });
    return {
      content: [{ type: 'text', text: `Segment created successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async get_segment(client: MauticApiClient, args: any) {
    const { id } = args;
    const response = await client.v1.get(`/segments/${id}`);
    const segment = args?.includeRaw === true ? response.data.list : summarizeSegment(response.data.list);
    return {
      content: [{ type: 'text', text: `Segment details:\n${JSON.stringify(segment, null, 2)}` }],
    };
  },

  async get_segment_summary(client: MauticApiClient, args: any) {
    const { segmentId, fields, includeFilters } = args;
    const sampleLimit = Math.min(Number(args?.sampleLimit ?? 0), 10);
    const segmentResponse = await client.v1.get(`/segments/${segmentId}`);
    const segmentRaw = segmentResponse.data.list;
    const segment = summarizeSegment(segmentRaw);

    if (!segmentRaw?.alias) {
      throw new McpError(ErrorCode.InvalidParams, `No segment alias found for segment ID ${segmentId}`);
    }

    const params = {
      search: `segment:${segmentRaw.alias}`,
      limit: Math.max(sampleLimit, 1),
    };
    const contactsResponse = await client.v1.get('/contacts', { params });
    const sampleContacts = sampleLimit > 0
      ? normalizeContacts(contactsResponse.data.contacts, fields).slice(0, sampleLimit)
      : [];
    const count = Array.isArray(sampleContacts) ? sampleContacts.length : Object.keys(sampleContacts ?? {}).length;
    const result = {
      segment: {
        ...segment,
        ...(includeFilters === true ? { filters: segmentRaw.filters ?? [] } : {}),
      },
      audienceCount: Number(contactsResponse.data.total ?? 0),
      sampleContacts,
      pagination: buildPagination(contactsResponse.data.total, 0, params.limit, count),
    };

    return {
      content: [{ type: 'text', text: `Segment ${segmentRaw.alias} summary:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async update_segment(client: MauticApiClient, args: any) {
    const { id, ...updateData } = args;
    const response = await client.v1.patch(`/segments/${id}/edit`, updateData);
    const segment = summarizeSegment(response.data.list);
    const result = buildMutationResult('updated', segment.id ?? id, 'segment', segment, { success: response.data?.success ?? true });
    return {
      content: [{ type: 'text', text: `Segment updated successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async delete_segment(client: MauticApiClient, args: any) {
    const { id, confirmDelete } = args;
    const existing = await client.v1.get(`/segments/${id}`);

    if (confirmDelete !== true) {
      const result = {
        success: false,
        action: 'delete_rejected',
        id,
        reason: 'confirmation_required',
        segment: summarizeSegment(existing.data.list),
        message: 'Pass confirmDelete: true to delete this segment.',
      };
      return {
        content: [{ type: 'text', text: `Segment delete rejected:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    await client.v1.delete(`/segments/${id}/delete`);
    const result = buildMutationResult('deleted', id, 'segment', summarizeSegment(existing.data.list));
    return {
      content: [{ type: 'text', text: `Segment deleted successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async get_segment_contacts(client: MauticApiClient, args: any) {
    const { segmentId, limit, start, minimal, fieldsOnly, fields } = args;
    const params: any = {};
    setLimitedParam(params, 'limit', limit, 200);
    setNonNegativeParam(params, 'start', start);

    const segmentsResponse = await client.v1.get('/segments', { params: { limit: 200 } });
    const segments = Object.values(segmentsResponse.data.lists ?? {}) as any[];
    const segment = segments.find((item: any) => Number(item.id) === Number(segmentId));

    if (!segment?.alias) {
      throw new McpError(ErrorCode.InvalidParams, `No segment alias found for segment ID ${segmentId}`);
    }

    params.search = `segment:${segment.alias}`;

    const response = await client.v1.get('/contacts', { params });
    const includeRaw = args?.includeRaw === true || minimal === false;
    const contacts = fieldsOnly
      ? normalizeContacts(response.data.contacts, fields).map(contact => ({ id: contact.id, fields: contact.fields }))
      : includeRaw
        ? response.data.contacts
        : normalizeContacts(response.data.contacts, fields);
    const count = Array.isArray(contacts) ? contacts.length : Object.keys(contacts ?? {}).length;
    const result = {
      pagination: buildPagination(response.data.total, params.start, params.limit, count),
      segment: { id: segment.id, alias: segment.alias, name: segment.name },
      contacts,
    };

    return {
      content: [{ type: 'text', text: `Found ${response.data.total} contacts in segment ${segment.alias}:\n${JSON.stringify(result, null, 2)}` }],
    };
  },
};
