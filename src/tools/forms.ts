import type { MauticApiClient } from '../api/client.js';
import type { ToolDefinition, ToolHandler } from '../types/index.js';
import { buildPagination, hasValue, setLimitedParam, setNonNegativeParam, setParam } from './utils.js';

function summarizeForm(form: any): Record<string, unknown> {
  const fields = Array.isArray(form?.fields) ? form.fields : Object.values(form?.fields ?? {});
  const actions = Array.isArray(form?.actions) ? form.actions : Object.values(form?.actions ?? {});

  return {
    id: form?.id,
    name: form?.name,
    alias: form?.alias,
    description: form?.description,
    formType: form?.formType,
    isPublished: form?.isPublished,
    submissionCount: form?.submissionCount ?? form?.results ?? form?.submissions,
    fieldCount: fields.length,
    actionCount: actions.length,
    dateAdded: form?.dateAdded,
    dateModified: form?.dateModified,
    createdByUser: form?.createdByUser,
    modifiedByUser: form?.modifiedByUser,
  };
}

function summarizeFormField(field: any): Record<string, unknown> {
  return {
    id: field?.id,
    label: field?.label,
    alias: field?.alias,
    type: field?.type,
    isRequired: field?.isRequired,
    isVisible: field?.isVisible,
    leadField: field?.leadField,
    validationMessage: field?.validationMessage,
  };
}

function summarizeFormAction(action: any): Record<string, unknown> {
  return {
    id: action?.id,
    name: action?.name,
    type: action?.type,
    order: action?.order,
  };
}

function formatFormOutput(
  form: any,
  options: { minimal?: boolean; includeFields?: boolean; includeActions?: boolean; includeRaw?: boolean } = {},
): Record<string, unknown> {
  if (options.includeRaw) {
    return form;
  }

  const fields = Array.isArray(form?.fields) ? form.fields : Object.values(form?.fields ?? {});
  const actions = Array.isArray(form?.actions) ? form.actions : Object.values(form?.actions ?? {});
  const output: Record<string, unknown> = summarizeForm(form);

  if (options.includeFields) {
    output.fields = fields.map(summarizeFormField);
  }

  if (options.includeActions) {
    output.actions = actions.map(summarizeFormAction);
  }

  if (options.minimal || options.includeFields || options.includeActions) {
    return output;
  }

  const {
    cachedHtml: _cachedHtml,
    renderStyle: _renderStyle,
    fields: _fields,
    actions: _actions,
    ...withoutHeavyFields
  } = form ?? {};

  return {
    ...withoutHeavyFields,
    fields: fields.map(summarizeFormField),
    actions: actions.map(summarizeFormAction),
  };
}

function formatSubmission(submission: any, options: { includeRaw?: boolean } = {}): Record<string, unknown> {
  if (options.includeRaw) {
    return submission;
  }

  return {
    id: submission?.id,
    dateSubmitted: submission?.dateSubmitted ?? submission?.dateAdded,
    ipAddress: submission?.ipAddress,
    referer: submission?.referer,
    page: submission?.page,
    contactId: submission?.lead?.id ?? submission?.contact?.id ?? submission?.leadId,
    values: submission?.results ?? submission?.values ?? submission?.fields,
  };
}

function pickFormPayload(args: any): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const allowedFields = [
    'name',
    'alias',
    'description',
    'formType',
    'isPublished',
    'publishUp',
    'publishDown',
    'postAction',
    'postActionProperty',
    'inKioskMode',
    'noIndex',
    'fields',
    'actions',
  ];

  for (const field of allowedFields) {
    if (hasValue(args?.[field])) {
      payload[field] = args[field];
    }
  }

  return payload;
}

export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'list_forms',
    description: 'Get all forms with submission counts',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search term' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        start: { type: 'number', description: 'Starting offset' },
        publishedOnly: { type: 'boolean', description: 'Only published forms' },
        minimal: { type: 'boolean', description: 'Return compact form metadata and counts' },
        includeFields: { type: 'boolean', description: 'Include compact form field definitions' },
        includeActions: { type: 'boolean', description: 'Include compact form action definitions' },
        includeRaw: { type: 'boolean', description: 'Return the raw Mautic form payload' },
      },
    },
  },
  {
    name: 'get_form',
    description: 'Get form details and fields',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Form ID' },
        minimal: { type: 'boolean', description: 'Return compact form metadata and counts' },
        includeFields: { type: 'boolean', description: 'Include compact form field definitions' },
        includeActions: { type: 'boolean', description: 'Include compact form action definitions' },
        includeRaw: { type: 'boolean', description: 'Return the raw Mautic form payload' },
      },
      required: ['id'],
    },
  },
  {
    name: 'create_form',
    description: 'Create a Mautic form through the v1 form endpoint',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Form name' },
        alias: { type: 'string', description: 'Form alias' },
        description: { type: 'string', description: 'Form description' },
        formType: { type: 'string', enum: ['campaign', 'standalone'], description: 'Form type' },
        isPublished: { type: 'boolean', description: 'Publication state; defaults to false when omitted' },
        publishUp: { type: 'string', description: 'Publish-up date/time' },
        publishDown: { type: 'string', description: 'Publish-down date/time' },
        postAction: { type: 'string', description: 'Submit action, such as return or redirect' },
        postActionProperty: { type: 'string', description: 'Submit action value, such as a redirect URL' },
        inKioskMode: { type: 'boolean', description: 'Enable kiosk mode' },
        noIndex: { type: 'boolean', description: 'Prevent indexing' },
        fields: { type: 'array', description: 'Mautic form field payloads', items: { type: 'object' } },
        actions: { type: 'array', description: 'Mautic form action payloads', items: { type: 'object' } },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_form',
    description: 'Update Mautic form metadata, fields, or actions through the v1 edit endpoint',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Form ID' },
        name: { type: 'string', description: 'Form name' },
        alias: { type: 'string', description: 'Form alias' },
        description: { type: 'string', description: 'Form description' },
        formType: { type: 'string', enum: ['campaign', 'standalone'], description: 'Form type' },
        isPublished: { type: 'boolean', description: 'Publication state' },
        publishUp: { type: 'string', description: 'Publish-up date/time' },
        publishDown: { type: 'string', description: 'Publish-down date/time' },
        postAction: { type: 'string', description: 'Submit action, such as return or redirect' },
        postActionProperty: { type: 'string', description: 'Submit action value, such as a redirect URL' },
        inKioskMode: { type: 'boolean', description: 'Enable kiosk mode' },
        noIndex: { type: 'boolean', description: 'Prevent indexing' },
        fields: { type: 'array', description: 'Mautic form field payloads', items: { type: 'object' } },
        actions: { type: 'array', description: 'Mautic form action payloads', items: { type: 'object' } },
        minimal: { type: 'boolean', description: 'Return compact form metadata and counts' },
        includeFields: { type: 'boolean', description: 'Include compact form field definitions' },
        includeActions: { type: 'boolean', description: 'Include compact form action definitions' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_form',
    description: 'Delete a Mautic form by ID; requires explicit confirmation',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Form ID' },
        confirmDelete: { type: 'boolean', description: 'Must be true to delete the form' },
      },
      required: ['id', 'confirmDelete'],
    },
  },
  {
    name: 'get_form_submissions',
    description: 'Get form submission data',
    inputSchema: {
      type: 'object',
      properties: {
        formId: { type: 'number', description: 'Form ID' },
        limit: { type: 'number', description: 'Number of results', maximum: 200 },
        start: { type: 'number', description: 'Starting offset' },
        dateFrom: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        dateTo: { type: 'string', description: 'End date (YYYY-MM-DD)' },
        includeRaw: { type: 'boolean', description: 'Return raw Mautic submission payloads' },
      },
      required: ['formId'],
    },
  },
];

export const toolHandlers: Record<string, ToolHandler> = {
  async list_forms(client: MauticApiClient, args: any) {
    const params: any = {};
    setParam(params, 'search', args?.search);
    setLimitedParam(params, 'limit', args?.limit, 200);
    setNonNegativeParam(params, 'start', args?.start);
    setParam(params, 'publishedOnly', args?.publishedOnly);

    const response = await client.v1.get('/forms', { params });
    const forms = Object.fromEntries(
      Object.entries(response.data.forms ?? {}).map(([id, form]) => [
        id,
        formatFormOutput(form, {
          minimal: args?.minimal,
          includeFields: args?.includeFields,
          includeActions: args?.includeActions,
          includeRaw: args?.includeRaw,
        }),
      ]),
    );
    const result = {
      pagination: buildPagination(response.data.total, params.start, params.limit, Object.keys(forms).length),
      forms,
    };

    return {
      content: [{ type: 'text', text: `Found ${response.data.total} forms:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async get_form(client: MauticApiClient, args: any) {
    const { id } = args;
    const response = await client.v1.get(`/forms/${id}`);
    const form = formatFormOutput(response.data.form, {
      minimal: args?.minimal,
      includeFields: args?.includeFields,
      includeActions: args?.includeActions,
      includeRaw: args?.includeRaw,
    });

    return {
      content: [{ type: 'text', text: `Form details:\n${JSON.stringify(form, null, 2)}` }],
    };
  },

  async create_form(client: MauticApiClient, args: any) {
    const payload = pickFormPayload({ ...args, isPublished: args?.isPublished ?? false });
    const response = await client.v1.post('/forms/new', payload);
    const result = {
      success: response.data?.success ?? true,
      action: 'created',
      id: response.data?.form?.id,
      form: formatFormOutput(response.data.form, { minimal: true, includeFields: true, includeActions: true }),
    };

    return {
      content: [{ type: 'text', text: `Form created successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async update_form(client: MauticApiClient, args: any) {
    const { id } = args;
    const payload = pickFormPayload(args);

    if (Object.keys(payload).length === 0) {
      return {
        content: [{ type: 'text', text: 'No form fields provided to update.' }],
      };
    }

    const response = await client.v1.patch(`/forms/${id}/edit`, payload);
    const result = {
      success: response.data?.success ?? true,
      action: 'updated',
      id: response.data?.form?.id ?? id,
      form: formatFormOutput(response.data.form, {
        minimal: args?.minimal ?? true,
        includeFields: args?.includeFields,
        includeActions: args?.includeActions,
      }),
    };

    return {
      content: [{ type: 'text', text: `Form updated successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async delete_form(client: MauticApiClient, args: any) {
    const { id, confirmDelete } = args;
    if (confirmDelete !== true) {
      return {
        content: [{ type: 'text', text: `Refusing to delete form ${id}. Re-run with confirmDelete: true.` }],
      };
    }

    const existing = await client.v1.get(`/forms/${id}`);
    await client.v1.delete(`/forms/${id}/delete`);
    const result = {
      success: true,
      action: 'deleted',
      id,
      deletedForm: summarizeForm(existing.data.form),
    };

    return {
      content: [{ type: 'text', text: `Form deleted successfully:\n${JSON.stringify(result, null, 2)}` }],
    };
  },

  async get_form_submissions(client: MauticApiClient, args: any) {
    const { formId, limit, start, dateFrom, dateTo } = args;
    const params: any = {};
    setLimitedParam(params, 'limit', limit, 200);
    setNonNegativeParam(params, 'start', start);
    setParam(params, 'dateFrom', dateFrom);
    setParam(params, 'dateTo', dateTo);

    const response = await client.v1.get(`/forms/${formId}/submissions`, { params });
    const submissions = Object.fromEntries(
      Object.entries(response.data.submissions ?? {}).map(([id, submission]) => [
        id,
        formatSubmission(submission, { includeRaw: args?.includeRaw }),
      ]),
    );
    const result = {
      pagination: buildPagination(response.data.total, params.start, params.limit, Object.keys(submissions).length),
      submissions,
    };

    return {
      content: [{ type: 'text', text: `Found ${response.data.total} form submissions:\n${JSON.stringify(result, null, 2)}` }],
    };
  },
};
