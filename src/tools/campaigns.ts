import type { MauticApiClient } from '../api/client.js';
import type { ToolDefinition, ToolHandler } from '../types/index.js';
import { buildMutationResult, buildPagination, normalizeContact, setLimitedParam, setNonNegativeParam, setParam, summarizePayload } from './utils.js';

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');
}

function normalizeChart(chart: any): Record<string, unknown> {
  const labels = Array.isArray(chart?.labels) ? chart.labels : [];
  const datasets = Array.isArray(chart?.datasets) ? chart.datasets : [];

  return {
    labels,
    datasets: datasets.map((dataset: any) => {
      const data = Array.isArray(dataset?.data) ? dataset.data.map((value: unknown) => Number(value ?? 0)) : [];

      return {
        label: dataset?.label ?? null,
        data,
        total: data.reduce((sum: number, value: number) => sum + value, 0),
      };
    }),
  };
}

function extractChartsFromHtml(html: string): Record<string, unknown>[] {
  return Array.from(html.matchAll(/<canvas[^>]*>([\s\S]*?)<\/canvas>/g))
    .map(match => decodeHtmlEntities(match[1].trim()))
    .filter(Boolean)
    .map((raw, index) => {
      try {
        return normalizeChart(JSON.parse(raw));
      } catch (error) {
        return {
          index,
          parseError: error instanceof Error ? error.message : 'Failed to parse chart data',
          rawPreview: raw.slice(0, 120),
        };
      }
    });
}

function readAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`${name}="([^"]*)"`));
  return match ? decodeHtmlEntities(match[1]) : null;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

const EVENT_BUILDER_PROPERTY_KEYS = new Set([
  '_token',
  'anchor',
  'anchorEventType',
  'buttons',
  'campaignId',
  'canvasSettings',
  'changes',
  'contactLog',
  'deleted',
  'description',
  'eventType',
  'failedCount',
  'id',
  'label',
  'name',
  'order',
  'tempId',
  'triggerDate',
  'triggerHour',
  'triggerInterval',
  'triggerIntervalUnit',
  'triggerMode',
  'triggerRestrictedDaysOfWeek',
  'triggerRestrictedStartHour',
  'triggerRestrictedStopHour',
  'triggerWindow',
  'type',
  'uuid',
]);

function flattenActionProperties(properties: any): Record<string, unknown> | null {
  if (!properties || typeof properties !== 'object') return null;

  const eventSpecificProperties = properties.properties && typeof properties.properties === 'object' ? properties.properties : {};
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(eventSpecificProperties)) {
    sanitized[key] = value;
  }

  for (const [key, value] of Object.entries(properties)) {
    if (EVENT_BUILDER_PROPERTY_KEYS.has(key) || key === 'properties') continue;
    if (sanitized[key] !== undefined) continue;
    sanitized[key] = value;
  }

  return Object.keys(sanitized).length ? sanitized : null;
}

function normalizeCampaignEvent(event: any, includeRaw = false): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    id: event?.id ?? null,
    name: event?.name ?? null,
    type: event?.type ?? null,
    eventType: event?.eventType ?? null,
    channel: event?.channel ?? null,
    channelId: event?.channelId ?? null,
    order: event?.order ?? null,
    triggerMode: event?.triggerMode ?? null,
    triggerInterval: event?.triggerInterval ?? null,
    triggerIntervalUnit: event?.triggerIntervalUnit ?? null,
    decisionPath: event?.decisionPath ?? null,
    parentId: event?.parent?.id ?? null,
    childIds: Array.isArray(event?.children) ? event.children.map((child: any) => child?.id).filter((id: unknown) => id != null) : [],
  };

  const properties = flattenActionProperties(event?.properties);
  if (properties) normalized.properties = properties;
  if (includeRaw) normalized.raw = event;

  return normalized;
}

function normalizeCampaign(campaign: any, options: { includeEvents?: boolean; includeCanvas?: boolean; includeRaw?: boolean } = {}): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    id: campaign?.id ?? null,
    name: campaign?.name ?? null,
    isPublished: campaign?.isPublished ?? null,
    description: campaign?.description ? stripTags(String(campaign.description)) : null,
    category: campaign?.category
      ? {
          id: campaign.category.id ?? null,
          title: campaign.category.title ?? null,
          alias: campaign.category.alias ?? null,
        }
      : null,
    allowRestart: campaign?.allowRestart ?? null,
    publishUp: campaign?.publishUp ?? null,
    publishDown: campaign?.publishDown ?? null,
    dateAdded: campaign?.dateAdded ?? null,
    dateModified: campaign?.dateModified ?? null,
    createdBy: campaign?.createdBy ?? null,
    createdByUser: campaign?.createdByUser ?? null,
    modifiedBy: campaign?.modifiedBy ?? null,
    modifiedByUser: campaign?.modifiedByUser ?? null,
    eventCount: Array.isArray(campaign?.events) ? campaign.events.length : 0,
    formCount: Array.isArray(campaign?.forms) ? campaign.forms.length : 0,
    segmentCount: Array.isArray(campaign?.lists) ? campaign.lists.length : 0,
    segments: Array.isArray(campaign?.lists)
      ? campaign.lists.map((segment: any) => ({
          id: segment?.id ?? null,
          name: segment?.name ?? null,
          alias: segment?.alias ?? null,
        }))
      : [],
    forms: Array.isArray(campaign?.forms)
      ? campaign.forms.map((form: any) => ({
          id: form?.id ?? null,
          name: form?.name ?? null,
          alias: form?.alias ?? null,
        }))
      : [],
  };

  if (options.includeEvents) {
    normalized.events = Array.isArray(campaign?.events) ? campaign.events.map((event: any) => normalizeCampaignEvent(event, options.includeRaw)) : [];
  }
  if (options.includeCanvas) normalized.canvasSettings = campaign?.canvasSettings ?? null;
  if (options.includeRaw) normalized.raw = campaign;

  return normalized;
}

function sourceId(value: any): string | null {
  return value === undefined || value === null ? null : String(value);
}

function mapCanvasId(value: any, eventIdMap: Map<string, string>): any {
  const id = sourceId(value);
  return id && eventIdMap.has(id) ? eventIdMap.get(id) : value;
}

function cloneCampaignCanvasSettings(canvasSettings: any, eventIdMap: Map<string, string>): any {
  if (!canvasSettings || typeof canvasSettings !== 'object') return undefined;

  return {
    ...canvasSettings,
    nodes: Array.isArray(canvasSettings.nodes)
      ? canvasSettings.nodes.map((node: any) => ({
          ...node,
          id: mapCanvasId(node?.id, eventIdMap),
        }))
      : canvasSettings.nodes,
    connections: Array.isArray(canvasSettings.connections)
      ? canvasSettings.connections.map((connection: any) => ({
          ...connection,
          sourceId: mapCanvasId(connection?.sourceId, eventIdMap),
          targetId: mapCanvasId(connection?.targetId, eventIdMap),
        }))
      : canvasSettings.connections,
  };
}

function cloneCampaignEventProperties(event: any): Record<string, unknown> {
  const properties = event?.properties;
  if (!properties || typeof properties !== 'object') return {};

  const eventSpecificProperties = properties.properties && typeof properties.properties === 'object' ? properties.properties : null;
  if (eventSpecificProperties) {
    return { ...eventSpecificProperties };
  }

  return flattenActionProperties(properties) ?? {};
}

function buildCampaignClonePayload(source: any): Record<string, unknown> {
  const events = Array.isArray(source?.events) ? source.events : [];
  const eventIdMap = new Map<string, string>();
  events.forEach((event: any, index: number) => {
    const id = sourceId(event?.id);
    if (id) eventIdMap.set(id, `new${index + 1}`);
  });

  const clonedEvents = events.map((event: any, index: number) => {
    const clonedEvent: Record<string, unknown> = {
      id: `new${index + 1}`,
      name: event?.name ?? '',
      type: event?.type,
      eventType: event?.eventType,
      order: event?.order,
      properties: cloneCampaignEventProperties(event),
      triggerMode: event?.triggerMode,
    };

    setParam(clonedEvent, 'triggerDate', event?.triggerDate);
    setParam(clonedEvent, 'triggerInterval', event?.triggerInterval);
    setParam(clonedEvent, 'triggerIntervalUnit', event?.triggerIntervalUnit);
    setParam(clonedEvent, 'triggerHour', event?.triggerHour);
    setParam(clonedEvent, 'triggerRestrictedStartHour', event?.triggerRestrictedStartHour);
    setParam(clonedEvent, 'triggerRestrictedStopHour', event?.triggerRestrictedStopHour);
    setParam(clonedEvent, 'triggerRestrictedDaysOfWeek', event?.triggerRestrictedDaysOfWeek);
    setParam(clonedEvent, 'decisionPath', event?.decisionPath);

    const parentId = sourceId(event?.parent?.id);
    if (parentId && eventIdMap.has(parentId)) {
      clonedEvent.parent = { id: eventIdMap.get(parentId) };
    }

    return clonedEvent;
  });

  const payload: Record<string, unknown> = {
    name: source?.name,
    description: source?.description ?? '',
    isPublished: false,
    allowRestart: source?.allowRestart ?? false,
  };

  setParam(payload, 'publishUp', source?.publishUp);
  setParam(payload, 'publishDown', source?.publishDown);
  if (source?.category?.id) payload.category = source.category.id;
  if (clonedEvents.length) payload.events = clonedEvents;
  if (Array.isArray(source?.lists) && source.lists.length) payload.lists = source.lists.map((segment: any) => ({ id: segment.id }));
  if (Array.isArray(source?.forms) && source.forms.length) payload.forms = source.forms.map((form: any) => ({ id: form.id }));

  const canvasSettings = cloneCampaignCanvasSettings(source?.canvasSettings, eventIdMap);
  setParam(payload, 'canvasSettings', canvasSettings);

  return payload;
}

function buildManagedCampaignExport(source: any): Record<string, unknown> {
  return {
    schema: 'helio-mautic-managed-campaign-export',
    schemaVersion: 1,
    sourceMauticVersionNote: 'Export shape tested with Mautic 6.0.7',
    exportedAt: new Date().toISOString(),
    campaign: {
      name: source?.name,
      description: source?.description ?? '',
      isPublished: false,
      allowRestart: source?.allowRestart ?? false,
      publishUp: source?.publishUp ?? null,
      publishDown: source?.publishDown ?? null,
      category: source?.category
        ? {
            id: source.category.id ?? null,
            title: source.category.title ?? null,
            alias: source.category.alias ?? null,
          }
        : null,
      segments: Array.isArray(source?.lists)
        ? source.lists.map((segment: any) => ({
            id: segment?.id ?? null,
            name: segment?.name ?? null,
            alias: segment?.alias ?? null,
          }))
        : [],
      forms: Array.isArray(source?.forms)
        ? source.forms.map((form: any) => ({
            id: form?.id ?? null,
            name: form?.name ?? null,
            alias: form?.alias ?? null,
          }))
        : [],
      events: Array.isArray(source?.events)
        ? source.events.map((event: any) => ({
            id: event?.id,
            name: event?.name ?? '',
            type: event?.type,
            eventType: event?.eventType,
            order: event?.order,
            properties: cloneCampaignEventProperties(event),
            triggerMode: event?.triggerMode,
            triggerDate: event?.triggerDate ?? null,
            triggerInterval: event?.triggerInterval ?? null,
            triggerIntervalUnit: event?.triggerIntervalUnit ?? null,
            triggerHour: event?.triggerHour ?? null,
            triggerRestrictedStartHour: event?.triggerRestrictedStartHour ?? null,
            triggerRestrictedStopHour: event?.triggerRestrictedStopHour ?? null,
            triggerRestrictedDaysOfWeek: event?.triggerRestrictedDaysOfWeek ?? [],
            decisionPath: event?.decisionPath ?? null,
            parentId: event?.parent?.id ?? null,
          }))
        : [],
      canvasSettings: source?.canvasSettings ?? null,
    },
  };
}

function buildCampaignPayloadFromManagedExport(exportData: any): Record<string, unknown> {
  const campaign = exportData?.campaign ?? exportData;
  const events = Array.isArray(campaign?.events) ? campaign.events : [];
  const eventIdMap = new Map<string, string>();
  events.forEach((event: any, index: number) => {
    const id = sourceId(event?.id);
    if (id) eventIdMap.set(id, `new${index + 1}`);
  });

  const clonedEvents = events.map((event: any, index: number) => {
    const clonedEvent: Record<string, unknown> = {
      id: `new${index + 1}`,
      name: event?.name ?? '',
      type: event?.type,
      eventType: event?.eventType,
      order: event?.order,
      properties: event?.properties ?? {},
      triggerMode: event?.triggerMode,
    };

    setParam(clonedEvent, 'triggerDate', event?.triggerDate);
    setParam(clonedEvent, 'triggerInterval', event?.triggerInterval);
    setParam(clonedEvent, 'triggerIntervalUnit', event?.triggerIntervalUnit);
    setParam(clonedEvent, 'triggerHour', event?.triggerHour);
    setParam(clonedEvent, 'triggerRestrictedStartHour', event?.triggerRestrictedStartHour);
    setParam(clonedEvent, 'triggerRestrictedStopHour', event?.triggerRestrictedStopHour);
    setParam(clonedEvent, 'triggerRestrictedDaysOfWeek', event?.triggerRestrictedDaysOfWeek);
    setParam(clonedEvent, 'decisionPath', event?.decisionPath);

    const parentId = sourceId(event?.parentId);
    if (parentId && eventIdMap.has(parentId)) {
      clonedEvent.parent = { id: eventIdMap.get(parentId) };
    }

    return clonedEvent;
  });

  const payload: Record<string, unknown> = {
    name: campaign?.name,
    description: campaign?.description ?? '',
    isPublished: false,
    allowRestart: campaign?.allowRestart ?? false,
  };

  setParam(payload, 'publishUp', campaign?.publishUp);
  setParam(payload, 'publishDown', campaign?.publishDown);
  if (campaign?.category?.id) payload.category = campaign.category.id;
  if (clonedEvents.length) payload.events = clonedEvents;
  if (Array.isArray(campaign?.segments) && campaign.segments.length) payload.lists = campaign.segments.map((segment: any) => ({ id: segment.id }));
  if (Array.isArray(campaign?.forms) && campaign.forms.length) payload.forms = campaign.forms.map((form: any) => ({ id: form.id }));
  setParam(payload, 'canvasSettings', cloneCampaignCanvasSettings(campaign?.canvasSettings, eventIdMap));

  return payload;
}

function verifyManagedCampaign(source: any, created: any): { verifiedComplete: boolean; warnings: string[] } {
  const sourceCampaign = source?.campaign ?? source;
  const sourceEvents = Array.isArray(sourceCampaign?.events) ? sourceCampaign.events : [];
  const createdEvents = Array.isArray(created?.events) ? created.events : [];
  const sourceSegments = Array.isArray(sourceCampaign?.segments) ? sourceCampaign.segments : Array.isArray(sourceCampaign?.lists) ? sourceCampaign.lists : [];
  const createdSegments = Array.isArray(created?.lists) ? created.lists : [];
  const sourceForms = Array.isArray(sourceCampaign?.forms) ? sourceCampaign.forms : [];
  const createdForms = Array.isArray(created?.forms) ? created.forms : [];
  const warnings = [];

  if (sourceEvents.length !== createdEvents.length) warnings.push(`Source had ${sourceEvents.length} events but created campaign has ${createdEvents.length}.`);
  if (sourceSegments.length !== createdSegments.length) warnings.push(`Source had ${sourceSegments.length} segments but created campaign has ${createdSegments.length}.`);
  if (sourceForms.length !== createdForms.length) warnings.push(`Source had ${sourceForms.length} forms but created campaign has ${createdForms.length}.`);

  return {
    verifiedComplete: warnings.length === 0,
    warnings,
  };
}

function validateCampaignAutomationArgs(args: any): string[] {
  const errors: string[] = [];
  const events = Array.isArray(args?.events) ? args.events : [];
  const segments = Array.isArray(args?.segments) ? args.segments : [];
  const forms = Array.isArray(args?.forms) ? args.forms : [];
  const eventsById = new Map<string, any>();

  if (segments.length === 0 && forms.length === 0) {
    errors.push('At least one campaign source is required: pass segments or forms.');
  }

  if (events.length === 0) {
    errors.push('At least one campaign event is required.');
  }

  const eventIds = new Set<string>();
  for (const event of events) {
    if (!event?.id) {
      errors.push(`Event "${event?.name ?? '(unnamed)'}" is missing id; use temporary IDs like new1, new2.`);
      continue;
    }

    const eventId = String(event.id);
    if (!/^new\d+$/.test(eventId)) {
      errors.push(`Event "${eventId}" must use a temporary ID like new1, new2 when creating campaigns.`);
    }
    if (eventIds.has(eventId)) {
      errors.push(`Duplicate event ID "${eventId}".`);
    }
    eventIds.add(eventId);
    eventsById.set(eventId, event);
  }

  for (const event of events) {
    const eventId = sourceId(event?.id);
    const parentId = sourceId(event?.parent?.id);
    if (parentId && !eventIds.has(parentId)) {
      errors.push(`Event "${event?.id}" references missing parent "${parentId}".`);
    }

    if (event?.decisionPath !== undefined) {
      if (!parentId) {
        errors.push(`Event "${eventId ?? event?.name ?? '(unnamed)'}" uses decisionPath but has no parent.`);
      }

      const parentEventType = parentId ? eventsById.get(parentId)?.eventType : null;
      if (parentId && parentEventType && !['condition', 'decision'].includes(parentEventType)) {
        errors.push(`Event "${eventId}" uses decisionPath but parent "${parentId}" is "${parentEventType}", not condition or decision.`);
      }
    }
  }

  const canvasSettings = args?.canvasSettings;
  if (canvasSettings && typeof canvasSettings === 'object') {
    const allowedCanvasIds = new Set<string>(['lists', 'forms', ...eventIds]);
    const nodes = Array.isArray(canvasSettings.nodes) ? canvasSettings.nodes : [];
    const nodeIds = new Set<string>();

    for (const node of nodes) {
      const nodeId = sourceId(node?.id);
      if (!nodeId) {
        errors.push('Canvas node is missing id.');
        continue;
      }
      nodeIds.add(nodeId);
      if (!allowedCanvasIds.has(nodeId)) {
        errors.push(`Canvas node "${nodeId}" does not refer to lists, forms, or an event ID in this request.`);
      }
    }

    const connections = Array.isArray(canvasSettings.connections) ? canvasSettings.connections : [];
    for (const connection of connections) {
      const source = sourceId(connection?.sourceId);
      const target = sourceId(connection?.targetId);
      if (!source || !target) {
        errors.push('Canvas connection is missing sourceId or targetId.');
        continue;
      }
      if (!nodeIds.has(source) && !allowedCanvasIds.has(source)) {
        errors.push(`Canvas connection source "${source}" does not refer to a known node/source/event.`);
      }
      if (!nodeIds.has(target) && !allowedCanvasIds.has(target)) {
        errors.push(`Canvas connection target "${target}" does not refer to a known node/source/event.`);
      }
    }
  }

  return errors;
}

function isDisposableCampaign(campaign: any): boolean {
  const name = String(campaign?.name ?? '');
  const description = String(campaign?.description ?? '');

  return (
    name.startsWith('Codex MCP ') ||
    name.startsWith('MCP Test ') ||
    name.includes('Temporary') ||
    description.includes('Temporary campaign') ||
    description.includes('Safe to delete')
  );
}

function campaignStatsUnavailable(kind: string, campaignId: number, dateFrom: string, dateTo: string): string {
  const result = {
    success: false,
    action: `${kind}_stats_unavailable`,
    id: campaignId,
    dateFrom,
    dateTo,
    reason: 'route_returned_campaign_detail',
    message: 'The generic Mautic 7-labeled stats route resolved to campaign detail, so the MCP is refusing to present it as analytics.',
    alternatives: ['get_campaign_email_metrics_v6', 'get_campaign_map_stats_v6'],
  };

  return `Campaign ${kind} stats unavailable:\n${JSON.stringify(result, null, 2)}`;
}

function extractMapOptionsFromHtml(html: string): Record<string, unknown>[] {
  return Array.from(html.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g))
    .filter(match => match[1].includes('data-map-option'))
    .map((match, index) => {
      const attributes = match[1];
      const seriesRaw = readAttribute(attributes, 'data-map-series') ?? '[]';
      let series: unknown = [];

      try {
        series = JSON.parse(seriesRaw);
      } catch (error) {
        series = {
          parseError: error instanceof Error ? error.message : 'Failed to parse map series',
          rawPreview: seriesRaw.slice(0, 120),
        };
      }

      return {
        index,
        label: stripTags(match[2]),
        statUnit: readAttribute(attributes, 'data-stat-unit'),
        legendText: readAttribute(attributes, 'data-legend-text'),
        series,
      };
    });
}

export const toolDefinitions: ToolDefinition[] = [
  // Existing campaign tools
  {
    name: 'list_campaigns',
    description: 'Get all campaigns with status and statistics',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search term' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        start: { type: 'number', description: 'Starting offset' },
        publishedOnly: { type: 'boolean', description: 'Only published campaigns' },
        minimal: { type: 'boolean', description: 'Return compact campaign summaries; compact output is the default unless includeRaw is true' },
        includeEvents: { type: 'boolean', description: 'Include normalized event summaries in compact output' },
        includeCanvas: { type: 'boolean', description: 'Include canvas settings in compact output' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic campaign payloads instead of compact summaries' },
      },
    },
  },
  {
    name: 'get_campaign',
    description: 'Get detailed campaign information',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Campaign ID' },
        minimal: { type: 'boolean', description: 'Return compact campaign summary; compact output is the default unless includeRaw is true' },
        includeEvents: { type: 'boolean', description: 'Include normalized event summaries in compact output' },
        includeCanvas: { type: 'boolean', description: 'Include canvas settings in compact output' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic campaign payload instead of compact summary' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_campaign',
    description: 'Create a new campaign',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Campaign name' },
        description: { type: 'string', description: 'Campaign description' },
        isPublished: { type: 'boolean', description: 'Publish immediately' },
        publishUp: { type: 'string', description: 'Publish start date (YYYY-MM-DD HH:MM:SS)' },
        publishDown: { type: 'string', description: 'Publish end date (YYYY-MM-DD HH:MM:SS)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_campaign',
    description: 'Update campaign metadata only; use managed clone/import for structural event/source changes',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Campaign ID' },
        name: { type: 'string', description: 'Campaign name' },
        description: { type: 'string', description: 'Campaign description' },
        isPublished: { type: 'boolean', description: 'Published state' },
        allowRestart: { type: 'boolean', description: 'Allow campaign restart' },
        publishUp: { type: 'string', description: 'Publish start date (YYYY-MM-DD HH:MM:SS)' },
        publishDown: { type: 'string', description: 'Publish end date (YYYY-MM-DD HH:MM:SS)' },
        category: { type: 'number', description: 'Category ID' },
        minimal: { type: 'boolean', description: 'Return compact campaign summary instead of full nested campaign payload' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic campaign payload instead of normalized metadata' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_campaign',
    description: 'Delete a campaign; requires confirmation unless the campaign is clearly disposable/test data',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Campaign ID' },
        confirmDelete: { type: 'boolean', description: 'Required to delete non-disposable campaigns' },
      },
      required: ['id'],
    },
  },
  {
    name: 'add_contact_to_campaign',
    description: 'Add a contact to a campaign',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        contactId: { type: 'number', description: 'Contact ID' },
        dryRun: { type: 'boolean', description: 'Preview campaign membership add without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to add contact to campaign' },
      },
      required: ['campaignId', 'contactId'],
    },
  },
  {
    name: 'remove_contact_from_campaign',
    description: 'Remove a contact from a campaign',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        contactId: { type: 'number', description: 'Contact ID' },
        dryRun: { type: 'boolean', description: 'Preview campaign membership removal without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to remove contact from campaign' },
      },
      required: ['campaignId', 'contactId'],
    },
  },
  {
    name: 'create_campaign_with_automation',
    description: 'Create campaign with full event automation including triggers, actions, and canvas settings',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Campaign name' },
        description: { type: 'string', description: 'Campaign description' },
        isPublished: { type: 'boolean', description: 'Publish immediately' },
        allowRestart: { type: 'boolean', description: 'Allow campaign restart' },
        events: {
          type: 'array',
          description: 'Array of campaign events (triggers/actions)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Event ID (use new1, new2, etc.)' },
              name: { type: 'string', description: 'Event name' },
              type: { type: 'string', description: 'Event type (e.g., email.send, lead.field_value)' },
              eventType: { type: 'string', enum: ['action', 'condition', 'decision'] },
              order: { type: 'number', description: 'Event order' },
              properties: { type: 'object', description: 'Event-specific properties' },
              triggerMode: { type: 'string', enum: ['immediate', 'interval'] },
              triggerInterval: { type: 'number' },
              triggerIntervalUnit: { type: 'string', enum: ['i', 'h', 'd', 'm', 'y'] },
              decisionPath: { type: 'string', enum: ['yes', 'no'] },
              parent: { type: 'object', properties: { id: { type: 'string' } } },
            },
          },
        },
        segments: { type: 'array', description: 'Segment IDs to trigger campaign', items: { type: 'number' } },
        forms: { type: 'array', description: 'Form IDs to trigger campaign', items: { type: 'number' } },
        canvasSettings: { type: 'object', description: 'Visual campaign builder settings' },
      },
      required: ['name'],
    },
  },
  {
    name: 'execute_campaign',
    description: 'Manually execute/trigger a campaign when the Mautic campaign trigger API route is available',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        contactIds: { type: 'array', items: { type: 'number' }, description: 'Optional: specific contacts' },
        confirmAllContacts: {
          type: 'boolean',
          description: 'Required to trigger a campaign without contactIds, which may execute for the full campaign audience',
        },
      },
      required: ['campaignId'],
    },
  },
  {
    name: 'get_campaign_contacts',
    description: 'Get contacts in a campaign with their status',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        start: { type: 'number', description: 'Starting offset' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        includeContactDetails: { type: 'boolean', description: 'Fetch each member contact and include normalized contact details' },
        minimal: { type: 'boolean', description: 'Return normalized contact details when includeContactDetails is true' },
        fieldsOnly: { type: 'boolean', description: 'Return only normalized contact field values plus id when includeContactDetails is true' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Field aliases to include when contact details are normalized' },
        pageSize: { type: 'number', description: 'Alias for limit when paging campaign contacts; capped at 50 when enriching contact details, otherwise 200' },
      },
      required: ['campaignId'],
    },
  },

  // NEW Mautic 7 campaign tools
  {
    name: 'clone_campaign',
    description: 'Clone an existing campaign (Mautic 7)',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'number', description: 'ID of the campaign to clone' },
      },
      required: ['campaignId'],
    },
  },
  {
    name: 'export_campaign',
    description: 'Export campaign data with all related assets (Mautic 7)',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID to export' },
      },
      required: ['campaignId'],
    },
  },
  {
    name: 'import_campaign',
    description: 'Import a campaign from JSON data (Mautic 7)',
    inputSchema: {
      type: 'object',
      properties: {
        campaignData: { type: 'object', description: 'Campaign JSON data to import' },
      },
      required: ['campaignData'],
    },
  },
  {
    name: 'get_campaign_event_details',
    description: 'Get detailed configuration for a specific campaign event',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: { type: 'number', description: 'Campaign event ID' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        start: { type: 'number', description: 'Starting offset' },
        minimal: { type: 'boolean', description: 'Return compact event detail without raw form internals; compact output is the default unless includeRaw is true' },
        includeRaw: { type: 'boolean', description: 'Include raw Mautic event payload when minimal is true' },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'get_campaign_graph_stats',
    description: 'Get campaign graph statistics for a date range (Mautic 7)',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        dateFrom: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        dateTo: { type: 'string', description: 'End date (YYYY-MM-DD)' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic graph stats payload instead of compact summary' },
      },
      required: ['campaignId', 'dateFrom', 'dateTo'],
    },
  },
  {
    name: 'get_campaign_map_stats',
    description: 'Get campaign geographic map statistics for a date range (Mautic 7)',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        dateFrom: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        dateTo: { type: 'string', description: 'End date (YYYY-MM-DD)' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic map stats payload instead of compact summary' },
      },
      required: ['campaignId', 'dateFrom', 'dateTo'],
    },
  },
  {
    name: 'get_campaign_email_metrics_v6',
    description: 'Get Mautic 6 campaign email metrics by weekday or hour from authenticated web stats routes',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        groupBy: { type: 'string', enum: ['weekdays', 'hours'], description: 'Group campaign email metrics by weekdays or hours' },
        dateFrom: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        dateTo: { type: 'string', description: 'End date (YYYY-MM-DD)' },
      },
      required: ['campaignId', 'groupBy', 'dateFrom', 'dateTo'],
    },
  },
  {
    name: 'get_campaign_map_stats_v6',
    description: 'Get Mautic 6 campaign geographic map statistics from the authenticated web stats route',
    inputSchema: {
      type: 'object',
      properties: {
        campaignId: { type: 'number', description: 'Campaign ID' },
        dateFrom: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        dateTo: { type: 'string', description: 'End date (YYYY-MM-DD)' },
      },
      required: ['campaignId', 'dateFrom', 'dateTo'],
    },
  },
];

export const toolHandlers: Record<string, ToolHandler> = {
  async list_campaigns(client: MauticApiClient, args: any) {
    const params: any = {};
    setParam(params, 'search', args?.search);
    setLimitedParam(params, 'limit', args?.limit, 200);
    setNonNegativeParam(params, 'start', args?.start);
    setParam(params, 'publishedOnly', args?.publishedOnly);

    const response = await client.v1.get('/campaigns', { params });
    if (args?.includeRaw !== true && args?.minimal !== false) {
      const campaigns = Object.values(response.data.campaigns ?? {}).map((campaign: any) =>
        normalizeCampaign(campaign, {
          includeEvents: args?.includeEvents === true,
          includeCanvas: args?.includeCanvas === true,
          includeRaw: args?.includeRaw === true,
        }),
      );
      const result = {
        pagination: buildPagination(response.data.total, params.start, params.limit, campaigns.length),
        campaigns,
      };
      return {
        content: [{ type: 'text', text: `Found ${response.data.total} campaigns:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    const campaigns = response.data.campaigns ?? {};
    const result = {
      pagination: buildPagination(response.data.total, params.start, params.limit, Object.keys(campaigns).length),
      campaigns,
    };
    return {
      content: [{ type: 'text', text: `Found ${response.data.total} campaigns:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async get_campaign(client: MauticApiClient, args: any) {
    const { id } = args;
    const response = await client.v1.get(`/campaigns/${id}`);
    if (args?.includeRaw !== true && args?.minimal !== false) {
      const campaign = normalizeCampaign(response.data.campaign, {
        includeEvents: args?.includeEvents === true,
        includeCanvas: args?.includeCanvas === true,
        includeRaw: args?.includeRaw === true,
      });
      return {
        content: [{ type: 'text', text: `Campaign details:\n${JSON.stringify(campaign, null, 2)}` }],
      };
    }

    return {
      content: [{ type: 'text', text: `Campaign details:\n${JSON.stringify(response.data.campaign, null, 2)}` }],
    };
  },

  async create_campaign(client: MauticApiClient, args: any) {
    const response = await client.v1.post('/campaigns/new', args);
    const campaign = normalizeCampaign(response.data.campaign);
    const result = buildMutationResult('created', campaign.id, 'campaign', campaign, { success: response.data?.success ?? true });
    return {
      content: [{ type: 'text', text: `Campaign created successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async update_campaign(client: MauticApiClient, args: any) {
    const { id, minimal, includeRaw, ...updates } = args;
    const structuralKeys = ['events', 'segments', 'lists', 'forms', 'canvasSettings'];
    const rejectedStructuralKeys = structuralKeys.filter(key => updates[key] !== undefined);

    if (rejectedStructuralKeys.length > 0) {
      const result = {
        success: false,
        action: 'update_rejected',
        id,
        reason: 'structural_fields_not_supported',
        rejectedFields: rejectedStructuralKeys,
        message: 'update_campaign is metadata-only. Use managed export/import or clone_campaign for campaign structure changes.',
      };
      return {
        content: [{ type: 'text', text: `Campaign update rejected:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    const payload: any = {};
    setParam(payload, 'name', updates.name);
    setParam(payload, 'description', updates.description);
    setParam(payload, 'isPublished', updates.isPublished);
    setParam(payload, 'allowRestart', updates.allowRestart);
    setParam(payload, 'publishUp', updates.publishUp);
    setParam(payload, 'publishDown', updates.publishDown);
    setParam(payload, 'category', updates.category);

    const response = await client.v1.patch(`/campaigns/${id}/edit`, payload);
    const campaign = includeRaw || minimal === false ? response.data.campaign ?? response.data : normalizeCampaign(response.data.campaign ?? response.data);
    const result = buildMutationResult('updated', (campaign as any)?.id ?? id, 'campaign', campaign, { success: response.data?.success ?? true });
    return {
      content: [{ type: 'text', text: `Campaign updated successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async delete_campaign(client: MauticApiClient, args: any) {
    const { id, confirmDelete } = args;
    const existingResponse = await client.v1.get(`/campaigns/${id}`);
    const campaign = existingResponse.data.campaign;

    if (confirmDelete !== true && !isDisposableCampaign(campaign)) {
      const result = {
        success: false,
        action: 'delete_rejected',
        id,
        reason: 'confirmation_required',
        campaign: normalizeCampaign(campaign),
        message: 'Pass confirmDelete: true to delete a non-disposable campaign.',
      };
      return {
        content: [{ type: 'text', text: `Campaign delete rejected:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    await client.v1.delete(`/campaigns/${id}/delete`);
    const deleted = normalizeCampaign(campaign, { includeEvents: true });
    const result = buildMutationResult('deleted', id, 'campaign', deleted);

    return {
      content: [{ type: 'text', text: `Campaign deleted successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async add_contact_to_campaign(client: MauticApiClient, args: any) {
    const { campaignId, contactId } = args;
    const live = args?.dryRun === false && args?.confirmMutation === true;
    if (!live) {
      const result = {
        success: true,
        dryRun: true,
        action: 'added_to_campaign_preview',
        id: contactId,
        membership: { campaignId, contactId },
        requiresConfirmation: true,
        confirmation: { tool: 'add_contact_to_campaign', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `Campaign membership add preview; no campaign membership was changed:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    await client.v1.post(`/campaigns/${campaignId}/contact/${contactId}/add`);
    const result = buildMutationResult('added_to_campaign', contactId, 'membership', { campaignId, contactId });
    return {
      content: [{ type: 'text', text: `Contact added to campaign successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async remove_contact_from_campaign(client: MauticApiClient, args: any) {
    const { campaignId, contactId } = args;
    const live = args?.dryRun === false && args?.confirmMutation === true;
    if (!live) {
      const result = {
        success: true,
        dryRun: true,
        action: 'removed_from_campaign_preview',
        id: contactId,
        membership: { campaignId, contactId },
        requiresConfirmation: true,
        confirmation: { tool: 'remove_contact_from_campaign', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `Campaign membership removal preview; no campaign membership was changed:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    await client.v1.post(`/campaigns/${campaignId}/contact/${contactId}/remove`);
    const result = buildMutationResult('removed_from_campaign', contactId, 'membership', { campaignId, contactId });
    return {
      content: [{ type: 'text', text: `Contact removed from campaign successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async create_campaign_with_automation(client: MauticApiClient, args: any) {
    const validationErrors = validateCampaignAutomationArgs(args);
    if (validationErrors.length > 0) {
      const result = {
        success: false,
        action: 'create_rejected',
        id: null,
        reason: 'automation_validation_failed',
        errors: validationErrors,
      };
      return {
        content: [{ type: 'text', text: `Campaign automation validation failed:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    const payload: any = {
      name: args.name,
      description: args.description || '',
      isPublished: args.isPublished !== undefined ? args.isPublished : false,
      allowRestart: args.allowRestart || false,
    };

    if (args.events?.length > 0) payload.events = args.events;
    if (args.segments?.length > 0) payload.lists = args.segments.map((id: number) => ({ id }));
    if (args.forms?.length > 0) payload.forms = args.forms.map((id: number) => ({ id }));
    setParam(payload, 'canvasSettings', args.canvasSettings);

    const response = await client.v1.post('/campaigns/new', payload);
    const campaign = normalizeCampaign(response.data.campaign, { includeEvents: true });
    const result = buildMutationResult('created', campaign.id, 'campaign', campaign, { success: response.data?.success ?? true });
    return {
      content: [{ type: 'text', text: `Campaign with automation created successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async execute_campaign(client: MauticApiClient, args: any) {
    const { campaignId, contactIds, confirmAllContacts } = args;
    const targetedContactIds = Array.isArray(contactIds) ? contactIds.filter((id: unknown) => id !== undefined && id !== null) : [];

    if (targetedContactIds.length === 0 && confirmAllContacts !== true) {
      const result = {
        success: false,
        action: 'execution_rejected',
        id: campaignId,
        reason: 'confirmation_required',
        message: 'Pass contactIds for targeted execution, or set confirmAllContacts: true to intentionally trigger without contactIds.',
      };
      return {
        content: [{ type: 'text', text: `Campaign execution rejected:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    const payload: any = {};
    if (targetedContactIds.length > 0) payload.contactIds = targetedContactIds;

    let response;
    try {
      response = await client.v1.post(`/campaigns/${campaignId}/trigger`, payload);
    } catch (error: any) {
      if (error?.response?.status === 404) {
        const result = {
          success: false,
          action: 'execution_unavailable',
          id: campaignId,
          route: `/campaigns/${campaignId}/trigger`,
          reason: 'route_not_found',
          message: 'The campaign trigger API route is not available on this Mautic instance. This was verified against Mautic 6.0.7.',
        };
        return {
          content: [{ type: 'text', text: `Campaign execution unavailable:\n${JSON.stringify(result, null, 2)}` }],
        };
      }

      throw error;
    }

    const execution = {
      campaignId,
      mode: targetedContactIds.length > 0 ? 'targeted' : 'all',
      requestedContactIds: targetedContactIds,
      response: response.data,
    };
    const result = buildMutationResult('executed', campaignId, 'execution', execution, { success: response.data?.success ?? true });

    return {
      content: [{ type: 'text', text: `Campaign executed successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async get_campaign_contacts(client: MauticApiClient, args: any) {
    const { campaignId, start, limit, pageSize, includeContactDetails, minimal, fieldsOnly, fields } = args;
    const params: any = {};
    setNonNegativeParam(params, 'start', start);
    setLimitedParam(params, 'limit', limit ?? pageSize, includeContactDetails ? 50 : 200);

    const response = await client.v1.get(`/campaigns/${campaignId}/contacts`, { params });
    const memberships = Array.isArray(response.data.contacts) ? response.data.contacts : Object.values(response.data.contacts ?? {});
    const pagination = buildPagination(response.data.total, params.start, params.limit, memberships.length);

    if (includeContactDetails) {
      const contacts = await Promise.all(
        memberships.map(async (membership: any) => {
          const contactId = membership.lead_id ?? membership.contact_id ?? membership.id;
          if (!contactId) {
            return { membership, contact: null, error: 'No contact ID found on campaign membership row' };
          }

          try {
            const contactResponse = await client.v1.get(`/contacts/${contactId}`);
            const contact = contactResponse.data.contact;
            const normalizedContact = fieldsOnly
              ? { id: contact?.id, fields: normalizeContact(contact, fields).fields }
              : minimal !== false
                ? normalizeContact(contact, fields)
                : contact;

            return {
              membership,
              contact: normalizedContact,
            };
          } catch (error: any) {
            return {
              membership,
              contact: null,
              error: error?.response?.data?.errors?.[0]?.message ?? error?.message ?? 'Failed to fetch contact details',
            };
          }
        }),
      );

      return {
        content: [{ type: 'text', text: `Campaign ${campaignId} contacts with details:\n${JSON.stringify({ pagination, contacts }, null, 2)}` }],
      };
    }

    const result = {
      pagination,
      contacts: memberships,
    };

    return {
      content: [{ type: 'text', text: `Campaign ${campaignId} contacts:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  // NEW Mautic 7 handlers
  async clone_campaign(client: MauticApiClient, args: any) {
    const { campaignId } = args;
    const sourceResponse = await client.v1.get(`/campaigns/${campaignId}`);
    const source = sourceResponse.data.campaign;
    const clonePayload = buildCampaignClonePayload(source);
    const response = await client.v1.post('/campaigns/new', clonePayload);
    const clonedId = response.data.campaign?.id;
    const clonedResponse = clonedId ? await client.v1.get(`/campaigns/${clonedId}`) : response;
    const cloned = clonedResponse.data.campaign || response.data.campaign || response.data;
    const verification = verifyManagedCampaign(source, cloned);

    const result = {
      success: true,
      action: 'cloned',
      id: cloned?.id,
      strategy: 'managed-v1-recreate',
      source: normalizeCampaign(source, { includeEvents: true }),
      campaign: normalizeCampaign(cloned, { includeEvents: true }),
      ...verification,
    };

    return {
      content: [{ type: 'text', text: `Campaign ${campaignId} clone result:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async export_campaign(client: MauticApiClient, args: any) {
    const { campaignId } = args;
    const response = await client.v1.get(`/campaigns/${campaignId}`);
    const exportData = buildManagedCampaignExport(response.data.campaign);

    return {
      content: [{ type: 'text', text: `Campaign ${campaignId} managed export data:\n${JSON.stringify(exportData, null, 2)}` }],
    };
  },

  async import_campaign(client: MauticApiClient, args: any) {
    const { campaignData } = args;
    const payload = buildCampaignPayloadFromManagedExport(campaignData);
    const response = await client.v1.post('/campaigns/new', payload);
    const importedId = response.data.campaign?.id;
    const importedResponse = importedId ? await client.v1.get(`/campaigns/${importedId}`) : response;
    const imported = importedResponse.data.campaign || response.data.campaign || response.data;
    const verification = verifyManagedCampaign(campaignData, imported);
    const result = {
      success: true,
      action: 'imported',
      id: imported?.id,
      strategy: 'managed-v1-import',
      campaign: normalizeCampaign(imported, { includeEvents: true }),
      ...verification,
    };

    return {
      content: [{ type: 'text', text: `Campaign imported successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async get_campaign_event_details(client: MauticApiClient, args: any) {
    const { eventId, limit, start } = args;
    const params: any = {};
    setLimitedParam(params, 'limit', limit, 200);
    setNonNegativeParam(params, 'start', start);

    const response = await client.v1.get(`/campaigns/events/${eventId}`, { params });
    if (args?.includeRaw !== true) {
      const event = normalizeCampaignEvent(response.data.event ?? response.data, false);
      return {
        content: [{ type: 'text', text: `Campaign event ${eventId} details:\n${JSON.stringify(event, null, 2)}` }],
      };
    }

    return {
      content: [{ type: 'text', text: `Campaign event ${eventId} details:\n${JSON.stringify(response.data, null, 2)}` }],
    };
  },

  async get_campaign_graph_stats(client: MauticApiClient, args: any) {
    const { campaignId, dateFrom, dateTo } = args;
    const response = await client.v1.get(`/campaigns/${campaignId}`, {
      params: { dateFrom, dateTo },
    });
    if (response.data?.campaign && !response.data?.stats && !response.data?.graphs) {
      return {
        content: [{ type: 'text', text: campaignStatsUnavailable('graph', campaignId, dateFrom, dateTo) }],
      };
    }

    const stats = args?.includeRaw === true ? response.data : summarizePayload(response.data);
    return {
      content: [{ type: 'text', text: `Campaign ${campaignId} stats (${dateFrom} to ${dateTo}):\n${JSON.stringify(stats, null, 2)}` }],
    };
  },

  async get_campaign_map_stats(client: MauticApiClient, args: any) {
    const { campaignId, dateFrom, dateTo } = args;
    const response = await client.v1.get(`/campaigns/${campaignId}`, {
      params: { dateFrom, dateTo },
    });
    if (response.data?.campaign && !response.data?.stats && !response.data?.mapStats) {
      return {
        content: [{ type: 'text', text: campaignStatsUnavailable('map', campaignId, dateFrom, dateTo) }],
      };
    }

    const stats = args?.includeRaw === true ? response.data : summarizePayload(response.data);
    return {
      content: [{ type: 'text', text: `Campaign ${campaignId} map stats (${dateFrom} to ${dateTo}):\n${JSON.stringify(stats, null, 2)}` }],
    };
  },

  async get_campaign_email_metrics_v6(client: MauticApiClient, args: any) {
    const { campaignId, groupBy, dateFrom, dateTo } = args;
    const route = groupBy === 'hours' ? 'email-hours' : 'email-weekdays';
    const path = `/campaign/metrics/${route}/${encodeURIComponent(campaignId)}/${encodeURIComponent(dateFrom)}/${encodeURIComponent(dateTo)}`;
    const response = await client.web.get(path);
    const charts = extractChartsFromHtml(response.data);
    const result = {
      source: path,
      campaignId,
      groupBy,
      dateFrom,
      dateTo,
      charts,
      note: charts.length ? undefined : 'Mautic returned no chart canvases for this campaign/range.',
    };

    return {
      content: [{ type: 'text', text: `Mautic 6 campaign ${campaignId} email metrics (${groupBy}, ${dateFrom} to ${dateTo}):\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async get_campaign_map_stats_v6(client: MauticApiClient, args: any) {
    const { campaignId, dateFrom, dateTo } = args;
    const path = `/campaign-map-stats/${encodeURIComponent(campaignId)}/${encodeURIComponent(dateFrom)}/${encodeURIComponent(dateTo)}`;
    const response = await client.web.get(path);
    const options = extractMapOptionsFromHtml(response.data);
    const result = {
      source: path,
      campaignId,
      dateFrom,
      dateTo,
      options,
      note: options.length ? undefined : 'Mautic returned no map options for this campaign/range.',
    };

    return {
      content: [{ type: 'text', text: `Mautic 6 campaign ${campaignId} map stats (${dateFrom} to ${dateTo}):\n${JSON.stringify(result, null, 2)}` }],
    };
  },
};
