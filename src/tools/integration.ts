import { readFile } from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { MauticApiClient } from '../api/client.js';
import type { ToolDefinition, ToolHandler } from '../types/index.js';
import { buildMutationResult, buildPagination, hasValue, setLimitedParam, setNonNegativeParam, setParam } from './utils.js';

function pickPayload(args: any, fields: string[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    if (hasValue(args?.[field])) payload[field] = args[field];
  }
  return payload;
}

function summarizeWebhook(hook: any): Record<string, unknown> {
  return {
    id: hook?.id,
    name: hook?.name,
    description: hook?.description,
    webhookUrl: hook?.webhookUrl,
    isPublished: hook?.isPublished,
    eventsOrderbyDir: hook?.eventsOrderbyDir,
    triggerCount: Array.isArray(hook?.triggers) ? hook.triggers.length : Object.keys(hook?.triggers ?? {}).length,
    dateAdded: hook?.dateAdded,
    dateModified: hook?.dateModified,
    createdByUser: hook?.createdByUser,
    modifiedByUser: hook?.modifiedByUser,
  };
}

function formatWebhook(hook: any, options: { minimal?: boolean; includeRaw?: boolean } = {}): Record<string, unknown> {
  if (options.includeRaw) return hook;
  if (options.minimal) return summarizeWebhook(hook);

  const { secret: _secret, ...withoutSecret } = hook ?? {};
  return withoutSecret;
}

function summarizeReport(report: any): Record<string, unknown> {
  return {
    id: report?.id,
    name: report?.name,
    description: report?.description,
    source: report?.source,
    isPublished: report?.isPublished,
    columnCount: Array.isArray(report?.columns) ? report.columns.length : Object.keys(report?.columns ?? {}).length,
    filterCount: Array.isArray(report?.filters) ? report.filters.length : Object.keys(report?.filters ?? {}).length,
    groupByCount: Array.isArray(report?.groupBy) ? report.groupBy.length : Object.keys(report?.groupBy ?? {}).length,
    dateAdded: report?.dateAdded,
    dateModified: report?.dateModified,
    createdByUser: report?.createdByUser,
    modifiedByUser: report?.modifiedByUser,
  };
}

function formatReport(report: any, options: { minimal?: boolean; includeRaw?: boolean } = {}): Record<string, unknown> {
  if (options.includeRaw) return report;
  if (options.minimal) return summarizeReport(report);

  const {
    graphs: _graphs,
    tableData: _tableData,
    ...withoutHeavyData
  } = report ?? {};
  return withoutHeavyData;
}

const WEBHOOK_FIELDS = ['name', 'description', 'webhookUrl', 'secret', 'eventsOrderbyDir', 'triggers', 'isPublished'];
const REPORT_FIELDS = ['name', 'description', 'source', 'columns', 'filters', 'groupBy', 'isPublished'];

function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    ...payload,
    ...(hasValue(payload.secret) ? { secret: '[redacted]' } : {}),
  };
}

function diagnosticError(action: string, endpoint: string, payload: Record<string, unknown>, error: unknown) {
  if (!axios.isAxiosError(error)) {
    throw error;
  }

  const details = {
    action,
    endpoint,
    status: error.response?.status,
    statusText: error.response?.statusText,
    message: MauticApiClient.extractErrorMessage(error),
    response: error.response?.data,
    requestPayload: redactPayload(payload),
  };

  return {
    content: [{ type: 'text', text: `Mautic API diagnostic error:\n${JSON.stringify(details, null, 2)}` }],
    isError: true,
  };
}

function contentTypeForFile(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.csv': 'text/csv',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.mp3': 'audio/mpeg',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.txt': 'text/plain',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };

  return types[extension] ?? 'application/octet-stream';
}

async function buildUploadForm(filePath: string): Promise<FormData> {
  const fileBuffer = await readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([fileBuffer], { type: contentTypeForFile(filePath) }), path.basename(filePath));
  return form;
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'list_webhooks',
    description: 'Get all webhooks',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        start: { type: 'number', description: 'Starting offset' },
        minimal: { type: 'boolean', description: 'Return compact webhook metadata' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic webhook payloads' },
      },
    },
  },
  {
    name: 'get_webhook',
    description: 'Get webhook details by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Webhook ID' },
        minimal: { type: 'boolean', description: 'Return compact webhook metadata' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic webhook payload' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_webhook',
    description: 'Create new webhook',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Webhook name' },
        description: { type: 'string', description: 'Webhook description' },
        webhookUrl: { type: 'string', description: 'Webhook URL' },
        secret: { type: 'string', description: 'Webhook secret' },
        eventsOrderbyDir: { type: 'string', enum: ['ASC', 'DESC'], description: 'Event order direction' },
        triggers: { type: 'array', items: { type: 'string' }, description: 'Event types to trigger webhook' },
        isPublished: { type: 'boolean', description: 'Publication state; defaults to false when omitted' },
      },
      required: ['name', 'webhookUrl', 'triggers'],
    },
  },
  {
    name: 'update_webhook',
    description: 'Update webhook metadata through the Mautic v1 edit endpoint',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Webhook ID' },
        name: { type: 'string', description: 'Webhook name' },
        description: { type: 'string', description: 'Webhook description' },
        webhookUrl: { type: 'string', description: 'Webhook URL' },
        secret: { type: 'string', description: 'Webhook secret' },
        eventsOrderbyDir: { type: 'string', enum: ['ASC', 'DESC'], description: 'Event order direction' },
        triggers: { type: 'array', items: { type: 'string' }, description: 'Event types to trigger webhook' },
        isPublished: { type: 'boolean', description: 'Publication state' },
        minimal: { type: 'boolean', description: 'Return compact webhook metadata' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_webhook',
    description: 'Delete a webhook by ID; requires explicit confirmation',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Webhook ID' },
        confirmDelete: { type: 'boolean', description: 'Must be true to delete the webhook' },
      },
      required: ['id', 'confirmDelete'],
    },
  },
  {
    name: 'upload_file',
    description: 'Upload file to Mautic',
    inputSchema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'File path or base64 encoded content' },
        folder: { type: 'string', enum: ['media', 'images'], description: 'Destination folder; Mautic 6 accepts media or images' },
      },
      required: ['file'],
    },
  },
  {
    name: 'list_reports',
    description: 'Get all reports',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        start: { type: 'number', description: 'Starting offset' },
        minimal: { type: 'boolean', description: 'Return compact report metadata' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic report payloads' },
      },
    },
  },
  {
    name: 'get_report',
    description: 'Get report details by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Report ID' },
        minimal: { type: 'boolean', description: 'Return compact report metadata' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic report payload' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_report',
    description: 'Create custom report',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Report name' },
        description: { type: 'string', description: 'Report description' },
        source: { type: 'string', description: 'Data source (contacts, companies, etc.)' },
        columns: { type: 'array', items: { type: 'string' }, description: 'Report columns' },
        filters: { type: 'array', description: 'Report filters' },
        groupBy: { type: 'array', items: { type: 'string' }, description: 'Group by columns' },
        isPublished: { type: 'boolean', description: 'Publication state; defaults to false when omitted' },
      },
      required: ['name', 'source', 'columns'],
    },
  },
  {
    name: 'update_report',
    description: 'Update report metadata through the Mautic v1 edit endpoint',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Report ID' },
        name: { type: 'string', description: 'Report name' },
        description: { type: 'string', description: 'Report description' },
        source: { type: 'string', description: 'Data source (contacts, companies, etc.)' },
        columns: { type: 'array', items: { type: 'string' }, description: 'Report columns' },
        filters: { type: 'array', description: 'Report filters' },
        groupBy: { type: 'array', items: { type: 'string' }, description: 'Group by columns' },
        isPublished: { type: 'boolean', description: 'Publication state' },
        minimal: { type: 'boolean', description: 'Return compact report metadata' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_report',
    description: 'Delete a report by ID; requires explicit confirmation',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Report ID' },
        confirmDelete: { type: 'boolean', description: 'Must be true to delete the report' },
      },
      required: ['id', 'confirmDelete'],
    },
  },
];

export const toolHandlers: Record<string, ToolHandler> = {
  async list_webhooks(client: MauticApiClient, args: any) {
    const params: any = {};
    setLimitedParam(params, 'limit', args?.limit, 200);
    setNonNegativeParam(params, 'start', args?.start);

    const response = await client.v1.get('/hooks', { params });
    const hooks = Object.fromEntries(
      Object.entries(response.data.hooks ?? {}).map(([id, hook]) => [
        id,
        formatWebhook(hook, { minimal: args?.minimal, includeRaw: args?.includeRaw }),
      ]),
    );
    const result = {
      pagination: buildPagination(response.data.total, params.start, params.limit, Object.keys(hooks).length),
      webhooks: hooks,
    };

    return {
      content: [{ type: 'text', text: `Found ${response.data.total || 0} webhooks:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async get_webhook(client: MauticApiClient, args: any) {
    const { id } = args;
    const response = await client.v1.get(`/hooks/${id}`);
    const hook = formatWebhook(response.data.hook, { minimal: args?.minimal, includeRaw: args?.includeRaw });

    return {
      content: [{ type: 'text', text: `Webhook details:\n${JSON.stringify(hook, null, 2)}` }],
    };
  },

  async create_webhook(client: MauticApiClient, args: any) {
    const payload: any = {
      name: args.name,
      webhookUrl: args.webhookUrl,
      triggers: args.triggers,
      eventsOrderbyDir: args.eventsOrderbyDir || 'DESC',
      isPublished: args.isPublished ?? false,
    };
    setParam(payload, 'description', args.description);
    setParam(payload, 'secret', args.secret);

    let response;
    try {
      response = await client.v1.post('/hooks/new', payload);
    } catch (error) {
      return diagnosticError('create_webhook', '/hooks/new', payload, error);
    }

    const result = {
      success: response.data?.success ?? true,
      action: 'created',
      id: response.data?.hook?.id,
      webhook: formatWebhook(response.data.hook, { minimal: true }),
    };

    return {
      content: [{ type: 'text', text: `Webhook created successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async update_webhook(client: MauticApiClient, args: any) {
    const { id } = args;
    const payload = pickPayload(args, WEBHOOK_FIELDS);
    if (Object.keys(payload).length === 0) {
      return { content: [{ type: 'text', text: 'No webhook fields provided to update.' }] };
    }

    const response = await client.v1.patch(`/hooks/${id}/edit`, payload);
    const result = {
      success: response.data?.success ?? true,
      action: 'updated',
      id: response.data?.hook?.id ?? id,
      webhook: formatWebhook(response.data.hook, { minimal: args?.minimal ?? true }),
    };

    return {
      content: [{ type: 'text', text: `Webhook updated successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async delete_webhook(client: MauticApiClient, args: any) {
    const { id, confirmDelete } = args;
    if (confirmDelete !== true) {
      return { content: [{ type: 'text', text: `Refusing to delete webhook ${id}. Re-run with confirmDelete: true.` }] };
    }

    const existing = await client.v1.get(`/hooks/${id}`);
    await client.v1.delete(`/hooks/${id}/delete`);
    const result = {
      success: true,
      action: 'deleted',
      id,
      deletedWebhook: summarizeWebhook(existing.data.hook),
    };

    return {
      content: [{ type: 'text', text: `Webhook deleted successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async upload_file(client: MauticApiClient, args: any) {
    const folder = args.folder || 'media';
    const payload = await buildUploadForm(args.file);

    const response = await client.v1.post(`/files/${encodeURIComponent(folder)}/new`, payload);
    const file = response.data?.file ?? response.data;
    const result = buildMutationResult('uploaded', file?.name ?? file?.id ?? null, 'file', file, {
      success: response.data?.success ?? true,
      folder,
    });

    return {
      content: [{ type: 'text', text: `File uploaded successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async list_reports(client: MauticApiClient, args: any) {
    const params: any = {};
    setLimitedParam(params, 'limit', args?.limit, 200);
    setNonNegativeParam(params, 'start', args?.start);

    const response = await client.v1.get('/reports', { params });
    const reports = Object.fromEntries(
      Object.entries(response.data.reports ?? {}).map(([id, report]) => [
        id,
        formatReport(report, { minimal: args?.minimal, includeRaw: args?.includeRaw }),
      ]),
    );
    const result = {
      pagination: buildPagination(response.data.total, params.start, params.limit, Object.keys(reports).length),
      reports,
    };

    return {
      content: [{ type: 'text', text: `Found ${response.data.total || 0} reports:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async get_report(client: MauticApiClient, args: any) {
    const { id } = args;
    const response = await client.v1.get(`/reports/${id}`);
    const report = formatReport(response.data.report, { minimal: args?.minimal, includeRaw: args?.includeRaw });

    return {
      content: [{ type: 'text', text: `Report details:\n${JSON.stringify(report, null, 2)}` }],
    };
  },

  async create_report(client: MauticApiClient, args: any) {
    const payload: any = {
      name: args.name,
      source: args.source,
      columns: args.columns,
      isPublished: args.isPublished ?? false,
    };
    setParam(payload, 'description', args.description);
    setParam(payload, 'filters', args.filters);
    setParam(payload, 'groupBy', args.groupBy);

    let response;
    try {
      response = await client.v1.post('/reports/new', payload);
    } catch (error) {
      return diagnosticError('create_report', '/reports/new', payload, error);
    }

    const result = {
      success: response.data?.success ?? true,
      action: 'created',
      id: response.data?.report?.id,
      report: formatReport(response.data.report, { minimal: true }),
    };

    return {
      content: [{ type: 'text', text: `Report created successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async update_report(client: MauticApiClient, args: any) {
    const { id } = args;
    const payload = pickPayload(args, REPORT_FIELDS);
    if (Object.keys(payload).length === 0) {
      return { content: [{ type: 'text', text: 'No report fields provided to update.' }] };
    }

    const response = await client.v1.patch(`/reports/${id}/edit`, payload);
    const result = {
      success: response.data?.success ?? true,
      action: 'updated',
      id: response.data?.report?.id ?? id,
      report: formatReport(response.data.report, { minimal: args?.minimal ?? true }),
    };

    return {
      content: [{ type: 'text', text: `Report updated successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async delete_report(client: MauticApiClient, args: any) {
    const { id, confirmDelete } = args;
    if (confirmDelete !== true) {
      return { content: [{ type: 'text', text: `Refusing to delete report ${id}. Re-run with confirmDelete: true.` }] };
    }

    const existing = await client.v1.get(`/reports/${id}`);
    await client.v1.delete(`/reports/${id}/delete`);
    const result = {
      success: true,
      action: 'deleted',
      id,
      deletedReport: summarizeReport(existing.data.report),
    };

    return {
      content: [{ type: 'text', text: `Report deleted successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },
};
