import type { MauticApiClient } from '../api/client.js';
import type { ToolDefinition, ToolHandler } from '../types/index.js';
import { buildMutationResult, buildPagination, hasValue, setLimitedParam, setParam } from './utils.js';

function summarizeCategory(category: any): Record<string, unknown> | null {
  if (!category) {
    return null;
  }

  return {
    id: category?.id,
    title: category?.title,
    alias: category?.alias,
    bundle: category?.bundle,
    color: category?.color,
  };
}

function pct(numerator: number, denominator: number): number | null {
  if (!denominator) {
    return null;
  }

  return Math.round((numerator / denominator) * 10000) / 100;
}

function summarizeEmail(email: any): Record<string, unknown> {
  const sentCount = Number(email?.sentCount ?? 0);
  const readCount = Number(email?.readCount ?? 0);
  const variantSentCount = Number(email?.variantSentCount ?? 0);
  const variantReadCount = Number(email?.variantReadCount ?? 0);

  return {
    id: email?.id,
    name: email?.name,
    subject: email?.subject,
    emailType: email?.emailType,
    isPublished: email?.isPublished,
    sentCount,
    readCount,
    readRatePct: pct(readCount, sentCount),
    variantSentCount,
    variantReadCount,
    variantReadRatePct: pct(variantReadCount, variantSentCount),
    dateAdded: email?.dateAdded,
    dateModified: email?.dateModified,
    createdByUser: email?.createdByUser,
    modifiedByUser: email?.modifiedByUser,
    language: email?.language,
    category: summarizeCategory(email?.category),
    fromAddress: email?.fromAddress,
    fromName: email?.fromName,
    replyToAddress: email?.replyToAddress,
  };
}

function stripEmailContent(email: any): Record<string, unknown> {
  if (!email || typeof email !== 'object') {
    return email;
  }

  const {
    customHtml: _customHtml,
    plainText: _plainText,
    grapesjsbuilder: _grapesjsbuilder,
    dynamicContent: _dynamicContent,
    headers: _headers,
    ...withoutContent
  } = email;

  return {
    ...withoutContent,
    variantChildren: Array.isArray(email.variantChildren) ? email.variantChildren.map(summarizeEmail) : email.variantChildren,
    translationChildren: Array.isArray(email.translationChildren) ? email.translationChildren.map(summarizeEmail) : email.translationChildren,
  };
}

function formatEmailOutput(email: any, options: { minimal?: boolean; includeContent?: boolean }): Record<string, unknown> {
  if (options.minimal) {
    return summarizeEmail(email);
  }

  if (options.includeContent !== true) {
    return stripEmailContent(email);
  }

  return email;
}

function pickEmailPayload(args: any): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const allowedFields = [
    'name',
    'subject',
    'fromAddress',
    'fromName',
    'replyToAddress',
    'customHtml',
    'plainText',
    'emailType',
    'template',
    'language',
    'category',
    'isPublished',
    'publishUp',
    'publishDown',
  ];

  for (const field of allowedFields) {
    if (hasValue(args?.[field])) {
      payload[field] = args[field];
    }
  }

  return payload;
}

function normalizeEmailMutation(action: string, responseData: any, options: { minimal?: boolean; includeContent?: boolean } = {}) {
  const email = responseData?.email ?? responseData;
  return {
    success: responseData?.success ?? true,
    action,
    id: email?.id,
    email: formatEmailOutput(email, options),
  };
}

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

export const toolDefinitions: ToolDefinition[] = [
  // Existing email tools
  {
    name: 'send_email',
    description: 'Send an email to specific contacts',
    inputSchema: {
      type: 'object',
      properties: {
        emailId: { type: 'number', description: 'Email template ID' },
        contactIds: { type: 'array', items: { type: 'number' }, description: 'Array of contact IDs' },
        contactEmails: { type: 'array', items: { type: 'string' }, description: 'Array of contact emails' },
      },
    },
  },
  {
    name: 'list_emails',
    description: 'Get all email templates and campaigns',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search term' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        start: { type: 'number', description: 'Starting offset' },
        publishedOnly: { type: 'boolean', description: 'Only published emails' },
        minimal: { type: 'boolean', description: 'Return compact email metadata and counters' },
        includeContent: { type: 'boolean', description: 'Include customHtml/plainText content in full output (default false)' },
      },
    },
  },
  {
    name: 'get_email',
    description: 'Get detailed email information',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Email ID' },
        minimal: { type: 'boolean', description: 'Return compact email metadata and counters' },
        includeContent: { type: 'boolean', description: 'Include customHtml/plainText content in full output (default false)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_email_template',
    description: 'Create a new email template',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Email name' },
        subject: { type: 'string', description: 'Email subject' },
        fromAddress: { type: 'string', description: 'From email address' },
        fromName: { type: 'string', description: 'From name' },
        replyToAddress: { type: 'string', description: 'Reply-to email address' },
        customHtml: { type: 'string', description: 'HTML content' },
        plainText: { type: 'string', description: 'Plain text content' },
        emailType: { type: 'string', enum: ['template', 'list'], description: 'Email type' },
        isPublished: { type: 'boolean', description: 'Publish immediately' },
        language: { type: 'string', description: 'Email language/locale, for example zh_CN' },
        category: { type: 'number', description: 'Category ID' },
      },
      required: ['name', 'subject'],
    },
  },
  {
    name: 'update_email',
    description: 'Update email metadata/content through the Mautic v1 edit endpoint',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Email ID' },
        name: { type: 'string', description: 'Email name' },
        subject: { type: 'string', description: 'Email subject' },
        fromAddress: { type: 'string', description: 'From email address' },
        fromName: { type: 'string', description: 'From name' },
        replyToAddress: { type: 'string', description: 'Reply-to email address' },
        customHtml: { type: 'string', description: 'HTML content' },
        plainText: { type: 'string', description: 'Plain text content' },
        emailType: { type: 'string', enum: ['template', 'list'], description: 'Email type' },
        template: { type: 'string', description: 'Mautic email theme/template key' },
        language: { type: 'string', description: 'Email language/locale, for example zh_CN' },
        category: { type: 'number', description: 'Category ID' },
        isPublished: { type: 'boolean', description: 'Publication state' },
        publishUp: { type: 'string', description: 'Publish-up date/time' },
        publishDown: { type: 'string', description: 'Publish-down date/time' },
        minimal: { type: 'boolean', description: 'Return compact email metadata and counters' },
        includeContent: { type: 'boolean', description: 'Include customHtml/plainText content in output (default false)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_email',
    description: 'Delete an email by ID; requires explicit confirmation',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Email ID' },
        confirmDelete: { type: 'boolean', description: 'Must be true to delete the email' },
      },
      required: ['id', 'confirmDelete'],
    },
  },
  {
    name: 'get_email_stats',
    description: 'Get email performance statistics when the stats route is available',
    inputSchema: {
      type: 'object',
      properties: {
        emailId: { type: 'number', description: 'Email ID' },
      },
      required: ['emailId'],
    },
  },

  // NEW Mautic 7 email tools
  {
    name: 'send_email_to_segment',
    description: 'Send email to its assigned segment(s) with real-time audience adaptation (Mautic 7)',
    inputSchema: {
      type: 'object',
      properties: {
        emailId: { type: 'number', description: 'Email ID (must be a segment/list email)' },
      },
      required: ['emailId'],
    },
  },
  {
    name: 'record_email_reply',
    description: 'Record an email reply by tracking hash (Mautic 7)',
    inputSchema: {
      type: 'object',
      properties: {
        trackingHash: { type: 'string', description: 'The email tracking hash' },
      },
      required: ['trackingHash'],
    },
  },
  {
    name: 'get_email_graph_stats',
    description: 'Get email graph statistics for a date range (Mautic 7)',
    inputSchema: {
      type: 'object',
      properties: {
        emailId: { type: 'number', description: 'Email ID' },
        isVariant: { type: 'boolean', description: 'Whether this is a variant email' },
        dateFrom: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        dateTo: { type: 'string', description: 'End date (YYYY-MM-DD)' },
      },
      required: ['emailId', 'dateFrom', 'dateTo'],
    },
  },
  {
    name: 'get_email_stats_v6',
    description: 'Get Mautic 6 email aggregate counters from the email detail endpoint',
    inputSchema: {
      type: 'object',
      properties: {
        emailId: { type: 'number', description: 'Email ID' },
      },
      required: ['emailId'],
    },
  },
  {
    name: 'get_email_graph_stats_v6',
    description: 'Get Mautic 6 email graph statistics from the authenticated web stats route',
    inputSchema: {
      type: 'object',
      properties: {
        emailId: { type: 'number', description: 'Email ID' },
        isVariant: { type: 'boolean', description: 'Whether this is a variant email' },
        dateFrom: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        dateTo: { type: 'string', description: 'End date (YYYY-MM-DD)' },
      },
      required: ['emailId', 'dateFrom', 'dateTo'],
    },
  },
];

export const toolHandlers: Record<string, ToolHandler> = {
  async send_email(client: MauticApiClient, args: any) {
    const { emailId, contactIds, contactEmails } = args;
    const data: any = { id: emailId };
    if (contactIds) data.contactIds = contactIds;
    if (contactEmails) data.contactEmails = contactEmails;

    const response = await client.v1.post(`/emails/${emailId}/contact/send`, data);
    const result = buildMutationResult('sent_to_contacts', emailId, 'delivery', {
      emailId,
      contactIds: contactIds ?? [],
      contactEmails: contactEmails ?? [],
      response: response.data,
    }, { success: response.data?.success ?? true });
    return {
      content: [{ type: 'text', text: `Email sent successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async list_emails(client: MauticApiClient, args: any) {
    const params: any = {};
    setParam(params, 'search', args?.search);
    setLimitedParam(params, 'limit', args?.limit, 200);
    setParam(params, 'start', args?.start);
    setParam(params, 'publishedOnly', args?.publishedOnly);

    const response = await client.v1.get('/emails', { params });
    const emails = Object.fromEntries(
      Object.entries(response.data.emails ?? {}).map(([id, email]) => [
        id,
        formatEmailOutput(email, { minimal: args?.minimal, includeContent: args?.includeContent }),
      ]),
    );
    const result = {
      pagination: buildPagination(response.data.total, params.start, params.limit, Object.keys(emails).length),
      emails,
    };

    return {
      content: [{ type: 'text', text: `Found ${response.data.total} emails:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async get_email(client: MauticApiClient, args: any) {
    const { id } = args;
    const response = await client.v1.get(`/emails/${id}`);
    const email = formatEmailOutput(response.data.email, { minimal: args?.minimal, includeContent: args?.includeContent });

    return {
      content: [{ type: 'text', text: `Email details:\n${JSON.stringify(email, null, 2)}` }],
    };
  },

  async create_email_template(client: MauticApiClient, args: any) {
    const payload = pickEmailPayload(args);
    const response = await client.v1.post('/emails/new', payload);
    const result = normalizeEmailMutation('created', response.data, { minimal: true });
    return {
      content: [{ type: 'text', text: `Email template created successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async update_email(client: MauticApiClient, args: any) {
    const { id } = args;
    const payload = pickEmailPayload(args);

    if (Object.keys(payload).length === 0) {
      return {
        content: [{ type: 'text', text: 'No email fields provided to update.' }],
      };
    }

    const response = await client.v1.patch(`/emails/${id}/edit`, payload);
    const result = normalizeEmailMutation('updated', response.data, {
      minimal: args?.minimal,
      includeContent: args?.includeContent,
    });

    return {
      content: [{ type: 'text', text: `Email updated successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async delete_email(client: MauticApiClient, args: any) {
    const { id, confirmDelete } = args;
    if (confirmDelete !== true) {
      return {
        content: [{ type: 'text', text: `Refusing to delete email ${id}. Re-run with confirmDelete: true.` }],
      };
    }

    const existing = await client.v1.get(`/emails/${id}`);
    const existingSummary = summarizeEmail(existing.data.email);
    const response = await client.v1.delete(`/emails/${id}/delete`);
    const result = {
      success: response.data?.success ?? true,
      action: 'deleted',
      id,
      deletedEmail: existingSummary,
    };

    return {
      content: [{ type: 'text', text: `Email deleted successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async get_email_stats(client: MauticApiClient, args: any) {
    const { emailId } = args;
    try {
      const response = await client.v1.get(`/emails/${emailId}/stats`);
      return {
        content: [{ type: 'text', text: `Email statistics:\n${JSON.stringify(response.data.stats ?? response.data, null, 2)}` }],
      };
    } catch (error: any) {
      if (error?.response?.status === 404) {
        const result = {
          success: false,
          action: 'stats_unavailable',
          id: emailId,
          route: `/emails/${emailId}/stats`,
          reason: 'route_not_found',
          message: 'Mautic 6 does not expose /emails/{id}/stats through the REST API.',
          alternatives: ['get_email_stats_v6', 'get_email_graph_stats_v6'],
        };
        return {
          content: [{ type: 'text', text: `Email stats unavailable:\n${JSON.stringify(result, null, 2)}` }],
        };
      }

      throw error;
    }
  },

  // NEW Mautic 7 handlers
  async send_email_to_segment(client: MauticApiClient, args: any) {
    const { emailId } = args;
    const response = await client.v1.post(`/emails/${emailId}/send`);
    const result = buildMutationResult('sent_to_segment', emailId, 'delivery', {
      emailId,
      response: response.data,
    }, { success: response.data?.success ?? true });
    return {
      content: [{ type: 'text', text: `Email sent to segment successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async record_email_reply(client: MauticApiClient, args: any) {
    const { trackingHash } = args;
    const response = await client.v1.post(`/emails/reply/${trackingHash}`);
    const result = buildMutationResult('reply_recorded', trackingHash, 'reply', {
      trackingHash,
      response: response.data,
    }, { success: response.data?.success ?? true });
    return {
      content: [{ type: 'text', text: `Email reply recorded successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async get_email_graph_stats(client: MauticApiClient, args: any) {
    const { emailId, dateFrom, dateTo } = args;
    const response = await client.v1.get(`/emails/${emailId}`, {
      params: { dateFrom, dateTo },
    });
    if (response.data?.email && !response.data?.stats && !response.data?.graphs) {
      const result = {
        success: false,
        action: 'graph_stats_unavailable',
        id: emailId,
        route: `/emails/${emailId}`,
        dateFrom,
        dateTo,
        reason: 'route_returned_email_detail',
        message: 'The generic Mautic 7-labeled graph stats route resolved to email detail on this Mautic instance.',
        alternatives: ['get_email_graph_stats_v6'],
      };
      return {
        content: [{ type: 'text', text: `Email graph stats unavailable:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    return {
      content: [{ type: 'text', text: `Email ${emailId} stats (${dateFrom} to ${dateTo}):\n${JSON.stringify(response.data, null, 2)}` }],
    };
  },

  async get_email_stats_v6(client: MauticApiClient, args: any) {
    const { emailId } = args;
    const response = await client.v1.get(`/emails/${emailId}`);
    const stats = {
      source: '/emails/{id} aggregate counters',
      note: 'Mautic 6 does not expose /emails/{id}/stats via the REST API. Click time-series data is available through get_email_graph_stats_v6.',
      email: summarizeEmail(response.data.email),
    };

    return {
      content: [{ type: 'text', text: `Mautic 6 email statistics:\n${JSON.stringify(stats, null, 2)}` }],
    };
  },

  async get_email_graph_stats_v6(client: MauticApiClient, args: any) {
    const { emailId, isVariant, dateFrom, dateTo } = args;
    const variant = isVariant ? 1 : 0;
    const path = `/emails-graph-stats/${encodeURIComponent(emailId)}/${variant}/${encodeURIComponent(dateFrom)}/${encodeURIComponent(dateTo)}`;
    const response = await client.web.get(path);
    const charts = extractChartsFromHtml(response.data);
    const result = {
      source: path,
      emailId,
      isVariant: Boolean(isVariant),
      dateFrom,
      dateTo,
      charts,
      note: charts.length ? undefined : 'Mautic returned no chart canvases for this range/email, usually because there is no graph data.',
    };

    return {
      content: [{ type: 'text', text: `Mautic 6 email ${emailId} graph stats (${dateFrom} to ${dateTo}):\n${JSON.stringify(result, null, 2)}` }],
    };
  },
};
