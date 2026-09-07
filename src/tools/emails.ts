import type { MauticApiClient } from '../api/client.js';
import type { ToolDefinition, ToolHandler } from '../types/index.js';
import { buildMutationResult, buildPagination, hasValue, normalizeContact, normalizeContacts, setLimitedParam, setNonNegativeParam, setParam, summarizePayload } from './utils.js';

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

function emailReadinessWarnings(email: any): string[] {
  const warnings: string[] = [];

  if (email?.isPublished === false) {
    warnings.push('Email is unpublished.');
  }

  if (!email?.subject) {
    warnings.push('Email subject is empty.');
  }

  return warnings;
}

function contactHasDnc(contact: any): boolean {
  const dnc = contact?.doNotContact;
  if (Array.isArray(dnc)) {
    return dnc.length > 0;
  }
  if (dnc && typeof dnc === 'object') {
    return Object.keys(dnc).length > 0;
  }
  return false;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numberValue = Math.floor(Number(value ?? fallback));
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(Math.max(numberValue, min), max);
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

function summarizeSegment(segment: any): Record<string, unknown> {
  return {
    id: segment?.id,
    name: segment?.name,
    alias: segment?.alias,
    isPublished: segment?.isPublished,
  };
}

function extractEmailSegments(email: any): any[] {
  const candidates = [email?.lists, email?.segments, email?.list, email?.segment];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
    if (candidate && typeof candidate === 'object') {
      return Object.values(candidate);
    }
  }

  return [];
}

async function getContactByEmail(client: MauticApiClient, email: string): Promise<any | null> {
  const response = await client.v1.get('/contacts', {
    params: { search: `email:${email}`, limit: 1 },
  });

  if (Number(response.data.total ?? 0) === 0) {
    return null;
  }

  return Object.values(response.data.contacts ?? {})[0] ?? null;
}

async function getContactById(client: MauticApiClient, id: number): Promise<any | null> {
  try {
    const response = await client.v1.get(`/contacts/${id}`);
    return response.data.contact ?? null;
  } catch (_error) {
    return null;
  }
}

async function previewDirectEmailSend(client: MauticApiClient, args: any, email: any): Promise<Record<string, unknown>> {
  const contactIds = Array.from(new Set<number>((args?.contactIds ?? []).map((id: unknown) => Number(id)).filter(Number.isFinite)));
  const contactEmails = Array.from(new Set<string>((args?.contactEmails ?? []).map((email: unknown) => String(email).trim()).filter(Boolean)));
  const sampleLimit = Math.min(Math.max(Number(args?.sampleLimit ?? 10), 0), 10);
  const requireFullReadinessCheck = args?.requireFullReadinessCheck === true;
  const maxDirectIdLookups = requireFullReadinessCheck
    ? contactIds.length
    : clampInteger(args?.maxPreviewContacts, 50, 1, 500);
  const resolvedFromIds: any[] = [];
  const unresolvedContactIds: number[] = [];
  const resolvedFromEmails: any[] = [];
  const unresolvedEmails: string[] = [];

  for (const contactId of contactIds.slice(0, maxDirectIdLookups)) {
    const contact = await getContactById(client, contactId);
    if (contact) {
      resolvedFromIds.push(contact);
    } else {
      unresolvedContactIds.push(contactId);
    }
  }

  for (const emailAddress of contactEmails) {
    const contact = await getContactByEmail(client, emailAddress);
    if (contact) {
      resolvedFromEmails.push(contact);
    } else {
      unresolvedEmails.push(emailAddress);
    }
  }

  const resolvedContacts = [...resolvedFromIds, ...resolvedFromEmails];
  const estimatedReach = new Set([
    ...contactIds,
    ...resolvedFromEmails.map((contact: any) => Number(contact?.id)).filter(Number.isFinite),
  ]).size;
  const sampledDncContacts = resolvedContacts.filter(contactHasDnc);
  const warnings = [
    ...emailReadinessWarnings(email),
    ...(contactIds.length === 0 && contactEmails.length === 0 ? ['No direct contactIds or contactEmails were provided.'] : []),
    ...(unresolvedContactIds.length ? ['Some contactIds could not be resolved during preview.'] : []),
    ...(unresolvedEmails.length ? ['Some contactEmails could not be resolved during preview.'] : []),
    ...(contactIds.length > maxDirectIdLookups ? [`Only the first ${maxDirectIdLookups} direct contactIds were checked for DNC/readiness.`] : []),
  ];

  return {
    mode: 'direct_contacts',
    email: summarizeEmail(email),
    estimatedReach,
    contactIds,
    contactEmails,
    unresolvedContactIds,
    unresolvedEmails,
    uncheckedContactIdCount: Math.max(contactIds.length - maxDirectIdLookups, 0),
    readinessCheck: {
      checkedContactIdCount: resolvedFromIds.length + unresolvedContactIds.length,
      maxPreviewContacts: maxDirectIdLookups,
      requireFullReadinessCheck,
      fullReadinessChecked: contactIds.length <= maxDirectIdLookups,
    },
    sampleContacts: resolvedContacts.slice(0, sampleLimit).map(contact => normalizeContact(contact, args?.fields)),
    readiness: {
      canEstimateReach: true,
      sampledDncCount: sampledDncContacts.length,
      sampledDncContactIds: sampledDncContacts.map((contact: any) => contact?.id).filter(Boolean),
      warnings,
    },
    warnings,
    requiresConfirmation: true,
    confirmation: {
      tool: 'send_email',
      requiredArgs: { emailId: args.emailId, confirmSend: true },
    },
  };
}

async function getSegmentAudiencePreview(
  client: MauticApiClient,
  segment: any,
  sampleLimit: number,
  fields?: string[],
): Promise<Record<string, unknown>> {
  if (!segment?.alias) {
    return {
      segment: summarizeSegment(segment),
      audienceCount: null,
      sampleContacts: [],
      warning: 'segment_alias_unavailable',
    };
  }

  const response = await client.v1.get('/contacts', {
    params: {
      search: `segment:${segment.alias}`,
      limit: Math.max(sampleLimit, 1),
    },
  });

  const rawContacts = Object.values(response.data.contacts ?? {});

  return {
    segment: summarizeSegment(segment),
    audienceCount: Number(response.data.total ?? 0),
    sampleContacts: sampleLimit > 0 ? normalizeContacts(response.data.contacts, fields).slice(0, sampleLimit) : [],
    sampledDncCount: sampleLimit > 0 ? rawContacts.slice(0, sampleLimit).filter(contactHasDnc).length : 0,
  };
}

async function previewSegmentEmailSend(client: MauticApiClient, args: any, email: any): Promise<Record<string, unknown>> {
  const sampleLimit = Math.min(Number(args?.sampleLimit ?? 0), 10);
  let segments = extractEmailSegments(email);

  if (args?.segmentId !== undefined) {
    const segmentResponse = await client.v1.get(`/segments/${args.segmentId}`);
    segments = [segmentResponse.data.list];
  }

  const segmentPreviews = [];
  for (const segment of segments) {
    segmentPreviews.push(await getSegmentAudiencePreview(client, segment, sampleLimit, args?.fields));
  }

  const knownAudienceCounts = segmentPreviews
    .map(preview => preview.audienceCount)
    .filter((count): count is number => typeof count === 'number');

  const warnings = [
    ...emailReadinessWarnings(email),
    ...(segments.length ? [] : ['No assigned segments found in the email payload. Pass segmentId to preview a specific segment.']),
    ...(segments.length > 1 ? ['Estimated reach sums segment counts and may double-count contacts present in multiple segments.'] : []),
  ];

  return {
    mode: 'assigned_segments',
    email: summarizeEmail(email),
    estimatedReach: knownAudienceCounts.length === segmentPreviews.length
      ? knownAudienceCounts.reduce((sum, count) => sum + count, 0)
      : null,
    segments: segmentPreviews,
    readiness: {
      canEstimateReach: knownAudienceCounts.length === segmentPreviews.length,
      sampledDncCount: segmentPreviews.reduce((sum, preview) => sum + Number(preview.sampledDncCount ?? 0), 0),
      warnings,
    },
    warnings,
    requiresConfirmation: true,
    confirmation: {
      tool: 'send_email_to_segment',
      requiredArgs: { emailId: args.emailId, confirmSend: true },
    },
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
        sampleLimit: { type: 'number', description: 'Optional number of sample contacts to include during dry-run preview, maximum 10' },
        maxPreviewContacts: { type: 'number', description: 'Maximum direct contactIds to resolve for readiness checks unless requireFullReadinessCheck is true; defaults to 50, maximum 500' },
        requireFullReadinessCheck: { type: 'boolean', description: 'Resolve every direct contactId for readiness checks, regardless of maxPreviewContacts' },
        dryRun: { type: 'boolean', description: 'Preview target resolution without sending' },
        confirmSend: { type: 'boolean', description: 'Must be true to send live email' },
      },
      required: ['emailId'],
    },
  },
  {
    name: 'preview_email_send',
    description: 'Preview an email send target and reach estimate without sending',
    inputSchema: {
      type: 'object',
      properties: {
        emailId: { type: 'number', description: 'Email ID' },
        contactIds: { type: 'array', items: { type: 'number' }, description: 'Specific contact IDs for direct send preview' },
        contactEmails: { type: 'array', items: { type: 'string' }, description: 'Specific contact emails for direct send preview' },
        segmentId: { type: 'number', description: 'Optional segment ID for audience estimate' },
        sampleLimit: { type: 'number', description: 'Optional number of sample contacts to include, maximum 10' },
        maxPreviewContacts: { type: 'number', description: 'Maximum direct contactIds to resolve for readiness checks unless requireFullReadinessCheck is true; defaults to 50, maximum 500' },
        requireFullReadinessCheck: { type: 'boolean', description: 'Resolve every direct contactId for readiness checks, regardless of maxPreviewContacts' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Contact field aliases to include in sample contacts' },
      },
      required: ['emailId'],
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
        includeRaw: { type: 'boolean', description: 'Return raw Mautic stats payload instead of compact summary' },
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
        segmentId: { type: 'number', description: 'Optional segment ID for preview only; send still uses the email assigned segment(s)' },
        sampleLimit: { type: 'number', description: 'Optional number of sample contacts to include during dry-run preview, maximum 10' },
        fields: { type: 'array', items: { type: 'string' }, description: 'Contact field aliases to include in dry-run sample contacts' },
        dryRun: { type: 'boolean', description: 'Preview assigned segment reach without sending' },
        confirmSend: { type: 'boolean', description: 'Must be true to send live email' },
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
        dryRun: { type: 'boolean', description: 'Preview reply recording without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to record the reply' },
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
        includeRaw: { type: 'boolean', description: 'Return raw Mautic graph stats payload instead of compact summary' },
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
    const { emailId, contactIds, contactEmails, confirmSend } = args;
    if (args?.dryRun === true || confirmSend !== true) {
      const emailResponse = await client.v1.get(`/emails/${emailId}`);
      const preview = await previewDirectEmailSend(client, args, emailResponse.data.email);
      return {
        content: [{ type: 'text', text: `Email send preview; no email was sent:\n${JSON.stringify(preview, null, 2)}` }],
      };
    }

    const hasDirectTargets = (Array.isArray(contactIds) && contactIds.length > 0) || (Array.isArray(contactEmails) && contactEmails.length > 0);
    if (!hasDirectTargets) {
      const result = {
        success: false,
        action: 'send_rejected',
        id: emailId,
        reason: 'missing_direct_targets',
        message: 'Pass contactIds or contactEmails before confirming a direct email send.',
      };
      return {
        content: [{ type: 'text', text: `Email send rejected:\n${JSON.stringify(result, null, 2)}` }],
        isError: true,
      };
    }

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

  async preview_email_send(client: MauticApiClient, args: any) {
    const emailResponse = await client.v1.get(`/emails/${args.emailId}`);
    const email = emailResponse.data.email;
    const hasDirectTargets = Array.isArray(args?.contactIds) || Array.isArray(args?.contactEmails);
    const preview = hasDirectTargets
      ? await previewDirectEmailSend(client, args, email)
      : await previewSegmentEmailSend(client, args, email);

    return {
      content: [{ type: 'text', text: `Email send preview; no email was sent:\n${JSON.stringify(preview, null, 2)}` }],
    };
  },

  async list_emails(client: MauticApiClient, args: any) {
    const params: any = {};
    setParam(params, 'search', args?.search);
    setLimitedParam(params, 'limit', args?.limit, 200);
    setNonNegativeParam(params, 'start', args?.start);
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
      const stats = args?.includeRaw === true ? response.data.stats ?? response.data : summarizePayload(response.data.stats ?? response.data);
      return {
        content: [{ type: 'text', text: `Email statistics:\n${JSON.stringify(stats, null, 2)}` }],
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
    const { emailId, confirmSend } = args;
    if (args?.dryRun === true || confirmSend !== true) {
      const emailResponse = await client.v1.get(`/emails/${emailId}`);
      const preview = await previewSegmentEmailSend(client, args, emailResponse.data.email);
      return {
        content: [{ type: 'text', text: `Segment email send preview; no email was sent:\n${JSON.stringify(preview, null, 2)}` }],
      };
    }

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
    const live = args?.dryRun === false && args?.confirmMutation === true;
    if (!live) {
      const result = {
        success: true,
        dryRun: true,
        action: 'reply_record_preview',
        id: trackingHash,
        reply: { trackingHash },
        requiresConfirmation: true,
        confirmation: { tool: 'record_email_reply', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `Email reply record preview; no reply was recorded:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

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

    const stats = args?.includeRaw === true ? response.data : summarizePayload(response.data);
    return {
      content: [{ type: 'text', text: `Email ${emailId} stats (${dateFrom} to ${dateTo}):\n${JSON.stringify(stats, null, 2)}` }],
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
