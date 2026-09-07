import { readFile } from 'fs/promises';
import path from 'path';
import type { MauticApiClient } from '../api/client.js';
import type { ToolDefinition, ToolHandler } from '../types/index.js';
import { buildMutationResult, buildPagination, hasValue, setLimitedParam, setNonNegativeParam, setParam } from './utils.js';

function summarizeCategory(category: any): Record<string, unknown> | null {
  if (!category) return null;
  return {
    id: category?.id,
    title: category?.title,
    alias: category?.alias,
    bundle: category?.bundle,
  };
}

function summarizeAsset(asset: any): Record<string, unknown> {
  return {
    id: asset?.id,
    title: asset?.title,
    alias: asset?.alias,
    description: asset?.description,
    isPublished: asset?.isPublished,
    storageLocation: asset?.storageLocation,
    path: asset?.path,
    remotePath: asset?.remotePath,
    downloadCount: asset?.downloadCount ?? asset?.downloads,
    uniqueDownloadCount: asset?.uniqueDownloadCount,
    revision: asset?.revision,
    category: summarizeCategory(asset?.category),
    dateAdded: asset?.dateAdded,
    dateModified: asset?.dateModified,
    createdByUser: asset?.createdByUser,
    modifiedByUser: asset?.modifiedByUser,
  };
}

function formatAsset(asset: any, options: { minimal?: boolean; includeRaw?: boolean } = {}): Record<string, unknown> {
  if (options.includeRaw) return asset;
  if (options.minimal) return summarizeAsset(asset);

  const {
    fileContents: _fileContents,
    contents: _contents,
    ...withoutContent
  } = asset ?? {};

  return {
    ...withoutContent,
    category: summarizeCategory(asset?.category),
  };
}

function summarizePage(page: any): Record<string, unknown> {
  return {
    id: page?.id,
    title: page?.title,
    alias: page?.alias,
    isPublished: page?.isPublished,
    template: page?.template,
    hits: page?.hits,
    uniqueHits: page?.uniqueHits,
    revision: page?.revision,
    category: summarizeCategory(page?.category),
    publishUp: page?.publishUp,
    publishDown: page?.publishDown,
    dateAdded: page?.dateAdded,
    dateModified: page?.dateModified,
    createdByUser: page?.createdByUser,
    modifiedByUser: page?.modifiedByUser,
  };
}

function formatPage(
  page: any,
  options: { minimal?: boolean; includeContent?: boolean; includeRaw?: boolean } = {},
): Record<string, unknown> {
  if (options.includeRaw) return page;
  if (options.minimal) return summarizePage(page);

  const {
    customHtml: _customHtml,
    content: _content,
    variantSettings: _variantSettings,
    translationChildren: _translationChildren,
    variantChildren: _variantChildren,
    ...withoutContent
  } = page ?? {};

  return {
    ...withoutContent,
    category: summarizeCategory(page?.category),
    variantChildren: Array.isArray(page?.variantChildren) ? page.variantChildren.map(summarizePage) : page?.variantChildren,
    translationChildren: Array.isArray(page?.translationChildren) ? page.translationChildren.map(summarizePage) : page?.translationChildren,
    ...(options.includeContent ? { customHtml: page?.customHtml, content: page?.content } : {}),
  };
}

function summarizeSms(sms: any): Record<string, unknown> {
  return {
    id: sms?.id,
    name: sms?.name,
    isPublished: sms?.isPublished,
    dateAdded: sms?.dateAdded,
    dateModified: sms?.dateModified,
  };
}

function pickPayload(args: any, fields: string[]): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    if (hasValue(args?.[field])) payload[field] = args[field];
  }
  return payload;
}

const ASSET_FIELDS = ['title', 'alias', 'description', 'storageLocation', 'tempName', 'remotePath', 'category', 'isPublished', 'publishUp', 'publishDown'];
const PAGE_FIELDS = ['title', 'alias', 'customHtml', 'template', 'category', 'isPublished', 'publishUp', 'publishDown'];

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

function looksLikeFilePath(value: string): boolean {
  return value.includes('/') || value.includes('\\');
}

async function uploadLocalFile(client: MauticApiClient, filePath: string, folder = 'assets'): Promise<any> {
  const fileBuffer = await readFile(filePath);
  const fileName = path.basename(filePath);
  const form = new FormData();
  form.append('file', new Blob([fileBuffer], { type: contentTypeForFile(filePath) }), fileName);

  const response = await client.v1.post(`/files/${encodeURIComponent(folder)}/new`, form);
  return response.data.file;
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'list_assets',
    description: 'Get all assets (PDFs, images, documents)',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search term' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        start: { type: 'number', description: 'Starting offset' },
        publishedOnly: { type: 'boolean', description: 'Only published assets' },
        minimal: { type: 'boolean', description: 'Return compact asset metadata' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic asset payloads' },
      },
    },
  },
  {
    name: 'get_asset',
    description: 'Get asset details by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Asset ID' },
        minimal: { type: 'boolean', description: 'Return compact asset metadata' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic asset payload' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_asset',
    description: 'Create new asset (local or remote)',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Asset title' },
        description: { type: 'string', description: 'Asset description' },
        storageLocation: { type: 'string', enum: ['local', 'remote'], description: 'Storage location' },
        file: { type: 'string', description: 'File path (local) or URL (remote)' },
        category: { type: 'number', description: 'Category ID' },
        isPublished: { type: 'boolean', description: 'Publish immediately; defaults to false when omitted' },
      },
      required: ['title', 'storageLocation', 'file'],
    },
  },
  {
    name: 'update_asset',
    description: 'Update asset metadata through the Mautic v1 edit endpoint',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Asset ID' },
        title: { type: 'string', description: 'Asset title' },
        alias: { type: 'string', description: 'Asset alias' },
        description: { type: 'string', description: 'Asset description' },
        category: { type: 'number', description: 'Category ID' },
        isPublished: { type: 'boolean', description: 'Publication state' },
        publishUp: { type: 'string', description: 'Publish start date' },
        publishDown: { type: 'string', description: 'Publish end date' },
        minimal: { type: 'boolean', description: 'Return compact asset metadata' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_asset',
    description: 'Delete an asset by ID; requires explicit confirmation',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Asset ID' },
        confirmDelete: { type: 'boolean', description: 'Must be true to delete the asset' },
      },
      required: ['id', 'confirmDelete'],
    },
  },
  {
    name: 'list_pages',
    description: 'Get all landing pages',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search term' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        start: { type: 'number', description: 'Starting offset' },
        publishedOnly: { type: 'boolean', description: 'Only published pages' },
        minimal: { type: 'boolean', description: 'Return compact page metadata' },
        includeContent: { type: 'boolean', description: 'Include page HTML/content in output (default false)' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic page payloads' },
      },
    },
  },
  {
    name: 'get_page',
    description: 'Get landing page details by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID' },
        minimal: { type: 'boolean', description: 'Return compact page metadata' },
        includeContent: { type: 'boolean', description: 'Include page HTML/content in output (default false)' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic page payload' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_page',
    description: 'Create new landing page',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Page title' },
        alias: { type: 'string', description: 'Page alias' },
        customHtml: { type: 'string', description: 'Custom HTML content' },
        template: { type: 'string', description: 'Template name' },
        category: { type: 'number', description: 'Category ID' },
        isPublished: { type: 'boolean', description: 'Publish immediately; defaults to false when omitted' },
        publishUp: { type: 'string', description: 'Publish start date' },
        publishDown: { type: 'string', description: 'Publish end date' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_page',
    description: 'Update landing page metadata/content through the Mautic v1 edit endpoint',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID' },
        title: { type: 'string', description: 'Page title' },
        alias: { type: 'string', description: 'Page alias' },
        customHtml: { type: 'string', description: 'Custom HTML content' },
        template: { type: 'string', description: 'Template name' },
        category: { type: 'number', description: 'Category ID' },
        isPublished: { type: 'boolean', description: 'Publication state' },
        publishUp: { type: 'string', description: 'Publish start date' },
        publishDown: { type: 'string', description: 'Publish end date' },
        minimal: { type: 'boolean', description: 'Return compact page metadata' },
        includeContent: { type: 'boolean', description: 'Include page HTML/content in output (default false)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_page',
    description: 'Delete a landing page by ID; requires explicit confirmation',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Page ID' },
        confirmDelete: { type: 'boolean', description: 'Must be true to delete the page' },
      },
      required: ['id', 'confirmDelete'],
    },
  },
  {
    name: 'list_sms',
    description: '[DEPRECATED in Mautic 7] Get all SMS templates - SMS API classes have been removed',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search term' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        start: { type: 'number', description: 'Starting offset' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic SMS payloads instead of compact summaries' },
      },
    },
  },
  {
    name: 'create_sms',
    description: '[DEPRECATED in Mautic 7] Create SMS template - SMS API classes have been removed',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'SMS name' },
        message: { type: 'string', description: 'SMS message content' },
        isPublished: { type: 'boolean', description: 'Publish immediately; defaults to false when omitted' },
        dryRun: { type: 'boolean', description: 'Preview SMS creation without mutating' },
        confirmMutation: { type: 'boolean', description: 'Must be true to create the SMS template' },
      },
      required: ['name', 'message'],
    },
  },
];

export const toolHandlers: Record<string, ToolHandler> = {
  async list_assets(client: MauticApiClient, args: any) {
    const params: any = {};
    setParam(params, 'search', args?.search);
    setLimitedParam(params, 'limit', args?.limit, 200);
    setNonNegativeParam(params, 'start', args?.start);
    setParam(params, 'publishedOnly', args?.publishedOnly);

    const response = await client.v1.get('/assets', { params });
    const assets = Object.fromEntries(
      Object.entries(response.data.assets ?? {}).map(([id, asset]) => [id, formatAsset(asset, { minimal: args?.minimal, includeRaw: args?.includeRaw })]),
    );
    const result = {
      pagination: buildPagination(response.data.total, params.start, params.limit, Object.keys(assets).length),
      assets,
    };
    return {
      content: [{ type: 'text', text: `Found ${response.data.total || 0} assets:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async get_asset(client: MauticApiClient, args: any) {
    const { id } = args;
    const response = await client.v1.get(`/assets/${id}`);
    const asset = formatAsset(response.data.asset, { minimal: args?.minimal, includeRaw: args?.includeRaw });
    return {
      content: [{ type: 'text', text: `Asset details:\n${JSON.stringify(asset, null, 2)}` }],
    };
  },

  async create_asset(client: MauticApiClient, args: any) {
    const payload: any = {
      title: args.title,
      description: args.description || '',
      storageLocation: args.storageLocation,
      isPublished: args.isPublished ?? false,
    };

    if (args.storageLocation === 'local' && looksLikeFilePath(args.file)) {
      const uploadedFile = await uploadLocalFile(client, args.file, 'media');
      payload.file = uploadedFile?.name;
    } else {
      payload.file = args.file;
    }
    setParam(payload, 'category', args.category);

    const response = await client.v1.post('/assets/new', payload);
    const result = {
      success: response.data?.success ?? true,
      action: 'created',
      id: response.data?.asset?.id,
      asset: formatAsset(response.data.asset, { minimal: true }),
    };
    return {
      content: [{ type: 'text', text: `Asset created successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async update_asset(client: MauticApiClient, args: any) {
    const { id } = args;
    const payload = pickPayload(args, ASSET_FIELDS);
    if (Object.keys(payload).length === 0) {
      return { content: [{ type: 'text', text: 'No asset fields provided to update.' }] };
    }

    const response = await client.v1.patch(`/assets/${id}/edit`, payload);
    const result = {
      success: response.data?.success ?? true,
      action: 'updated',
      id: response.data?.asset?.id ?? id,
      asset: formatAsset(response.data.asset, { minimal: args?.minimal ?? true }),
    };
    return {
      content: [{ type: 'text', text: `Asset updated successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async delete_asset(client: MauticApiClient, args: any) {
    const { id, confirmDelete } = args;
    if (confirmDelete !== true) {
      return { content: [{ type: 'text', text: `Refusing to delete asset ${id}. Re-run with confirmDelete: true.` }] };
    }

    const existing = await client.v1.get(`/assets/${id}`);
    await client.v1.delete(`/assets/${id}/delete`);
    const result = {
      success: true,
      action: 'deleted',
      id,
      deletedAsset: summarizeAsset(existing.data.asset),
    };
    return {
      content: [{ type: 'text', text: `Asset deleted successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async list_pages(client: MauticApiClient, args: any) {
    const params: any = {};
    setParam(params, 'search', args?.search);
    setLimitedParam(params, 'limit', args?.limit, 200);
    setNonNegativeParam(params, 'start', args?.start);
    setParam(params, 'publishedOnly', args?.publishedOnly);

    const response = await client.v1.get('/pages', { params });
    const pages = Object.fromEntries(
      Object.entries(response.data.pages ?? {}).map(([id, page]) => [
        id,
        formatPage(page, { minimal: args?.minimal, includeContent: args?.includeContent, includeRaw: args?.includeRaw }),
      ]),
    );
    const result = {
      pagination: buildPagination(response.data.total, params.start, params.limit, Object.keys(pages).length),
      pages,
    };
    return {
      content: [{ type: 'text', text: `Found ${response.data.total || 0} pages:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async get_page(client: MauticApiClient, args: any) {
    const { id } = args;
    const response = await client.v1.get(`/pages/${id}`);
    const page = formatPage(response.data.page, {
      minimal: args?.minimal,
      includeContent: args?.includeContent,
      includeRaw: args?.includeRaw,
    });

    return {
      content: [{ type: 'text', text: `Page details:\n${JSON.stringify(page, null, 2)}` }],
    };
  },

  async create_page(client: MauticApiClient, args: any) {
    const payload: any = {
      title: args.title,
      isPublished: args.isPublished ?? false,
    };
    setParam(payload, 'alias', args.alias);
    setParam(payload, 'customHtml', args.customHtml);
    setParam(payload, 'template', args.template);
    setParam(payload, 'category', args.category);
    setParam(payload, 'publishUp', args.publishUp);
    setParam(payload, 'publishDown', args.publishDown);

    const response = await client.v1.post('/pages/new', payload);
    const result = {
      success: response.data?.success ?? true,
      action: 'created',
      id: response.data?.page?.id,
      page: formatPage(response.data.page, { minimal: true }),
    };
    return {
      content: [{ type: 'text', text: `Landing page created successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async update_page(client: MauticApiClient, args: any) {
    const { id } = args;
    const payload = pickPayload(args, PAGE_FIELDS);
    if (Object.keys(payload).length === 0) {
      return { content: [{ type: 'text', text: 'No page fields provided to update.' }] };
    }

    const response = await client.v1.patch(`/pages/${id}/edit`, payload);
    const result = {
      success: response.data?.success ?? true,
      action: 'updated',
      id: response.data?.page?.id ?? id,
      page: formatPage(response.data.page, { minimal: args?.minimal, includeContent: args?.includeContent }),
    };
    return {
      content: [{ type: 'text', text: `Landing page updated successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async delete_page(client: MauticApiClient, args: any) {
    const { id, confirmDelete } = args;
    if (confirmDelete !== true) {
      return { content: [{ type: 'text', text: `Refusing to delete page ${id}. Re-run with confirmDelete: true.` }] };
    }

    const existing = await client.v1.get(`/pages/${id}`);
    await client.v1.delete(`/pages/${id}/delete`);
    const result = {
      success: true,
      action: 'deleted',
      id,
      deletedPage: summarizePage(existing.data.page),
    };
    return {
      content: [{ type: 'text', text: `Landing page deleted successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async list_sms(client: MauticApiClient, args: any) {
    const params: any = {};
    setParam(params, 'search', args?.search);
    setLimitedParam(params, 'limit', args?.limit, 200);
    setNonNegativeParam(params, 'start', args?.start);

    const response = await client.v1.get('/smses', { params });
    const rawSmses = response.data.smses || response.data;
    const smses = args?.includeRaw === true
      ? rawSmses
      : Object.fromEntries(
          Object.entries(rawSmses ?? {}).map(([id, sms]) => [id, summarizeSms(sms)]),
        );
    const count = Array.isArray(smses) ? smses.length : Object.keys(smses ?? {}).length;
    const result = {
      pagination: buildPagination(response.data.total, params.start, params.limit, count),
      smses,
    };
    return {
      content: [{ type: 'text', text: `[WARNING] SMS API is deprecated in Mautic 7. This endpoint may not work.\nFound ${response.data.total || 0} SMS templates:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async create_sms(client: MauticApiClient, args: any) {
    const payload: any = {
      name: args.name,
      message: args.message,
      isPublished: args.isPublished ?? false,
    };

    const live = args?.dryRun === false && args?.confirmMutation === true;
    if (!live) {
      const result = {
        success: true,
        dryRun: true,
        action: 'sms_create_preview',
        id: null,
        sms: summarizeSms(payload),
        requiresConfirmation: true,
        confirmation: { tool: 'create_sms', requiredArgs: { dryRun: false, confirmMutation: true } },
      };
      return {
        content: [{ type: 'text', text: `[WARNING] SMS API is deprecated in Mautic 7. This endpoint may not work.\nSMS template create preview; no SMS was created:\n${JSON.stringify(result, null, 2)}` }],
      };
    }

    const response = await client.v1.post('/smses/new', payload);
    const sms = summarizeSms(response.data.sms);
    const result = buildMutationResult('created', sms.id, 'sms', sms, { success: response.data?.success ?? true });
    return {
      content: [{ type: 'text', text: `[WARNING] SMS API is deprecated in Mautic 7. This endpoint may not work.\nSMS template created successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },
};
