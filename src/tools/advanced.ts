import type { MauticApiClient } from '../api/client.js';
import type { ToolDefinition, ToolHandler } from '../types/index.js';
import { buildMutationResult, buildPagination, setLimitedParam, setParam } from './utils.js';

function summarizeContactField(field: any): Record<string, unknown> {
  return {
    id: field?.id,
    label: field?.label,
    alias: field?.alias,
    type: field?.type,
    object: field?.object,
    group: field?.group,
    isRequired: field?.isRequired,
    isPubliclyUpdatable: field?.isPubliclyUpdatable,
    dateAdded: field?.dateAdded,
    dateModified: field?.dateModified,
  };
}

function summarizeStage(stage: any): Record<string, unknown> {
  return {
    id: stage?.id,
    name: stage?.name,
    description: stage?.description,
    weight: stage?.weight,
    isPublished: stage?.isPublished,
    dateAdded: stage?.dateAdded,
    dateModified: stage?.dateModified,
  };
}

function summarizeActivityEvent(event: any): Record<string, unknown> {
  return {
    id: event?.id,
    eventType: event?.eventType,
    eventLabel: event?.eventLabel,
    eventName: event?.eventName,
    timestamp: event?.timestamp,
    dateAdded: event?.dateAdded,
    actionName: event?.actionName,
    campaign: event?.campaign
      ? {
          id: event.campaign?.id,
          name: event.campaign?.name,
        }
      : undefined,
  };
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'add_contact_points',
    description: 'Add points to contact',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'number', description: 'Contact ID' },
        points: { type: 'number', description: 'Number of points to add' },
        eventName: { type: 'string', description: 'Event name' },
        actionName: { type: 'string', description: 'Action name' },
        dryRun: { type: 'boolean', description: 'Preview point change without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to add contact points' },
      },
      required: ['contactId', 'points'],
    },
  },
  {
    name: 'subtract_contact_points',
    description: 'Subtract points from contact',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'number', description: 'Contact ID' },
        points: { type: 'number', description: 'Number of points to subtract' },
        eventName: { type: 'string', description: 'Event name' },
        actionName: { type: 'string', description: 'Action name' },
        dryRun: { type: 'boolean', description: 'Preview point change without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to subtract contact points' },
      },
      required: ['contactId', 'points'],
    },
  },
  {
    name: 'list_stages',
    description: 'Get all lifecycle stages',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic stage payloads instead of compact summaries' },
      },
    },
  },
  {
    name: 'change_contact_stage',
    description: "Change contact's lifecycle stage",
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'number', description: 'Contact ID' },
        stageId: { type: 'number', description: 'Stage ID' },
        dryRun: { type: 'boolean', description: 'Preview stage assignment without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to change contact stage' },
      },
      required: ['contactId', 'stageId'],
    },
  },
  {
    name: 'list_contact_fields',
    description: 'Get all contact custom fields',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic field payloads instead of compact summaries' },
      },
    },
  },
  {
    name: 'create_contact_field',
    description: 'Create new contact custom field',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'Field label' },
        alias: { type: 'string', description: 'Field alias' },
        type: { type: 'string', enum: ['text', 'textarea', 'email', 'number', 'select', 'multiselect', 'boolean', 'date', 'datetime'], description: 'Field type' },
        defaultValue: { type: 'string', description: 'Default value' },
        isRequired: { type: 'boolean', description: 'Is field required' },
        isPubliclyUpdatable: { type: 'boolean', description: 'Can be updated publicly' },
        properties: { type: 'object', description: 'Field type specific properties' },
        dryRun: { type: 'boolean', description: 'Preview field creation without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to create the contact field' },
      },
      required: ['label', 'type'],
    },
  },
  {
    name: 'get_contact_activity',
    description: 'Get contact interaction history',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'number', description: 'Contact ID' },
        search: { type: 'string', description: 'Search term' },
        includeEvents: { type: 'array', items: { type: 'string' }, description: 'Event types to include' },
        excludeEvents: { type: 'array', items: { type: 'string' }, description: 'Event types to exclude' },
        dateFrom: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        dateTo: { type: 'string', description: 'End date (YYYY-MM-DD)' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic activity payloads instead of compact summaries' },
      },
      required: ['contactId'],
    },
  },
];

export const toolHandlers: Record<string, ToolHandler> = {
  async add_contact_points(client: MauticApiClient, args: any) {
    const { contactId, points, eventName, actionName } = args;
    const live = args?.dryRun === false && args?.confirmMutation === true;
    const payload = {
      eventName: eventName || 'API Point Addition',
      actionName: actionName || 'Manual',
      points,
    };

    if (!live) {
      const result = {
        success: true,
        dryRun: true,
        action: 'points_add_preview',
        id: contactId,
        points: { contactId, delta: points, payload },
        requiresConfirmation: true,
        confirmation: { tool: 'add_contact_points', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `Contact points add preview; no contact was changed:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    const response = await client.v1.post(`/contacts/${contactId}/points/plus/${points}`, payload);
    const result = buildMutationResult('points_added', contactId, 'points', {
      contactId,
      points,
      response: response.data,
    });
    return {
      content: [{ type: 'text', text: `Contact points added successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async subtract_contact_points(client: MauticApiClient, args: any) {
    const { contactId, points, eventName, actionName } = args;
    const live = args?.dryRun === false && args?.confirmMutation === true;
    const payload = {
      eventName: eventName || 'API Point Subtraction',
      actionName: actionName || 'Manual',
      points,
    };

    if (!live) {
      const result = {
        success: true,
        dryRun: true,
        action: 'points_subtract_preview',
        id: contactId,
        points: { contactId, delta: -Number(points), payload },
        requiresConfirmation: true,
        confirmation: { tool: 'subtract_contact_points', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `Contact points subtraction preview; no contact was changed:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    const response = await client.v1.post(`/contacts/${contactId}/points/minus/${points}`, payload);
    const result = buildMutationResult('points_subtracted', contactId, 'points', {
      contactId,
      points,
      response: response.data,
    });
    return {
      content: [{ type: 'text', text: `Contact points subtracted successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async list_stages(client: MauticApiClient, args: any) {
    const params: any = {};
    setLimitedParam(params, 'limit', args?.limit, 200);

    const response = await client.v1.get('/stages', { params });
    const rawStages = response.data.stages || response.data;
    const stages = args?.includeRaw === true
      ? rawStages
      : Object.fromEntries(
          Object.entries(rawStages ?? {}).map(([id, stage]) => [id, summarizeStage(stage)]),
        );
    const count = Array.isArray(stages) ? stages.length : Object.keys(stages ?? {}).length;
    const result = {
      pagination: buildPagination(response.data.total, undefined, params.limit, count),
      stages,
    };
    return {
      content: [{ type: 'text', text: `Found ${response.data.total || 0} stages:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async change_contact_stage(client: MauticApiClient, args: any) {
    const { contactId, stageId } = args;
    const live = args?.dryRun === false && args?.confirmMutation === true;
    if (!live) {
      const result = {
        success: true,
        dryRun: true,
        action: 'stage_change_preview',
        id: contactId,
        stageAssignment: { contactId, stageId },
        requiresConfirmation: true,
        confirmation: { tool: 'change_contact_stage', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `Contact stage change preview; no contact was changed:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    const response = await client.v1.post(`/contacts/${contactId}/stages/${stageId}/add`);
    const result = buildMutationResult('stage_changed', contactId, 'stageAssignment', {
      contactId,
      stageId,
      response: response.data,
    });
    return {
      content: [{ type: 'text', text: `Contact stage changed successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async list_contact_fields(client: MauticApiClient, args: any) {
    const params: any = {};
    setLimitedParam(params, 'limit', args?.limit, 200);

    const response = await client.v1.get('/fields/contact', { params });
    const rawFields = response.data.fields || response.data;
    const fields = args?.includeRaw === true
      ? rawFields
      : Object.fromEntries(
          Object.entries(rawFields ?? {}).map(([id, field]) => [id, summarizeContactField(field)]),
        );
    const count = Array.isArray(fields) ? fields.length : Object.keys(fields ?? {}).length;
    const result = {
      pagination: buildPagination(response.data.total, undefined, params.limit, count),
      fields,
    };
    return {
      content: [{ type: 'text', text: `Found ${response.data.total || 0} contact fields:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async create_contact_field(client: MauticApiClient, args: any) {
    const payload: any = {
      label: args.label,
      type: args.type,
      isRequired: args.isRequired || false,
      isPubliclyUpdatable: args.isPubliclyUpdatable || false,
    };
    setParam(payload, 'alias', args.alias);
    setParam(payload, 'defaultValue', args.defaultValue);
    setParam(payload, 'properties', args.properties);

    const live = args?.dryRun === false && args?.confirmMutation === true;
    if (!live) {
      const result = {
        success: true,
        dryRun: true,
        action: 'contact_field_create_preview',
        id: null,
        field: summarizeContactField(payload),
        requiresConfirmation: true,
        confirmation: { tool: 'create_contact_field', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `Contact field create preview; no field was created:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    const response = await client.v1.post('/fields/contact/new', payload);
    const field = summarizeContactField(response.data.field);
    const result = buildMutationResult('created', field.id, 'field', field, { success: response.data?.success ?? true });
    return {
      content: [{ type: 'text', text: `Contact field created successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async get_contact_activity(client: MauticApiClient, args: any) {
    const { contactId, search, includeEvents, excludeEvents, dateFrom, dateTo, limit } = args;
    const params: any = {};
    setParam(params, 'search', search);
    setParam(params, 'includeEvents', includeEvents);
    setParam(params, 'excludeEvents', excludeEvents);
    setParam(params, 'dateFrom', dateFrom);
    setParam(params, 'dateTo', dateTo);
    setLimitedParam(params, 'limit', limit, 200);

    const response = await client.v1.get(`/contacts/${contactId}/activity`, { params });
    const rawEvents = response.data.events ?? {};
    const events = args?.includeRaw === true
      ? rawEvents
      : Object.fromEntries(
          Object.entries(rawEvents).map(([id, event]) => [id, summarizeActivityEvent(event)]),
        );
    return {
      content: [{ type: 'text', text: `Contact activity:\n${JSON.stringify(events, null, 2)}` }],
    };
  },
};
